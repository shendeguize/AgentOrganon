import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { outputFile } from '../scripts/agents/core.mjs';
import { validateReceipt } from '../scripts/agents/review.mjs';
import { mergeReviews } from '../scripts/release/collect.mjs';
import { INVENTORY_FILE, assertSealRole, readTrustedInventory, validateTrustedEvidence, collectEvidenceClosure } from '../scripts/release/evidence.mjs';
import { sha256, digest, PRODUCTS } from '../scripts/release/lib.mjs';
import { sourceIdentity, validateEvidence } from '../scripts/release/manifest.mjs';

// Synthetic structural fixture only. These bytes never constitute actual agent or release evidence.
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'organon-trusted-unit-'));
  const reviews = fs.mkdtempSync(path.join(os.tmpdir(), 'organon-reviews-unit-'));
  t.after(() => { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(reviews, { recursive: true, force: true }); });
  const manifest = { schema_version: 1, version: '1.0.0-rc.1', state: 'prepared', channel: 'rc', sources: Object.fromEntries(Object.entries(PRODUCTS).map(([p, spec]) => [p, { repository: 'shendeguize/' + spec.repo, commit: 'a'.repeat(40), dirty: false }])), artifacts: {}, evidence: [] };
  manifest.source_digest = sourceIdentity(manifest);
  const pkg = outputFile(root, 'fixture.tgz', 'UNIT ONLY, not a real package'); manifest.artifacts.core = pkg;
  const identity = { source_digest: manifest.source_digest, artifact_digest: digest(manifest.artifacts) };
  const attachment = outputFile(root, 'evidence/attachment.txt', 'UNIT captured attachment');
  const raw = outputFile(root, 'evidence/raw.txt', 'UNIT ONLY. Subject fixture-subject. Model fixture-model. Discovered installed method through native loader. Invoked installed method explicitly. Read selected payload and PHILOSOPHY.md.');
  const cases = [{ id: 'organon-assess', skill: 'organon-assess', process_status: 'completed' }];
  const inputs = outputFile(root, 'evidence/inputs.json', { ...identity, cases, package_artifacts: { core: pkg } });
  const index = outputFile(root, 'evidence/raw-index.json', { ...identity, cases: [{ id: 'organon-assess', artifact: raw, attachments: [attachment] }] });
  const report = { ...identity, gate: 'agents', agent: 'codex', status: 'needs_independent_review', actual_call: true, probe: false, matrix: 'smoke', platform: 'linux', run_id: 'fixture-process', ci: { run_id: '20', run_attempt: '1', source_commit: 'a'.repeat(40) }, tool_version: 'fixture-version', inputs, raw_response: index, cases };
  const original = outputFile(root, 'evidence/report.json', report);
  const mechanical = outputFile(root, 'reports/content.json', { ...identity, gate: 'content', product: 'core', status: 'passed' });
  const environment = { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'shendeguize/AgentOrganon', GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/release/1.0.0', GITHUB_WORKFLOW_REF: 'shendeguize/AgentOrganon/.github/workflows/seal.yml@refs/heads/release/1.0.0', RUNNER_ENVIRONMENT: 'github-hosted', GITHUB_SHA: 'a'.repeat(40), GITHUB_RUN_ID: '30', GITHUB_RUN_ATTEMPT: '1' };
  const inventory = { schema_version: 1, ...identity, candidate_run: '10', collector: { repository: environment.GITHUB_REPOSITORY, workflow: environment.GITHUB_WORKFLOW_REF, source_commit: environment.GITHUB_SHA, run_id: '30', run_attempt: '1' }, runs: ['10', '20', '21'].map(id => ({ run_id: id, run_attempt: '1', workflow: id === '10' ? 'candidate.yml' : 'agent-e2e.yml', repository: environment.GITHUB_REPOSITORY, source_commit: environment.GITHUB_SHA, conclusion: 'success' })), files: [pkg, mechanical, attachment, raw, inputs, index, original].map(ref => ({ path: ref.file, sha256: ref.sha256, run_id: [pkg, mechanical].includes(ref) ? '10' : '20', workflow: [pkg, mechanical].includes(ref) ? 'candidate.yml' : 'agent-e2e.yml', run_attempt: '1', artifact_id: [pkg, mechanical].includes(ref) ? '100' : '200', artifact_digest: 'sha256:' + 'b'.repeat(64), artifact: [pkg, mechanical].includes(ref) ? 'candidate-packages-1' : 'agent-codex-Linux-smoke-1' })) };
  const assessment = outputFile(root, 'reviews/assessment.txt', 'UNIT FIXTURE bounded independent reasoning with explicitly acknowledged limits. '.repeat(5));
  const reviewerInput = outputFile(root, 'reviews/input.txt', [original.sha256, index.sha256, inputs.sha256].join('\n'));
  const cite = quote => ({ artifact: raw, quote });
  const receipt = { schema_version: 1, ...identity, report_sha256: original.sha256, inputs_sha256: inputs.sha256, raw_sha256: index.sha256, reviewer: { kind: 'human', id: 'fixture-reviewer', session_id: 'fixture-review', harness_author: false, case_author: false }, assessment, reviewer_input: reviewerInput, raw_preserved_before_comparison: true, exposure: 'Fixture only', limits: 'No real invocation', observed_model: { name: 'fixture-model', evidence: cite('Model fixture-model.') }, cases: [{ id: 'organon-assess', verdict: 'accepted', findings: 'Fixture structure only.', limits: 'No actual method claim.', discovered_path: '/fixture/skill', discovery: cite('Discovered installed method through native loader.'), invocation: cite('Invoked installed method explicitly.'), payload_access: cite('Read selected payload and PHILOSOPHY.md.'), subject_session: { id: 'fixture-subject', evidence: cite('Subject fixture-subject.') }, delegation: { status: 'not_required', reason: 'Assessment fixture.' } }] };
  const receiptRef = outputFile(root, 'reviews/receipt.json', receipt);
  const approved = outputFile(root, 'reviews/approved.json', { ...validateReceipt(root, path.join(root, original.file), receipt), unreviewed_report: original, review_receipt: receiptRef });
  for (const ref of [assessment, reviewerInput, receiptRef, approved]) { fs.mkdirSync(path.dirname(path.join(reviews, ref.file)), { recursive: true }); fs.renameSync(path.join(root, ref.file), path.join(reviews, ref.file)); }
  manifest.evidence = [mechanical, approved];
  function save() { const file = path.join(root, INVENTORY_FILE); fs.writeFileSync(file, JSON.stringify(inventory)); manifest.trusted_executions = { file: INVENTORY_FILE, sha256: sha256(fs.readFileSync(file)) }; }
  save();
  return { root, reviews, manifest, inventory, save, environment, raw, original, attachment, inputs, index, mechanical };
}

