import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildPackage } from '../package/build.mjs';
import { checkContent } from './content.mjs';
import * as governance from './governance.mjs';
import { PRODUCTS, sha256, digest, readJSON, writeJSON, git, parseArgs, requireValue, main } from './lib.mjs';
import { sourceIdentity, assertManifest, assertGithubReport } from './manifest.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`${command} failed in ${cwd}: ${result.error?.message || result.stderr || result.stdout}`);
  return result.stdout;
}
export async function collectGithubReport(product, inspect = governance.inspectReleaseGovernance) {
  if (!PRODUCTS[product]) throw new Error('Unknown release product');
  const report = await inspect(`shendeguize/${PRODUCTS[product].repo}`);
  assertGithubReport(report, product);
  return { ...report, gate: 'github', product };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(async () => {
  const options = parseArgs(); const out = path.resolve(requireValue(options, 'out')); const version = options.version || readJSON(path.join(ROOT, 'package.json')).version;
  if (fs.existsSync(path.join(out, 'release-manifest.json'))) throw new Error('Candidate destination already contains a manifest; preserve it and use a new directory');
  fs.mkdirSync(out, { recursive: true });
  const sources = Object.fromEntries(Object.entries(PRODUCTS).map(([product, spec]) => {
    const repo = path.join(ROOT, spec.directory); const dirty = Boolean(git(repo, 'status', '--porcelain=v1'));
    if (dirty && !options['allow-dirty']) throw new Error(`Uncommitted source: ${product}`);
    return [product, { repository: `shendeguize/${spec.repo}`, commit: git(repo, 'rev-parse', 'HEAD'), dirty }];
  }));
  const manifest = { schema_version: 1, version, channel: version.includes('-rc.') ? 'rc' : 'stable', state: 'prepared', sources, artifacts: {}, evidence: [] };
  if (options['approved-rc']) manifest.approved_rc = readJSON(options['approved-rc']);
  else if (manifest.channel === 'stable') manifest.approved_rc = { version: process.env.APPROVED_RC_VERSION, manifest_sha256: process.env.APPROVED_RC_MANIFEST_SHA256 };
  manifest.source_digest = sourceIdentity(manifest); assertManifest(manifest);
  const pendingReports = [];
  const addReport = (name, report) => pendingReports.push({ name, report });
  for (const [product, spec] of Object.entries(PRODUCTS)) {
    const repo = path.join(ROOT, spec.directory);
    const built = buildPackage({ product, out, version });
    manifest.artifacts[product] = { file: path.basename(built.tarball), sha256: built.sha256 };
    const packageResult = JSON.parse(run(process.execPath, ['scripts/package/check.mjs', '--package', built.tarball], ROOT));
    addReport(`${product}-package`, { gate: 'package', product, status: packageResult.passed ? 'passed' : 'failed', ...packageResult });
    const content = checkContent(repo); addReport(`${product}-content`, { ...content, gate: 'content', product });
    if (!options['skip-site']) {
      const output = run(process.execPath, [repo === ROOT ? 'scripts/release/site.mjs' : 'scripts/site.mjs', 'check'], repo);
      addReport(`${product}-site`, { gate: 'site', product, status: 'passed', output });
    }
    if (!options['skip-github']) addReport(`${product}-github`, await collectGithubReport(product));
  }
  for (const { name, report } of pendingReports) {
    const file = `reports/${name}.json`;
    writeJSON(path.join(out, file), { ...report, source_digest: manifest.source_digest, artifact_digest: digest(manifest.artifacts) });
    manifest.evidence.push({ file, sha256: sha256(fs.readFileSync(path.join(out, file))) });
  }
  writeJSON(path.join(out, 'release-manifest.json'), manifest);
  console.log(JSON.stringify({ status: 'prepared', manifest_sha256: digest(manifest), source_digest: manifest.source_digest,
    remaining: 'Three-platform installer reports, six-agent actual smoke/full reports with independent assessment, and every failed/missing gate must be completed before sealing.' }, null, 2));
});
