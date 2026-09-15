import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { gzipSync, gunzipSync } from 'node:zlib';
import { buildPackage } from '../scripts/package/build.mjs';
import { checkPackage } from '../scripts/package/check.mjs';
import { extractTarball } from '../installer/lib/archive.mjs';
import { verifyPackage, openPackage } from '../installer/lib/package.mjs';

test('release payloads are reproducible, symlink-free, complete and omit Lean/docs/tests', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'organon-package-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const installerHashes = [];
  for (const product of ['agent-organon', 'core', 'advised']) {
    const first = buildPackage({ product, out: directory });
    const second = buildPackage({ product, out: path.join(directory, 'second') });
    assert.equal(first.sha256, second.sha256);
    assert.equal(checkPackage(first.tarball).passed, true);
    const extracted = extractTarball(first.tarball, path.join(directory, product));
    const manifest = verifyPackage(extracted);
    assert.ok(manifest.files.every(entry => !entry.path.includes('/lean/') && !entry.path.includes('/docs/')));
    const mirror = manifest.files.find(entry => entry.path === 'payload/PHILOSOPHY.md');
    assert.ok(mirror.source.transformations.includes('materialize-symbolic-link'));
    const metadata = JSON.parse(fs.readFileSync(path.join(extracted, 'package.json')));
    assert.equal(Boolean(metadata.bin), product === 'agent-organon');
    installerHashes.push(manifest.files.filter(entry => entry.path.startsWith('installer/')).map(entry => [entry.path, entry.sha256]));
    fs.appendFileSync(path.join(extracted, 'payload/PHILOSOPHY.md'), '\nTampered\n');
    assert.throws(() => verifyPackage(extracted), /integrity/);
  }
  assert.deepEqual(installerHashes[0], installerHashes[1]); assert.deepEqual(installerHashes[1], installerHashes[2]);
});

test('a bundled installer never fetches another product implicitly', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'organon-offline-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const archive = buildPackage({ product: 'core', out: directory }).tarball;
  const bundled = extractTarball(archive, path.join(directory, 'extracted'));
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = () => { called = true; throw new Error('Unexpected network request'); };
  try {
    const local = await openPackage({ product: 'core', bundled });
    assert.equal(local.manifest.product, 'core'); local.close();
    await assert.rejects(openPackage({ product: 'agent-organon', bundled }), /exact --version/);
    assert.equal(called, false);
  } finally { globalThis.fetch = originalFetch; }
});

test('archive extraction rejects traversal, links and checksum tampering before writing', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'organon-archive-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const archive = buildPackage({ product: 'core', out: directory }).tarball;
  for (const mutation of ['traversal', 'link', 'checksum']) {
    const bytes = gunzipSync(fs.readFileSync(archive));
    if (mutation === 'traversal') { bytes.fill(0, 0, 100); bytes.write('package/../../escape', 0); }
    if (mutation === 'link') bytes.write('2', 156);
    if (mutation !== 'checksum') {
      bytes.fill(32, 148, 156);
      const sum = bytes.subarray(0, 512).reduce((total, byte) => total + byte, 0);
      bytes.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
    } else bytes[10] ^= 1;
    const bad = path.join(directory, `${mutation}.tgz`); fs.writeFileSync(bad, gzipSync(bytes));
    const destination = path.join(directory, mutation);
    assert.throws(() => extractTarball(bad, destination), /Unsafe|Unsupported|checksum/);
    assert.ok(!fs.existsSync(destination));
  }
});
