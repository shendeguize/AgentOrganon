import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { CORE_FILE, CORE_ID, ROOT, read, json, serialize, lockPath, writePair, pendingPath, recover, digestFile } from '../scripts/lib/io.js';
import { coreWarnings, parseFrontmatter, renderFrontmatter } from '../scripts/lib/frontmatter.js';
import { hash, parseDocument } from '../scripts/lib/sections.js';
import { statusOf, initialize, check, exportPhilosophy, classify, prepare, applyPlan, resolvePhilosophy } from '../scripts/lib/operations.js';

const write = (file, content) => fs.writeFileSync(file, typeof content === 'string' ? content : serialize(content));
const metadata = { format_version: '0.1.0', philosophy_version: '0.1.0', core_version: '0.1.0', derived_from: null };
function fixture(t, { git = false } = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'organon-test-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  if (git) {
    execFileSync('git', ['init', '-q', dir]);
    write(path.join(dir, '.gitignore'), '.local/\n');
  }
  return dir;
}
function example(a = 'Alpha.', b = 'Beta.') {
  return renderFrontmatter(metadata, `# Example\n<!-- organon:id organon.preamble -->\n\nIntroduction.\n\n## A\n<!-- organon:id example.a -->\n\n${a}\n\n## B\n<!-- organon:id example.b -->\n\n${b}\n`);
}
function managed(t, options) {
  const dir = fixture(t, options), source = path.join(dir, 'upstream.md'), ours = path.join(dir, 'PHILOSOPHY.md');
  write(source, example());
  initialize({ target: ours, source, sourceId: CORE_ID });
  return { dir, source, ours };
}
function reportFor(ctx, sourceId = CORE_ID, kind = 'core') {
  return classify({ ours: ctx.ours, theirs: ctx.source, sourceId, kind });
}
function planFor(ctx, report, candidate, decisions) {
  const directory = path.join(ctx.dir, '.local/iterations/merges');
  fs.mkdirSync(directory, { recursive: true });
  const files = Object.fromEntries(['report', 'candidate', 'decisions', 'record', 'plan'].map(key => [key, path.join(directory, `${key}.${['candidate', 'record'].includes(key) ? 'md' : 'json'}`)]));
  write(files.report, report); write(files.candidate, candidate); write(files.decisions, decisions);
  write(files.record, '# Adoption record\n\nObject and baseline; objective; grounds; alternatives; assessment; decision.\n');
  write(files.plan, prepare(files));
  return files;
}

test('source checks cover 22 matching bilingual IDs; root mirror needs no lock', () => {
  const english = parseDocument(read(CORE_FILE));
  const chinese = parseDocument(read(path.join(ROOT, 'OrganonCore/zh/PHILOSOPHY.md')));
  assert.equal(english.sections.length, 22);
  assert.deepEqual(english.sections.map(s => s.id), chinese.sections.map(s => s.id));
  assert.equal(english.sections.map(s => s.raw).join(''), english.body);
  // Core 0.1.3 after the approved Assessment clarification; change only with a reviewed text revision.
  assert.equal(hash(english.body.replace(/^<!-- organon:id [^\n]+ -->\n/gm, '')), '41496fa241aa3c3cb6e3abc83992f904f4cbc4555f6fee935b72fc799fe06ee1');
  assert.equal(hash(chinese.body.replace(/^<!-- organon:id [^\n]+ -->\n/gm, '')), '27d81360a31a44fa207bcee48d08b09da18d2f0d58beb592879b779ac5ad9cf5');
  assert.equal(check(CORE_FILE, { source: true }).mode, 'source');
  assert.equal(check(path.join(ROOT, 'PHILOSOPHY.md'), { source: true }).realPath, fs.realpathSync(CORE_FILE));
  assert.equal(fs.existsSync(path.join(ROOT, 'PHILOSOPHY.lock.json')), false);
});

