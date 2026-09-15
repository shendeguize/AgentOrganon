import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { AGENTS, discoveryRoot } from './adapters.mjs';
import { PRODUCTS, openPackage, verifyPackage } from './package.mjs';
import { exists, json, serialize, sha256, write, within, noSymlinkAncestors, listFiles } from './files.mjs';
import { locked, recover, transact, matches } from './transaction.mjs';

function context(options) {
  if (!Object.hasOwn(PRODUCTS, options.product)) throw new Error('--product agent-organon|core|advised is required');
  if (!Object.hasOwn(AGENTS, options.agent)) throw new Error(`--agent ${Object.keys(AGENTS).join('|')} is required`);
  if (!['project', 'global'].includes(options.scope)) throw new Error('--scope project|global is required');
  if (options.scope === 'project' && !options.project) throw new Error('--project is required for project scope');
  const requestedRoot = options.scope === 'global' ? os.homedir() : path.resolve(options.project);
  if (!exists(requestedRoot) || !fs.statSync(requestedRoot).isDirectory()) throw new Error(`Installation root must exist: ${requestedRoot}`);
  const root = fs.realpathSync(requestedRoot);
  const store = path.join(root, '.organon');
  noSymlinkAncestors(store);
  return { ...options, root, store, stateFile: path.join(store, 'installations.json') };
}
function stateOf(ctx) {
  noSymlinkAncestors(ctx.stateFile);
  const state = exists(ctx.stateFile) ? json(ctx.stateFile) : { schema: 1, products: {} };
  if (state.schema !== 1 || !state.products || typeof state.products !== 'object') throw new Error('Invalid installation state');
  for (const [product, entry] of Object.entries(state.products)) {
    if (!Object.hasOwn(PRODUCTS, product)) throw new Error('Unknown product in installation state');
    for (const candidate of [entry, entry.previous].filter(Boolean)) {
      within(path.join(ctx.store, 'packages', product), candidate.directory);
      noSymlinkAncestors(candidate.directory);
      if (!/^[a-f0-9]{64}$/.test(candidate.manifestHash)) throw new Error('Invalid installed manifest identity');
    }
    for (const [agent, discovery] of Object.entries(entry.discovery ?? {})) {
      if (!Object.hasOwn(AGENTS, agent)) throw new Error('Unknown agent in installation state');
      for (const item of discovery) {
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.skill) || item.file !== path.join(discoveryRoot(agent, ctx.scope, ctx.root), item.skill, 'SKILL.md')) throw new Error('Invalid installed discovery path');
      }
    }
  }
  return state;
}
function assertCurrent(entry) {
  const manifest = verifyPackage(entry.directory);
  if (manifest.manifestHash !== entry.manifestHash) throw new Error('Installed manifest was modified');
  for (const discovery of Object.values(entry.discovery)) {
    for (const item of discovery) if (!matches(item.file, item.sha256)) throw new Error(`Installed skill was modified or removed: ${item.file}`);
  }
}
function renderSkill(source, destination, directory) {
  const payload = path.join(directory, 'payload');
  const text = fs.readFileSync(source, 'utf8');
  const canonical = path.dirname(source);
  let rendered = text.replace(/\]\(([^\s)]+)\)/g, (whole, href) => {
    if (/^(?:[a-z]+:|#|\/)/i.test(href)) return whole;
    const [relative, fragment] = href.split('#');
    const target = path.resolve(canonical, decodeURIComponent(relative));
    return `](${path.relative(path.dirname(destination), target).split(path.sep).map(part => encodeURIComponent(part)).join('/')}${fragment ? `#${fragment}` : ''})`;
  });
  // Keep the caller's cwd unchanged. Script roots are explicit, including the
  // management skill's formerly repository-relative command examples.
  rendered = rendered.replace(/node (?:<AgentOrganon>\/)?scripts\/([\w/-]+\.js)/g, (_, script) => `node "${path.join(payload, 'scripts', script)}"`);
  rendered = rendered.replaceAll('<AgentOrganon>', payload);
  const end = rendered.indexOf('\n---', 4);
  const note = `\n\nInstalled runtime directory: \`${payload}\`. Canonical skill directory: \`${canonical}\`. Resolve any remaining repository-relative command or resource from those directories; preserve the caller's workspace for philosophical selection. This installation contains non-Lean methods only.\n`;
  return rendered.slice(0, end + 4) + note + rendered.slice(end + 4);
}
function discoveryFor(ctx, directory, manifest, agents) {
  const discovery = {};
  const operations = [];
  for (const agent of agents) {
    discovery[agent] = [];
    for (const skill of manifest.skills) {
      const file = path.join(discoveryRoot(agent, ctx.scope, ctx.root), skill.name, 'SKILL.md');
      const content = renderSkill(path.join(directory, skill.path), file, directory);
      discovery[agent].push({ file, sha256: sha256(content), sourceSha256: manifest.files.find(entry => entry.path === skill.path).sha256, skill: skill.name });
      operations.push({ file, content });
    }
  }
  return { discovery, operations };
}
function collisionCheck(ctx, operations, existing) {
  const owned = new Map(Object.values(existing?.discovery ?? {}).flat().map(entry => [entry.file, entry.sha256]));
  for (const { file } of operations) {
    noSymlinkAncestors(file);
    if (exists(file) && (!owned.has(file) || !matches(file, owned.get(file)))) throw new Error(`Discovery path conflict: ${file}`);
  }
}
function aliases(ctx, entry) {
  const warnings = [];
  for (const [agent, discovered] of Object.entries(entry.discovery)) {
    for (const skill of discovered) {
      for (const alias of AGENTS[agent].aliases) {
        const file = path.join(ctx.root, alias, skill.skill, 'SKILL.md');
        if (file !== skill.file && exists(file)) {
          const ownedAlias = Object.values(entry.discovery).flat().find(item => item.file === file);
          warnings.push({ type: 'alias-discovery', agent, skill: skill.skill, file, sameManagedPayload: Boolean(ownedAlias && matches(file, ownedAlias.sha256)), resolution: 'Inspect both discovery paths. Retain the desired integration and explicitly uninstall an unwanted managed integration; agent precedence is not assumed.' });
        }
      }
      const otherRoot = ctx.scope === 'project' ? os.homedir() : ctx.project && path.resolve(ctx.project);
      const otherScope = ctx.scope === 'project' ? 'global' : 'project';
      if (otherRoot) {
        const file = path.join(discoveryRoot(agent, otherScope, otherRoot), skill.skill, 'SKILL.md');
        if (file !== skill.file && exists(file)) warnings.push({ type: 'cross-scope-discovery', agent, skill: skill.skill, file, resolution: 'Compare the project and global installations. Explicitly uninstall the unwanted scope; no scope is silently preferred.' });
      }
    }
  }
  return warnings;
}

