import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { hash } from './sections.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const CORE_FILE = path.join(ROOT, 'OrganonCore/PHILOSOPHY.md');
export const CORE_ID = 'https://github.com/shendeguize/OrganonCore';
export const lockPath = file => path.join(path.dirname(path.resolve(file)), 'PHILOSOPHY.lock.json');
export const read = file => fs.readFileSync(file, 'utf8');
export const json = file => JSON.parse(read(file));
export const serialize = value => `${JSON.stringify(value, null, 2)}\n`;
export const digestFile = file => hash(fs.readFileSync(file));
const inside = (file, dir) => file === dir || file.startsWith(`${dir}${path.sep}`);
export function canonicalTarget(file) {
  file = path.resolve(file);
  return path.join(fs.realpathSync(path.dirname(file)), path.basename(file));
}
export function stat(file) {
  try { return fs.lstatSync(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export function assertWritable(file, { absent = false } = {}) {
  file = path.resolve(file);
  const info = stat(file);
  if (info?.isSymbolicLink()) throw new Error(`Refusing to write through or replace symlink: ${file}`);
  if (info && !info.isFile()) throw new Error(`Expected regular output file: ${file}`);
  const parent = fs.realpathSync(path.dirname(file));
  const target = path.join(parent, path.basename(file));
  const core = fs.realpathSync(path.join(ROOT, 'OrganonCore'));
  if (inside(target, core)) throw new Error('Core is a protected source; use its maintenance or absorb workflow');
  if (absent && info) throw new Error(`Output already exists: ${file}`);
  return target;
}

export function writeNew(file, text) {
  assertWritable(file, { absent: true });
  const descriptor = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  try { fs.writeFileSync(descriptor, text); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
}

export function workspaceRoot(file) {
  const cwd = path.dirname(path.resolve(file));
  try { return execFileSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return cwd; }
}

export function privateDirectory(file, { requireIgnored = true } = {}) {
  const root = workspaceRoot(file);
  if (requireIgnored) try {
    execFileSync('git', ['-C', root, 'rev-parse', '--show-toplevel'], { stdio: 'ignore' });
    try { execFileSync('git', ['-C', root, 'check-ignore', '-q', '.local/'], { stdio: 'ignore' }); }
    catch { throw new Error('Ignore .local/ in the workspace before saving private merge records'); }
  } catch (error) { if (error.message.startsWith('Ignore ')) throw error; }
  let directory = fs.realpathSync(root);
  for (const segment of ['.local', 'iterations', 'merges']) {
    directory = path.join(directory, segment);
    if (stat(directory)?.isSymbolicLink()) throw new Error('Private record directory must not be a symlink');
    if (stat(directory) && !stat(directory).isDirectory()) throw new Error('Private record path is not a directory');
  }
  return directory;
}

export function assertPrivateRecord(target, record) {
  const directory = privateDirectory(target);
  const real = fs.realpathSync(record);
  if (!inside(real, directory) || !fs.statSync(real).isFile()) throw new Error('Merge record must be a file under ignored .local/iterations/merges/');
  return real;
}

export function pendingPath(file) {
  file = canonicalTarget(file);
  return path.join(privateDirectory(file, { requireIgnored: false }), `.pending-${hash(file).slice(0, 20)}.json`);
}

export function assertNoPending(file) {
  const pending = pendingPath(file);
  if (stat(pending)) throw new Error(`Interrupted transaction: run node scripts/apply.js --recover ${path.resolve(file)}`);
}

function replace(file, content) {
  assertWritable(file);
  const temporary = path.join(path.dirname(file), `.organon-${randomUUID()}.tmp`);
  try {
    writeNew(temporary, content);
    if (stat(file)) fs.chmodSync(temporary, fs.statSync(file).mode & 0o777);
    assertWritable(file);
    fs.renameSync(temporary, file);
  } finally { if (stat(temporary)) fs.unlinkSync(temporary); }
}

export function recover(file) {
  assertWritable(file);
  file = canonicalTarget(file);
  const pending = pendingPath(file);
  if (!stat(pending)) throw new Error('No interrupted transaction for this target');
  const journal = json(pending);
  if (journal.target !== file || journal.lock !== lockPath(file)) throw new Error('Invalid transaction target');
  for (const [target, oldText, newText] of [[file, journal.oldDocument, journal.newDocument], [journal.lock, journal.oldLock, journal.newLock]]) {
    assertWritable(target);
    const current = stat(target) ? read(target) : null;
    if (current !== oldText && current !== newText) throw new Error(`Recovery stopped: ${target} changed outside the transaction`);
  }
  for (const [target, oldText] of [[file, journal.oldDocument], [journal.lock, journal.oldLock]]) {
    if (oldText === null) { if (stat(target)) fs.unlinkSync(target); }
    else replace(target, oldText);
  }
  fs.unlinkSync(pending);
  return { recovered: file };
}

// failAfterFirst is a test seam, never a CLI option or environment override.
export function writePair(file, documentText, lockText, { create = false, failAfterFirst = false, verifyInputs = () => {} } = {}) {
  assertWritable(file, { absent: create });
  file = canonicalTarget(file);
  const sidecar = lockPath(file);
  assertWritable(file, { absent: create });
  assertWritable(sidecar, { absent: create });
  assertNoPending(file);
  privateDirectory(file);
  const pending = pendingPath(file);
  fs.mkdirSync(path.dirname(pending), { recursive: true, mode: 0o700 });
  const journal = { target: file, lock: sidecar,
    oldDocument: stat(file) ? read(file) : null, oldLock: stat(sidecar) ? read(sidecar) : null,
    newDocument: documentText, newLock: lockText };
  writeNew(pending, serialize(journal));
  let started = false;
  try {
    verifyInputs();
    for (const [target, expected] of [[file, journal.oldDocument], [sidecar, journal.oldLock]]) {
      assertWritable(target, { absent: create });
      if ((stat(target) ? read(target) : null) !== expected) throw new Error('Inputs changed while acquiring the transaction; reclassify');
    }
    started = true;
    if (create) writeNew(file, documentText); else replace(file, documentText);
    if (failAfterFirst) throw new Error('Injected write failure');
    if (create) writeNew(sidecar, lockText); else replace(sidecar, lockText);
    fs.unlinkSync(pending);
  } catch (error) {
    if (!started) { fs.unlinkSync(pending); throw error; }
    try { recover(file); } catch (recovery) { throw new Error(`${error.message}; recovery pending: ${recovery.message}`); }
    throw error;
  }
}
