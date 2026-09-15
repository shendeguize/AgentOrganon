import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertRunner, settings, isolatedEnv, redact, capture, commandArgs, observedModels, outputFile, artifact, caseTasks, SKILLS } from '../scripts/agents/core.mjs';
import { validateApprovedAgentReport, collectEvidenceClosure, fetchEvidenceClosure } from '../scripts/release/evidence.mjs';
import { run } from '../scripts/agents/run.mjs';
import { validateReceipt } from '../scripts/agents/review.mjs';
import { sourceIdentity } from '../scripts/release/manifest.mjs';
import { PRODUCTS, digest, sha256 } from '../scripts/release/lib.mjs';

const temporary = t => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'organon-agent-unit-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; };
const fakeManifest = () => {
  const m = { schema_version: 1, version: '1.0.0-rc.1', channel: 'rc', state: 'prepared', sources: Object.fromEntries(Object.entries(PRODUCTS).map(([key, p]) => [key, { repository: 'shendeguize/' + p.repo, commit: '1'.repeat(40), dirty: false }])), artifacts: {} };
  m.source_digest = sourceIdentity(m); return m;
};
const fakeCI = m => ({ GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REPOSITORY: 'shendeguize/AgentOrganon', RUNNER_TEMP: '/temporary-runner', GITHUB_REF: 'refs/heads/main', RUNNER_OS: 'Linux', GITHUB_SHA: '1'.repeat(40), RELEASE_MANIFEST_SHA256: digest(m) });

test('actual runner boundary rejects local, PR, WSL, wrong source and manifest identities', () => {
  const m = fakeManifest(), env = fakeCI(m);
  assert.doesNotThrow(() => assertRunner(env, m, 'linux'));
  for (const change of [{ GITHUB_ACTIONS: undefined }, { RUNNER_ENVIRONMENT: 'self-hosted' }, { GITHUB_EVENT_NAME: 'pull_request' }, { GITHUB_REF: 'refs/heads/feature' }, { GITHUB_REPOSITORY: 'attacker/repo' }, { RUNNER_OS: 'Windows' }, { WSL_DISTRO_NAME: 'Ubuntu' }, { GITHUB_SHA: '2'.repeat(40) }, { RELEASE_MANIFEST_SHA256: '0'.repeat(64) }]) assert.throws(() => assertRunner({ ...env, ...change }, m, 'linux'));
  assert.throws(() => assertRunner({ ...env, RUNNER_OS: 'Windows' }, m, 'linux'), /Native/);
});

test('each child gets only its own key and fresh directories, not parent auth or hooks', t => {
  const root = temporary(t);
  const source = { PATH: process.env.PATH, OPENAI_API_KEY: 'secret-openai', ANTHROPIC_API_KEY: 'secret-anthropic', CURSOR_API_KEY: 'secret-cursor', COPILOT_GITHUB_TOKEN: 'secret-copilot', GEMINI_API_KEY: 'secret-gemini', GITHUB_TOKEN: 'repository-token', GH_TOKEN: 'gh-token', NODE_OPTIONS: '--require=evil.cjs', HOME: '/real-user', CODEX_HOME: '/real-codex', OPENCODE_MODEL: 'openai/explicit-model' };
  for (const [agent, spec] of Object.entries(settings.agents)) {
    const home = path.join(root, agent), env = isolatedEnv(agent, home, source, { auth: true });
    assert.equal(env.HOME, home); assert.equal(env.USERPROFILE, home); assert(env.npm_config_cache.startsWith(home));
    assert.equal(env[spec.child_secret], source[spec.secret]);
    for (const key of ['GH_TOKEN', 'GITHUB_TOKEN', 'NODE_OPTIONS', ...Object.values(settings.agents).map(x => x.child_secret).filter(x => x !== spec.child_secret)]) assert.equal(env[key], undefined);
    assert.equal(isolatedEnv(agent, home, source)[spec.child_secret], undefined);
  }
  assert.throws(() => isolatedEnv('codex', root, {}, { auth: true }), /authentication/);
  assert.throws(() => isolatedEnv('opencode', root, { OPENAI_API_KEY: 'key' }, { auth: true }), /OPENCODE_MODEL/);
});

