import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PRODUCTS, digest, writeJSON } from '../scripts/release/lib.mjs';
import { sourceIdentity } from '../scripts/release/manifest.mjs';
import { assertSiteRunner, inventory, validateState, sampleStars, installPublic, buildIdentity, verifyForSite, checkoutState } from '../scripts/release/site-data.mjs';
const repository = 'shendeguize/AgentOrganon';
function temporary(t) { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'organon-site-state-')); t.after(() => fs.rmSync(root, { recursive: true, force: true })); return root; }
function manifest(version = '1.0.0-rc.1') {
  const value = { schema_version: 1, version, channel: 'rc', state: 'validated', sources: Object.fromEntries(Object.entries(PRODUCTS).map(([key, p]) => [key, { repository: `shendeguize/${p.repo}`, commit: 'a'.repeat(40), dirty: false }])), evidence: [], artifacts: {} };
  value.source_digest = sourceIdentity(value); return value;
}
function built(t) { const root = temporary(t); fs.mkdirSync(path.join(root, 'zh')); fs.writeFileSync(path.join(root, 'index.html'), 'English released HTML'); fs.writeFileSync(path.join(root, 'zh/index.html'), '中文发行页面'); return root; }
const api = total => async () => ({ ok: true, json: async () => ({ stargazers_count: total }) });
test('site writes reject local, foreign, PR and self-hosted contexts', () => {
  const env = { GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', GITHUB_REPOSITORY: repository, GITHUB_REF: 'refs/heads/main', GITHUB_EVENT_NAME: 'workflow_dispatch', RUNNER_TEMP: '/tmp', GITHUB_TOKEN: 'fixture' };
  assert.doesNotThrow(() => assertSiteRunner(env, 'pages'));
  for (const key of Object.keys(env)) assert.throws(() => assertSiteRunner({ ...env, [key]: '' }, 'pages'));
  assert.throws(() => assertSiteRunner({ ...env, GITHUB_EVENT_NAME: 'schedule' }, 'pages'));
  assert.doesNotThrow(() => assertSiteRunner({ ...env, GITHUB_EVENT_NAME: 'schedule' }, 'stars'));
});
test('first actual sample does not create or deploy an unreleased site', async t => {
  const root = temporary(t);
  assert.equal(await sampleStars(root, repository, api(0), new Date('2026-09-15T00:00:00Z')), false);
  assert.equal(validateState(root, repository), null); assert.equal(fs.existsSync(path.join(root, 'public')), false);
  const before = fs.readFileSync(path.join(root, 'stars.json'));
  await assert.rejects(sampleStars(root, repository, async () => ({ ok: false, status: 403 }), new Date('2026-09-16T00:00:00Z')), /state unchanged/);
  assert.deepEqual(fs.readFileSync(path.join(root, 'stars.json')), before);
  await assert.rejects(sampleStars(root, repository, api(undefined), new Date('2026-09-16T00:00:00Z')), /Invalid GitHub/);
  assert.deepEqual(fs.readFileSync(path.join(root, 'stars.json')), before);
});
test('daily sampling preserves exact released HTML while retaining decreases and gaps', async t => {
  const root = temporary(t), source = built(t), release = manifest();
  installPublic(root, repository, release, source, '2026-09-14T00:00:00Z');
  const before = inventory(path.join(root, 'public')), receipt = fs.readFileSync(path.join(root, 'recommended-release.json'));
  for (const [day, count] of [[15, 3], [16, 0], [19, 1]]) assert.equal(await sampleStars(root, repository, api(count), new Date(`2026-09-${day}T00:00:00Z`)), true);
  assert.deepEqual(inventory(path.join(root, 'public')), before); assert.deepEqual(fs.readFileSync(path.join(root, 'recommended-release.json')), receipt);
  const points = JSON.parse(fs.readFileSync(path.join(root, 'public/assets/stars.json'))).observations;
  assert.deepEqual(points.map(p => p.total), [3,0,1]);
  assert.equal((fs.readFileSync(path.join(root, 'public/assets/stars.svg'), 'utf8').match(/<path d="M[0-9.]+ [0-9.]+ L/g) || []).length, 1);
});
test('changed HTML, recommendation, manifest, symlinks and orphan trees fail closed', async t => {
  for (const mutation of ['html', 'receipt', 'manifest', 'symlink']) {
    const root = temporary(t); installPublic(root, repository, manifest(), built(t), new Date().toISOString());
    if (mutation === 'html') fs.writeFileSync(path.join(root, 'public/index.html'), 'unreleased');
    if (mutation === 'receipt') { const file=path.join(root,'recommended-release.json'), value=JSON.parse(fs.readFileSync(file)); value.core_commit='b'.repeat(40); writeJSON(file,value); }
    if (mutation === 'manifest') writeJSON(path.join(root, 'release-manifest.json'), manifest('1.0.0-rc.2'));
    if (mutation === 'symlink') fs.symlinkSync(os.tmpdir(), path.join(root, 'public/escape'), process.platform === 'win32' ? 'junction' : 'dir');
    let called=false; await assert.rejects(sampleStars(root, repository, async () => { called=true; return api(1)(); })); assert.equal(called,false);
  }
  const orphan=temporary(t);fs.mkdirSync(path.join(orphan,'public'));assert.throws(()=>validateState(orphan,repository),/Orphan/);
});
test('older and same-version different manifests cannot replace recommendation', t => {
  const root=temporary(t), source=built(t);installPublic(root,repository,manifest('1.0.0-rc.2'),source,new Date().toISOString());
  assert.throws(()=>installPublic(root,repository,manifest(),source,new Date().toISOString()),/older/);
  const changed=manifest('1.0.0-rc.2');changed.sources.core.commit='b'.repeat(40);changed.source_digest=sourceIdentity(changed);
  assert.throws(()=>installPublic(root,repository,changed,source,new Date().toISOString()),/same-version/);
});
test('source product and version and fixed theme identity are checked before build', t => {
  const root=temporary(t),core=temporary(t);writeJSON(path.join(root,'site/site.json'),{repository:'AgentOrganon',product:'agent-organon',version:'1.0.0-rc.1',themeVersion:'1.0.0-rc.1'});writeJSON(path.join(core,'tools/site/package.json'),{version:'1.0.0-rc.1'});
  assert.doesNotThrow(()=>buildIdentity(root,core,manifest(),'agent-organon'));
  assert.throws(()=>buildIdentity(root,core,manifest(),'advised'));
  assert.throws(()=>buildIdentity(root,core,manifest('1.0.0-rc.2'),'agent-organon'));
  writeJSON(path.join(core,'tools/site/package.json'),{version:'1.0.0-rc.2'});assert.throws(()=>buildIdentity(root,core,manifest(),'agent-organon'));
});
test('all-channel verification failure cannot produce a verification timestamp', async () => {
  let args;await assert.rejects(verifyForSite(manifest(), '/fixture', async (...input) => {args=input;throw new Error('missing npm product');}),/missing npm/);
  assert.equal(args.length,2); // No reduced product list may bypass the three-product default.
  assert.equal(args[1],'/fixture');
});

test('data branch distinguishes first creation from existing branch and network failure', t => {
  for (const status of [0, 2, 128]) {
    const root=temporary(t), calls=[];
    const executor=(command,args) => { calls.push([command,...args]); if(args.includes('ls-remote') && status) { const failure=new Error('git failure');failure.status=status;throw failure; } return ''; };
    if(status===128) assert.throws(()=>checkoutState(root,repository,{},executor),/git failure/);
    else checkoutState(root,repository,{},executor);
    assert.equal(calls.some(args=>args.includes('--orphan')),status===2);
    assert.equal(calls.some(args=>args.includes('fetch')),status===0);
    assert.equal(calls.some(args=>args.includes('--force') || args.includes('push')),false);
    assert(calls.find(args=>args.includes('ls-remote')).includes('refs/heads/site-data'));
  }
});
