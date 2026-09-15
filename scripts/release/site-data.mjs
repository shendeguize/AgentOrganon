import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PRODUCTS, digest, sha256, readJSON, writeJSON, parseArgs, requireValue, main } from './lib.mjs';
import { assertManifest } from './manifest.mjs';
import { validateHistory, observe, renderSVG } from './stars.mjs';
import { fetchBundle, verifyPublished } from './publish.mjs';

const MUTABLE = new Set(['assets/stars.json', 'assets/stars.svg']);
export function productFor(repository) {
  const product = Object.keys(PRODUCTS).find(key => repository === `shendeguize/${PRODUCTS[key].repo}`);
  if (!product) throw new Error('Unexpected site repository');
  return product;
}
export function assertSiteRunner(env, operation) {
  productFor(env.GITHUB_REPOSITORY);
  if (!['stars', 'pages'].includes(operation) || env.GITHUB_ACTIONS !== 'true' || env.RUNNER_ENVIRONMENT !== 'github-hosted' || !env.RUNNER_TEMP || !env.GITHUB_TOKEN || !['refs/heads/main', 'refs/heads/release/1.0.0'].includes(env.GITHUB_REF) || !(operation === 'stars' ? ['schedule', 'workflow_dispatch'] : ['workflow_dispatch']).includes(env.GITHUB_EVENT_NAME)) throw new Error('Site writes require a reviewed GitHub-hosted workflow');
}
export function inventory(root) {
  if (fs.lstatSync(root).isSymbolicLink() || !fs.statSync(root).isDirectory()) throw new Error('Invalid public site directory');
  const files = {};
  function visit(directory, prefix = '') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))) {
      const relative = `${prefix}${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error('Site tree contains a symlink');
      if (entry.isDirectory()) visit(path.join(directory, entry.name), `${relative}/`);
      else if (entry.isFile()) { if (!MUTABLE.has(relative)) files[relative] = sha256(fs.readFileSync(path.join(directory, entry.name))); }
      else throw new Error('Site tree contains a special file');
    }
  }
  visit(root);
  if (!files['index.html'] || !files['zh/index.html']) throw new Error('Missing bilingual site entrypoints');
  return files;
}
export function validateState(root, repository) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name === '.git' && entry.isDirectory()) continue;
    if (!['stars.json', 'stars.svg', 'public', 'release-manifest.json', 'recommended-release.json'].includes(entry.name) || entry.isSymbolicLink() || (entry.name === 'public' ? !entry.isDirectory() : !entry.isFile())) throw new Error('Unexpected or unsafe site-data entry');
  }
  if (fs.existsSync(path.join(root, 'stars.json'))) validateHistory(readJSON(path.join(root, 'stars.json')), repository);
  const recommendation = path.join(root, 'recommended-release.json');
  if (!fs.existsSync(recommendation)) {
    if (fs.existsSync(path.join(root, 'public')) || fs.existsSync(path.join(root, 'release-manifest.json'))) throw new Error('Orphan public site without a release receipt');
    return null;
  }
  const saved = readJSON(recommendation), manifest = readJSON(path.join(root, 'release-manifest.json'));
  assertManifest(manifest, { publish: true });
  const product = productFor(repository);
  if (saved.schema_version !== 1 || saved.repository !== repository || saved.version !== manifest.version || saved.manifest_sha256 !== digest(manifest) || saved.source_commit !== manifest.sources[product].commit || saved.core_commit !== manifest.sources.core.commit || saved.verification !== 'all-three-npm-and-github' || !saved.verified_at || Number.isNaN(Date.parse(saved.verified_at)) || digest(saved.site_files) !== digest(inventory(path.join(root, 'public')))) throw new Error('Stored public site identity differs from verified release');
  return saved;
}
export async function sampleStars(root, repository, fetcher = fetch, now = new Date(), token) {
  const previous = fs.existsSync(path.join(root, 'stars.json')) ? validateHistory(readJSON(path.join(root, 'stars.json')), repository) : { schema_version: 1, repository, observations: [] };
  const saved = validateState(root, repository);
  const response = await fetcher(`https://api.github.com/repos/${repository}`, { headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
  if (!response.ok) throw new Error(`Star observation failed: HTTP ${response.status}; state unchanged`);
  const history = observe(previous, (await response.json()).stargazers_count, now);
  writeJSON(path.join(root, 'stars.json'), history);
  fs.writeFileSync(path.join(root, 'stars.svg'), renderSVG(history));
  if (saved) copyStars(root);
  return Boolean(saved);
}
function copyStars(root) {
  const history = readJSON(path.join(root, 'stars.json'));
  validateHistory(history, history.repository);
  const assets = path.join(root, 'public/assets'); fs.mkdirSync(assets, { recursive: true });
  writeJSON(path.join(assets, 'stars.json'), history);
  fs.writeFileSync(path.join(assets, 'stars.svg'), renderSVG(history));
}
export function installPublic(root, repository, manifest, built, verifiedAt) {
  assertManifest(manifest, { publish: true });
  const previous = validateState(root, repository), product = productFor(repository);
  const rank = version => version === '1.0.0' ? Infinity : Number(version.split('-rc.')[1]);
  if (previous && (rank(previous.version) > rank(manifest.version) || (previous.version === manifest.version && previous.manifest_sha256 !== digest(manifest)))) throw new Error('Cannot replace a recommendation with older or different same-version content');
  const files = inventory(built);
  if (!verifiedAt || Number.isNaN(Date.parse(verifiedAt))) throw new Error('Missing completed publication verification time');
  fs.rmSync(path.join(root, 'public'), { recursive: true, force: true });
  fs.cpSync(built, path.join(root, 'public'), { recursive: true });
  writeJSON(path.join(root, 'release-manifest.json'), manifest);
  writeJSON(path.join(root, 'recommended-release.json'), { schema_version: 1, repository, version: manifest.version, manifest_sha256: digest(manifest), source_commit: manifest.sources[product].commit, core_commit: manifest.sources.core.commit, verification: 'all-three-npm-and-github', verified_at: verifiedAt, site_files: files });
  if (fs.existsSync(path.join(root, 'stars.json'))) copyStars(root);
  validateState(root, repository);
}
export function buildIdentity(repo, core, manifest, product) {
  const site = readJSON(path.join(repo, 'site/site.json'));
  const theme = readJSON(path.join(core, 'tools/site/package.json'));
  if (site.repository !== PRODUCTS[product].repo || site.product !== product || site.version !== manifest.version || site.themeVersion !== theme.version || theme.version !== manifest.version) throw new Error('Site/product/theme version differs from fixed release');
}
function cleanEnv(scratch) {
  const env = Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR', 'LANG', 'LC_ALL'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
  const home = path.join(scratch, 'home'), temp = path.join(scratch, 'tmp'); fs.mkdirSync(home, { recursive: true }); fs.mkdirSync(temp, { recursive: true });
  return { ...env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: path.join(home, '.config'), TMPDIR: temp, TMP: temp, TEMP: temp, npm_config_cache: path.join(scratch, 'npm-cache'), CI: 'true' };
}
const execute = (command, args, options = {}) => execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024, ...options }).trim();
export function checkoutState(root, repository, env, executor = execute) {
  fs.mkdirSync(root, { recursive: true });
  const git = (...args) => executor('git', ['-C', root, ...args], { env });
  git('init'); git('remote', 'add', 'origin', `https://github.com/${repository}.git`);
  let exists = true;
  try { git('ls-remote', '--exit-code', '--heads', 'origin', 'refs/heads/site-data'); }
  catch (error) { if (error.status !== 2) throw error; exists = false; }
  if (exists) { git('fetch', '--depth=1', 'origin', 'refs/heads/site-data'); git('checkout', '-B', 'site-data', 'FETCH_HEAD'); }
  else git('checkout', '--orphan', 'site-data');
  return git;
}
function checkoutSource(scratch, source, env) {
  const directory = path.join(scratch, source.repository.split('/')[1]);
  fs.mkdirSync(directory, { recursive: true });
  const git = (...args) => execute('git', ['-C', directory, ...args], { env });
  git('init'); git('remote', 'add', 'origin', `https://github.com/${source.repository}.git`); git('fetch', '--depth=1', 'origin', source.commit); git('checkout', '--detach', 'FETCH_HEAD');
  if (git('rev-parse', 'HEAD') !== source.commit) throw new Error('Source checkout identity mismatch');
  return directory;
}
export async function verifyForSite(manifest, bundle, verifier = verifyPublished) {
  await verifier(manifest, bundle);
  return new Date().toISOString();
}
async function buildReleased(scratch, repository, version, hash, env) {
  const bundle = path.join(scratch, 'bundle');
  const manifest = await fetchBundle(version, hash, bundle);
  const verifiedAt = await verifyForSite(manifest, bundle), product = productFor(repository);
  const core = checkoutSource(scratch, manifest.sources.core, env);
  const repo = product === 'core' ? core : checkoutSource(scratch, manifest.sources[product], env);
  if (product === 'agent-organon') {
    for (const key of ['core', 'advised']) {
      const relative = PRODUCTS[key].directory;
      const link = execute('git', ['-C', repo, 'ls-tree', 'HEAD', relative], { env });
      if (!link.startsWith(`160000 commit ${manifest.sources[key].commit}\t`)) throw new Error('Released workspace gitlink mismatch');
    }
    fs.rmSync(path.join(repo, 'OrganonCore'), { recursive: true, force: true }); fs.cpSync(core, path.join(repo, 'OrganonCore'), { recursive: true });
    const advised = checkoutSource(scratch, manifest.sources.advised, env);
    fs.rmSync(path.join(repo, 'AdvisedOrganons'), { recursive: true, force: true }); fs.cpSync(advised, path.join(repo, 'AdvisedOrganons'), { recursive: true });
  }
  if (product === 'advised') {
    const tooling = readJSON(path.join(repo, 'release/tooling.json'));
    if (tooling.core?.repository !== manifest.sources.core.repository || tooling.core?.commit !== manifest.sources.core.commit) throw new Error('Released domain theme pin differs from manifest');
  }
  buildIdentity(repo, core, manifest, product);
  execute('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: path.join(core, 'tools/site'), env });
  for (const operation of ['build', 'check']) execute(process.execPath, [path.join(core, `tools/site/${operation}.mjs`), '--repo', repo], { env });
  return { manifest, built: path.join(repo, 'dist/site'), verifiedAt };
}
export async function runSiteData(args, env = process.env) {
  const operation = args._[0]; assertSiteRunner(env, operation);
  const scratch = fs.mkdtempSync(path.join(env.RUNNER_TEMP, 'organon-site-'));
  const localEnv = cleanEnv(scratch), state = path.join(scratch, 'state');
  const git = checkoutState(state, env.GITHUB_REPOSITORY, localEnv);
  let deploy;
  if (operation === 'stars') deploy = await sampleStars(state, env.GITHUB_REPOSITORY, fetch, new Date(), env.GITHUB_TOKEN);
  else {
    const release = await buildReleased(scratch, env.GITHUB_REPOSITORY, requireValue(args, 'version'), requireValue(args, 'manifest-sha256'), localEnv);
    installPublic(state, env.GITHUB_REPOSITORY, release.manifest, release.built, release.verifiedAt); deploy = true;
  }
  // Git configuration is process-local; the token never enters a URL, argv or a persisted config.
  const pushEnv = { ...localEnv, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader', GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${env.GITHUB_TOKEN}`).toString('base64')}` };
  git('config', 'user.name', 'github-actions[bot]'); git('config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com');
  git('add', '--all');
  if (git('status', '--porcelain')) { git('commit', '-m', operation === 'stars' ? 'Record observed GitHub stars' : 'Publish verified release site'); execute('git', ['-C', state, 'push', 'origin', 'HEAD:refs/heads/site-data'], { env: pushEnv }); }
  if (env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT, `deploy=${deploy}\npublic_dir=${path.join(state, 'public')}\n`);
  return { status: 'passed', operation, deploy, repository: env.GITHUB_REPOSITORY };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(async () => console.log(JSON.stringify(await runSiteData(parseArgs()))));
