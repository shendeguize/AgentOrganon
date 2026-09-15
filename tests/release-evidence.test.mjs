import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildPackage } from '../scripts/package/build.mjs';
import { checkPackage } from '../scripts/package/check.mjs';
import { extractTarball, createTarball } from '../installer/lib/archive.mjs';
import { validateReleasePackages, sourceIdentity, validateEvidence } from '../scripts/release/manifest.mjs';
import { PRODUCTS, sha256, digest } from '../scripts/release/lib.mjs';
import { outputFile } from '../scripts/agents/core.mjs';
import { collectEvidenceClosure } from '../scripts/release/evidence.mjs';

function temp(t) { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'organon-evidence-unit-')); t.after(() => fs.rmSync(root, { force: true, recursive: true })); return root; }

test('release verifies real archive product, version and all three source snapshots', t => {
  const root = temp(t), artifacts = {}, snapshots = {}, fixtureVersion = '1.0.0-rc.1';
  for (const product of Object.keys(PRODUCTS)) {
    const built = buildPackage({ product, out: root, version: fixtureVersion });
    artifacts[product] = { file: path.basename(built.tarball), sha256: built.sha256 };
    Object.assign(snapshots, checkPackage(built.tarball).snapshots);
  }
  const m = { schema_version: 1, version: fixtureVersion, channel: 'rc', state: 'prepared', sources: Object.fromEntries(Object.entries(PRODUCTS).map(([product, p]) => [product, { repository: 'shendeguize/' + p.repo, commit: snapshots[p.repo], dirty: false }])), artifacts, evidence: [] };
  m.source_digest = sourceIdentity(m);
  assert.equal(validateReleasePackages(m, root), true);
  const swapped = structuredClone(m); swapped.artifacts.core = swapped.artifacts.advised;
  assert.throws(() => validateReleasePackages(swapped, root), /product\/version/);
  const wrongVersion = structuredClone(m); wrongVersion.version = '1.0.0-rc.2'; wrongVersion.source_digest = sourceIdentity(wrongVersion);
  assert.throws(() => validateReleasePackages(wrongVersion, root), /product\/version/);
  const wrongSource = structuredClone(m); wrongSource.sources.core.commit = '0'.repeat(40); wrongSource.source_digest = sourceIdentity(wrongSource);
  assert.throws(() => validateReleasePackages(wrongSource, root), /snapshots differ/);
  const text = outputFile(root, 'not-an-archive.tgz', 'Checksummed text is not a release package.');
  const invalid = structuredClone(m); invalid.artifacts.core = text;
  assert.throws(() => validateReleasePackages(invalid, root));
  const unpacked = extractTarball(path.join(root, artifacts.core.file), path.join(root, 'unpacked'));
  const manifestFile = path.join(unpacked, 'organon-content.json'), content = JSON.parse(fs.readFileSync(manifestFile));
  content.files.find(file => file.source).source.revision = 'f'.repeat(40);
  fs.writeFileSync(manifestFile, JSON.stringify(content));
  assert.throws(() => checkPackage(unpacked), /provenance differs/);
});

test('opaque passed summaries cannot replace independently bound actual evidence', t => {
  const root = temp(t);
  const m = { schema_version: 1, version: '1.0.0-rc.1', channel: 'rc', state: 'prepared', sources: Object.fromEntries(Object.entries(PRODUCTS).map(([product, p]) => [product, { repository: 'shendeguize/' + p.repo, commit: '1'.repeat(40), dirty: false }])), artifacts: {}, evidence: [] };
  m.source_digest = sourceIdentity(m);
  const fake = outputFile(root, 'fabricated.json', { gate: 'agents', status: 'passed', source_digest: m.source_digest, artifact_digest: digest(m.artifacts), agent: 'codex', platform: 'linux', matrix: 'smoke', actual_call: true, independent_reviewer: true, model: 'unknown', tool_version: 'unknown' });
  m.evidence = [fake]; assert.throws(() => validateEvidence(m, root), /Invalid evidence reference/);
});

test('closure rejects changed nested objects and conflicting same-path identities', t => {
  const root = temp(t), raw = outputFile(root, 'raw.txt', 'frozen');
  const report = outputFile(root, 'report.json', { nested: { raw } });
  assert.equal(collectEvidenceClosure({ evidence: [report] }, root).length, 2);
  const conflict = outputFile(root, 'conflict.json', { a: raw, b: { file: raw.file, sha256: '0'.repeat(64) } });
  assert.throws(() => collectEvidenceClosure({ evidence: [conflict] }, root), /Conflicting/);
  fs.rmSync(path.join(root, 'raw.txt'));
  assert.throws(() => collectEvidenceClosure({ evidence: [report] }, root));
});
