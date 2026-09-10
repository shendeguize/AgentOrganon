import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { coreWarnings, parseFrontmatter, renderFrontmatter, SEMVER } from './frontmatter.js';
import { hash, parseDocument, withoutExtensions } from './sections.js';
import { checkpoint, initialLock, validateLock } from './lock.js';
import { CORE_FILE, CORE_ID, read, json, serialize, stat, lockPath, assertWritable, assertNoPending,
  digestFile, writePair, writeNew, assertPrivateRecord } from './io.js';

export function resolvePhilosophy({ cwd = process.cwd(), philosophy } = {}) {
  cwd = path.resolve(cwd);
  let candidates;
  if (philosophy) candidates = [path.resolve(cwd, philosophy)];
  else {
    let root;
    try { root = execFileSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
    catch { root = cwd; }
    candidates = [...new Set([path.join(root, 'PHILOSOPHY.md'), path.join(cwd, 'PHILOSOPHY.md')])];
  }
  const selectedPath = candidates.find(file => stat(file));
  if (!selectedPath) throw new Error(`Philosophy not found: ${candidates.join(', ')}. ${philosophy ? 'Correct the explicit path' : 'Use organon-philosophy init'}; no Core fallback.`);
  const realPath = fs.realpathSync(selectedPath);
  const text = read(realPath);
  let metadata = null;
  const warnings = [];
  try {
    metadata = parseFrontmatter(text, { supported: false }).metadata;
    warnings.push(...coreWarnings(metadata.core_version));
    if (metadata.format_version !== '0.1.0') warnings.push('Unsupported managed format; assessment may read the selected text, but managed writes must stop.');
  } catch (error) { warnings.push(`${error.message}; version information is unknown. Managed operations require valid metadata.`); }
  return { selectedPath, realPath, referenceDirectory: path.dirname(realPath), metadata, warnings };
}

export function check(file, { source = false } = {}) {
  file = path.resolve(file);
  assertNoPending(fs.realpathSync(file));
  const document = parseDocument(read(file));
  const result = { file, realPath: fs.realpathSync(file), mode: source ? 'source' : 'managed',
    sections: document.sections.length, warnings: coreWarnings(document.metadata.core_version) };
  if (!source) {
    assertWritable(file);
    assertNoPending(file);
    const sidecar = lockPath(file);
    assertWritable(sidecar);
    validateLock(json(sidecar), document.metadata, path.basename(file));
  }
  return result;
}

export function initialize({ target, source = CORE_FILE, sourceId }) {
  if (!target) throw new Error('--target is required');
  assertWritable(target, { absent: true });
  assertWritable(lockPath(target), { absent: true });
  if (sourceId === undefined && fs.realpathSync(source) === fs.realpathSync(CORE_FILE)) sourceId = CORE_ID;
  if (typeof sourceId !== 'string' || !sourceId.trim()) throw new Error('Provide --source-id for a custom initialization source');
  assertNoPending(fs.realpathSync(source));
  const raw = read(source);
  const document = parseDocument(raw);
  const body = document.sections.some(section => section.id === 'extensions') ? document.body
    : `${document.body}${document.body.endsWith('\n') ? '' : '\n'}## 4. Extensions\n<!-- organon:id extensions -->\n`;
  const metadata = { ...document.metadata, derived_from: {
    source_id: sourceId, philosophy_version: document.metadata.philosophy_version, content_hash: hash(raw) } };
  const candidate = renderFrontmatter(metadata, body);
  parseDocument(candidate);
  writePair(target, candidate, serialize(initialLock(document, sourceId, path.basename(target))), { create: true });
  return check(target);
}

export function exportPhilosophy({ source, out, coreOnly = false, sourceId }) {
  if (!source || !out) throw new Error('--source and --out are required');
  assertWritable(out, { absent: true });
  assertNoPending(fs.realpathSync(source));
  const raw = read(source);
  const document = parseDocument(raw);
  const sidecar = lockPath(source);
  if (stat(sidecar) && json(sidecar).document_filename === path.basename(fs.realpathSync(source))) {
    const lock = validateLock(json(sidecar), document.metadata);
    sourceId ??= lock.document_id;
  } else if (fs.realpathSync(source) === fs.realpathSync(CORE_FILE)) sourceId ??= CORE_ID;
  if (typeof sourceId !== 'string' || !sourceId.trim()) throw new Error('Provide --source-id for a source without a managed document identity');
  const metadata = { ...document.metadata, derived_from: {
    source_id: sourceId, philosophy_version: document.metadata.philosophy_version, content_hash: hash(raw) } };
  const body = coreOnly ? withoutExtensions(document) : document.body;
  const output = renderFrontmatter(metadata, body);
  parseDocument(output);
  writeNew(out, output);
  return { out: path.resolve(out), source_id: sourceId, content_hash: hash(output), core_only: coreOnly };
}

export function statusOf(base, ours, theirs) {
  if (ours === theirs) return ours === base ? 'unchanged' : 'converged';
  if (ours === base) return 'theirs-changed';
  if (theirs === base) return 'ours-changed';
  return 'conflict';
}

const changeType = (oldHash, newHash) => oldHash === newHash ? 'unchanged'
  : oldHash === null ? 'added' : newHash === null ? 'deleted' : 'modified';
const sectionHashes = document => Object.fromEntries(document.sections.map(section => [section.id, section.hash]));

export function classify({ ours, theirs, sourceId, kind, baseFile }) {
  if (!ours || !theirs || !sourceId?.trim() || !['core', 'import'].includes(kind)) throw new Error('--ours, --theirs, --source-id and --kind core|import are required');
  ours = path.resolve(ours); theirs = path.resolve(theirs);
  assertNoPending(ours);
  assertNoPending(fs.realpathSync(theirs));
  const local = parseDocument(read(ours));
  const incoming = parseDocument(read(theirs));
  const sidecar = lockPath(ours);
  const lock = validateLock(json(sidecar), local.metadata, path.basename(ours));
  if ((sourceId === lock.core_source_id) !== (kind === 'core')) throw new Error('Source identity and kind disagree; imports cannot advance the Core checkpoint');
  const base = Object.hasOwn(lock.sources, sourceId) ? lock.sources[sourceId] : null;
  if (base && base.kind !== kind) throw new Error('Source kind changed');
  let baseText = null;
  if (baseFile) {
    if (!base) throw new Error('No checkpoint against which to verify --base-file');
    baseText = read(baseFile);
    const verified = parseDocument(baseText);
    if (verified.content_hash !== base.content_hash || verified.structure_hash !== base.structure_hash
      || serialize(sectionHashes(verified)) !== serialize(base.sections)) throw new Error('Base file does not match the source checkpoint');
  }
  const o = sectionHashes(local), t = sectionHashes(incoming), b = base?.sections ?? {};
  const ids = [...new Set([...Object.keys(o), ...Object.keys(t), ...Object.keys(b)])];
  const sections = ids.map(id => {
    const O = o[id] ?? null, T = t[id] ?? null, B = b[id] ?? null;
    return { id, base: base ? B : undefined, ours: O, theirs: T,
      status: base ? statusOf(B, O, T) : O === T ? 'equal' : 'different',
      ours_change: base ? changeType(B, O) : null,
      theirs_change: base ? changeType(B, T) : null,
      difference: changeType(O, T),
      suppressed: lock.declined.some(entry => entry.source_id === sourceId && entry.id === id && entry.incoming_hash === T) };
  });
  return { format_version: '0.1.0', mode: base ? 'checkpoint' : 'two-way', source_id: sourceId, kind,
    baseTextAvailable: baseText !== null, ...(baseText !== null ? { base_text: baseText } : {}),
    metadata: { ours: local.metadata, theirs: incoming.metadata },
    bindings: { ours: { path: ours, hash: digestFile(ours) }, theirs: { path: theirs, hash: digestFile(theirs) },
      lock: { path: sidecar, hash: digestFile(sidecar) } },
    sections, structure: { base: base?.structure_hash ?? null, ours: local.structure_hash, theirs: incoming.structure_hash,
      status: base ? statusOf(base.structure_hash, local.structure_hash, incoming.structure_hash)
        : local.structure_hash === incoming.structure_hash ? 'equal' : 'different',
      ours_layout: local.structure, theirs_layout: incoming.structure,
      ...(base ? { base_layout: base.structure } : {}) },
    warnings: coreWarnings(incoming.metadata.core_version) };
}

function verifyBindings(bindings) {
  for (const [label, binding] of Object.entries(bindings)) {
    if (!binding || typeof binding.path !== 'string' || digestFile(binding.path) !== binding.hash) throw new Error(`Stale ${label}: reclassify and review the changed inputs`);
  }
}

function validateCandidate(report, candidateText, decisions) {
  const candidate = parseDocument(candidateText);
  if (!decisions || !decisions.sections || Array.isArray(decisions.sections)
    || !['ours', 'theirs', 'manual', 'agent'].includes(decisions.structure)
    || !SEMVER.test(decisions.philosophy_version ?? '')) throw new Error('Invalid decisions: provide sections, structure and philosophy_version');
  const c = sectionHashes(candidate);
  for (const [id, choice] of Object.entries(decisions.sections)) {
    if (!['ours', 'theirs', 'decline', 'manual', 'agent'].includes(choice)) throw new Error(`Invalid section decision: ${id}`);
    if (!report.sections.some(row => row.id === id) && !(Object.hasOwn(c, id) && ['manual', 'agent'].includes(choice))) throw new Error(`Decision references an unknown section: ${id}`);
  }
  for (const row of report.sections) {
    const incomingChange = report.mode === 'two-way' || row.base !== row.theirs;
    const needsDecision = row.ours !== row.theirs && incomingChange && !row.suppressed;
    const choice = decisions.sections[row.id] ?? (needsDecision ? null : row.suppressed ? 'decline' : 'ours');
    if (!choice) throw new Error(`Missing decision for ${row.id}`);
    const expected = choice === 'theirs' ? row.theirs : ['ours', 'decline'].includes(choice) ? row.ours : undefined;
    if (expected !== undefined && (c[row.id] ?? null) !== expected) throw new Error(`Candidate does not implement ${choice} for ${row.id}`);
  }
  for (const id of Object.keys(c)) {
    if (!report.sections.some(row => row.id === id) && !['manual', 'agent'].includes(decisions.sections[id])) throw new Error(`Candidate adds ${id} without a manual/agent decision`);
  }
  if (['ours', 'theirs'].includes(decisions.structure) && candidate.structure_hash !== report.structure[decisions.structure]) throw new Error('Candidate does not implement the selected structure');
  const expectedCore = report.kind === 'core' ? report.metadata.theirs.core_version : report.metadata.ours.core_version;
  if (candidate.metadata.core_version !== expectedCore || candidate.metadata.philosophy_version !== decisions.philosophy_version
    || candidate.metadata.format_version !== report.metadata.ours.format_version
    || JSON.stringify(candidate.metadata.derived_from) !== JSON.stringify(report.metadata.ours.derived_from)) throw new Error('Candidate metadata does not implement the confirmed version/lineage policy');
  return candidate;
}

export function prepare({ report: reportFile, candidate: candidateFile, decisions: decisionsFile, record }) {
  if (!reportFile || !candidateFile || !decisionsFile || !record) throw new Error('--report, --candidate, --decisions and --record are required');
  const supplied = json(reportFile);
  verifyBindings(supplied.bindings);
  const ours = supplied.bindings.ours.path;
  assertWritable(ours);
  assertWritable(lockPath(ours));
  const report = classify({ ours, theirs: supplied.bindings.theirs.path, sourceId: supplied.source_id, kind: supplied.kind });
  const decisions = json(decisionsFile);
  const candidateText = read(candidateFile);
  validateCandidate(report, candidateText, decisions);
  record = assertPrivateRecord(ours, record);
  return { format_version: '0.1.0', source_id: report.source_id, kind: report.kind,
    bindings: { ...report.bindings, candidate: { path: path.resolve(candidateFile), hash: hash(candidateText) },
      decisions: { path: path.resolve(decisionsFile), hash: digestFile(decisionsFile) }, record: { path: record, hash: digestFile(record) } } };
}

export function applyPlan(planFile) {
  const plan = json(planFile);
  if (plan.format_version !== '0.1.0') throw new Error('Unsupported apply plan');
  if (Object.keys(plan.bindings ?? {}).sort().join(',') !== 'candidate,decisions,lock,ours,record,theirs') throw new Error('Incomplete apply plan bindings');
  verifyBindings(plan.bindings);
  const target = plan.bindings.ours.path;
  assertWritable(target);
  assertWritable(lockPath(target));
  if (plan.bindings.lock.path !== lockPath(target)) throw new Error('Plan lock path does not match target');
  assertPrivateRecord(target, plan.bindings.record.path);
  const report = classify({ ours: target, theirs: plan.bindings.theirs.path, sourceId: plan.source_id, kind: plan.kind });
  const decisions = json(plan.bindings.decisions.path);
  const candidateText = read(plan.bindings.candidate.path);
  const candidate = validateCandidate(report, candidateText, decisions);
  const lock = json(lockPath(target));
  const incoming = parseDocument(read(plan.bindings.theirs.path));
  lock.sources = { ...lock.sources, [plan.source_id]: checkpoint(incoming, plan.kind) };
  if (plan.kind === 'core') lock.core_version = incoming.metadata.core_version;
  const currentSourceDeclines = [];
  for (const row of report.sections) {
    const choice = decisions.sections[row.id] ?? (row.suppressed ? 'decline' : 'ours');
    const reviewable = report.mode === 'two-way' || row.base !== row.theirs;
    if (row.ours !== row.theirs && (((reviewable || row.suppressed) && choice === 'ours') || choice === 'decline')) {
      currentSourceDeclines.push({ source_id: plan.source_id, id: row.id, incoming_hash: row.theirs });
    }
  }
  lock.declined = [...lock.declined.filter(entry => entry.source_id !== plan.source_id), ...currentSourceDeclines];
  validateLock(lock, candidate.metadata);
  verifyBindings(plan.bindings);
  writePair(target, candidateText, serialize(lock), { verifyInputs: () => verifyBindings(plan.bindings) });
  return { applied: target, core_version: lock.core_version, philosophy_version: candidate.metadata.philosophy_version,
    record: plan.bindings.record.path };
}
