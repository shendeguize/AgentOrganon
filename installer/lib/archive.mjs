import fs from 'node:fs';
import path from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { listFiles, safeRelative, write } from './files.mjs';

// A small regular-file-only ustar implementation. Archives never create links,
// devices or executable lifecycle hooks. Reject extension records and duplicates.
const text = (buffer, start, length) => buffer.subarray(start, start + length).toString('utf8').replace(/\0.*$/s, '');
function octal(buffer, start, length) {
  const value = text(buffer, start, length).trim();
  if (!/^[0-7]*$/.test(value)) throw new Error('Invalid tar numeric field');
  return parseInt(value || '0', 8);
}
export function extractTarball(file, destination) {
  const archive = gunzipSync(fs.readFileSync(file), { maxOutputLength: 64 * 1024 * 1024 });
  const entries = [];
  const names = new Set();
  let offset = 0;
  for (; offset + 512 <= archive.length; ) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const expected = octal(header, 148, 8);
    const sum = header.reduce((total, byte, index) => total + (index >= 148 && index < 156 ? 32 : byte), 0);
    if (sum !== expected) throw new Error('Invalid tar checksum');
    const prefix = text(header, 345, 155);
    const rawName = `${prefix ? `${prefix}/` : ''}${text(header, 0, 100)}`;
    const type = text(header, 156, 1);
    if (!['', '0', '5'].includes(type)) throw new Error(`Unsupported tar entry type: ${type}`);
    const name = safeRelative(rawName.replace(/\/$/, ''));
    if (name !== 'package' && !name.startsWith('package/')) throw new Error('Archive must use a package/ root');
    if (names.has(name)) throw new Error(`Duplicate tar entry: ${name}`);
    names.add(name);
    const size = octal(header, 124, 12);
    offset += 512;
    if (offset + size > archive.length) throw new Error('Truncated tar entry');
    if (type === '5' && size !== 0) throw new Error('Tar directory has content');
    if (type !== '5') entries.push([name, archive.subarray(offset, offset + size)]);
    offset += Math.ceil(size / 512) * 512;
  }
  if (archive.subarray(offset).some(byte => byte !== 0)) throw new Error('Invalid tar trailer');
  for (const [name, bytes] of entries) write(path.join(destination, name), bytes);
  return path.join(destination, 'package');
}
export function createTarball(root, destination) {
  const chunks = [];
  for (const name of listFiles(root)) {
    const full = `package/${name}`;
    let basename = full, prefix = '';
    if (Buffer.byteLength(full) > 100) {
      const split = full.lastIndexOf('/');
      prefix = full.slice(0, split); basename = full.slice(split + 1);
    }
    if (Buffer.byteLength(prefix) > 155 || Buffer.byteLength(basename) > 100) throw new Error(`Path exceeds ustar limits: ${full}`);
    const bytes = fs.readFileSync(path.join(root, name));
    const header = Buffer.alloc(512);
    const field = (value, start, length) => header.write(value, start, length, 'ascii');
    const number = (value, start, length) => field(`${value.toString(8).padStart(length - 1, '0')}\0`, start, length);
    header.write(basename, 0, 100, 'utf8');
    number(name === 'installer/organon.mjs' ? 0o755 : 0o644, 100, 8);
    number(0, 108, 8); number(0, 116, 8); number(bytes.length, 124, 12); number(0, 136, 12);
    field('        ', 148, 8); field('0', 156, 1); field('ustar\0', 257, 6); field('00', 263, 2);
    header.write(prefix, 345, 155, 'utf8');
    const sum = header.reduce((total, byte) => total + byte, 0);
    field(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8);
    chunks.push(header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512));
  }
  chunks.push(Buffer.alloc(1024));
  write(destination, gzipSync(Buffer.concat(chunks), { level: 9 }));
  return destination;
}
