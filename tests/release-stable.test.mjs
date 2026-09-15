import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { PRODUCTS, digest } from '../scripts/release/lib.mjs';
import { sourceIdentity } from '../scripts/release/manifest.mjs';
import { validateStable } from '../scripts/release/stable.mjs';

const bytes = value => Buffer.from(typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
const blobHash = value => crypto.createHash('sha1').update(`blob ${value.length}\0`).update(value).digest('hex');
function fixture() {
  const oldSHAs = { core: '1'.repeat(40), advised: '2'.repeat(40), 'agent-organon': '3'.repeat(40) };
  const newSHAs = { core: '4'.repeat(40), advised: '5'.repeat(40), 'agent-organon': '6'.repeat(40) };
  const manifest = (version, identities) => {
    const item = { schema_version: 1, version, channel: version === '1.0.0' ? 'stable' : 'rc', state: 'validated', sources: Object.fromEntries(Object.entries(PRODUCTS).map(([product, spec]) => [product, { repository: `shendeguize/${spec.repo}`, commit: identities[product], dirty: false }])), artifacts: {}, evidence: [] };
    item.source_digest = sourceIdentity(item); return item;
  };
  const rc = manifest('1.0.0-rc.1', oldSHAs); const stable = manifest('1.0.0', newSHAs);
  stable.approved_rc = { version: rc.version, manifest_sha256: digest(rc) };
  const files = {};
  for (const [product, spec] of Object.entries(PRODUCTS)) {
    const common = { 'PHILOSOPHY.md': '# Philosophical commitments\nphilosophy_version: 0.1.4\n', 'rationale/README.md': 'Adopted rationale.\n', 'scripts/runtime.mjs': 'export const correct = true;\n' };
    files[product] = {
      before: { ...common, 'package.json': { name: spec.package, version: rc.version, dependencies: { '@shendeguize/organon-core': rc.version } }, 'README.md': `Install ${spec.package}@${rc.version}.\n`, 'site/site.json': { product, version: rc.version, themeVersion: rc.version } },
      after: { ...common, 'package.json': { name: spec.package, version: stable.version, dependencies: { '@shendeguize/organon-core': stable.version } }, 'README.md': `Install ${spec.package}@${stable.version}.\n`, 'site/site.json': { product, version: stable.version, themeVersion: stable.version } },
    };
  }
  for (const product of ['core', 'advised']) {
    const tooling = { schema_version: 1, workspace: { repository: rc.sources['agent-organon'].repository, commit: oldSHAs['agent-organon'] }, ...(product === 'advised' ? { core: { repository: rc.sources.core.repository, commit: oldSHAs.core } } : {}) };
    files[product].before['release/tooling.json'] = tooling;
    files[product].after['release/tooling.json'] = structuredClone(tooling);
  }
  const modes = new Map(); const gitlinks = { before: { OrganonCore: oldSHAs.core, AdvisedOrganons: oldSHAs.advised }, after: { OrganonCore: newSHAs.core, AdvisedOrganons: newSHAs.advised } };
  function backend() {
    const commits = new Map(); const trees = new Map(); const blobs = new Map();
    for (const [product, spec] of Object.entries(PRODUCTS)) {
      const repo = `shendeguize/${spec.repo}`;
      for (const side of ['before', 'after']) {
        const entries = Object.entries(files[product][side]).map(([name, value]) => {
          const buffer = bytes(value); const sha = blobHash(buffer); blobs.set(`${repo}:${sha}`, buffer);
          return { path: name, sha, type: 'blob', mode: modes.get(`${product}:${side}:${name}`) ?? '100644' };
        });
        if (product === 'agent-organon') for (const [name, sha] of Object.entries(gitlinks[side])) entries.push({ path: name, sha, type: 'commit', mode: '160000' });
        const sha = crypto.createHash('sha1').update(JSON.stringify(entries)).digest('hex');
        trees.set(`${repo}:${sha}`, { sha, truncated: false, tree: entries });
        const commit = side === 'before' ? oldSHAs[product] : newSHAs[product];
        commits.set(`${repo}:${commit}`, { sha: commit, tree: { sha } });
      }
    }
    return {
      rcManifest: async version => { assert.equal(version, rc.version); return structuredClone(rc); },
      commit: async (repo, sha) => { const item = commits.get(`${repo}:${sha}`); assert.ok(item, 'Unexpected commit request'); return structuredClone(item); },
      tree: async (repo, sha) => { const item = trees.get(`${repo}:${sha}`); assert.ok(item, 'Unexpected tree request'); return structuredClone(item); },
      blob: async (repo, sha) => { const item = blobs.get(`${repo}:${sha}`); assert.ok(item, 'Unexpected blob request'); return Buffer.from(item); },
    };
  }
  return { rc, stable, files, modes, gitlinks, oldSHAs, newSHAs, backend, validate: () => validateStable(stable, '.', { backend: backend(), approvalDigest: digest(rc) }) };
}

test('stable validates all three immutable trees, exact versions and peer gitlinks', async () => {
  const f = fixture(); const receipt = await f.validate();
  assert.equal(receipt.status, 'passed'); assert.equal(Object.keys(receipt.repositories).length, 3);
  assert.equal(receipt.approved_rc_manifest_sha256, digest(f.rc));
  assert.equal(receipt.changes.filter(change => change.reason === 'peer-gitlink').length, 2);
  assert.ok(receipt.changes.every(change => change.before !== change.after));
});

test('stable requires separate approval, the exact downloaded RC and completed RC state', async () => {
  const f = fixture();
  await assert.rejects(validateStable(f.stable, '.', { backend: f.backend(), approvalDigest: 'f'.repeat(64) }), /approval/);
  const backend = f.backend(); backend.rcManifest = async () => ({ ...f.rc, state: 'prepared' });
  await assert.rejects(validateStable(f.stable, '.', { backend, approvalDigest: digest(f.rc) }), /validation gates/);
  const altered = f.backend(); altered.rcManifest = async () => ({ ...f.rc, unexpected: true });
  await assert.rejects(validateStable(f.stable, '.', { backend: altered, approvalDigest: digest(f.rc) }), /exact approved/);
  const wrong = f.backend(); wrong.rcManifest = async () => ({ ...f.rc, channel: 'stable' });
  await assert.rejects(validateStable(f.stable, '.', { backend: wrong, approvalDigest: digest(f.rc) }), /channel/);
});

test('a self-declared RC digest and arbitrary stable commits cannot authorize a transition', async () => {
  const f = fixture();
  f.stable.approved_rc.manifest_sha256 = 'f'.repeat(64);
  await assert.rejects(validateStable(f.stable, '.', { backend: f.backend(), approvalDigest: 'f'.repeat(64) }), /exact approved/);
  const g = fixture(); g.stable.sources.core.commit = '9'.repeat(40); g.stable.source_digest = sourceIdentity(g.stable);
  await assert.rejects(g.validate(), /Unexpected commit/);
});

test('stable rejects logic, philosophical versions, additions, deletions and mode changes', async () => {
  for (const kind of ['logic', 'philosophy', 'rationale', 'add', 'delete', 'mode']) {
    const f = fixture();
    if (kind === 'logic') f.files.core.after['scripts/runtime.mjs'] = 'export const correct = false;\n';
    if (kind === 'philosophy') f.files.core.after['PHILOSOPHY.md'] += 'philosophy_version: 0.1.5\n';
    if (kind === 'rationale') f.files.advised.after['rationale/README.md'] = 'A changed interpretation.\n';
    if (kind === 'add') f.files.core.after['new.txt'] = 'New source.\n';
    if (kind === 'delete') delete f.files.core.after['scripts/runtime.mjs'];
    if (kind === 'mode') f.modes.set('core:after:scripts/runtime.mjs', '100755');
    await assert.rejects(f.validate(), /Unapproved|byte-identical|adds or deletes|type\/mode/, kind);
  }
});

test('an allowed version edit cannot conceal dependency, instruction or formatting changes', async () => {
  for (const kind of ['external-dependency', 'script', 'reading-text', 'formatting', 'partial-version']) {
    const f = fixture(); const after = f.files.core.after;
    if (kind === 'external-dependency') after['package.json'].dependencies.external = '1.0.0';
    if (kind === 'script') after['package.json'].scripts = { postinstall: 'unapproved-command' };
    if (kind === 'reading-text') after['README.md'] += 'New authority.\n';
    if (kind === 'formatting') after['package.json'] = JSON.stringify(after['package.json']);
    if (kind === 'partial-version') after['package.json'].version = '1.0.0-rc.1';
    await assert.rejects(f.validate(), /Unapproved|Only exact|version transition/, kind);
  }
});

test('peer gitlinks must match both frozen source lists and remain present', async () => {
  const f = fixture(); f.gitlinks.after.OrganonCore = '9'.repeat(40);
  await assert.rejects(f.validate(), /Peer gitlink/);
  const g = fixture(); delete g.gitlinks.before.AdvisedOrganons; delete g.gitlinks.after.AdvisedOrganons;
  await assert.rejects(g.validate(), /Required peer gitlink/);
});

test('tooling pins may remain fixed or follow only the exact corresponding peer transition', async () => {
  const f = fixture();
  f.files.core.after['release/tooling.json'].workspace.commit = f.newSHAs['agent-organon'];
  f.files.advised.after['release/tooling.json'].core.commit = f.newSHAs.core;
  const result = await f.validate(); assert.equal(result.changes.filter(change => change.reason === 'fixed-tooling-peer-reference').length, 2);
  const g = fixture(); g.files.core.after['release/tooling.json'].workspace.commit = '9'.repeat(40);
  await assert.rejects(g.validate(), /exact RC-to-stable/);
  const h = fixture(); h.files.core.after['release/tooling.json'].workspace.repository = 'other/repo';
  await assert.rejects(h.validate(), /repository cannot change/);
});

test('immutable object mismatches, truncated trees and missing network data fail closed', async () => {
  for (const kind of ['commit', 'tree', 'blob', 'unavailable']) {
    const f = fixture(); const backend = f.backend();
    if (kind === 'commit') backend.commit = async () => ({ sha: '9'.repeat(40), tree: { sha: '8'.repeat(40) } });
    if (kind === 'tree') { const read = backend.tree; backend.tree = async (...args) => ({ ...await read(...args), truncated: true }); }
    if (kind === 'blob') backend.blob = async () => Buffer.from('Wrong blob.');
    if (kind === 'unavailable') backend.rcManifest = async () => { throw new Error('Unavailable RC'); };
    await assert.rejects(validateStable(f.stable, '.', { backend, approvalDigest: digest(f.rc) }), /mismatch|Incomplete|immutable identity|Unavailable/, kind);
  }
});
