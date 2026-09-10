import { randomUUID } from 'node:crypto';
import { FORMAT_VERSION, HASH, SEMVER } from './frontmatter.js';
import { ID, hash } from './sections.js';
import { CORE_ID } from './io.js';

export function checkpoint(document, kind) {
  return { kind, format_version: document.metadata.format_version,
    philosophy_version: document.metadata.philosophy_version, core_version: document.metadata.core_version,
    content_hash: document.content_hash,
    sections: Object.fromEntries(document.sections.map(section => [section.id, section.hash])),
    structure: document.structure, structure_hash: document.structure_hash };
}

export function initialLock(document, sourceId = CORE_ID, filename = 'PHILOSOPHY.md') {
  return { format_version: FORMAT_VERSION, document_id: `urn:uuid:${randomUUID()}`,
    document_filename: filename,
    core_version: document.metadata.core_version, core_source_id: sourceId,
    sources: { [sourceId]: checkpoint(document, 'core') }, declined: [] };
}

export function validateLock(lock, metadata, filename) {
  if (!lock || lock.format_version !== FORMAT_VERSION || typeof lock.document_id !== 'string' || !lock.document_id
    || typeof lock.core_source_id !== 'string' || !lock.core_source_id || !SEMVER.test(lock.core_version ?? '')
    || !lock.sources || Array.isArray(lock.sources) || !Array.isArray(lock.declined)) throw new Error('Invalid lock header');
  if (metadata && lock.core_version !== metadata.core_version) throw new Error('Document and lock core_version disagree');
  if (typeof lock.document_filename !== 'string' || !lock.document_filename || /[/\\]/.test(lock.document_filename)
    || (filename && lock.document_filename !== filename)) throw new Error('Lock belongs to a different document');
  if (!Object.hasOwn(lock.sources, lock.core_source_id)) throw new Error('Lock is missing its Core source checkpoint');
  if (lock.sources[lock.core_source_id]?.core_version !== lock.core_version) throw new Error('Core checkpoint and lock version disagree');
  for (const [id, source] of Object.entries(lock.sources)) {
    if (!id || !source || !['core', 'import'].includes(source.kind) || source.format_version !== FORMAT_VERSION
      || !SEMVER.test(source.philosophy_version ?? '') || !SEMVER.test(source.core_version ?? '')
      || !HASH.test(source.content_hash ?? '') || !source.sections || Array.isArray(source.sections)
      || !Array.isArray(source.structure) || !HASH.test(source.structure_hash ?? '')) throw new Error(`Invalid source checkpoint: ${id}`);
    if (source.kind === 'core' !== (id === lock.core_source_id)) throw new Error('Checkpoint source kind does not match its identity');
    const ids = Object.keys(source.sections);
    if (!ids.length || ids.some(key => !ID.test(key) || !HASH.test(source.sections[key]))) throw new Error('Invalid checkpoint section hashes');
    if (hash(JSON.stringify(source.structure)) !== source.structure_hash
      || source.structure.map(entry => entry.id).sort().join('\n') !== ids.sort().join('\n')) throw new Error('Incomplete or inconsistent structure checkpoint');
    const stack = [];
    for (const entry of source.structure) {
      if (!entry || !Number.isInteger(entry.level) || entry.level < 1 || entry.level > 6 || typeof entry.title !== 'string') throw new Error('Invalid checkpoint structure');
      while (stack.length && stack.at(-1).level >= entry.level) stack.pop();
      if (entry.parent !== (stack.at(-1)?.id ?? null)) throw new Error('Invalid checkpoint parent');
      stack.push(entry);
    }
  }
  const seen = new Set();
  for (const declined of lock.declined) {
    if (!declined || !Object.hasOwn(lock.sources, declined.source_id) || !ID.test(declined.id ?? '')
      || !(declined.incoming_hash === null || HASH.test(declined.incoming_hash ?? ''))) throw new Error('Invalid declined entry');
    const key = JSON.stringify([declined.source_id, declined.id]);
    if (seen.has(key)) throw new Error('Duplicate declined entry');
    seen.add(key);
  }
  return lock;
}