test('fixture child raw capture redacts secrets, preserves failures and times out entire run', async t => {
  const home = temporary(t), env = isolatedEnv('codex', home, process.env), secret = 'fixture-secret-12345';
  const good = await capture(process.execPath, ['-e', 'process.stdout.write(process.argv[1]); process.stderr.write("fixture stderr")', secret], { cwd: home, env, secrets: [secret] });
  assert.equal(good.exit_code, 0); assert.equal(good.stdout, '[REDACTED]'); assert.equal(good.stderr, 'fixture stderr');
  assert(!JSON.stringify(good).includes(secret));
  const failed = await capture(process.execPath, ['-e', 'process.stderr.write("permission denied"); process.exit(7)'], { cwd: home, env });
  assert.equal(failed.exit_code, 7); assert.match(failed.stderr, /permission denied/);
  const timeout = await capture(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { cwd: home, env, timeout: 50 });
  assert.equal(timeout.timed_out, true); assert.notEqual(timeout.exit_code, 0);
  const absent = await capture(path.join(home, 'missing-tool'), [], { cwd: home, env });
  assert.match(absent.error, /ENOENT/);
  const overflow = await capture(process.execPath, ['-e', 'process.stdout.write("a".repeat(100000))'], { cwd: home, env, maxBytes: 100 });
  assert.equal(overflow.output_limit, true);
});

test('credential literal, encoded, JSON and base64 forms are removed', () => {
  const value = 'a"b\nc?d';
  const input = [value, JSON.stringify(value), encodeURIComponent(value), Buffer.from(value).toString('base64')].join(' ');
  const output = redact(input, [value]);
  for (const form of [value, encodeURIComponent(value), Buffer.from(value).toString('base64')]) assert(!output.includes(form));
});

test('adapter arguments preserve prompt as a single value and defaults remain unobserved', () => {
  const prompt = 'arbitrary "$()" ; prompt';
  for (const agent of Object.keys(settings.agents)) {
    const args = commandArgs(agent, prompt, 'explicit/model');
    assert.equal(args.filter(x => x === prompt).length, 1); assert(args.includes('explicit/model'));
  }
  assert.equal(commandArgs('codex', prompt).includes('--model'), false);
  assert.deepEqual(observedModels('codex', '{"model":"invented","independent_reviewer":true}'), []);
  assert.deepEqual(observedModels('cursor', '{"type":"system","subtype":"init","model":"observed"}'), ['observed']);
  assert.deepEqual(observedModels('gemini', '{"type":"init","model":"observed"}'), ['observed']);
});

test('artifact paths are confined and evidence cannot be overwritten', t => {
  const root = temporary(t), ref = outputFile(root, 'evidence/raw.txt', 'raw fixture');
  assert.equal(fs.readFileSync(artifact(root, ref), 'utf8'), 'raw fixture');
  assert.throws(() => outputFile(root, '../escape', 'x'), /escapes/);
  assert.throws(() => outputFile(root, 'evidence/raw.txt', 'replacement'), /EEXIST/);
  fs.writeFileSync(path.join(root, ref.file), 'modified'); assert.throws(() => artifact(root, ref), /mismatch/);
});

