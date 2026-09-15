import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRODUCTS, AGENTS, PLATFORMS, sha256, digest, readJSON, writeJSON, confined, git, parseArgs, requireValue, main } from './lib.mjs';

import { checkPackage } from '../package/check.mjs';
import { collectEvidenceClosure, validateApprovedAgentReport, validateTrustedEvidence } from './evidence.mjs';

const HEX = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
export const sourceIdentity = manifest => digest({ version: manifest.version, sources: manifest.sources });
export function assertManifest(manifest, { publish = false } = {}) {
  if (manifest.schema_version !== 1 || !/^1\.0\.0(?:-rc\.[1-9]\d*)?$/.test(manifest.version)) throw new Error('Invalid release manifest/version');
  const rc = manifest.version.includes('-rc.');
  if (manifest.channel !== (rc ? 'rc' : 'stable')) throw new Error('Release channel does not match version');
  if (Object.keys(manifest.sources || {}).sort().join() !== Object.keys(PRODUCTS).sort().join()) throw new Error('All three source identities are required');
  for (const [product, definition] of Object.entries(PRODUCTS)) {
    const source = manifest.sources[product];
    if (source.repository !== `shendeguize/${definition.repo}` || !COMMIT.test(source.commit)) throw new Error(`Invalid source identity: ${product}`);
    if (publish && source.dirty) throw new Error(`Uncommitted source cannot be published: ${product}`);
  }
  if (manifest.source_digest !== sourceIdentity(manifest)) throw new Error('Source digest mismatch');
  if (publish && manifest.state !== 'validated') throw new Error('Candidate has not completed all validation gates');
  if (!rc && (!manifest.approved_rc || !/^1\.0\.0-rc\.[1-9]\d*$/.test(manifest.approved_rc.version) || !HEX.test(manifest.approved_rc.manifest_sha256))) throw new Error('Stable publication needs an exact approved RC manifest');
  return manifest;
}
export function assertArtifact(root, artifact) {
  if (!artifact || !HEX.test(artifact.sha256)) throw new Error('Missing artifact checksum');
  const file = confined(root, artifact.file);
  if (!fs.statSync(file).isFile() || sha256(fs.readFileSync(file)) !== artifact.sha256) throw new Error(`Artifact checksum mismatch: ${artifact.file}`);
  return file;
}
export function assertGithubReport(report, product) {
  const repository = PRODUCTS[product] && `shendeguize/${PRODUCTS[product].repo}`;
  if (!repository || report?.status !== 'passed' || report.repository !== repository || report.security?.status !== 'passed' || report.security.repository !== repository) throw new Error(`Missing, failed or unrelated GitHub governance/security inspection: ${product}`);
  return report;
}
export function validateEvidence(manifest, root, options = {}) {
  assertManifest(manifest);
  validateTrustedEvidence(manifest, root, options);
  const reports = (manifest.evidence || []).map(item => {
    const report = readJSON(assertArtifact(root, item));
    if (report.status !== 'passed' || report.source_digest !== manifest.source_digest || report.artifact_digest !== digest(manifest.artifacts)) throw new Error(`Unsuccessful or unrelated evidence: ${item.file}`);
    if (report.gate === 'agents') validateApprovedAgentReport(root, report);
    if (report.gate === 'github') assertGithubReport(report, report.product);
    return report;
  });
  for (const gate of ['content', 'site', 'package', 'github']) {
    for (const product of Object.keys(PRODUCTS)) {
      if (!reports.some(r => r.gate === gate && r.product === product)) throw new Error(`Missing ${gate} evidence: ${product}`);
    }
  }
  for (const platform of PLATFORMS) {
    if (!reports.some(r => r.gate === 'install' && r.platform === platform && r.lifecycle === 'complete')) throw new Error(`Missing installer lifecycle: ${platform}`);
    for (const agent of AGENTS) {
      const report = reports.find(r => r.gate === 'agents' && r.agent === agent && r.platform === platform && r.matrix === 'smoke');
      if (!report || !report.actual_call || !report.independent_reviewer || !report.raw_response || !report.tool_version || !report.model) throw new Error(`Missing actual agent smoke: ${agent}/${platform}`);
      assertArtifact(root, report.raw_response);
    }
  }
  for (const agent of AGENTS) {
    const report = reports.find(r => r.gate === 'agents' && r.agent === agent && r.platform === 'linux' && r.matrix === 'full');
    if (!report || !report.actual_call || !report.independent_reviewer || !report.raw_response || !report.all_non_lean_skills || !report.independent_assessment) throw new Error(`Missing complete actual methods: ${agent}`);
    assertArtifact(root, report.raw_response);
    assertArtifact(root, report.independent_assessment);
  }
  validateReleasePackages(manifest, root);
  collectEvidenceClosure(manifest, root);
  return reports;
}
export function validateReleasePackages(manifest, root) {
  assertManifest(manifest);
  for (const [product] of Object.entries(PRODUCTS)) {
    const checked = checkPackage(assertArtifact(root, manifest.artifacts?.[product]));
    if (checked.product !== product || checked.version !== manifest.version) throw new Error('Package product/version does not match release: ' + product);
    for (const [sourceProduct, source] of Object.entries(manifest.sources)) {
      if (checked.snapshots[PRODUCTS[sourceProduct].repo] !== source.commit) throw new Error('Package source snapshots differ from release: ' + product + '/' + sourceProduct);
    }
  }
  return true;
}
export function assertDispatch(manifest, environment, product = 'agent-organon') {
  assertManifest(manifest, { publish: true });
  if (environment.RELEASE_VERSION && environment.RELEASE_VERSION !== manifest.version) throw new Error('Dispatch version differs from approved manifest');
  if (environment.GITHUB_ACTIONS !== 'true' || environment.GITHUB_EVENT_NAME !== 'workflow_dispatch') throw new Error('Publication runs only through explicitly dispatched GitHub Actions');
  if (!PRODUCTS[product] || environment.GITHUB_REPOSITORY !== `shendeguize/${PRODUCTS[product].repo}`) throw new Error('Wrong publication repository');
  if (environment.RELEASE_MANIFEST_SHA256 !== digest(manifest)) throw new Error('Approved manifest identity mismatch');
  if (environment.GITHUB_SHA !== manifest.sources[product].commit) throw new Error('Workflow commit does not match release source');
  if (environment.GITHUB_REF !== 'refs/heads/release/1.0.0') throw new Error('Publication must run from release/1.0.0');
  if (manifest.channel === 'stable' && environment.APPROVED_RC_MANIFEST_SHA256 !== manifest.approved_rc.manifest_sha256) throw new Error('Stable RC approval identity mismatch');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(() => {
  const options = parseArgs();
  const mode = options._[0] || 'check';
  if (mode === 'prepare') {
    const workspace = path.resolve(options.workspace || '.');
    const version = requireValue(options, 'version');
    const sources = Object.fromEntries(Object.entries(PRODUCTS).map(([product, spec]) => {
      const repo = path.join(workspace, spec.directory);
      const dirty = Boolean(git(repo, 'status', '--porcelain=v1', '--untracked-files=normal'));
      if (dirty && !options['allow-dirty']) throw new Error(`Source has uncommitted work: ${product}`);
      return [product, { repository: `shendeguize/${spec.repo}`, commit: git(repo, 'rev-parse', 'HEAD'), dirty }];
    }));
    const manifest = { schema_version: 1, version, channel: version.includes('-rc.') ? 'rc' : 'stable', state: 'prepared', sources, artifacts: {}, evidence: [] };
    if (options['approved-rc']) manifest.approved_rc = readJSON(options['approved-rc']);
    manifest.source_digest = sourceIdentity(manifest);
    assertManifest(manifest);
    writeJSON(requireValue(options, 'out'), manifest);
    console.log(JSON.stringify({ status: 'prepared', source_digest: manifest.source_digest }));
  } else if (mode === 'check' || mode === 'seal') {
    const file = path.resolve(requireValue(options, 'manifest'));
    const manifest = readJSON(file);
    validateEvidence(manifest, path.dirname(file), { sealing: mode === 'seal' });
    if (mode === 'seal') { manifest.state = 'validated'; assertManifest(manifest, { publish: true }); writeJSON(requireValue(options, 'out'), manifest); }
    console.log(JSON.stringify({ status: 'passed', manifest_sha256: digest(manifest), source_digest: manifest.source_digest }));
  } else throw new Error(`Unknown manifest command: ${mode}`);
});
