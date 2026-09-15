import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PRODUCTS, digest, sha256 } from '../scripts/release/lib.mjs';
import { sourceIdentity, assertGithubReport, validateEvidence } from '../scripts/release/manifest.mjs';
import { collectGithubReport } from '../scripts/release/candidate.mjs';
import { recheckReleaseGovernance, withReleaseGovernance, verifyPublished } from '../scripts/release/publish.mjs';
const candidate = () => {
  const manifest = { schema_version: 1, version: '1.0.0-rc.1', channel: 'rc', state: 'prepared', artifacts: {}, evidence: [], sources: Object.fromEntries(Object.entries(PRODUCTS).map(([key, spec]) => [key, { repository: `shendeguize/${spec.repo}`, commit: 'a'.repeat(40), dirty: false }])) };
  manifest.source_digest = sourceIdentity(manifest); return manifest;
};
const passing = repository => ({ status: 'passed', repository, rulesets: [{ id: 12, name: 'Unit fixture', bypass_actors: [] }], missing: [], security: { status: 'passed', repository, environments: [{ name: 'npm-stable', owner_approval: true }], actions: { sha_pinning_required: true }, workflow: { default_workflow_permissions: 'read' } } });

test('candidate report preserves full governance and security observations for the exact product', async () => {
  const original = passing('shendeguize/OrganonCore');
  const result = await collectGithubReport('core', async repository => { assert.equal(repository, original.repository); return original; });
  assert.deepEqual(result, { ...original, gate: 'github', product: 'core' });
  assert.deepEqual(result.security.environments, original.security.environments);
});
test('missing, failed and cross-repository security cannot become a passed GitHub gate', async () => {
  const valid = passing('shendeguize/OrganonCore');
  const changes = [{ security: undefined }, { security: { ...valid.security, status: 'failed' } }, { security: { ...valid.security, repository: 'shendeguize/AdvisedOrganons' } }, { status: 'failed' }, { repository: 'shendeguize/AdvisedOrganons' }];
  for (const change of changes) {
    const report = { ...valid, ...change };
    assert.throws(() => assertGithubReport(report, 'core'), /governance\/security/);
    await assert.rejects(() => collectGithubReport('core', async () => report), /governance\/security/);
  }
  await assert.rejects(() => collectGithubReport('core', async () => { throw new Error('Missing audit credential'); }), /credential/);
});
test('manifest validation rejects historical ruleset-only reports despite a valid checksum', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'organon-github-gate-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const security of [undefined, { status: 'failed', repository: 'shendeguize/OrganonCore' }, { status: 'passed', repository: 'other/repo' }]) {
    const manifest = candidate(), report = { ...passing('shendeguize/OrganonCore'), security, gate: 'github', product: 'core', source_digest: manifest.source_digest, artifact_digest: digest(manifest.artifacts) };
    const file = path.join(root, 'github.json'); fs.writeFileSync(file, JSON.stringify(report)); manifest.evidence = [{ file: 'github.json', sha256: sha256(fs.readFileSync(file)) }];
    assert.throws(() => validateEvidence(manifest, root), /governance\/security/);
  }
});
test('every operation freshly audits all three repositories before its callback', async () => {
  const manifest = candidate(), order = [];
  const inspect = async repository => { order.push(repository); return passing(repository); };
  await withReleaseGovernance(manifest, reports => { assert.equal(reports.length, 3); order.push('mutation'); }, inspect);
  assert.deepEqual(order, [...Object.values(manifest.sources).map(source => source.repository), 'mutation']);
  order.length = 0;
  await withReleaseGovernance(manifest, () => order.push('mutation'), inspect);
  assert.equal(order.length, 4);
});
test('later governance drift or credential failure blocks publication instead of reusing old success', async () => {
  const manifest = candidate(); let changed = false, mutations = 0;
  const inspect = async repository => { const report = passing(repository); if (changed && repository.endsWith('/AdvisedOrganons')) report.security.status = 'failed'; return report; };
  await recheckReleaseGovernance(manifest, inspect); changed = true;
  await assert.rejects(() => withReleaseGovernance(manifest, () => mutations++, inspect), /governance\/security/);
  await assert.rejects(() => withReleaseGovernance(manifest, () => mutations++, async () => { throw new Error('Audit API denied'); }), /denied/);
  assert.equal(mutations, 0);
});
test('dual-channel verification checks all three governance states before artifact or registry access', async () => {
  const manifest = candidate(), visited = [];
  // Missing local directory/packages would fail later. Audit failure must win before any network/package access.
  await assert.rejects(() => verifyPublished(manifest, '/missing-unit-fixture', ['core'], { inspect: async repository => { visited.push(repository); const report = passing(repository); if (repository.endsWith('/AgentOrganon')) report.security.status = 'failed'; return report; } }), /governance\/security/);
  assert.deepEqual(visited, Object.values(manifest.sources).map(source => source.repository));
});
