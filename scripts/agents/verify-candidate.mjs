import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, requireValue, readJSON, digest } from '../release/lib.mjs';
import { assertTrustedRun, selectAttemptArtifacts } from '../release/actions-artifacts.mjs';
import { assertRunner } from './core.mjs';
export async function verifyCandidate(options, env = process.env) {
  const runId = requireValue(options, 'run-id');
  if (!/^\d+$/.test(runId) || env.GITHUB_REPOSITORY !== 'shendeguize/AgentOrganon' || !env.GITHUB_TOKEN) throw new Error('Invalid candidate run lookup');
  const api = async suffix => {
    const response = await fetch('https://api.github.com/repos/shendeguize/AgentOrganon/' + suffix, { headers: { Authorization: 'Bearer ' + env.GITHUB_TOKEN, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error('Cannot verify candidate workflow artifact');
    return response.json();
  };
  const run = assertTrustedRun(await api('actions/runs/' + runId), 'candidate.yml', env.GITHUB_SHA);
  const artifacts = [];
  for (let page = 1; ; page++) {
    if (page > 100) throw new Error('Artifact listing exceeds page limit');
    const result = await api(`actions/runs/${runId}/artifacts?per_page=100&page=${page}`);
    artifacts.push(...result.artifacts);
    if (artifacts.length >= result.total_count) break;
  }
  const selected = selectAttemptArtifacts(run, artifacts, 'candidate.yml');
  const candidate = selected.find(item => item.name.startsWith('candidate-packages-'));
  if ((options.attempt && String(run.run_attempt) !== options.attempt) || (options['artifact-id'] && String(candidate.id) !== options['artifact-id'])) throw new Error('Candidate attempt changed after selection; restart validation with the exact reviewed candidate');
  if (!options.manifest && env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT, `candidate_artifact_id=${candidate.id}\ncandidate_run_attempt=${run.run_attempt}\n`);
  if (options.manifest) {
    const manifest = readJSON(requireValue(options, 'manifest'));
    if (digest(manifest) !== env.RELEASE_MANIFEST_SHA256) throw new Error('Downloaded manifest does not match approved identity');
    assertRunner(env, manifest);
  }
  return { candidate_run_id: runId, candidate_run_attempt: String(run.run_attempt), artifact_id: String(candidate.id), artifact_digest: candidate.digest, source_commit: run.head_sha, workflow: run.path };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await verifyCandidate(parseArgs()))); } catch (e) { console.error(e.message); process.exitCode = 1; }
}