export async function install(options, { update = false, bundled } = {}) {
  const ctx = context(options);
  if (ctx.product === 'advised' && ctx.domain !== 'SoftwareEngineering') throw new Error('AdvisedOrganons requires explicit --domain SoftwareEngineering');
  const source = await openPackage({ ...ctx, bundled });
  try {
    return locked(ctx.store, () => {
      const recovered = recover(ctx.store, ctx.root);
      const state = stateOf(ctx);
      const existing = state.products[ctx.product];
      if (existing) assertCurrent(existing);
      if (update && !existing) throw new Error('Product is not installed; use install first');
      if (!update && existing && existing.manifestHash !== source.manifest.manifestHash) throw new Error('Different content is already installed; use update');
      if (existing?.manifestHash === source.manifest.manifestHash && existing.discovery[ctx.agent]) return { action: 'unchanged', product: ctx.product, version: existing.version, directory: existing.directory, recovered, warnings: aliases(ctx, existing) };
      const directory = path.join(ctx.store, 'packages', ctx.product, `${source.manifest.version}-${source.manifest.manifestHash.slice(0, 16)}`);
      noSymlinkAncestors(directory);
      if (!exists(directory)) {
        const staging = `${directory}.staging-${process.pid}`;
        fs.mkdirSync(path.dirname(staging), { recursive: true });
        fs.cpSync(source.directory, staging, { recursive: true, dereference: false, errorOnExist: true, force: false });
        verifyPackage(staging); fs.renameSync(staging, directory);
      }
      const manifest = verifyPackage(directory);
      const agents = [...new Set([...Object.keys(existing?.discovery ?? {}), ctx.agent])].sort();
      const { discovery, operations } = discoveryFor(ctx, directory, manifest, agents);
      collisionCheck(ctx, operations, existing);
      const nextFiles = new Set(operations.map(entry => entry.file));
      for (const item of Object.values(existing?.discovery ?? {}).flat()) if (!nextFiles.has(item.file)) operations.push({ file: item.file, content: null });
      const entry = { version: manifest.version, manifestHash: manifest.manifestHash, directory, discovery, domain: ctx.domain ?? existing?.domain ?? null, previous: existing && existing.manifestHash !== manifest.manifestHash ? { version: existing.version, manifestHash: existing.manifestHash, directory: existing.directory } : existing?.previous ?? null };
      state.products[ctx.product] = entry;
      operations.push({ file: ctx.stateFile, content: serialize(state) });
      transact(ctx.store, ctx.root, operations);
      const retained = [];
      const obsolete = existing?.previous;
      if (obsolete && obsolete.directory !== directory && obsolete.directory !== entry.previous?.directory) {
        try {
          if (verifyPackage(obsolete.directory).manifestHash !== obsolete.manifestHash) retained.push(obsolete.directory);
          else fs.rmSync(obsolete.directory, { recursive: true });
        } catch { retained.push(obsolete.directory); }
      }
      return { action: update ? 'updated' : 'installed', product: ctx.product, version: manifest.version, directory, discovery, recovered, retained, warnings: aliases(ctx, entry), capabilityValidation: 'Filesystem content verified; authenticated agent invocation, resource permissions and delegation require separate tests.' };
    });
  } finally { source.close(); }
}

