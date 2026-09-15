import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, symlinkSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { digest, confined } from '../scripts/release/lib.mjs';
import { observe, renderSVG } from '../scripts/release/stars.mjs';
import { assertManifest, assertDispatch, sourceIdentity, validateEvidence } from '../scripts/release/manifest.mjs';
import { PRODUCTS } from '../scripts/release/lib.mjs';
import { branchRules, tagRules, allowedRepository } from '../scripts/release/governance.mjs';

test('release identities are stable across object key order and retain array order', () => {
  assert.equal(digest({ a: 1, b: [2,3] }), digest({ b: [2,3], a: 1 }));
  assert.notEqual(digest({ b: [2,3] }), digest({ b: [3,2] }));
});
test('artifact paths reject traversal, absolute paths and symlink escape', t => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'organon-paths-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const name of ['../x', '/x', 'C:\\x', 'a\\..\\x']) assert.throws(() => confined(root, name));
  symlinkSync(os.tmpdir(), path.join(root, 'outside'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => confined(root, 'outside/a'));
  assert.equal(confined(root, 'safe/a.tgz'), path.join(root, 'safe/a.tgz'));
});

function candidate() {
  const result = { schema_version: 1, version: '1.0.0-rc.1', channel: 'rc', state: 'prepared',
    sources: Object.fromEntries(Object.entries(PRODUCTS).map(([key, p]) => [key, { repository: `shendeguize/${p.repo}`, commit: 'a'.repeat(40), dirty: false }])), evidence: [], artifacts: {} };
  result.source_digest = sourceIdentity(result); return result;
}
test('release fails closed on unvalidated, dirty, incomplete or unrelated objects', () => {
  const manifest = candidate(); assert.doesNotThrow(() => assertManifest(manifest));
  assert.throws(() => assertManifest(manifest, { publish: true }), /not completed/);
  assert.throws(() => validateEvidence(manifest, os.tmpdir()), /Missing content/);
  const stale = structuredClone(manifest); stale.sources.core.commit = 'b'.repeat(40);
  assert.throws(() => assertManifest(stale), /digest mismatch/);
  const dirty = structuredClone(manifest); dirty.sources.core.dirty = true; dirty.source_digest = sourceIdentity(dirty); dirty.state = 'validated';
  assert.throws(() => assertManifest(dirty, { publish: true }), /Uncommitted/);
  const stable = structuredClone(manifest); stable.version = '1.0.0'; stable.channel = 'stable'; stable.source_digest = sourceIdentity(stable);
  assert.throws(() => assertManifest(stable), /approved RC/);
});
test('publication dispatch is bound to repository, protected branch, exact workflow commit and manifest', () => {
  const manifest = candidate(); manifest.state = 'validated';
  const environment = { GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REPOSITORY: 'shendeguize/AgentOrganon',
    RELEASE_MANIFEST_SHA256: digest(manifest), GITHUB_SHA: 'a'.repeat(40), GITHUB_REF: 'refs/heads/release/1.0.0' };
  assert.doesNotThrow(() => assertDispatch(manifest, environment));
  for (const key of Object.keys(environment)) assert.throws(() => assertDispatch(manifest, { ...environment, [key]: 'wrong' }));
});
test('governance forbids bypass and covers slash branches, while retaining single-maintainer PRs', () => {
  const rules = branchRules(); assert.deepEqual(rules.bypass_actors, []);
  assert(rules.conditions.ref_name.include.includes('refs/heads/dev*/**/*'));
  assert(rules.conditions.ref_name.include.includes('refs/heads/release*/**/*'));
  assert.equal(rules.rules.find(r => r.type === 'pull_request').parameters.required_approving_review_count, 0);
  assert(tagRules().rules.some(r => r.type === 'update'));
  assert.throws(() => allowedRepository('someone/other'));
});
test('stars retain observed zero, decreases and dated gaps without fabricated history', () => {
  let history = { schema_version: 1, repository: 'shendeguize/AgentOrganon', observations: [] };
  assert.match(renderSVG(history), /No observations yet/);
  history = observe(history, 0, new Date('2026-09-15T00:00:00Z'));
  assert.equal(observe(history, 9, new Date('2026-09-15T10:00:00Z')), history);
  history = observe(history, 3, new Date('2026-09-16T00:00:00Z'));
  history = observe(history, 1, new Date('2026-09-19T00:00:00Z'));
  const svg = renderSVG(history);
  assert.equal((svg.match(/<circle /g) || []).length, 3);
  assert.equal((svg.match(/<path d="M[0-9.]+ [0-9.]+ L/g) || []).length, 1);
  assert.throws(() => observe(history, -1));
  assert.throws(() => observe(history, 0, new Date('2026-09-18T00:00:00Z')));
});
test('star gaps follow UTC calendar dates rather than elapsed hours', () => {
  for (const [dates, segments] of [
    [['2026-09-14T23:30:00Z', '2026-09-16T00:30:00Z'], 0],
    [['2026-09-14T00:01:00Z', '2026-09-15T23:59:00Z'], 1],
  ]) {
    const observations = dates.map((date, total) => ({ observed_at: new Date(date).toISOString(), total }));
    const svg = renderSVG({ schema_version: 1, repository: 'shendeguize/AgentOrganon', observations });
    assert.equal((svg.match(/<path d="M[0-9.]+ [0-9.]+ L/g) || []).length, segments);
  }
});
