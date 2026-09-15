import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRODUCTS, gh, digest, readJSON, writeJSON, parseArgs, requireValue, main } from './lib.mjs';
import { inspectSecurity } from './security.mjs';

// Keep the audit credential out of site builders, npm and other child processes.
// Only the read-only GitHub API adapter below receives it.
const auditToken = process.env.GOVERNANCE_AUDIT_TOKEN;
delete process.env.GOVERNANCE_AUDIT_TOKEN;
function auditAPI(args, body) {
  if (process.env.GITHUB_ACTIONS === 'true' && !auditToken) throw new Error('GOVERNANCE_AUDIT_TOKEN is required to inspect complete repository protections');
  return gh(args, body, auditToken ? { ...process.env, GH_TOKEN: auditToken } : process.env);
}

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
function comparableRules(value) {
  const conditions = structuredClone(value.conditions);
  for (const key of ['include', 'exclude']) conditions?.ref_name?.[key]?.sort();
  const rules = structuredClone(value.rules);
  for (const rule of rules) {
    const p = rule.parameters;
    if (rule.type === 'pull_request' && p) {
      if (Array.isArray(p.required_reviewers) && p.required_reviewers.length === 0) delete p.required_reviewers;
      if (p.ignore_approvals_from_contributors === false) delete p.ignore_approvals_from_contributors;
      // GitHub adds this true default when creating the reviewed zero-approval rule.
      // Retain it; an explicitly disabled value is not equivalent.
      if (p.require_extra_approval_for_unattributed_changes === undefined) p.require_extra_approval_for_unattributed_changes = true;
      if (Array.isArray(p.allowed_merge_methods) && [...p.allowed_merge_methods].sort().join() === 'merge,rebase,squash') delete p.allowed_merge_methods;
    }
    if (rule.type === 'required_status_checks' && p) {
      if (p.do_not_enforce_on_create === false) delete p.do_not_enforce_on_create;
      p.required_status_checks?.sort((a, b) => digest(a).localeCompare(digest(b)));
    }
  }
  rules.sort((a, b) => a.type.localeCompare(b.type));
  return { target: value.target, enforcement: value.enforcement, bypass_actors: value.bypass_actors, conditions, rules };
}
export const sameRules = (actual, desired) => Array.isArray(actual.bypass_actors) && digest(comparableRules(actual)) === digest(comparableRules(desired));
export function allowedRepository(repository) {
  if (!Object.values(PRODUCTS).some(p => `shendeguize/${p.repo}` === repository)) throw new Error('Unexpected repository');
  return repository;
}
export async function inspect(repository, api = gh) {
  allowedRepository(repository);
  const listed = api([`repos/${repository}/rulesets`]);
  const actual = listed.map(rule => api([`repos/${repository}/rulesets/${rule.id}`]));
  const bypassEvidence = [];
  for (const rule of actual) {
    if (Array.isArray(rule.bypass_actors)) {
      bypassEvidence.push({ id: rule.id, source: 'rest', count: rule.bypass_actors.length });
      continue;
    }
    // REST omits actor details for read-only callers. GraphQL exposes the total
    // count even when individual actor nodes are hidden. Never count visible nodes.
    if (typeof rule.node_id !== 'string' || !rule.node_id) continue;
    const [owner, name] = repository.split('/');
    const response = api(['graphql'], { query: 'query($owner: String!, $name: String!, $databaseId: Int!) { repository(owner: $owner, name: $name) { nameWithOwner ruleset(databaseId: $databaseId) { __typename id databaseId source { __typename ... on Repository { nameWithOwner } } bypassActors(first: 1) { totalCount } } } }', variables: { owner, name, databaseId: rule.id } });
    const repo = response?.data?.repository, node = repo?.ruleset, count = node?.bypassActors?.totalCount;
    if (response?.errors?.length || repo?.nameWithOwner !== repository || node?.__typename !== 'RepositoryRuleset' || node?.id !== rule.node_id || node?.databaseId !== rule.id || node?.source?.__typename !== 'Repository' || node?.source?.nameWithOwner !== repository || !Number.isSafeInteger(count) || count < 0) throw new Error('Cannot establish complete ruleset bypass count');
    bypassEvidence.push({ id: rule.id, node_id: rule.node_id, source: 'graphql-total-count', count });
    if (count === 0) rule.bypass_actors = [];
  }
  const expected = [branchRules(), tagRules()];
  const missing = expected.filter(rule => !actual.some(item => item.name === rule.name && sameRules(item, rule))).map(rule => rule.name);
  return { status: missing.length ? 'failed' : 'passed', repository, missing, bypass_evidence: bypassEvidence, rulesets: actual.map(item => ({ id: item.id, name: item.name, enforcement: item.enforcement })) };
}
export async function inspectReleaseGovernance(repository, api = auditAPI) {
  const rules = await inspect(repository, api);
  const security = inspectSecurity(repository, api);
  return { ...rules, status: rules.status === 'passed' && security.status === 'passed' ? 'passed' : 'failed', security };
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
    const result = await inspectReleaseGovernance(repository);
    if (options.manifest) { const manifest = readJSON(options.manifest); result.gate = 'github'; result.product = Object.keys(PRODUCTS).find(k => `shendeguize/${PRODUCTS[k].repo}` === repository); result.source_digest = manifest.source_digest; }
    if (options.out) writeJSON(options.out, result);
    console.log(JSON.stringify(result, null, 2)); if (result.status !== 'passed') process.exitCode = 1;
  } else throw new Error(`Unknown governance command: ${mode}`);
});
