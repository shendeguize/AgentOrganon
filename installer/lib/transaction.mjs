import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { exists, json, serialize, write, sha256, within, noSymlinkAncestors } from './files.mjs';

const snapshot = file => exists(file) ? fs.readFileSync(file).toString('base64') : null;
function put(file, encoded) {
  if (encoded === null) { if (exists(file)) fs.unlinkSync(file); return; }
  const temporary = `${file}.organon-${randomUUID()}`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(temporary, Buffer.from(encoded, 'base64'), { flag: 'wx' });
  try { fs.renameSync(temporary, file); }
  finally { if (exists(temporary)) fs.unlinkSync(temporary); }
}
function validate(journal, scopeRoot) {
  if (journal.schema !== 1 || !Array.isArray(journal.operations)) throw new Error('Invalid recovery journal');
  for (const entry of journal.operations) {
    within(scopeRoot, entry.path); noSymlinkAncestors(entry.path);
    if (![entry.before, entry.after].includes(snapshot(entry.path))) throw new Error(`Recovery conflict: ${entry.path}; preserve the journal and inspect the changed file`);
  }
}
export function recover(store, scopeRoot) {
  const file = path.join(store, 'transaction.json');
  if (!exists(file)) return false;
  const journal = json(file); validate(journal, scopeRoot);
  for (const entry of [...journal.operations].reverse()) put(entry.path, entry.before);
  fs.unlinkSync(file);
  return true;
}
export function transact(store, scopeRoot, operations) {
  if (exists(path.join(store, 'transaction.json'))) throw new Error('Recover the pending transaction first');
  const journal = { schema: 1, operations: operations.map(({ file, content }) => {
    within(scopeRoot, file); noSymlinkAncestors(file);
    return { path: file, before: snapshot(file), after: content === null ? null : Buffer.from(content).toString('base64') };
  }) };
  const journalFile = path.join(store, 'transaction.json');
  write(journalFile, serialize(journal));
  try {
    for (const entry of journal.operations) {
      if (snapshot(entry.path) !== entry.before) throw new Error(`Concurrent edit during installation: ${entry.path}`);
      put(entry.path, entry.after);
    }
    fs.unlinkSync(journalFile);
  } catch (error) {
    recover(store, scopeRoot);
    throw error;
  }
}
export function locked(store, action) {
  noSymlinkAncestors(store); fs.mkdirSync(store, { recursive: true });
  const file = path.join(store, 'lock.json');
  if (exists(file)) {
    const lock = json(file);
    if (!Number.isSafeInteger(lock.pid) || lock.pid <= 0) throw new Error('Invalid installation lock; inspect it manually');
    let running = true;
    try { process.kill(lock.pid, 0); } catch (error) { if (error.code === 'ESRCH') running = false; }
    if (running) throw new Error(`Another installer is active (PID ${lock.pid})`);
    fs.unlinkSync(file);
  }
  const fd = fs.openSync(file, 'wx');
  fs.writeFileSync(fd, serialize({ pid: process.pid })); fs.closeSync(fd);
  try { return action(); } finally { fs.unlinkSync(file); }
}
export function matches(file, hash) { return exists(file) && fs.lstatSync(file).isFile() && sha256(fs.readFileSync(file)) === hash; }