test('frontmatter subset rejects unsupported syntax, duplicates and unsupported format', () => {
  for (const bad of [
    example().replace('format_version: 0.1.0', 'format_version: "0.1.0"'),
    example().replace('derived_from: null', 'unknown: value\nderived_from: null'),
    example().replace('derived_from: null', 'derived_from: null\nderived_from: null'),
    example().replace('format_version: 0.1.0', 'format_version: 0.2.0'),
    example().replace('derived_from: null', 'derived_from:\n  source_id: "x"\n  philosophy_version: 0.1.0\n  content_hash: "' + '0'.repeat(64) + '"'),
  ]) assert.throws(() => parseDocument(bad));
  const source = { source_id: 'a "quoted" source', philosophy_version: '0.1.0', content_hash: 'a'.repeat(64) };
  assert.deepEqual(parseFrontmatter(renderFrontmatter({ ...metadata, derived_from: source }, '# text')).metadata.derived_from, source);
});

test('heading units cover parent provisions and ignore fenced examples', () => {
  const body = example().replace('Alpha.', 'Parent commitment.\n\n### Child\n<!-- organon:id example.child -->\n\n```md\n## Unmanaged example\n```');
  const document = parseDocument(body);
  assert.equal(document.sections.length, 4);
  assert.match(document.sections[1].body, /Parent commitment/);
  assert.equal(document.sections[2].parent, 'example.a');
  assert.throws(() => parseDocument(example().replace('example.b', 'example.a')), /Duplicate/);
  assert.throws(() => parseDocument(example().replace('organon.preamble', 'example.intro')), /preamble/);
  assert.throws(() => parseDocument(example().replace('## A\n<!-- organon:id example.a -->', 'A\n---')), /setext/);
  assert.throws(() => parseDocument(example() + '\n```bad`\n## Hidden\n'), /fence/);
});

test('hashes normalize line endings only; title and body have separate identities', () => {
  const a = parseDocument(example()), crlf = parseDocument(example().replaceAll('\n', '\r\n'));
  assert.deepEqual(a.sections.map(s => s.hash), crlf.sections.map(s => s.hash));
  assert.notEqual(a.content_hash, crlf.content_hash);
  const space = parseDocument(example().replace('Alpha.', 'Alpha.  '));
  assert.notEqual(a.sections[1].hash, space.sections[1].hash);
  const renamed = parseDocument(example().replace('## A', '## Renamed'));
  assert.equal(a.sections[1].hash, renamed.sections[1].hash);
  assert.notEqual(a.structure_hash, renamed.structure_hash);
});

test('five mutually exclusive statuses cover presence and deletion combinations', () => {
  const cases = [
    ['a', 'a', 'a', 'unchanged'], ['a', 'b', 'b', 'converged'],
    ['a', 'a', 'b', 'theirs-changed'], ['a', 'b', 'a', 'ours-changed'], ['a', 'b', 'c', 'conflict'],
    [null, null, 'b', 'theirs-changed'], [null, 'a', 'b', 'conflict'],
    ['a', null, 'a', 'ours-changed'], ['a', 'b', null, 'conflict'], ['a', null, null, 'converged'], [null, 'a', null, 'ours-changed'],
  ];
  for (const [b, o, t, expected] of cases) assert.equal(statusOf(b, o, t), expected);
});

test('init creates a regular managed copy, lineage and empty Extensions; never overwrites', t => {
  const ctx = managed(t, { git: true });
  const document = parseDocument(read(ctx.ours)), lock = json(lockPath(ctx.ours));
  assert.equal(document.sections.at(-1).id, 'extensions');
  for (const section of parseDocument(read(ctx.source)).sections) {
    assert.equal(document.sections.find(s => s.id === section.id).hash, section.hash);
  }
  assert.equal(document.metadata.derived_from.content_hash, digestFile(ctx.source));
  assert.equal(lock.sources[CORE_ID].sections['extensions'], undefined);
  assert.equal(check(ctx.ours).mode, 'managed');
  assert.throws(() => initialize({ target: ctx.ours, source: ctx.source }), /already exists/);
  write(ctx.ours, read(ctx.ours).replace('Alpha.', 'Locally revised.'));
  assert.equal(check(ctx.ours).mode, 'managed');
});

