import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

export const PRODUCTS = Object.freeze({
  core: { repo: 'OrganonCore', directory: 'OrganonCore', package: '@shendeguize/organon-core' },
  advised: { repo: 'AdvisedOrganons', directory: 'AdvisedOrganons', package: '@shendeguize/advised-organons' },
  'agent-organon': { repo: 'AgentOrganon', directory: '.', package: '@shendeguize/agent-organon' },
});
export const AGENTS = ['codex', 'claude', 'cursor', 'copilot', 'gemini', 'opencode'];
export const PLATFORMS = ['linux', 'darwin', 'win32'];
export const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
export const digest = value => sha256(JSON.stringify(canonical(value)));
export const readJSON = file => JSON.parse(fs.readFileSync(file, 'utf8'));
export function writeJSON(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}
export function parseArgs(argv = process.argv.slice(2)) {
  const options = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) { options._.push(token); continue; }
    const key = token.slice(2);
    if (key in options) throw new Error(`Duplicate option: ${token}`);
    options[key] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return options;
}
export function requireValue(options, key) {
  if (typeof options[key] !== 'string' || !options[key]) throw new Error(`Required: --${key} VALUE`);
  return options[key];
}
export function confined(root, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || /^[A-Za-z]:/.test(relative) || relative.includes('\\')) throw new Error('Expected relative artifact path');
  const target = path.resolve(root, relative);
  if (!target.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error('Artifact escapes its root');
  let cursor = target;
  while (cursor !== path.resolve(root)) {
    if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) throw new Error(`Symlink artifact path: ${relative}`);
    cursor = path.dirname(cursor);
  }
  return target;
}
export function git(repo, ...args) { return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
export function gh(args, body) {
  return JSON.parse(execFileSync('gh', ['api', ...args, ...(body ? ['--input', '-'] : [])], {
    input: body ? JSON.stringify(body) : undefined, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'],
  }) || 'null');
}
export function main(fn) { Promise.resolve().then(fn).catch(error => { console.error(error.message); process.exitCode = 1; }); }
