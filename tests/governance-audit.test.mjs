import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { branchRules, tagRules, sameRules, inspect, inspectReleaseGovernance } from '../scripts/release/governance.mjs';
import { environmentPlan } from '../scripts/release/security.mjs';

const repository = 'shendeguize/AgentOrganon';
function apiFixture({ hiddenBypass = false, adminBypass = false, writableToken = false } = {}) {
  const rules = [branchRules(), tagRules()];
  return ([endpoint]) => {
    if (endpoint.endsWith('/rulesets')) return rules.map((rule, index) => ({ id: index + 1, name: rule.name }));
    if (/\/rulesets\/\d+$/.test(endpoint)) {
      const rule = structuredClone(rules[Number(endpoint.split('/').at(-1)) - 1]);
      if (hiddenBypass) delete rule.bypass_actors;
      return rule;
    }
    if (endpoint.endsWith('/actions/permissions')) return { enabled: true, sha_pinning_required: true };
    if (endpoint.endsWith('/actions/permissions/workflow')) return { default_workflow_permissions: writableToken ? 'write' : 'read', can_approve_pull_request_reviews: false };
    const name = endpoint.split('/environments/')[1]?.split('/')[0];
    const wanted = environmentPlan(repository).find(item => item.name === name);
    assert.ok(wanted, endpoint);
    if (endpoint.endsWith('/deployment-branch-policies')) return { branch_policies: wanted.branches.map(name => ({ name, type: 'branch' })) };
    return { can_admins_bypass: adminBypass, deployment_branch_policy: { protected_branches: false, custom_branch_policies: true }, protection_rules: wanted.review ? [{ type: 'required_reviewers', prevent_self_review: false, reviewers: [{ reviewer: { login: 'shendeguize' } }] }] : [] };
  };
}

test('a missing bypass field is unknown, not an empty bypass list', () => {
  const rule = branchRules(), hidden = structuredClone(rule); delete hidden.bypass_actors;
  assert.equal(sameRules(rule, rule), true);
  assert.equal(sameRules(hidden, rule), false);
  assert.equal(sameRules({ ...rule, bypass_actors: [{ actor_type: 'User', actor_id: 1, bypass_mode: 'always' }] }, rule), false);
});
test('release governance combines branch, tag, Action and environment checks', async () => {
  assert.equal((await inspectReleaseGovernance(repository, apiFixture())).status, 'passed');
  for (const options of [{ hiddenBypass: true }, { adminBypass: true }, { writableToken: true }]) {
    assert.equal((await inspectReleaseGovernance(repository, apiFixture(options))).status, 'failed');
  }
});
test('GitHub server defaults and set ordering preserve the same rules', () => {
  const wanted = branchRules(), actual = structuredClone(wanted);
  actual.rules.reverse(); actual.conditions.ref_name.include.reverse();
  const pr = actual.rules.find(r => r.type === 'pull_request').parameters;
  Object.assign(pr, { required_reviewers: [], ignore_approvals_from_contributors: false, require_extra_approval_for_unattributed_changes: true, allowed_merge_methods: ['rebase', 'merge', 'squash'] });
  actual.rules.find(r => r.type === 'required_status_checks').parameters.do_not_enforce_on_create = false;
  assert.equal(sameRules(actual, wanted), true);
  pr.require_extra_approval_for_unattributed_changes = false;
  assert.equal(sameRules(actual, wanted), false);
});
test('read-only bypass counts bind the exact repository and ruleset and reject hidden or nonzero counts', async () => {
  const run = mutation => inspect(repository, (args, body) => {
    if (args[0] !== 'graphql') {
      const value = apiFixture({ hiddenBypass: true })(args);
      if (/\/rulesets\/\d+$/.test(args[0])) Object.assign(value, { id: Number(args[0].split('/').at(-1)), node_id: `fixture-${args[0].split('/').at(-1)}` });
      return value;
    }
    const id = body.variables.databaseId;
    const response = { data: { repository: { nameWithOwner: repository, ruleset: { __typename: 'RepositoryRuleset', id: `fixture-${id}`, databaseId: id, source: { __typename: 'Repository', nameWithOwner: repository }, bypassActors: { totalCount: 0, nodes: [] } } } } };
    mutation?.(response);
    return response;
  });
  assert.equal((await run()).status, 'passed');
  assert.equal((await run(r => { r.data.repository.ruleset.bypassActors = { totalCount: 2, nodes: [null, null] }; })).status, 'failed');
  for (const mutate of [r => { r.errors = [{ message: 'hidden' }]; }, r => { r.data.repository.ruleset.bypassActors = null; }, r => { r.data.repository.ruleset.id = 'another'; }, r => { r.data.repository.ruleset.databaseId = 8; }, r => { r.data.repository.ruleset.source.nameWithOwner = 'another/repo'; }]) await assert.rejects(run(mutate), /Cannot establish complete/);
});
test('audit credential is removed from the environment before child execution', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', 'await import("./scripts/release/governance.mjs"); if ("GOVERNANCE_AUDIT_TOKEN" in process.env) process.exit(9)'], { cwd: new URL('..', import.meta.url), env: { ...process.env, GOVERNANCE_AUDIT_TOKEN: 'fixture-only' }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
