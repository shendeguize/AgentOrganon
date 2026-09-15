import test from 'node:test';
import assert from 'node:assert/strict';
import { assertTrustedRun, assertArtifactIdentity, selectAttemptArtifacts, resolveAttempt } from '../scripts/release/actions-artifacts.mjs';
import { AGENTS } from '../scripts/release/lib.mjs';
const run = (workflow = 'candidate.yml', attempt = 2) => ({ id: 10, run_attempt: attempt, head_sha: 'a'.repeat(40), repository: { full_name: 'shendeguize/AgentOrganon' }, head_repository: { full_name: 'shendeguize/AgentOrganon' }, path: '.github/workflows/' + workflow, event: 'workflow_dispatch', conclusion: 'success' });
const artifact = (name, id = 100) => ({ id, name, expired: false, digest: 'sha256:' + 'b'.repeat(64), workflow_run: { id: 10, head_sha: 'a'.repeat(40) } });
const candidate = attempt => [`candidate-packages-${attempt}`, ...['Linux', 'macOS', 'Windows'].map(os => `install-${os}-${attempt}`)].map((name, i) => artifact(name, attempt * 100 + i));

test('complete latest candidate attempt selects exact IDs and never borrows old successful assets', () => {
  const current = candidate(2), all = [...candidate(1), ...current];
  assert.deepEqual(selectAttemptArtifacts(run(), all, 'candidate.yml'), current);
  for (const missing of current) assert.throws(() => selectAttemptArtifacts(run(), all.filter(a => a !== missing), 'candidate.yml'), /Rerun all jobs/);
  assert.throws(() => selectAttemptArtifacts(run(), candidate(1), 'candidate.yml'), /Rerun all jobs/);
});
test('a full or smoke agent attempt must be complete even when earlier attempts succeeded', () => {
  for (const matrix of ['smoke', 'full']) {
    const names = (attempt) => AGENTS.flatMap(agent => (matrix === 'full' ? ['Linux'] : ['Linux', 'macOS', 'Windows']).map(os => `agent-${agent}-${os}-${matrix}-${attempt}`));
    const current = names(2).map((name, i) => artifact(name, 100 + i));
    const old = names(1).map((name, i) => artifact(name, 200 + i));
    assert.deepEqual(selectAttemptArtifacts(run('agent-e2e.yml'), [...old, ...current], 'agent-e2e.yml'), current);
    assert.throws(() => selectAttemptArtifacts(run('agent-e2e.yml'), [...old, ...current.slice(1)], 'agent-e2e.yml'), /Rerun all jobs/);
  }
});
test('seal artifacts are selected by current attempt and original IDs stay distinct', () => {
  const old = artifact('validated-release-1', 10), current = artifact('validated-release-2', 20);
  assert.deepEqual(selectAttemptArtifacts(run('seal.yml'), [old, current], 'seal.yml'), [current]);
  assert.throws(() => selectAttemptArtifacts(run('seal.yml'), [old], 'seal.yml'), /Rerun all jobs/);
});
test('expired, duplicate, unrelated and changed artifact identities are rejected', () => {
  const r = run(), current = candidate(2);
  for (const change of [{ expired: true }, { id: null }, { digest: null }, { workflow_run: { id: 11, head_sha: r.head_sha } }]) assert.throws(() => assertArtifactIdentity({ ...current[0], ...change }, r));
  for (const change of [{ id: 999 }, { name: 'changed' }, { digest: 'sha256:' + 'c'.repeat(64) }]) assert.throws(() => assertArtifactIdentity({ ...current[0], ...change }, r, current[0]), /changed/);
  assert.throws(() => selectAttemptArtifacts(r, [...current, current[0]], 'candidate.yml'), /Rerun all jobs/);
});
test('resolve verifies current run before selecting paginated immutable artifacts', () => {
  const calls = [], current = candidate(2), r = run();
  const api = ([route]) => { calls.push(route); if (!route.includes('artifacts?')) return r; return route.endsWith('page=1') ? { total_count: 8, artifacts: candidate(1) } : { total_count: 8, artifacts: current }; };
  assert.deepEqual(resolveAttempt('10', 'candidate.yml', r.head_sha, api).artifacts, current);
  assert.equal(calls.length, 3);
  for (const change of [{ run_attempt: undefined }, { conclusion: 'failure' }, { path: '.github/workflows/ci.yml' }, { head_sha: 'c'.repeat(40) }]) assert.throws(() => assertTrustedRun({ ...r, ...change }, 'candidate.yml', r.head_sha));
});
