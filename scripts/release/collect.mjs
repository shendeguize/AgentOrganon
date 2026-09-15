import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { parseArgs, requireValue, main, gh, confined, sha256, readJSON, digest, writeJSON } from './lib.mjs';
import { INVENTORY_FILE, assertSealRole, verifyReference, validateApprovedAgentReport, requireTrustedReference } from './evidence.mjs';
import { resolveAttempt, assertArtifactIdentity } from './actions-artifacts.mjs';

export function mergeArtifacts(source, target, onFile = () => {}) {
  function visit(directory, relative = '') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      const input = path.join(directory, entry.name), output = confined(target, name);
      if (entry.isSymbolicLink()) throw new Error('Symlinks are forbidden in review evidence');
      if (entry.isDirectory()) visit(input, name);
      else if (entry.isFile()) {
        const bytes = fs.readFileSync(input);
        onFile(name, sha256(bytes));
        if (fs.existsSync(output) && sha256(fs.readFileSync(output)) !== sha256(bytes)) throw new Error(`Conflicting evidence file: ${name}`);
        fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, bytes);
      } else throw new Error('Unsupported evidence object');
    }
  }
  visit(source);
}
// Reviews are derived judgments only. Execution inputs and bytes come exclusively from downloaded Actions artifacts.
export function mergeReviews(source, target, trusted) {
  const files = new Map();
  function scan(dir, prefix = '') {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const name = prefix + entry.name;
      if (entry.isDirectory()) scan(path.join(dir, entry.name), name + '/');
      else if (entry.isFile()) { confined(source, name); files.set(name, path.join(dir, entry.name)); }
      else throw new Error('Unsupported review evidence object');
    }
  }
  scan(source);
  const approved = [], allowed = new Set();
  const allow = ref => { verifyReference(source, ref); allowed.add(ref.file); };
  for (const [name, file] of files) {
    if (!name.endsWith('.json')) continue;
    const report = readJSON(file);
    if (report.gate !== 'agents' || report.status !== 'passed') continue;
    requireTrustedReference(target, trusted, report.unreviewed_report, 'agent-e2e.yml');
    const receipt = readJSON(verifyReference(source, report.review_receipt));
    allowed.add(name); allow(report.review_receipt); allow(receipt.assessment); allow(receipt.reviewer_input);
    approved.push(report);
  }
  if (!approved.length) throw new Error('No derived independent agent reviews supplied');
  for (const name of files.keys()) {
    if (!allowed.has(name) || fs.existsSync(confined(target, name)) || trusted.entries.has(name) || name === INVENTORY_FILE || name === 'release-manifest.json') throw new Error('Review files may only add derived judgments without replacing execution evidence: ' + name);
  }
  mergeArtifacts(source, target);
  for (const report of approved) validateApprovedAgentReport(target, report);
  return approved.length;
}
export function inventoryCollector(environment = process.env) {
  return { repository: environment.GITHUB_REPOSITORY, workflow: environment.GITHUB_WORKFLOW_REF,
    source_commit: environment.GITHUB_SHA, run_id: environment.GITHUB_RUN_ID, run_attempt: environment.GITHUB_RUN_ATTEMPT };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(() => {
  const args = parseArgs(), output = path.resolve(requireValue(args, 'out'));
  const candidate = requireValue(args, 'candidate-run');
  const runs = requireValue(args, 'agent-runs').split(',');
  if (![candidate, ...runs].every(id => /^[1-9]\d*$/.test(id)) || new Set(runs).size !== runs.length || runs.length > 30) throw new Error('Expected distinct numeric workflow run IDs');
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_REPOSITORY !== 'shendeguize/AgentOrganon' || process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch') throw new Error('Evidence collection requires an explicit coordinator workflow');
  if (fs.existsSync(output) && fs.readdirSync(output).length) throw new Error('Collection output must be empty');
  const inventory = { schema_version: 1, collector: inventoryCollector(), candidate_run: candidate, runs: [], files: [] };
  const entries = new Map();
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'organon-evidence-'));
  try {
    for (const [id, workflow] of [[candidate, 'candidate.yml'], ...runs.map(id => [id, 'agent-e2e.yml'])]) {
      const { run, artifacts } = resolveAttempt(id, workflow, process.env.GITHUB_SHA);
      inventory.runs.push({ run_id: id, run_attempt: String(run.run_attempt), workflow, repository: run.repository.full_name, source_commit: run.head_sha, conclusion: run.conclusion });
      for (const artifact of artifacts) {
        const entry = artifact.name;
        const prefix = entry.startsWith('candidate-packages-') ? '' : workflow === 'candidate.yml' ? 'reports/' : 'evidence/';
        const destination = path.join(temporary, id, entry);
        execFileSync('gh', ['run', 'download', id, '--repo', 'shendeguize/AgentOrganon', '--name', entry, '--dir', destination], { stdio: 'pipe' });
        // A name cannot silently switch to a newly uploaded ID while it is downloaded.
        assertArtifactIdentity(gh([`repos/shendeguize/AgentOrganon/actions/artifacts/${artifact.id}`]), run, artifact);
        mergeArtifacts(destination, path.join(output, prefix), (name, hash) => {
          const relative = prefix + name;
          if (relative === INVENTORY_FILE) throw new Error('Downloaded artifacts cannot supply the trusted inventory');
          if (relative === 'release-manifest.json') return; // The final manifest references this inventory.
          const previous = entries.get(relative);
          if (previous && (previous.sha256 !== hash || previous.run_id !== id || previous.workflow !== workflow || previous.artifact_id !== String(artifact.id))) throw new Error('Ambiguous artifact origin: ' + relative);
          if (!previous) entries.set(relative, { path: relative, sha256: hash, run_id: id, workflow, artifact: entry, run_attempt: String(run.run_attempt), artifact_id: String(artifact.id), artifact_digest: artifact.digest });
        });
      }
    }
    const manifest = readJSON(path.join(output, 'release-manifest.json'));
    if (digest(manifest) !== requireValue(args, 'manifest-sha256')) throw new Error('Candidate identity differs from reviewed input');
    assertSealRole(manifest);
    inventory.source_digest = manifest.source_digest; inventory.artifact_digest = digest(manifest.artifacts);
    inventory.files = [...entries.values()].sort((a, b) => a.path.localeCompare(b.path));
    writeJSON(path.join(output, INVENTORY_FILE), inventory);
    const reviews = path.resolve(requireValue(args, 'reviews'));
    mergeReviews(reviews, output, { inventory, entries });
    if (digest(readJSON(path.join(output, 'release-manifest.json'))) !== digest(manifest)) throw new Error('Review files must not replace the candidate manifest');
    console.log(JSON.stringify({ status: 'collected', runs, candidate }));
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});
