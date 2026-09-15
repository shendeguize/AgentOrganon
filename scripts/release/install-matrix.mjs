import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs, requireValue, readJSON, writeJSON, digest, sha256, main } from './lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
main(() => {
  const args = parseArgs();
  const files = fs.readdirSync(path.join(root, 'tests')).filter(name => /^(installer|package).*\.test\.mjs$/.test(name)).sort().map(name => path.join(root, 'tests', name));
  const result = spawnSync(process.execPath, ['--test', ...files], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, ...(args.manifest ? { ORGANON_TEST_CANDIDATE_MANIFEST: path.resolve(args.manifest) } : {}) } });
  if (args.manifest) {
    const manifest = readJSON(args.manifest), out = path.resolve(requireValue(args, 'out'));
    if (process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_ENVIRONMENT !== 'github-hosted' || process.env.GITHUB_SHA !== manifest.sources['agent-organon'].commit) throw new Error('Release lifecycle evidence requires the exact source on a hosted runner');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const raw = `${out}.tap`; fs.writeFileSync(raw, `${result.stdout || ''}\n${result.stderr || ''}`, { flag: 'wx' });
    writeJSON(out, { gate: 'install', status: result.status === 0 ? 'passed' : 'failed', platform: process.platform, lifecycle: result.status === 0 ? 'complete' : 'incomplete',
      source_digest: manifest.source_digest, artifact_digest: digest(manifest.artifacts), node: process.version,
      ci: { run_id: process.env.GITHUB_RUN_ID, source_commit: process.env.GITHUB_SHA },
      raw_response: { file: path.relative(path.dirname(path.resolve(args.manifest)), raw).split(path.sep).join('/'), sha256: sha256(fs.readFileSync(raw)) } });
  }
  process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
});