test('downloaded origins plus derived review form a closed, seal-bound evidence inventory', t => {
  const f = fixture(t), trusted = readTrustedInventory(f.manifest, f.root);
  assert.equal(mergeReviews(f.reviews, f.root, trusted), 1);
  assert.doesNotThrow(() => validateTrustedEvidence(f.manifest, f.root, { sealing: true, environment: f.environment }));
  const closure = collectEvidenceClosure(f.manifest, f.root);
  assert(closure.some(ref => ref.file === INVENTORY_FILE));
  assert(!closure.some(ref => ref.file === 'release-manifest.json'));
  assert(closure.some(ref => ref.file === f.attachment.file));
});

test('review commit cannot supply a new original execution, raw output or mechanical report', t => {
  for (const [name, content] of [['invented-original.json', { gate: 'agents', status: 'needs_independent_review' }], ['fake-raw.txt', 'forged output'], ['fake-gate.json', { gate: 'install', status: 'passed' }], ['release-manifest.json', {}], [INVENTORY_FILE, {}]]) {
    const f = fixture(t); outputFile(f.reviews, name, content);
    assert.throws(() => mergeReviews(f.reviews, f.root, readTrustedInventory(f.manifest, f.root)), /only add derived/);
    assert(!fs.existsSync(path.join(f.root, name)) || name === INVENTORY_FILE);
  }
});

