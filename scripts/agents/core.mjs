import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertManifest } from '../release/manifest.mjs';
import { sha256, digest, confined, readJSON } from '../release/lib.mjs';

export const settings = readJSON(fileURLToPath(new URL('../../release/agents.json', import.meta.url)));
export const SKILLS = ['organon-philosophy', 'organon-assess', 'organon-absorb', 'organon-principled-review', 'organon-wording-review', 'organon-core-assess', 'organon-core-absorb', 'organon-core-principled-review', 'organon-core-wording-review', 'organon-software-engineering'];
export function assertRunner(env, manifest, platform = process.platform) {
  if (env.GITHUB_ACTIONS !== 'true' || env.RUNNER_ENVIRONMENT !== 'github-hosted' || env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || env.GITHUB_REPOSITORY !== 'shendeguize/AgentOrganon' || !env.RUNNER_TEMP) throw new Error('Actual agent calls require a GitHub-hosted manually dispatched temporary runner');
  if (!['refs/heads/main', 'refs/heads/release/1.0.0'].includes(env.GITHUB_REF)) throw new Error('Unreviewed workflow ref');
  if (!['linux', 'darwin', 'win32'].includes(platform) || ({ Linux: 'linux', macOS: 'darwin', Windows: 'win32' })[env.RUNNER_OS] !== platform || env.WSL_DISTRO_NAME) throw new Error('Native runner platform mismatch');
  assertManifest(manifest);
  if (manifest.sources['agent-organon'].commit !== env.GITHUB_SHA || Object.values(manifest.sources).some(s => s.dirty)) throw new Error('Runner source does not match the clean release manifest');
  if (env.RELEASE_MANIFEST_SHA256 !== digest(manifest)) throw new Error('Approved manifest digest mismatch');
}
export function isolatedEnv(agent, home, source = process.env, { auth = false } = {}) {
  const definition = settings.agents[agent];
  if (!definition) throw new Error(`Unknown agent: ${agent}`);
  const env = {};
  for (const key of ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'LANG', 'LC_ALL', 'TERM']) if (source[key]) env[key] = source[key];
  Object.assign(env, { HOME: home, USERPROFILE: home, APPDATA: path.join(home, 'AppData/Roaming'), LOCALAPPDATA: path.join(home, 'AppData/Local'), XDG_CONFIG_HOME: path.join(home, '.config'), XDG_DATA_HOME: path.join(home, '.local/share'), XDG_CACHE_HOME: path.join(home, '.cache'), TMPDIR: path.join(home, 'tmp'), TMP: path.join(home, 'tmp'), TEMP: path.join(home, 'tmp'), npm_config_cache: path.join(home, '.npm'), npm_config_userconfig: path.join(home, '.npmrc'), CODEX_HOME: path.join(home, '.codex'), CLAUDE_CONFIG_DIR: path.join(home, '.claude'), COPILOT_HOME: path.join(home, '.copilot'), CI: 'true', NO_COLOR: '1' });
  for (const value of [home, env.APPDATA, env.LOCALAPPDATA, env.XDG_CONFIG_HOME, env.XDG_DATA_HOME, env.XDG_CACHE_HOME, env.TMPDIR, env.CODEX_HOME, env.CLAUDE_CONFIG_DIR, env.COPILOT_HOME]) fs.mkdirSync(value, { recursive: true });
  if (auth) {
    if (!source[definition.secret]) throw new Error(`Missing authentication: ${definition.secret}`);
    env[definition.child_secret] = source[definition.secret];
    if (agent === 'opencode' && !source.OPENCODE_MODEL) throw new Error('OpenCode requires explicit OPENCODE_MODEL in provider/model form');
  }
  return env;
}
export function redact(text, secrets) {
  let result = String(text ?? '');
  for (const value of [...new Set(secrets.filter(Boolean))].sort((a, b) => b.length - a.length)) {
    for (const form of new Set([value, JSON.stringify(value).slice(1, -1), encodeURIComponent(value), Buffer.from(value).toString('base64')])) result = result.split(form).join('[REDACTED]');
  }
  return result;
}
export function commandArgs(agent, prompt, model) {
  const flags = model ? ['--model', model] : [];
  switch (agent) {
    case 'codex': return ['exec', '--json', '--ephemeral', '--sandbox', 'workspace-write', '--skip-git-repo-check', ...flags, prompt];
    case 'claude': return ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'bypassPermissions', '--no-session-persistence', ...flags, prompt];
    case 'cursor': return ['-p', '--output-format', 'stream-json', '--force', '--trust', ...flags, prompt];
    case 'copilot': return ['-p', prompt, '--allow-all-tools', ...flags];
    case 'gemini': return ['-p', prompt, '--output-format', 'stream-json', '--approval-mode', 'yolo', ...flags];
    case 'opencode': return ['run', '--format', 'json', '--auto', ...flags, prompt];
    default: throw new Error('Unknown agent');
  }
}
// Raw capture precedes interpretation. Provider events never establish independent review.
export async function capture(command, args, { cwd, env, timeout = 600_000, secrets = [], maxBytes = 16 * 1024 * 1024 } = {}) {
  const start = new Date().toISOString();
  return await new Promise(resolve => {
    let stdout = '', stderr = '', timedOut = false, overflow = false, settled = false;
    const child = spawn(command, args, { cwd, env, shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    const kill = () => {
      if (process.platform === 'win32' && child.pid) spawn(path.join(env.SystemRoot || env.SYSTEMROOT || 'C:\\Windows', 'System32/taskkill.exe'), ['/pid', String(child.pid), '/t', '/f'], { env, stdio: 'ignore', windowsHide: true });
      else if (child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
    };
    const finish = (status, signal, error) => {
      if (settled) return; settled = true; clearTimeout(timer);
      resolve({ started_at: start, finished_at: new Date().toISOString(), exit_code: status, signal, error: redact(error || '', secrets), timed_out: timedOut, output_limit: overflow, stdout: redact(stdout, secrets), stderr: redact(stderr, secrets) });
    };
    const timer = setTimeout(() => { timedOut = true; kill(); }, timeout);
    for (const [stream, key] of [[child.stdout, 'stdout'], [child.stderr, 'stderr']]) stream.on('data', data => {
      if (overflow) return;
      if (key === 'stdout') stdout += data.toString(); else stderr += data.toString();
      if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > maxBytes) { overflow = true; kill(); }
    });
    child.once('error', error => finish(null, null, error.message));
    child.once('close', (status, signal) => finish(status, signal, ''));
  });
}
export function observedModels(agent, text) {
  const names = new Set();
  for (const line of text.split('\n')) {
    let value; try { value = JSON.parse(line); } catch { continue; }
    if (['cursor', 'claude'].includes(agent) && value.type === 'system' && value.subtype === 'init' && typeof value.model === 'string') names.add(value.model);
    if (agent === 'gemini' && value.type === 'init' && typeof value.model === 'string') names.add(value.model);
  }
  return [...names];
}
export function outputFile(root, file, value) {
  const target = confined(root, file); fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return { file, sha256: sha256(fs.readFileSync(target)) };
}
export function artifact(root, ref) {
  if (!ref || !/^[a-f0-9]{64}$/.test(ref.sha256 || '')) throw new Error('Missing artifact identity');
  const file = confined(root, ref.file);
  if (!fs.statSync(file).isFile() || sha256(fs.readFileSync(file)) !== ref.sha256) throw new Error(`Artifact mismatch: ${ref.file}`);
  return file;
}
export function caseTasks(matrix, probe = false) {
  if (!['smoke', 'full'].includes(matrix)) throw new Error('Matrix must be smoke or full');
  if (probe) return [{ id: 'authentication-probe', skill: null, task: 'Return the exact text ORGANON_AUTHENTICATION_PROBE. Do not access files or network tools.' }];
  const tasks = {
    'organon-philosophy': 'Inspect the adopted project philosophy and provenance using the installed management interface. Report the chosen baseline and format/version check. Do not replace or adopt anything.',
    'organon-assess': 'Assess INPUT.md against the explicitly adopted project philosophy. Distinguish unsupported inference, incompatibility and adoption.',
    'organon-absorb': 'Assess the proposed philosophy addition in INPUT.md using the installed absorption workflow. Compare retention and stop before application: no adoption is authorized.',
    'organon-principled-review': 'Perform the installed principled review of INPUT.md. Identify object standards, assumptions, relevant dimensions, alternatives and your method limits.',
    'organon-wording-review': 'Review only wording in INPUT.md with the installed method. Separate wording defects from substantive philosophical judgment; propose minimal corrections.',
    'organon-core-assess': 'Assess INPUT.md against the selected project philosophy while preserving the caller baseline. Identify grounds and limits; compatibility is not adoption.',
    'organon-core-absorb': 'Use the Core absorption method on INPUT.md with the selected project baseline. Compare no adoption; writing to the adopted philosophy is not authorized.',
    'organon-core-principled-review': 'Use the Core principled-review method on INPUT.md. Separate review standards from object commitments and assess your report and method in one bounded review.',
    'organon-core-wording-review': 'Use Core wording review on INPUT.md. Report supported grammar/precision defects, preserving conditions; wording advice is not adoption.',
    'organon-software-engineering': 'Use the domain method to assess the implementation choice in INPUT.md against the adopted SoftwareEngineering philosophy, credible evolution reasons, lifecycle and constraints.'
  };
  return (matrix === 'full' ? SKILLS : ['organon-assess']).map(skill => ({ id: skill, skill, task: tasks[skill] }));
}
export function inputText(skill) {
  if (skill?.includes('wording')) return 'Candidate wording: A system are certainly correct whenever its repeated measurements is stable. Retain any justified limits when proposing wording changes.\n';
  if (skill?.includes('absorb')) return 'Proposed addition: Every assessment must be an executable test. Grounds offered: executable tests are repeatable. No concrete adoption authorization has been given.\n';
  if (skill === 'organon-software-engineering') return 'A team proposes replacing a finite, stable dispatch table with a plugin abstraction. Its only reason is that plugins are conventional and flexible. The project has a fixed two-format contract for its declared lifecycle; no credible third format or measured change cost is supplied. Compare retention and the abstraction under these conditions.\n';
  return 'A system reports identical outputs in three repeated runs and concludes that its judgment is universally correct. No connection between those outputs and the intended claim, workload or applicability conditions is supplied. Assess only the stated evidence.\n';
}
export function requestPrompt(testCase) {
  if (!testCase.skill) return testCase.task;
  return `Use the installed ${testCase.skill} skill. Discover it through this agent tool's installed skill mechanism. Record the discovered path and actual invocation; reading an arbitrary source checkout is not an installation test. The adopted baseline is workspace PHILOSOPHY.md, selected explicitly during setup.\n\n${testCase.task}\n\nFollow required independent-first and delegation steps. Use a distinct reviewer when required, preserving its initial raw answer before disclosing your candidate. If a required step is unavailable, report it incomplete; do not simulate delegation or declare self-review independent. Do not publish or contact people. Store raw independent reviewer inputs and initial replies under review-evidence/ before comparing them with your candidate. Keep artifacts in this disposable workspace. Return grounds, findings, limits and actual reviewer/session evidence.`;
}
export const newRunId = () => crypto.randomUUID();
