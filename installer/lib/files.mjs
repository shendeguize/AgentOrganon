import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
export const exists = file => { try { fs.lstatSync(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
export function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value);
}
export const serialize = value => `${JSON.stringify(value, null, 2)}\n`;
export function safeRelative(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0') || value.split('/').some(part => !part || part === '.' || part === '..') || /^[A-Za-z]:/.test(value)) throw new Error(`Unsafe relative path: ${value}`);
  return value;
}
export function within(root, file) {
  const relative = path.relative(root, file);
  if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) throw new Error(`Path escapes managed root: ${file}`);
  return file;
}
export function noSymlinkAncestors(file) {
  let cursor = path.resolve(file);
  for (;;) {
    if (exists(cursor) && fs.lstatSync(cursor).isSymbolicLink()) throw new Error(`Symbolic link destination is not writable: ${cursor}`);
    const parent = path.dirname(cursor);
    if (parent === cursor) return;
    cursor = parent;
  }
}
export function listFiles(root, prefix = '') {
  const result = [];
  for (const entry of fs.readdirSync(path.join(root, prefix), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) result.push(...listFiles(root, name));
    else if (entry.isFile()) result.push(name);
    else throw new Error(`Unsupported file type: ${name}`);
  }
  return result.sort();
}