export function check(options) {
  const ctx = context(options);
  if (exists(path.join(ctx.store, 'transaction.json'))) throw new Error('Interrupted installation; rerun its lifecycle command to recover before checking');
  const entry = stateOf(ctx).products[ctx.product];
  if (!entry?.discovery[ctx.agent]) throw new Error('Product is not installed for this agent and scope');
  assertCurrent(entry);
  const command = AGENTS[ctx.agent].command;
  const result = spawnSync(command, ['--version'], { encoding: 'utf8', timeout: 10000, windowsHide: true });
  return { passed: true, validationScope: 'package-integrity-and-discovery-files', capabilityValidationComplete: false, product: ctx.product, version: entry.version, directory: entry.directory, discovery: entry.discovery[ctx.agent], warnings: aliases(ctx, entry), agent: { command, executableAvailable: !result.error && result.status === 0, authentication: 'not-checked', invocation: 'not-checked', resourcePermissions: 'not-checked', delegation: 'not-checked' } };
}

export function rollback(options) {
  const ctx = context(options);
  return locked(ctx.store, () => {
    const recovered = recover(ctx.store, ctx.root);
    const state = stateOf(ctx); const entry = state.products[ctx.product];
    if (!entry?.previous) throw new Error('No previous complete installation is available');
    assertCurrent(entry);
    const previous = verifyPackage(entry.previous.directory);
    if (previous.manifestHash !== entry.previous.manifestHash) throw new Error('Previous installation was modified');
    const { discovery, operations } = discoveryFor(ctx, entry.previous.directory, previous, Object.keys(entry.discovery));
    collisionCheck(ctx, operations, entry);
    const nextFiles = new Set(operations.map(item => item.file));
    for (const item of Object.values(entry.discovery).flat()) if (!nextFiles.has(item.file)) operations.push({ file: item.file, content: null });
    state.products[ctx.product] = { ...entry.previous, discovery, domain: entry.domain, previous: { version: entry.version, manifestHash: entry.manifestHash, directory: entry.directory } };
    operations.push({ file: ctx.stateFile, content: serialize(state) });
    transact(ctx.store, ctx.root, operations);
    return { action: 'rolled-back', product: ctx.product, version: previous.version, recovered };
  });
}

