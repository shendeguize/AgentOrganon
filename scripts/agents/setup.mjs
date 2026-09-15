import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, requireValue, readJSON, sha256 } from '../release/lib.mjs';
import { settings, isolatedEnv, capture, outputFile } from './core.mjs';

export async function setup(options, source = process.env) {
  if (source.GITHUB_ACTIONS !== 'true' || source.RUNNER_ENVIRONMENT !== 'github-hosted' || !source.RUNNER_TEMP || source.GITHUB_EVENT_NAME !== 'workflow_dispatch') throw new Error('CLI setup is limited to temporary GitHub-hosted runners');
  const agent = requireValue(options, 'agent'), spec = settings.agents[agent];
  if (!spec) throw new Error('Unknown agent');
  const root = path.join(source.RUNNER_TEMP, 'organon-agent-tools'), directory = path.join(root, agent);
  if (fs.existsSync(directory)) throw new Error('Tool directory already exists');
  fs.mkdirSync(directory, { recursive: true });
  const env = isolatedEnv(agent, path.join(directory, 'home'), source);
  let executable, result;
  if (spec.npm) {
    const npmCandidates = [source.npm_execpath, path.resolve(path.dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js'), path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')].filter(Boolean);
    const npm = npmCandidates.find(p => fs.existsSync(p));
    if (!npm) throw new Error('Cannot locate setup-node npm CLI');
    result = await capture(process.execPath, [npm, 'install', '--prefix', directory, '--no-audit', '--no-fund', '--save-exact', spec.npm + '@' + spec.version], { cwd: directory, env, timeout: 300_000 });
    outputFile(directory, 'installation.json', result);
    if (result.exit_code !== 0 || result.timed_out) throw new Error('Pinned CLI package installation failed');
    const packageRoot = path.join(directory, 'node_modules', spec.npm), metadata = readJSON(path.join(packageRoot, 'package.json'));
    if (metadata.version !== spec.version) throw new Error('Installed npm version mismatch');
    executable = path.resolve(packageRoot, typeof metadata.bin === 'string' ? metadata.bin : Object.values(metadata.bin)[0]);
  } else {
    const installer = spec.installers[process.platform === 'win32' ? 'win32' : 'unix'];
    const response = await fetch(installer.url, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error('Cursor installer download failed');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (sha256(bytes) !== installer.sha256) throw new Error('Pinned Cursor installer changed; independently review a new version before updating its hash');
    const script = path.join(directory, process.platform === 'win32' ? 'install.ps1' : 'install.sh');
    fs.writeFileSync(script, bytes, { mode: 0o600 });
    const command = process.platform === 'win32' ? 'pwsh' : '/bin/bash';
    const args = process.platform === 'win32' ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', script] : [script];
    result = await capture(command, args, { cwd: directory, env, timeout: 300_000 });
    outputFile(directory, 'installation.json', result);
    if (result.exit_code !== 0 || result.timed_out) throw new Error('Pinned Cursor installation failed');
    executable = process.platform === 'win32' ? path.join(env.LOCALAPPDATA, 'cursor-agent/agent.exe') : path.join(env.HOME, '.local/bin/agent');
  }
  executable = fs.realpathSync(executable);
  if (!executable.startsWith(directory + path.sep)) throw new Error('Installed launcher escaped tool directory');
  const content = fs.readFileSync(executable), header = content.subarray(0, 200).toString();
  outputFile(directory, 'launcher.json', { file: path.relative(directory, executable).split(path.sep).join('/'), sha256: sha256(content), node: /^#![^\n]*\bnode\b/.test(header), version: spec.version, package_lock_sha256: fs.existsSync(path.join(directory, 'package-lock.json')) ? sha256(fs.readFileSync(path.join(directory, 'package-lock.json'))) : null, installer_sha256: spec.installers?.[process.platform === 'win32' ? 'win32' : 'unix']?.sha256 || null });
  return root;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(await setup(parseArgs())); } catch (e) { console.error(e.message); process.exitCode = 1; }
}