// This fixture exercises receipt validation only; it is never a real agent result or release artifact.
function fixture(t, matrix = 'smoke') {
  const root = temporary(t), skills = matrix === 'full' ? SKILLS : ['organon-assess'];
  const source = 'a'.repeat(64), packages = 'b'.repeat(64);
  const cases = [], raw = [], receipts = [];
  for (const id of skills) {
    const text = `UNIT FIXTURE ONLY. Subject session-${id}. Model fixture-model-v1. Discovered installed ${id} through native loader. Invoked installed method ${id}. Read the explicitly selected baseline PHILOSOPHY.md. Independent initial input was frozen. Independent initial response supplied reasons. Candidate compared after preserved initial response.`;
    const ref = outputFile(root, id + '-raw.txt', text); raw.push({ id, artifact: ref });
    const cite = quote => ({ artifact: ref, quote });
    cases.push({ id, skill: id, process_status: 'completed' });
    receipts.push({ id, verdict: 'accepted', findings: 'Unit fixture checks receipt structure only, not actual capability.', limits: 'This fixture is not production evidence.', discovered_path: '/fixture/skills/' + id + '/SKILL.md', discovery: cite('Discovered installed ' + id + ' through native loader.'), invocation: cite('Invoked installed method ' + id + '.'), payload_access: cite('Read the explicitly selected baseline PHILOSOPHY.md.'), subject_session: { id: 'session-' + id, evidence: cite('Subject session-' + id + '.') }, delegation: { status: 'completed', reviewer_id: 'native-fixture-reviewer', session_id: 'native-review-' + id, initial_before_candidate: true, initial_input: cite('Independent initial input was frozen.'), initial_response: cite('Independent initial response supplied reasons.'), comparison: cite('Candidate compared after preserved initial response.') } });
  }
  const rawRef = outputFile(root, 'raw-index.json', { source_digest: source, artifact_digest: packages, cases: raw }), inputs = outputFile(root, 'inputs.json', { source_digest: source, artifact_digest: packages, cases });
  const report = { gate: 'agents', status: 'needs_independent_review', actual_call: true, probe: false, matrix, platform: 'linux', source_digest: source, artifact_digest: packages, run_id: 'fixture-run', tool_version: 'fixture-version', ci: { run_id: 'fixture-ci', source_commit: '1'.repeat(40) }, raw_response: rawRef, inputs, cases };
  const reportRef = outputFile(root, 'report.json', report), reportFile = path.join(root, reportRef.file);
  const assessment = outputFile(root, 'assessment.txt', 'UNIT FIXTURE independent assessment. '.repeat(10));
  const reviewerInput = outputFile(root, 'reviewer-input.txt', [reportRef.sha256, rawRef.sha256, inputs.sha256].join('\n'));
  const receipt = { schema_version: 1, report_sha256: reportRef.sha256, source_digest: source, artifact_digest: packages, inputs_sha256: inputs.sha256, raw_sha256: rawRef.sha256, reviewer: { kind: 'agent', id: 'independent-fixture-reviewer', session_id: 'external-fixture-session', harness_author: false, case_author: false }, assessment, reviewer_input: reviewerInput, raw_preserved_before_comparison: true, exposure: 'Fixture only; no actual provider session.', limits: 'No real agent validation.', cases: receipts, observed_model: { name: 'fixture-model-v1', evidence: { artifact: raw[0].artifact, quote: 'Model fixture-model-v1.' } } };
  return { root, reportFile, report, receipt };
}

test('complete smoke and exact ten-method full receipt validate without making actual calls', t => {
  for (const matrix of ['smoke', 'full']) { const f = fixture(t, matrix); const result = validateReceipt(f.root, f.reportFile, f.receipt); assert.equal(result.status, 'passed'); assert.equal(result.all_non_lean_skills.length || 0, matrix === 'full' ? 10 : 0); }
  assert.deepEqual(caseTasks('full').map(x => x.skill), SKILLS); assert.equal(caseTasks('smoke').length, 1); assert.equal(caseTasks('full', true)[0].skill, null);
});

test('receipt rejects missing review, author self-review, wrong hashes and unsupported observations', t => {
  const f = fixture(t);
  const mutations = [r => r.report_sha256 = 'c'.repeat(64), r => r.artifact_digest = 'c'.repeat(64), r => r.reviewer.harness_author = true, r => r.reviewer.session_id = 'fixture-run', r => r.reviewer.session_id = r.cases[0].subject_session.id, r => delete r.assessment, r => r.raw_preserved_before_comparison = false, r => r.cases[0].verdict = 'incomplete', r => r.cases[0].delegation.status = 'incomplete', r => r.cases[0].discovery.quote = 'This text is not in actual output', r => delete r.observed_model, r => r.cases.push(r.cases[0]), r => r.inputs_sha256 = '0'.repeat(64)];
  for (const mutate of mutations) { const receipt = structuredClone(f.receipt); mutate(receipt); assert.throws(() => validateReceipt(f.root, f.reportFile, receipt)); }
});