test('review data cannot overwrite even an identical downloaded execution artifact', t => {
  const f = fixture(t); outputFile(f.reviews, f.raw.file, fs.readFileSync(path.join(f.root, f.raw.file), 'utf8'));
  assert.throws(() => mergeReviews(f.reviews, f.root, readTrustedInventory(f.manifest, f.root)), /only add derived/);
});

test('original report, inputs, raw index, every output and attachment require the same verified run', t => {
  for (const key of ['original', 'inputs', 'index', 'raw', 'attachment']) {
    const f = fixture(t); mergeReviews(f.reviews, f.root, readTrustedInventory(f.manifest, f.root));
    f.inventory.files.find(item => item.path === f[key].file).run_id = '21'; f.save();
    assert.throws(() => validateTrustedEvidence(f.manifest, f.root), /required trusted execution/);
  }
});

test('coherent reviewer-added original evidence is rejected even when receipt hashes would match', t => {
  const f = fixture(t); f.inventory.files = f.inventory.files.filter(item => item.path !== f.original.file); f.save();
  assert.throws(() => mergeReviews(f.reviews, f.root, readTrustedInventory(f.manifest, f.root)), /required trusted execution/);
});

test('mechanical reports and package bytes must originate in the candidate workflow', t => {
  for (const file of ['reports/content.json', 'fixture.tgz']) {
    const f = fixture(t); mergeReviews(f.reviews, f.root, readTrustedInventory(f.manifest, f.root));
    Object.assign(f.inventory.files.find(item => item.path === file), { run_id: '20', workflow: 'agent-e2e.yml' }); f.save();
    assert.throws(() => validateTrustedEvidence(f.manifest, f.root), /required trusted execution/);
  }
});

test('missing or changed inventory never seals and validated manifests require it on later checks', t => {
  const f = fixture(t); delete f.manifest.trusted_executions;
  assert.equal(readTrustedInventory(f.manifest, f.root), null);
  assert.throws(() => validateEvidence(f.manifest, f.root, { sealing: true, environment: f.environment }), /Missing trusted/);
  f.manifest.state = 'validated'; assert.throws(() => readTrustedInventory(f.manifest, f.root), /Missing trusted/);
  f.save(); fs.appendFileSync(path.join(f.root, INVENTORY_FILE), ' '); assert.throws(() => readTrustedInventory(f.manifest, f.root), /checksum/);
});

test('seal role rejects local, other workflow, source, ref, attempt and run identities', t => {
  const f = fixture(t); assert.doesNotThrow(() => assertSealRole(f.manifest, f.environment));
  for (const key of Object.keys(f.environment).filter(key => key !== 'GITHUB_RUN_ATTEMPT')) {
    assert.throws(() => readTrustedInventory(f.manifest, f.root, { sealing: true, environment: { ...f.environment, [key]: 'wrong' } }));
  }
  assert.throws(() => readTrustedInventory(f.manifest, f.root, { sealing: true, environment: { ...f.environment, GITHUB_RUN_ATTEMPT: '2' } }), /different seal/);
});

test('inventory rejects wrong workflow identities, duplicate paths and manifest self-reference', t => {
  for (const mutate of [f => f.inventory.runs[1].workflow = 'ci.yml', f => f.inventory.files.push(f.inventory.files[0]), f => f.inventory.files[0].path = 'release-manifest.json', f => f.inventory.source_digest = '0'.repeat(64)]) {
    const f = fixture(t); mutate(f); f.save(); assert.throws(() => readTrustedInventory(f.manifest, f.root));
  }
});
