import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gh, parseArgs, requireValue, main, writeJSON } from './lib.mjs';
import { allowedRepository } from './governance.mjs';

export const environmentPlan = repository => [
  { name: 'npm-rc', branches: ['release/1.0.0'], review: false },
  { name: 'npm-stable', branches: ['release/1.0.0'], review: true },
  { name: 'github-pages', branches: ['main', 'release/1.0.0'], review: false },
  ...(repository.endsWith('/AgentOrganon') ? [
    { name: 'agent-validation', branches: ['main', 'release/1.0.0'], review: true },
    { name: 'release-validation', branches: ['release/1.0.0'], review: true },
  ] : []),
];
export function inspectSecurity(repository) {
  allowedRepository(repository);
  const actions = gh([`repos/${repository}/actions/permissions`]);
  const workflow = gh([`repos/${repository}/actions/permissions/workflow`]);
  const missing = [];
  if (!actions.enabled || actions.sha_pinning_required !== true) missing.push('full Action revision pinning');
  if (workflow.default_workflow_permissions !== 'read' || workflow.can_approve_pull_request_reviews !== false) missing.push('read-only default token without PR approval');
  const environments = [];
  for (const wanted of environmentPlan(repository)) {
    let actual;
    try { actual = gh([`repos/${repository}/environments/${wanted.name}`]); }
    catch (error) { if (!String(error.stderr || error.message).includes('404')) throw error; missing.push(`environment ${wanted.name}`); continue; }
    if (actual.deployment_branch_policy?.protected_branches !== false || actual.deployment_branch_policy?.custom_branch_policies !== true) missing.push(`${wanted.name}: exact deployment branches`);
    const branches = gh([`repos/${repository}/environments/${wanted.name}/deployment-branch-policies`]).branch_policies;
    if (branches.some(item => item.type !== 'branch') || branches.map(item => item.name).sort().join() !== [...wanted.branches].sort().join()) missing.push(`${wanted.name}: deployment branch list`);
    const reviewer = actual.protection_rules.find(item => item.type === 'required_reviewers');
    if (wanted.review && (!reviewer || reviewer.prevent_self_review !== false || reviewer.reviewers.length !== 1 || reviewer.reviewers[0].reviewer.login !== 'shendeguize' || actual.can_admins_bypass !== false)) missing.push(`${wanted.name}: owner approval without administrator bypass`);
    environments.push({ name: wanted.name, can_admins_bypass: actual.can_admins_bypass, branches: branches.map(item => item.name), owner_approval: wanted.review });
  }
  return { status: missing.length ? 'failed' : 'passed', repository, missing, actions, workflow, environments };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(() => {
  const args = parseArgs(), repository = allowedRepository(requireValue(args, 'repository'));
  const operation = args._[0] || 'check';
  if (operation === 'plan') { console.log(JSON.stringify({ repository, environments: environmentPlan(repository), actions: { enabled: true, sha_pinning_required: true }, workflow: { default_workflow_permissions: 'read', can_approve_pull_request_reviews: false } }, null, 2)); return; }
  if (operation === 'apply') {
    const current = gh([`repos/${repository}/actions/permissions`]);
    gh([`repos/${repository}/actions/permissions`, '--method', 'PUT'], { enabled: true, allowed_actions: current.allowed_actions, sha_pinning_required: true });
    gh([`repos/${repository}/actions/permissions/workflow`, '--method', 'PUT'], { default_workflow_permissions: 'read', can_approve_pull_request_reviews: false });
    const owner = gh(['users/shendeguize']);
    for (const environment of environmentPlan(repository)) {
      gh([`repos/${repository}/environments/${environment.name}`, '--method', 'PUT'], { wait_timer: 0, prevent_self_review: false,
        reviewers: environment.review ? [{ type: 'User', id: owner.id }] : [], deployment_branch_policy: { protected_branches: false, custom_branch_policies: true } });
      const existing = gh([`repos/${repository}/environments/${environment.name}/deployment-branch-policies`]).branch_policies;
      for (const item of existing) if (item.type !== 'branch' || !environment.branches.includes(item.name)) gh([`repos/${repository}/environments/${environment.name}/deployment-branch-policies/${item.id}`, '--method', 'DELETE']);
      for (const name of environment.branches) if (!existing.some(item => item.type === 'branch' && item.name === name)) gh([`repos/${repository}/environments/${environment.name}/deployment-branch-policies`, '--method', 'POST'], { name, type: 'branch' });
    }
    // The documented REST update does not expose administrator bypass. Inspect it
    // and require the actual GitHub UI setting rather than inventing an API field.
  } else if (operation !== 'check') throw new Error('Expected plan, apply or check');
  const result = inspectSecurity(repository);
  if (args.out) writeJSON(args.out, result);
  console.log(JSON.stringify(result, null, 2)); if (result.status !== 'passed') process.exitCode = 1;
});