test('resolution uses repository root then cwd and never falls back after explicit failure', t => {
  const ctx = managed(t, { git: true });
  const child = path.join(ctx.dir, 'nested'); fs.mkdirSync(child);
  write(path.join(child, 'PHILOSOPHY.md'), example('Child only.'));
  assert.equal(resolvePhilosophy({ cwd: child }).realPath, fs.realpathSync(ctx.ours));
  assert.throws(() => resolvePhilosophy({ cwd: child, philosophy: 'missing.md' }), /no Core fallback/);
  fs.unlinkSync(ctx.ours);
  assert.equal(resolvePhilosophy({ cwd: child }).realPath, fs.realpathSync(path.join(child, 'PHILOSOPHY.md')));
  fs.unlinkSync(path.join(child, 'PHILOSOPHY.md'));
  assert.throws(() => resolvePhilosophy({ cwd: child }), /init/);
});

test('core merge rejects stale candidate and lock while a valid plan applies exact choices', t => {
  const ctx = managed(t);
  write(ctx.source, example('Incoming.').replace('core_version: 0.1.0', 'core_version: 0.1.1'));
  const report = reportFor(ctx);
  assert.equal(report.sections.find(s => s.id === 'example.a').status, 'theirs-changed');
  const candidate = read(ctx.ours).replace('Alpha.', 'Incoming.').replace('core_version: 0.1.0', 'core_version: 0.1.1').replace('philosophy_version: 0.1.0', 'philosophy_version: 1.0.0');
  const decisions = { sections: { 'example.a': 'theirs' }, structure: 'ours', philosophy_version: '1.0.0' };
  const files = planFor(ctx, report, candidate, decisions);
  const oldLock = read(lockPath(ctx.ours));
  write(lockPath(ctx.ours), `${oldLock}\n`);
  assert.throws(() => applyPlan(files.plan), /Stale lock/);
  write(lockPath(ctx.ours), oldLock);
  write(files.candidate, candidate + '\n');
  assert.throws(() => applyPlan(files.plan), /Stale candidate/);
  write(files.candidate, candidate);
  applyPlan(files.plan);
  assert.equal(read(ctx.ours), candidate);
  assert.equal(json(lockPath(ctx.ours)).core_version, '0.1.1');
  assert.equal(reportFor(ctx).sections.find(s => s.id === 'example.a').status, 'unchanged');
  assert.throws(() => applyPlan(files.plan), /Stale/);
});

test('declines survive source checkpoint advance and local edits; changed source reopens proposal', t => {
  const ctx = managed(t);
  write(ctx.source, example('First incoming.'));
  const decisions = { sections: { 'example.a': 'decline' }, structure: 'ours', philosophy_version: '0.1.0' };
  const files = planFor(ctx, reportFor(ctx), read(ctx.ours), decisions);
  applyPlan(files.plan);
  let row = reportFor(ctx).sections.find(s => s.id === 'example.a');
  assert.equal(row.status, 'ours-changed'); assert.equal(row.suppressed, true);
  const again = planFor(ctx, reportFor(ctx), read(ctx.ours), { ...decisions, sections: { 'example.a': 'ours' } });
  applyPlan(again.plan);
  assert.equal(reportFor(ctx).sections.find(s => s.id === 'example.a').suppressed, true);
  assert.equal(json(lockPath(ctx.ours)).sources[CORE_ID].sections['example.a'], parseDocument(read(ctx.source)).sections[1].hash);
  write(ctx.ours, read(ctx.ours).replace('Alpha.', 'A local edit.'));
  assert.equal(reportFor(ctx).sections.find(s => s.id === 'example.a').suppressed, true);
  write(ctx.source, example('Second incoming.'));
  row = reportFor(ctx).sections.find(s => s.id === 'example.a');
  assert.equal(row.status, 'conflict'); assert.equal(row.suppressed, false);
});

test('delete/modify is conflict and declined deletion uses explicit absent state', t => {
  const ctx = managed(t);
  write(ctx.ours, read(ctx.ours).replace('Beta.', 'Local revision.'));
  const upstream = parseDocument(read(ctx.source));
  write(ctx.source, renderFrontmatter(upstream.metadata, upstream.sections.filter(s => s.id !== 'example.b').map(s => s.raw).join('')));
  const report = reportFor(ctx), row = report.sections.find(s => s.id === 'example.b');
  assert.equal(row.status, 'conflict'); assert.equal(row.theirs_change, 'deleted');
  applyPlan(planFor(ctx, report, read(ctx.ours), { sections: { 'example.b': 'decline' }, structure: 'ours', philosophy_version: '0.1.0' }).plan);
  assert.deepEqual(json(lockPath(ctx.ours)).declined, [{ source_id: CORE_ID, id: 'example.b', incoming_hash: null }]);
});

