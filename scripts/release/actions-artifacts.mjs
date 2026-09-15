import { gh, AGENTS } from './lib.mjs';
const REPOSITORY = 'shendeguize/AgentOrganon';
const positive = value => /^[1-9]\d*$/.test(String(value ?? ''));
const incomplete = () => new Error('Incomplete current workflow attempt; use Rerun all jobs or a new workflow dispatch. Older artifacts are preserved but never borrowed.');
export function assertTrustedRun(run, workflow, sourceCommit) {
  if (!positive(run.id) || !positive(run.run_attempt) || run.head_sha !== sourceCommit || run.repository?.full_name !== REPOSITORY || run.head_repository?.full_name !== REPOSITORY || run.path !== `.github/workflows/${workflow}` || run.event !== 'workflow_dispatch' || run.conclusion !== 'success') throw new Error('Untrusted or incomplete workflow run');
  return run;
}
export function assertArtifactIdentity(artifact, run, expected) {
  if (!positive(artifact.id) || artifact.expired !== false || artifact.workflow_run?.id !== run.id || artifact.workflow_run?.head_sha !== run.head_sha || !/^sha256:[a-f0-9]{64}$/.test(artifact.digest || '') || typeof artifact.name !== 'string') throw new Error('Invalid workflow artifact identity');
  if (expected && (artifact.id !== expected.id || artifact.name !== expected.name || artifact.digest !== expected.digest)) throw new Error('Artifact identity changed during download');
  return artifact;
}
export function selectAttemptArtifacts(run, artifacts, workflow) {
  const attempt = String(run.run_attempt);
  let names;
  if (workflow === 'candidate.yml') names = [`candidate-packages-${attempt}`, ...['Linux', 'macOS', 'Windows'].map(os => `install-${os}-${attempt}`)];
  else if (workflow === 'seal.yml') names = [`validated-release-${attempt}`];
  else if (workflow === 'agent-e2e.yml') {
    const full = AGENTS.map(agent => `agent-${agent}-Linux-full-${attempt}`);
    const smoke = AGENTS.flatMap(agent => ['Linux', 'macOS', 'Windows'].map(os => `agent-${agent}-${os}-smoke-${attempt}`));
    const haveFull = artifacts.some(item => full.includes(item.name)), haveSmoke = artifacts.some(item => smoke.includes(item.name));
    if (haveFull === haveSmoke) throw incomplete();
    names = haveFull ? full : smoke;
  } else throw new Error('Unexpected artifact workflow');
  return names.map(name => {
    const matches = artifacts.filter(item => item.name === name);
    if (matches.length !== 1) throw incomplete();
    return assertArtifactIdentity(matches[0], run);
  });
}
export function listRunArtifacts(runID, api = gh) {
  const result = [];
  for (let page = 1; page <= 100; page++) {
    const body = api([`repos/${REPOSITORY}/actions/runs/${runID}/artifacts?per_page=100&page=${page}`]);
    if (!Array.isArray(body.artifacts)) throw new Error('Invalid artifact listing');
    result.push(...body.artifacts);
    if (result.length >= body.total_count) return result;
  }
  throw new Error('Artifact inventory exceeds pagination limit');
}
export function resolveAttempt(runID, workflow, sourceCommit, api = gh) {
  if (!positive(runID)) throw new Error('Expected workflow run ID');
  const run = assertTrustedRun(api([`repos/${REPOSITORY}/actions/runs/${runID}`]), workflow, sourceCommit);
  return { run, artifacts: selectAttemptArtifacts(run, listRunArtifacts(runID, api), workflow) };
}
