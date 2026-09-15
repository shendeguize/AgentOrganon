import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PRODUCTS, sha256, digest, readJSON, writeJSON, confined, gh, parseArgs, requireValue, main } from './lib.mjs';
import { assertManifest, assertArtifact, assertDispatch, validateEvidence, assertGithubReport } from './manifest.mjs';
import { collectEvidenceClosure, fetchEvidenceClosure } from './evidence.mjs';
import { validateStable } from './stable.mjs';
import * as governance from './governance.mjs';

export const assetName = item => item.file.endsWith('.tgz') ? path.basename(item.file) : `${item.sha256}-${path.basename(item.file)}`;
const execute = (cmd, args, options = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options });
const integrity = file => `sha512-${crypto.createHash('sha512').update(fs.readFileSync(file)).digest('base64')}`;
export function releaseFiles(manifest, root) {
  const items = collectEvidenceClosure(manifest, root), names = new Map();
  for (const item of items) {
    const name = assetName(item);
    if (names.has(name) && names.get(name) !== item.sha256) throw new Error(`Conflicting release asset name: ${name}`);
    names.set(name, item.sha256);
  }
  return [...new Map(items.map(item => [assetName(item), item])).values()];
}
export async function registryVersion(product, version) {
  const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(PRODUCTS[product].package)}/${version}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`npm registry lookup failed: HTTP ${response.status}`);
  return response.json();
}
async function publishNpm(manifest, product, file) {
  const previous = await registryVersion(product, manifest.version);
  const expected = integrity(file);
  if (previous) {
    if (previous.dist?.integrity !== expected) throw new Error(`Published version has different bytes: ${product}`);
    return 'already-matching';
  }
  const strategy = process.env.NPM_CHANNEL_STRATEGY;
  if (!['direct', 'deferred'].includes(strategy)) throw new Error('Explicit approved NPM_CHANNEL_STRATEGY is required');
  const temporaryTag = strategy === 'direct' ? (manifest.channel === 'rc' ? 'rc' : 'latest') : `candidate-${manifest.version.replace(/\./g, '-')}`;
  execute('npm', ['publish', file, '--access', 'public', '--provenance', '--tag', temporaryTag], { stdio: 'inherit' });
  const current = await registryVersion(product, manifest.version);
  if (current?.dist?.integrity !== expected) throw new Error(`npm post-publication integrity mismatch: ${product}`);
  return 'published';
}
function getRelease(repository, tag) {
  try { return gh([`repos/${repository}/releases/tags/${tag}`]); }
  catch (error) { if (String(error.stderr || error.message).includes('404')) return null; throw error; }
}
function assertTag(repository, tag, commit) {
  let object = gh([`repos/${repository}/git/ref/tags/${tag}`]).object;
  for (let depth = 0; object.type === 'tag' && depth < 5; depth++) object = gh([`repos/${repository}/git/tags/${object.sha}`]).object;
  if (object.type !== 'commit' || object.sha !== commit) throw new Error(`Release tag has different source: ${repository}/${tag}`);
}
function ensureGithub(manifest, product, root, { coordinator = false } = {}) {
  const repository = manifest.sources[product].repository;
  const tag = `v${manifest.version}`;
  let release = getRelease(repository, tag);
  if (!release) {
    release = gh([`repos/${repository}/releases`, '--method', 'POST'], { tag_name: tag, target_commitish: manifest.sources[product].commit,
      name: `${PRODUCTS[product].repo} ${manifest.version}`, draft: true, prerelease: manifest.channel === 'rc', make_latest: 'false',
      body: `Product ${manifest.version}. Manifest identity: ${digest(manifest)}. Philosophy and product versions are separate. Install and validation details are in the attached manifest.`, });
  }
  if (release.draft && release.target_commitish !== manifest.sources[product].commit) throw new Error('Existing draft targets a different source commit');
  if (!release.draft) assertTag(repository, tag, manifest.sources[product].commit);
  else {
    try { gh([`repos/${repository}/git/ref/tags/${tag}`]); assertTag(repository, tag, manifest.sources[product].commit); }
    catch (error) { if (!String(error.stderr || error.message).includes('404')) throw error; }
  }
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'organon-publish-'));
  try {
    const manifestFile = path.join(temporary, 'release-manifest.json'); writeJSON(manifestFile, manifest);
    const items = coordinator ? releaseFiles(manifest, root) : [manifest.artifacts[product]];
    const upload = [{ file: manifestFile, name: 'release-manifest.json' }, ...items.map(item => ({ file: assertArtifact(root, item), name: assetName(item) }))];
    for (const item of upload) {
      const existing = release.assets.find(asset => asset.name === item.name);
      if (existing) {
        const bytes = execFileSync('gh', ['api', `repos/${repository}/releases/assets/${existing.id}`, '-H', 'Accept: application/octet-stream'], { maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
        if (sha256(bytes) !== sha256(fs.readFileSync(item.file))) throw new Error(`Existing release asset differs: ${item.name}`);
      } else {
        if (!release.draft) throw new Error(`Published release is incomplete; use a new RC: ${item.name}`);
        const copied = path.join(temporary, item.name); if (copied !== item.file) fs.copyFileSync(item.file, copied);
        execute('gh', ['release', 'upload', tag, copied, '--repo', repository]);
      }
    }
    if (release.draft) gh([`repos/${repository}/releases/${release.id}`, '--method', 'PATCH'], { draft: false, prerelease: manifest.channel === 'rc', make_latest: 'false' });
    assertTag(repository, tag, manifest.sources[product].commit);
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}
export async function recheckReleaseGovernance(manifest, inspect = governance.inspectReleaseGovernance) {
  assertManifest(manifest);
  const reports = [];
  for (const product of Object.keys(PRODUCTS)) {
    const report = await inspect(manifest.sources[product].repository);
    assertGithubReport(report, product);
    reports.push({ ...report, product });
  }
  return reports;
}
export async function withReleaseGovernance(manifest, operation, inspect = governance.inspectReleaseGovernance) {
  const reports = await recheckReleaseGovernance(manifest, inspect);
  return operation(reports);
}
export async function verifyPublished(manifest, root, products = Object.keys(PRODUCTS), { inspect = governance.inspectReleaseGovernance } = {}) {
  return withReleaseGovernance(manifest, async () => {
    for (const product of products) {
      const current = await registryVersion(product, manifest.version);
      if (current?.dist?.integrity !== integrity(assertArtifact(root, manifest.artifacts[product]))) throw new Error(`Not all npm products are published with matching bytes: ${product}`);
      const repository = manifest.sources[product].repository;
      const release = getRelease(repository, `v${manifest.version}`);
      if (!release || release.draft || release.prerelease !== (manifest.channel === 'rc')) throw new Error(`GitHub product not published: ${product}`);
      assertTag(repository, `v${manifest.version}`, manifest.sources[product].commit);
      const checks = [{ name: 'release-manifest.json', expected: sha256(`${JSON.stringify(manifest, null, 2)}\n`) },
        ...((product === 'agent-organon' ? releaseFiles(manifest, root) : [manifest.artifacts[product]])).map(item => ({ name: assetName(item), expected: item.sha256 }))];
      for (const item of checks) {
        const asset = release.assets.find(value => value.name === item.name);
        if (!asset) throw new Error(`GitHub artifact missing: ${product}/${item.name}`);
        const bytes = execFileSync('gh', ['api', `repos/${repository}/releases/assets/${asset.id}`, '-H', 'Accept: application/octet-stream'], { maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
        if (sha256(bytes) !== item.expected) throw new Error(`Downloaded GitHub bytes differ: ${product}/${item.name}`);
      }
      if (!current.dist?.tarball?.startsWith('https://registry.npmjs.org/')) throw new Error('Unexpected npm tarball origin');
      const download = await fetch(current.dist.tarball);
      if (!download.ok) throw new Error(`npm tarball download failed: ${product}`);
      if (sha256(Buffer.from(await download.arrayBuffer())) !== manifest.artifacts[product].sha256) throw new Error(`Downloaded npm bytes differ: ${product}`);
    }
  }, inspect);
}
async function fetchAsset(version, name, expected, destination) {
  const response = await fetch(`https://github.com/shendeguize/AgentOrganon/releases/download/v${version}/${encodeURIComponent(name)}`);
  if (!response.ok) throw new Error(`Validated release bundle unavailable: ${name}, HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 64 * 1024 * 1024 || (expected && sha256(bytes) !== expected)) throw new Error(`Invalid bundle asset: ${name}`);
  fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.writeFileSync(destination, bytes);
}
export async function fetchBundle(version, expectedManifest, root) {
  if (!/^1\.0\.0(?:-rc\.[1-9]\d*)?$/.test(version) || !/^[a-f0-9]{64}$/.test(expectedManifest)) throw new Error('Invalid bundle identity');
  const file = path.join(root, 'release-manifest.json');
  await fetchAsset(version, 'release-manifest.json', null, file);
  const manifest = readJSON(file); assertManifest(manifest, { publish: true });
  if (manifest.version !== version || digest(manifest) !== expectedManifest) throw new Error('Downloaded manifest is not the approved object');
  const fetchItem = item => fetchAsset(version, assetName(item), item.sha256, confined(root, item.file));
  await fetchEvidenceClosure(manifest, root, fetchItem);
  validateEvidence(manifest, root); return manifest;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(async () => {
  const args = parseArgs(); const operation = args._[0];
  if (operation === 'fetch') { const manifest = await fetchBundle(requireValue(args, 'version'), requireValue(args, 'manifest-sha256'), path.resolve(requireValue(args, 'out'))); console.log(JSON.stringify({ status: 'passed', manifest_sha256: digest(manifest) })); return; }
  const file = path.resolve(requireValue(args, 'manifest')); const root = path.dirname(file); const manifest = readJSON(file);
  validateEvidence(manifest, root);
  if (operation === 'verify') { await verifyPublished(manifest, root); console.log(JSON.stringify({ status: 'passed' })); return; }
  const product = requireValue(args, 'product'); assertDispatch(manifest, process.env, product);
  if (manifest.channel === 'stable') await validateStable(manifest, root);
  await withReleaseGovernance(manifest, async () => {
    if (operation === 'bootstrap-bundle') {
      if (product !== 'agent-organon') throw new Error('Only the coordinator publishes the validated bundle');
      ensureGithub(manifest, product, root, { coordinator: true });
    } else if (operation === 'publish') {
      if (process.env.NPM_CHANNEL_STRATEGY === 'direct') await verifyPublished(manifest, root, Object.keys(PRODUCTS).slice(0, Object.keys(PRODUCTS).indexOf(product)));
      await publishNpm(manifest, product, assertArtifact(root, manifest.artifacts[product]));
      ensureGithub(manifest, product, root, { coordinator: product === 'agent-organon' });
    } else if (operation === 'promote') {
      await verifyPublished(manifest, root);
      if (process.env.NPM_CHANNEL_STRATEGY === 'deferred') {
        if (!process.env.NODE_AUTH_TOKEN) throw new Error('Deferred npm channel promotion requires a separately authorized tag-management credential; OIDC does not support dist-tag');
        execute('npm', ['dist-tag', 'add', `${PRODUCTS[product].package}@${manifest.version}`, manifest.channel === 'rc' ? 'rc' : 'latest'], { stdio: 'inherit' });
      } else if (process.env.NPM_CHANNEL_STRATEGY !== 'direct') throw new Error('Explicit approved NPM_CHANNEL_STRATEGY is required');
      const release = getRelease(manifest.sources[product].repository, `v${manifest.version}`);
      if (manifest.channel === 'stable') gh([`repos/${manifest.sources[product].repository}/releases/${release.id}`, '--method', 'PATCH'], { make_latest: 'true' });
    } else throw new Error('Expected fetch, bootstrap-bundle, publish, promote or verify');
  });
  console.log(JSON.stringify({ status: 'passed', operation, product, version: manifest.version, manifest_sha256: digest(manifest) }));
});