test('foreign import is two-way, scopes decline memory and does not advance Core', t => {
  const ctx = managed(t);
  write(ctx.source, example('Foreign input.').replace('core_version: 0.1.0', 'core_version: 0.9.0'));
  const before = json(lockPath(ctx.ours)).sources[CORE_ID];
  const report = reportFor(ctx, 'urn:example:foreign', 'import');
  assert.equal(report.mode, 'two-way'); assert.equal(report.sections.find(s => s.id === 'example.a').status, 'different');
  const decisions = { sections: { 'example.a': 'decline', extensions: 'ours' }, structure: 'ours', philosophy_version: '0.1.0' };
  applyPlan(planFor(ctx, report, read(ctx.ours), decisions).plan);
  const lock = json(lockPath(ctx.ours));
  assert.equal(lock.core_version, '0.1.0'); assert.deepEqual(lock.sources[CORE_ID], before);
  assert.equal(reportFor(ctx, 'urn:example:foreign', 'import').mode, 'checkpoint');
  assert.equal(reportFor(ctx, 'urn:example:different', 'import').sections.find(s => s.id === 'example.a').suppressed, false);
  assert.throws(() => reportFor(ctx, CORE_ID, 'import'), /kind disagree/);
});

test('verified old source is optional; provenance alone cannot supply base text', t => {
  const ctx = managed(t), old = path.join(ctx.dir, 'old.md'); write(old, read(ctx.source));
  write(ctx.source, example('Changed.'));
  assert.equal(reportFor(ctx).baseTextAvailable, false);
  assert.equal(classify({ ours: ctx.ours, theirs: ctx.source, sourceId: CORE_ID, kind: 'core', baseFile: old }).baseTextAvailable, true);
  write(old, read(old) + '\n');
  assert.throws(() => classify({ ours: ctx.ours, theirs: ctx.source, sourceId: CORE_ID, kind: 'core', baseFile: old }), /does not match/);
});

test('heading rename, parent and order changes are visible without invented body conflicts', t => {
  const ctx = managed(t);
  for (const transformed of [example().replace('## A', '## Renamed'), example().replace('## B', '### B'),
    renderFrontmatter(metadata, [0, 2, 1].map(i => parseDocument(example()).sections[i].raw).join(''))]) {
    write(ctx.source, transformed);
    const report = reportFor(ctx);
    assert.notEqual(report.structure.ours, report.structure.theirs);
    assert.equal(report.structure.status, 'conflict'); // ours added Extensions; theirs changed the source structure.
    assert.equal(report.sections.find(s => s.id === 'example.a').status, 'unchanged');
  }
});

test('export excludes marked subtree after renaming/moving and preserves source bytes', t => {
  const ctx = managed(t);
  write(ctx.ours, read(ctx.ours).replace('## 4. Extensions', '## Local material') + '\n### Notes\n<!-- organon:id local.notes -->\n\nPrivate example.\n');
  const original = read(ctx.ours), full = path.join(ctx.dir, 'full.md'), subset = path.join(ctx.dir, 'subset.md');
  exportPhilosophy({ source: ctx.ours, out: full });
  exportPhilosophy({ source: ctx.ours, out: subset, coreOnly: true });
  assert.match(read(full), /Private example/); assert.doesNotMatch(read(subset), /Private example|id extensions/);
  assert.equal(parseDocument(read(full)).metadata.derived_from.source_id, json(lockPath(ctx.ours)).document_id);
  assert.equal(parseDocument(read(full)).metadata.derived_from.content_hash, hash(original));
  assert.equal(read(ctx.ours), original);
  assert.throws(() => exportPhilosophy({ source: ctx.source, out: path.join(ctx.dir, 'bad.md'), coreOnly: true, sourceId: 'test' }), /No Extensions/);
  assert.throws(() => exportPhilosophy({ source: ctx.ours, out: full }), /already exists/);
});