export function uninstall(options) {
  const ctx = context(options);
  return locked(ctx.store, () => {
    const recovered = recover(ctx.store, ctx.root);
    const state = stateOf(ctx); const entry = state.products[ctx.product];
    if (!entry?.discovery[ctx.agent]) return { action: 'unchanged', recovered };
    const retained = [];
    const operations = [];
    for (const item of entry.discovery[ctx.agent]) {
      if (matches(item.file, item.sha256)) operations.push({ file: item.file, content: null });
      else if (exists(item.file)) retained.push(item.file);
    }
    delete entry.discovery[ctx.agent];
    const removeProduct = !Object.keys(entry.discovery).length;
    if (removeProduct) delete state.products[ctx.product];
    operations.push({ file: ctx.stateFile, content: serialize(state) });
    transact(ctx.store, ctx.root, operations);
    if (removeProduct) {
      // Retain content whenever a discovery copy was changed, so its references
      // do not become dangling. Payload edits also prevent recursive deletion.
      for (const candidate of [entry, entry.previous].filter(Boolean)) {
        try {
          const manifest = verifyPackage(candidate.directory);
          if (manifest.manifestHash !== candidate.manifestHash || retained.length) retained.push(candidate.directory);
          else fs.rmSync(candidate.directory, { recursive: true });
        } catch { retained.push(candidate.directory); }
      }
    }
    return { action: 'uninstalled', product: ctx.product, agent: ctx.agent, retained, recovered, adoption: 'unchanged' };
  });
}