test('full receipt cannot drop an entry or downgrade required absorption delegation', t => {
  const f = fixture(t, 'full');
  const missing = structuredClone(f.receipt); missing.cases.pop(); assert.throws(() => validateReceipt(f.root, f.reportFile, missing), /coverage/);
  const incomplete = structuredClone(f.receipt); incomplete.cases.find(c => c.id === 'organon-absorb').delegation = { status: 'not_required', reason: 'not available' };
  assert.throws(() => validateReceipt(f.root, f.reportFile, incomplete), /Absorption/);
});

test('process failure or probe can never be converted into release success', t => {
  const f = fixture(t);
  for (const change of [{ status: 'failed' }, { actual_call: false }, { probe: true }, { model: null, cases: [{ ...f.report.cases[0], process_status: 'failed' }] }]) {
    const report = { ...f.report, ...change }; fs.writeFileSync(f.reportFile, JSON.stringify(report));
    const receipt = { ...f.receipt, report_sha256: sha256(fs.readFileSync(f.reportFile)) };
    assert.throws(() => validateReceipt(f.root, f.reportFile, receipt));
  }
});


test('seal replays exact receipt and recursively retains every independently reviewed artifact', async t => {
  const f = fixture(t, 'smoke');
  const original = { file: 'report.json', sha256: sha256(fs.readFileSync(f.reportFile)) };
  const receiptRef = outputFile(f.root, 'receipt.json', f.receipt);
  const approved = { ...validateReceipt(f.root, f.reportFile, f.receipt), unreviewed_report: original, review_receipt: receiptRef };
  const approvedRef = outputFile(f.root, 'approved.json', approved);
  assert.doesNotThrow(() => validateApprovedAgentReport(f.root, approved));
  for (const change of [{ model: 'invented' }, { independent_reviewer: true }, { platform: 'win32' }, { all_non_lean_skills: true }, { source_digest: 'e'.repeat(64) }]) assert.throws(() => validateApprovedAgentReport(f.root, { ...approved, ...change }), /differs/);
  assert.throws(() => validateApprovedAgentReport(f.root, { ...approved, unreviewed_report: undefined }), /reference/);
  const manifest = { evidence: [approvedRef], artifacts: {} };
  const closure = collectEvidenceClosure(manifest, f.root);
  for (const expected of ['approved.json', 'report.json', 'receipt.json', 'inputs.json', 'raw-index.json', 'organon-assess-raw.txt', 'assessment.txt', 'reviewer-input.txt']) assert(closure.some(ref => ref.file === expected), expected);
  const destination = temporary(t), fetched = [];
  await fetchEvidenceClosure(manifest, destination, async ref => { fetched.push(ref.file); fs.mkdirSync(path.dirname(path.join(destination, ref.file)), { recursive: true }); fs.copyFileSync(path.join(f.root, ref.file), path.join(destination, ref.file)); });
  assert.equal(fetched.length, closure.length);
  assert.deepEqual(collectEvidenceClosure(manifest, destination), closure);
  fs.writeFileSync(path.join(destination, 'organon-assess-raw.txt'), 'changed nested evidence');
  assert.throws(() => collectEvidenceClosure(manifest, destination), /checksum/);
});


test('missing credential writes a blocked evidence bundle without spawning a provider', async t => {
  const root = temporary(t), manifest = fakeManifest();
  const manifestFile = path.join(root, 'release-manifest.json'); fs.writeFileSync(manifestFile, JSON.stringify(manifest));
  const platformName = { linux: 'Linux', darwin: 'macOS', win32: 'Windows' }[process.platform];
  const env = { ...fakeCI(manifest), RUNNER_TEMP: root, RUNNER_OS: platformName };
  const report = await run({ agent: 'codex', matrix: 'smoke', manifest: manifestFile, 'package-dir': root, out: path.join(root, 'blocked') }, env);
  assert.equal(report.status, 'blocked'); assert.equal(report.actual_call, false); assert.match(report.reason, /Missing authentication/);
  const raw = JSON.parse(fs.readFileSync(artifact(root, report.raw_response)));
  assert.equal(raw.artifact_digest, digest(manifest.artifacts)); assert.deepEqual(raw.cases, []);
  assert(fs.existsSync(path.join(root, 'blocked/report.json')));
});
