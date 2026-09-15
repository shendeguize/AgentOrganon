import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRODUCTS, gh, digest, readJSON, writeJSON, parseArgs, requireValue, main } from './lib.mjs';

export const REQUIRED_CHECK = 'Repository / verify';
export const branchRules = () => ({ name: 'Organon protected branches', target: 'branch', enforcement: 'active', bypass_actors: [],
  conditions: { ref_name: { include: ['refs/heads/main', 'refs/heads/dev*', 'refs/heads/dev*/**/*', 'refs/heads/release*', 'refs/heads/release*/**/*'], exclude: [] } },
  rules: [{ type: 'deletion' }, { type: 'non_fast_forward' }, { type: 'pull_request', parameters: {
    required_approving_review_count: 0, dismiss_stale_reviews_on_push: true, require_code_owner_review: false,
    require_last_push_approval: false, required_review_thread_resolution: true,
  } }, { type: 'required_status_checks', parameters: {
    strict_required_status_checks_policy: true, required_status_checks: [{ context: REQUIRED_CHECK, integration_id: 15368 }],
  } }],
});
export const tagRules = () => ({ name: 'Organon immutable version tags', target: 'tag', enforcement: 'active', bypass_actors: [],
  conditions: { ref_name: { include: ['refs/tags/v*'], exclude: [] } }, rules: [{ type: 'deletion' }, { type: 'update' }, { type: 'non_fast_forward' }],
});
const sameRules = (actual, desired) => digest({ target: actual.target, enforcement: actual.enforcement, bypass_actors: actual.bypass_actors || [], conditions: actual.conditions, rules: actual.rules }) === digest({ target: desired.target, enforcement: desired.enforcement, bypass_actors: desired.bypass_actors, conditions: desired.conditions, rules: desired.rules });
export function allowedRepository(repository) {
  if (!Object.values(PRODUCTS).some(p => `shendeguize/${p.repo}` === repository)) throw new Error('Unexpected repository');
  return repository;
}
export async function inspect(repository) {
  allowedRepository(repository);
  const listed = gh([`repos/${repository}/rulesets`]);
  const actual = listed.map(rule => gh([`repos/${repository}/rulesets/${rule.id}`]));
  const expected = [branchRules(), tagRules()];
  const missing = expected.filter(rule => !actual.some(item => item.name === rule.name && sameRules(item, rule))).map(rule => rule.name);
  return { status: missing.length ? 'failed' : 'passed', repository, missing, rulesets: actual.map(item => ({ id: item.id, name: item.name, enforcement: item.enforcement })) };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(async () => {
  const options = parseArgs(); const mode = options._[0] || 'check';
  const repository = allowedRepository(requireValue(options, 'repository'));
  if (mode === 'plan') {
    const result = { repository, rulesets: [branchRules(), tagRules()], required_check: REQUIRED_CHECK };
    if (options.out) writeJSON(options.out, result); else console.log(JSON.stringify(result, null, 2));
  } else if (mode === 'apply') {
    const ref = requireValue(options, 'validated-ref');
    if (!/^[0-9a-f]{40}$/.test(ref)) throw new Error('A full validated commit is required');
    const checks = gh([`repos/${repository}/commits/${ref}/check-runs`]).check_runs;
    if (!checks.some(check => check.name === REQUIRED_CHECK && check.conclusion === 'success' && check.app?.slug === 'github-actions')) throw new Error('Required check has not actually succeeded on the supplied revision');
    const existing = gh([`repos/${repository}/rulesets`]);
    for (const rule of [branchRules(), tagRules()]) {
      const match = existing.find(item => item.name === rule.name);
      gh([`repos/${repository}/rulesets${match ? `/${match.id}` : ''}`, '--method', match ? 'PUT' : 'POST'], rule);
    }
    const result = await inspect(repository);
    console.log(JSON.stringify(result, null, 2)); if (result.status !== 'passed') process.exitCode = 1;
  } else if (mode === 'check') {
    const result = await inspect(repository);
    if (options.manifest) { const manifest = readJSON(options.manifest); result.gate = 'github'; result.product = Object.keys(PRODUCTS).find(k => `shendeguize/${PRODUCTS[k].repo}` === repository); result.source_digest = manifest.source_digest; }
    if (options.out) writeJSON(options.out, result);
    console.log(JSON.stringify(result, null, 2)); if (result.status !== 'passed') process.exitCode = 1;
  } else throw new Error(`Unknown governance command: ${mode}`);
});