test('incorrect or incomplete decisions cannot apply a different candidate', t => {
  const ctx = managed(t); write(ctx.source, example('Incoming.'));
  const report = reportFor(ctx);
  assert.throws(() => planFor(ctx, report, read(ctx.ours), { sections: {}, structure: 'ours', philosophy_version: '0.1.0' }), /Missing decision/);
  assert.throws(() => planFor(ctx, report, read(ctx.ours), { sections: { 'example.a': 'theirs' }, structure: 'ours', philosophy_version: '0.1.0' }), /does not implement theirs/);
});

test('pair failure restores original file and lock; interrupted writes can be recovered', t => {
  const ctx = managed(t), original = read(ctx.ours), originalLock = read(lockPath(ctx.ours));
  const candidate = original.replace('Alpha.', 'Candidate.');
  assert.throws(() => writePair(ctx.ours, candidate, originalLock, { failAfterFirst: true }), /Injected/);
  assert.equal(read(ctx.ours), original); assert.equal(read(lockPath(ctx.ours)), originalLock);
  const pending = pendingPath(ctx.ours);
  write(pending, { target: ctx.ours, lock: lockPath(ctx.ours), oldDocument: original, oldLock: originalLock, newDocument: candidate, newLock: originalLock });
  write(ctx.ours, candidate);
  assert.throws(() => check(ctx.ours), /Interrupted transaction/);
  recover(ctx.ours);
  assert.equal(read(ctx.ours), original); assert.equal(fs.existsSync(pending), false);
});

test('recovery refuses an unrelated concurrent edit and keeps its journal', t => {
  const ctx = managed(t), original = read(ctx.ours), oldLock = read(lockPath(ctx.ours)), pending = pendingPath(ctx.ours);
  write(pending, { target: ctx.ours, lock: lockPath(ctx.ours), oldDocument: original, oldLock, newDocument: original + '\n', newLock: oldLock });
  write(ctx.ours, original.replace('Alpha.', 'Concurrent work.'));
  assert.throws(() => recover(ctx.ours), /changed outside/);
  assert.match(read(ctx.ours), /Concurrent work/); assert.equal(fs.existsSync(pending), true);
});

test('all write operations reject symlinks and protected Core targets without changing either', t => {
  const ctx = managed(t), mirror = path.join(ctx.dir, 'mirror.md'), before = digestFile(CORE_FILE);
  fs.symlinkSync(CORE_FILE, mirror);
  for (const target of [mirror, path.join(ROOT, 'PHILOSOPHY.md'), CORE_FILE]) {
    assert.throws(() => initialize({ target, source: ctx.source }), /symlink|protected source/);
    assert.throws(() => exportPhilosophy({ source: ctx.ours, out: target }), /symlink|protected source/);
    assert.throws(() => writePair(target, example(), '{}'), /symlink|protected source/);
  }
  const report = reportFor(ctx);
  const files = planFor(ctx, report, read(ctx.ours), { sections: {}, structure: 'ours', philosophy_version: '0.1.0' });
  fs.unlinkSync(ctx.ours); fs.symlinkSync(CORE_FILE, ctx.ours);
  assert.throws(() => applyPlan(files.plan), /Stale|symlink/);
  assert.equal(digestFile(CORE_FILE), before);
  assert.equal(fs.lstatSync(mirror).isSymbolicLink(), true);
  assert.equal(fs.lstatSync(path.join(ROOT, 'PHILOSOPHY.md')).isSymbolicLink(), true);
});