export async function initialize(options) {
  const ctx = context(options);
  if (!options.project) throw new Error('--project is required for explicit project adoption');
  const project = fs.realpathSync(options.project);
  const entry = stateOf(ctx).products[ctx.product];
  if (!entry?.discovery[ctx.agent]) throw new Error('Install this product for the selected agent/scope before init');
  assertCurrent(entry);
  if (!['core', 'SoftwareEngineering'].includes(options.philosophy)) throw new Error('--philosophy core|SoftwareEngineering is required; installation is not adoption');
  if (options.philosophy === 'SoftwareEngineering' && (ctx.product !== 'advised' || options.domain !== 'SoftwareEngineering')) throw new Error('Select --product advised --domain SoftwareEngineering to adopt this domain');
  const source = path.join(entry.directory, 'payload', options.philosophy === 'core' ? 'OrganonCore/PHILOSOPHY.md' : 'AdvisedOrganons/SoftwareEngineering/PHILOSOPHY.md');
  const target = path.join(project, 'PHILOSOPHY.md');
  const lock = path.join(project, 'PHILOSOPHY.lock.json');
  const instructions = path.join(project, AGENTS[ctx.agent].instructions);
  const adoption = path.join(project, '.organon/adoption.json');
  for (const file of [target, lock, instructions, adoption]) noSymlinkAncestors(file);
  if (exists(target) || exists(lock) || exists(adoption)) throw new Error('Existing philosophy/adoption is preserved; use the philosophical review workflow for revision');
  const sourceId = options.philosophy === 'core' ? 'https://github.com/shendeguize/OrganonCore' : 'https://github.com/shendeguize/AdvisedOrganons/SoftwareEngineering';
  const block = '\n<!-- organon:adoption:begin -->\nRead [PHILOSOPHY.md](PHILOSOPHY.md) as this workspace\'s adopted philosophy. Preserve its path and real reference directory through Organon delegation. Installation changes do not authorize philosophical revision.\n<!-- organon:adoption:end -->\n';
  const current = exists(instructions) ? fs.readFileSync(instructions, 'utf8') : '';
  if (current.includes('<!-- organon:adoption:')) throw new Error('Existing Organon instruction block requires review');
  const preview = { action: 'preview', source, sourceSha256: sha256(fs.readFileSync(source)), installedManifestHash: entry.manifestHash, product: ctx.product, agent: ctx.agent, scope: ctx.scope, philosophy: options.philosophy, target, instructions, instructionsBeforeSha256: sha256(current), instructionAppend: block, adoption, expectedAbsent: [target, lock, adoption] };
  preview.planSha256 = sha256(serialize(preview));
  if (!options.apply) return preview;
  if (options['plan-sha256'] !== preview.planSha256) throw new Error('Adoption plan does not match the current inputs; rerun init preview and supply its --plan-sha256 with --apply');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'organon-adopt-'));
  try {
    const { initialize: managedInitialize } = await import(pathToFileURL(path.join(entry.directory, 'payload/scripts/lib/operations.js')).href);
    const candidate = path.join(temporary, 'PHILOSOPHY.md');
    managedInitialize({ target: candidate, source, sourceId });
    // Preserve the selected reference closure independently of installation
    // lifecycle. Adoption never points at a payload that uninstall can remove.
    const payload = path.join(entry.directory, 'payload');
    const snapshotRoot = path.join(project, '.organon/adopted', entry.manifestHash);
    const candidateText = fs.readFileSync(candidate, 'utf8').replace(/\]\(([^\s)]+)\)/g, (whole, href) => {
      if (/^(?:[a-z]+:|#|\/)/i.test(href)) return whole;
      const [relative, fragment] = href.split('#');
      const resource = within(payload, path.resolve(path.dirname(source), decodeURIComponent(relative)));
      const snapshotFile = path.join(snapshotRoot, path.relative(payload, resource));
      return `](${path.relative(project, snapshotFile).split(path.sep).map(part => encodeURIComponent(part)).join('/')}${fragment ? `#${fragment}` : ''})`;
    });
    const adoptionFiles = [
      ...listFiles(payload).map(file => ({ file: path.join(snapshotRoot, file), content: fs.readFileSync(path.join(payload, file)) })),
      { file: target, content: candidateText },
      { file: lock, content: fs.readFileSync(path.join(temporary, 'PHILOSOPHY.lock.json')) },
      { file: instructions, content: current + block },
      { file: adoption, content: serialize({ schema: 1, product: ctx.product, version: entry.version, philosophy: options.philosophy, source, sourceSha256: preview.sourceSha256, adoptedSha256: sha256(candidateText), referenceSnapshot: snapshotRoot, transformations: ['rebase-adopted-reference-links'] }) },
    ];
    const adoptionStore = path.join(project, '.organon');
    return locked(adoptionStore, () => {
      recover(adoptionStore, project);
      if (stateOf(ctx).products[ctx.product]?.manifestHash !== entry.manifestHash) throw new Error('Installation changed after adoption preview');
      assertCurrent(entry);
      for (const file of [target, lock, adoption]) if (exists(file)) throw new Error('Adoption destination changed after preview');
      if (exists(snapshotRoot)) throw new Error('Adoption reference snapshot already exists; inspect it before retrying');
      if ((exists(instructions) ? fs.readFileSync(instructions, 'utf8') : '') !== current) throw new Error('Project instructions changed after preview');
      transact(adoptionStore, project, adoptionFiles);
      return { ...preview, action: 'adopted' };
    });
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}