test('CLI errors return nonzero JSON and source check is executable', () => {
  const success = spawnSync(process.execPath, ['scripts/check.js', '--source', 'PHILOSOPHY.md'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(success.status, 0, success.stderr); assert.equal(JSON.parse(success.stdout).sections, 22);
  const bad = spawnSync(process.execPath, ['scripts/classify.js', '--unknown'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(bad.status, 1); assert.match(JSON.parse(bad.stderr).error, /Unknown/);
});

test('unsupported ATX spellings cannot silently hide unnumbered sections', () => {
  for (const heading of ['##', '##\tHidden', '  ## Indented']) {
    assert.throws(() => parseDocument(example() + `\n${heading}\nBody.\n`), /ATX/);
  }
});

test('pending transaction detection uses the physical target across parent aliases', t => {
  const ctx = managed(t), alias = path.join(ctx.dir, 'alias');
  fs.symlinkSync(ctx.dir, alias);
  const aliasFile = path.join(alias, 'PHILOSOPHY.md');
  assert.equal(pendingPath(aliasFile), pendingPath(ctx.ours));
  const old = read(ctx.ours), oldLock = read(lockPath(ctx.ours)), pending = pendingPath(ctx.ours);
  const report = reportFor(ctx);
  const files = planFor(ctx, report, old, { sections: {}, structure: 'ours', philosophy_version: '0.1.0' });
  write(pending, { target: ctx.ours, lock: lockPath(ctx.ours), oldDocument: old, oldLock, newDocument: old, newLock: oldLock });
  assert.throws(() => check(aliasFile), /Interrupted/);
  assert.throws(() => classify({ ours: aliasFile, theirs: ctx.source, sourceId: CORE_ID, kind: 'core' }), /Interrupted/);
  assert.throws(() => applyPlan(files.plan), /Interrupted/);
  recover(aliasFile);
  assert.equal(read(ctx.ours), old);
});

test('interrupted sources cannot enter export, init or another merge', t => {
  const ctx = managed(t), otherDir = fixture(t), other = path.join(otherDir, 'PHILOSOPHY.md');
  initialize({ target: other, source: ctx.source, sourceId: CORE_ID });
  const old = read(ctx.ours), oldLock = read(lockPath(ctx.ours));
  write(pendingPath(ctx.ours), { target: ctx.ours, lock: lockPath(ctx.ours), oldDocument: old, oldLock, newDocument: old, newLock: oldLock });
  assert.throws(() => exportPhilosophy({ source: ctx.ours, out: path.join(ctx.dir, 'export.md') }), /Interrupted/);
  assert.throws(() => initialize({ target: path.join(fixture(t), 'new.md'), source: ctx.ours, sourceId: 'custom' }), /Interrupted/);
  assert.throws(() => classify({ ours: other, theirs: ctx.ours, sourceId: 'foreign', kind: 'import' }), /Interrupted/);
});

test('a sibling document cannot borrow the managed identity from an unrelated sidecar', t => {
  const ctx = managed(t), out = path.join(ctx.dir, 'export.md');
  assert.throws(() => exportPhilosophy({ source: ctx.source, out }), /Provide --source-id/);
  assert.throws(() => check(ctx.source), /different document/);
  assert.throws(() => initialize({ source: ctx.source, target: path.join(fixture(t), 'PHILOSOPHY.md') }), /Provide --source-id/);
});

test('input validation runs under the exclusive transaction before any document write', t => {
  const ctx = managed(t), old = read(ctx.ours), oldLock = read(lockPath(ctx.ours));
  assert.throws(() => writePair(ctx.ours, old + '\n', oldLock, {
    verifyInputs() {
      assert.equal(fs.existsSync(pendingPath(ctx.ours)), true);
      write(ctx.ours, old.replace('Alpha.', 'Independent update.'));
      throw new Error('Stale input after acquiring transaction');
    },
  }), /Stale input/);
  assert.match(read(ctx.ours), /Independent update/);
  assert.equal(read(lockPath(ctx.ours)), oldLock);
  assert.equal(fs.existsSync(pendingPath(ctx.ours)), false);
});

test('version warnings respect the manifest range without becoming format judgments', () => {
  assert.deepEqual(coreWarnings('0.1.99'), []);
  assert.equal(coreWarnings('0.2.0').length, 1);
  assert.deepEqual(coreWarnings('3.4.2', '>=3.4.0 <4.0.0'), []);
  assert.equal(coreWarnings('3.3.99', '>=3.4.0 <4.0.0').length, 1);
  assert.throws(() => coreWarnings('0.1.0', '^0.1.0'), /Unsupported/);
});

test('each reviewed input is bound, including source, current text, decisions and record', t => {
  const ctx = managed(t);
  const report = reportFor(ctx);
  const files = planFor(ctx, report, read(ctx.ours), { sections: {}, structure: 'ours', philosophy_version: '0.1.0' });
  for (const [label, file] of [['ours', ctx.ours], ['theirs', ctx.source], ['decisions', files.decisions], ['record', files.record]]) {
    const original = read(file); write(file, original + '\n');
    assert.throws(() => applyPlan(files.plan), new RegExp(`Stale ${label}`));
    write(file, original);
  }
});
