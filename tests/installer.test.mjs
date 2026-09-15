import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildPackage } from '../scripts/package/build.mjs';
import { extractTarball } from '../installer/lib/archive.mjs';
import { sha256, serialize, write } from '../installer/lib/files.mjs';
import { transact } from '../installer/lib/transaction.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const candidateFile = process.env.ORGANON_TEST_CANDIDATE_MANIFEST;
const candidate = candidateFile ? JSON.parse(fs.readFileSync(candidateFile, 'utf8')) : null;
const firstVersion = candidate?.version || '1.0.0-rc.1';
const nextVersion = firstVersion.includes('-rc.') ? firstVersion.replace(/rc\.(\d+)$/, (_, n) => `rc.${Number(n) + 1}`) : '1.0.1';
function sandbox(t) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'organon-install-test-')));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const home = path.join(directory, 'home'); const project = path.join(directory, 'project with spaces');
  fs.mkdirSync(home); fs.mkdirSync(project);
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/(?:TOKEN|SECRET|PASSWORD|API_KEY|AUTH|CONFIG|HOME|NODE_OPTIONS)/i.test(key)));
  const env = { ...inherited, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: path.join(home, '.config'), CODEX_HOME: path.join(home, '.codex'), CLAUDE_CONFIG_DIR: path.join(home, '.claude'), GEMINI_CLI_HOME: home, npm_config_cache: path.join(home, '.npm'), npm_config_prefix: path.join(home, '.npm-global'), npm_config_userconfig: path.join(home, '.npmrc'), npm_config_globalconfig: path.join(home, '.npmrc-global') };
  const packages = {};
  function pack(product = 'agent-organon', version = firstVersion) {
    if (candidate && version === candidate.version) {
      const entry = candidate.artifacts[product];
      const file = path.resolve(path.dirname(candidateFile), entry.file);
      assert.equal(sha256(fs.readFileSync(file)), entry.sha256);
      return file;
    }
    const key = `${product}-${version}`;
    return packages[key] ??= buildPackage({ product, version, out: path.join(directory, 'artifacts') }).tarball;
  }
  const runtime = candidate ? path.join(extractTarball(pack(), path.join(directory, 'candidate-runtime')), 'installer/organon.mjs') : path.join(root, 'installer/organon.mjs');
  function cli(command, extra = [], expected = 0, product = 'agent-organon', executable = runtime) {
    const result = spawnSync(process.execPath, [executable, command, '--product', product, '--agent', 'codex', '--scope', 'project', '--project', project, ...extra], { cwd: project, env, encoding: 'utf8' });
    assert.equal(result.status, expected, result.stderr || result.stdout);
    return JSON.parse(expected ? result.stderr : result.stdout);
  }
  return { directory, home, project, env, pack, cli, runtime };
}

test('three extracted packages install offline from an empty directory and expose distinct skills', t => {
  const s = sandbox(t);
  const names = new Set();
  for (const product of ['agent-organon', 'core', 'advised']) {
    const extracted = extractTarball(s.pack(product), path.join(s.directory, `extract-${product}`));
    const readme = fs.readFileSync(path.join(extracted, 'README.md'), 'utf8');
    const example = readme.match(/`(node installer\/organon\.mjs install [^`]+)`/)[1].split(' ').slice(1).map(value => value === '/path/to/project' ? s.project : value);
    const execution = spawnSync(process.execPath, example, { cwd: extracted, env: s.env, encoding: 'utf8' });
    assert.equal(execution.status, 0, execution.stderr);
    const result = JSON.parse(execution.stdout);
    assert.equal(result.action, 'installed');
    for (const skill of result.discovery.codex) { assert.ok(!names.has(skill.skill)); names.add(skill.skill); }
    const checked = s.cli('check', [], 0, product, path.join(extracted, 'installer/organon.mjs'));
    assert.equal(checked.agent.authentication, 'not-checked');
  }
  assert.ok(!fs.existsSync(path.join(s.project, 'PHILOSOPHY.md')));
  assert.ok(!fs.existsSync(path.join(s.home, '.agents')));
});

test('idempotent install, exact update, rollback and immutable adoption reference closure', t => {
  const s = sandbox(t);
  const first = s.cli('install', ['--from', s.pack()]);
  assert.equal(s.cli('install', ['--from', s.pack()]).action, 'unchanged');
  const preview = s.cli('init', ['--philosophy', 'core']);
  assert.equal(preview.action, 'preview'); assert.ok(!fs.existsSync(preview.target));
  write(path.join(s.project, 'AGENTS.md'), 'User instructions.\n');
  s.cli('init', ['--philosophy', 'core', '--apply', '--plan-sha256', s.cli('init', ['--philosophy', 'core']).planSha256]);
  const adopted = fs.readFileSync(preview.target, 'utf8');
  assert.match(fs.readFileSync(path.join(s.project, 'AGENTS.md'), 'utf8'), /^User instructions\.\n/);
  const rationale = adopted.match(/\[Rationale\]\(([^)]+)\)/)[1];
  assert.ok(fs.existsSync(path.resolve(s.project, decodeURIComponent(rationale))));
  const updated = s.cli('update', ['--from', s.pack('agent-organon', nextVersion)]);
  assert.equal(updated.version, nextVersion);
  assert.equal(s.cli('rollback').version, firstVersion);
  assert.equal(s.cli('check').directory, first.directory);
  s.cli('uninstall');
  assert.equal(fs.readFileSync(preview.target, 'utf8'), adopted);
  assert.ok(fs.existsSync(path.resolve(s.project, decodeURIComponent(rationale))));
});

test('modified discovery blocks update and survives uninstall with its runtime', t => {
  const s = sandbox(t);
  const installed = s.cli('install', ['--from', s.pack()]);
  const file = installed.discovery.codex[0].file;
  fs.appendFileSync(file, '\nUser modification.\n');
  assert.match(s.cli('update', ['--from', s.pack('agent-organon', nextVersion)], 1).error, /modified/);
  const result = s.cli('uninstall');
  assert.ok(result.retained.includes(file)); assert.ok(fs.existsSync(installed.directory));
  assert.match(fs.readFileSync(file, 'utf8'), /User modification/);
});

test('modified payload blocks check/update and is retained by uninstall', t => {
  const s = sandbox(t);
  const installed = s.cli('install', ['--from', s.pack()]);
  fs.appendFileSync(path.join(installed.directory, 'payload/OrganonCore/PHILOSOPHY.md'), '\nModified.\n');
  assert.match(s.cli('check', [], 1).error, /integrity/);
  assert.match(s.cli('update', ['--from', s.pack('agent-organon', nextVersion)], 1).error, /integrity/);
  assert.ok(s.cli('uninstall').retained.includes(installed.directory));
});

test('existing project philosophy and destination symlinks are not overwritten', t => {
  const s = sandbox(t);
  s.cli('install', ['--from', s.pack()]);
  write(path.join(s.project, 'PHILOSOPHY.md'), 'Existing adopted text.\n');
  assert.match(s.cli('init', ['--philosophy', 'core', '--apply'], 1).error, /Existing philosophy/);
  assert.equal(fs.readFileSync(path.join(s.project, 'PHILOSOPHY.md'), 'utf8'), 'Existing adopted text.\n');
  const other = path.join(s.directory, 'other-project'); fs.mkdirSync(other);
  fs.symlinkSync(s.home, path.join(other, '.agents'), process.platform === 'win32' ? 'junction' : 'dir');
  const result = spawnSync(process.execPath, [path.join(root, 'installer/organon.mjs'), 'install', '--product', 'agent-organon', '--agent', 'codex', '--scope', 'project', '--project', other, '--from', s.pack()], { env: s.env, encoding: 'utf8' });
  assert.equal(result.status, 1); assert.match(result.stderr, /Symbolic link/);
  assert.ok(!fs.existsSync(path.join(s.home, 'skills')));
});

test('npm offline installation registers the sole working organon executable', t => {
  const s = sandbox(t);
  const npmCli = process.env.npm_execpath ?? (process.platform === 'win32'
    ? path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')
    : fs.realpathSync(execFileSync('which', ['npm'], { encoding: 'utf8' }).trim()));
  const result = spawnSync(process.execPath, [npmCli, 'install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--prefix', s.project, s.pack()], { env: s.env, cwd: s.project, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const bin = path.join(s.project, 'node_modules/.bin', process.platform === 'win32' ? 'organon.cmd' : 'organon');
  assert.ok(fs.existsSync(bin));
  const help = process.platform === 'win32'
    ? spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '& $env:ORGANON_TEST_BIN --help'], { env: { ...s.env, ORGANON_TEST_BIN: bin }, cwd: s.project, encoding: 'utf8' })
    : spawnSync(process.execPath, [bin, '--help'], { env: s.env, cwd: s.project, encoding: 'utf8' });
  assert.equal(help.status, 0, help.stderr); assert.match(JSON.parse(help.stdout).help, /install\|check\|init/);
});

test('recovery refuses independent edits and preserves its journal', t => {
  const s = sandbox(t); const installed = s.cli('install', ['--from', s.pack()]);
  const file = installed.discovery.codex[0].file;
  const before = fs.readFileSync(file).toString('base64');
  const after = Buffer.from('Candidate.').toString('base64');
  const journal = path.join(s.project, '.organon/transaction.json');
  write(journal, serialize({ schema: 1, operations: [{ path: file, before, after }] }));
  fs.writeFileSync(file, 'Independent user edit.');
  assert.match(s.cli('install', ['--from', s.pack()], 1).error, /Recovery conflict/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'Independent user edit.'); assert.ok(fs.existsSync(journal));
});

test('interrupted multi-file activation recovers before rerunning installation', t => {
  const s = sandbox(t);
  const installed = s.cli('install', ['--from', s.pack()]);
  const file = installed.discovery.codex[0].file;
  const before = fs.readFileSync(file).toString('base64');
  const after = Buffer.from('Interrupted candidate.').toString('base64');
  write(path.join(s.project, '.organon/transaction.json'), serialize({ schema: 1, operations: [{ path: file, before, after }] }));
  fs.writeFileSync(file, Buffer.from(after, 'base64'));
  assert.match(s.cli('check', [], 1).error, /Interrupted/);
  const result = s.cli('install', ['--from', s.pack()]);
  assert.equal(result.recovered, true); assert.equal(fs.readFileSync(file).toString('base64'), before);
  s.cli('check');
});

test('all six adapters install to native paths, retain coinstallation and report alias/scope duplication', t => {
  const s = sandbox(t); const archive = s.pack();
  const command = (action, agent, scope = 'project') => {
    const args = [path.join(root, 'installer/organon.mjs'), action, '--product', 'agent-organon', '--agent', agent, '--scope', scope, '--project', s.project, ...(action === 'install' ? ['--from', archive] : [])];
    const result = spawnSync(process.execPath, args, { env: s.env, cwd: s.project, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout);
  };
  for (const agent of ['codex', 'claude', 'cursor', 'copilot', 'gemini', 'opencode']) {
    assert.equal(command('install', agent).action, 'installed'); command('check', agent);
  }
  assert.ok(command('check', 'copilot').warnings.some(item => item.type === 'alias-discovery'));
  command('install', 'codex', 'global');
  assert.ok(command('check', 'codex').warnings.some(item => item.type === 'cross-scope-discovery'));
  command('uninstall', 'claude'); command('check', 'codex');
  assert.ok(fs.existsSync(path.join(s.home, '.agents/skills/organon-assess/SKILL.md')));
});

test('explicit domain adoption retains the independent Core checkpoint', t => {
  const s = sandbox(t);
  s.cli('install', ['--from', s.pack('advised'), '--domain', 'SoftwareEngineering'], 0, 'advised');
  assert.match(s.cli('init', ['--philosophy', 'SoftwareEngineering', '--apply'], 1, 'advised').error, /Select/);
  const preview = s.cli('init', ['--philosophy', 'SoftwareEngineering', '--domain', 'SoftwareEngineering'], 0, 'advised');
  s.cli('init', ['--philosophy', 'SoftwareEngineering', '--domain', 'SoftwareEngineering', '--apply', '--plan-sha256', preview.planSha256], 0, 'advised');
  const text = fs.readFileSync(path.join(s.project, 'PHILOSOPHY.md'), 'utf8');
  assert.match(text, /core_version: 0\.1\.2/);
});

test('installed management commands operate without source repository access', t => {
  const s = sandbox(t); const installed = s.cli('install', ['--from', s.pack()]);
  s.cli('init', ['--philosophy', 'core', '--apply', '--plan-sha256', s.cli('init', ['--philosophy', 'core']).planSha256]);
  const payload = path.join(installed.directory, 'payload');
  const result = spawnSync(process.execPath, [path.join(payload, 'scripts/resolve.js'), '--cwd', s.project], { env: s.env, cwd: s.project, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr); assert.equal(JSON.parse(result.stdout).selectedPath, path.join(s.project, 'PHILOSOPHY.md'));
  const check = spawnSync(process.execPath, [path.join(payload, 'scripts/check.js'), path.join(s.project, 'PHILOSOPHY.md')], { env: s.env, cwd: s.project, encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr);
  const management = fs.readFileSync(path.join(s.project, '.agents/skills/organon-philosophy/SKILL.md'), 'utf8');
  assert.ok(!/node scripts\//.test(management)); assert.ok(management.includes(payload));
});

test('adoption apply binds the preceding preview across instruction and package changes', t => {
  const s = sandbox(t); s.cli('install', ['--from', s.pack()]);
  const first = s.cli('init', ['--philosophy', 'core']);
  assert.match(s.cli('init', ['--philosophy', 'core', '--apply'], 1).error, /plan/);
  write(path.join(s.project, 'AGENTS.md'), 'Changed after preview.\n');
  assert.match(s.cli('init', ['--philosophy', 'core', '--apply', '--plan-sha256', first.planSha256], 1).error, /plan/);
  const second = s.cli('init', ['--philosophy', 'core']);
  s.cli('update', ['--from', s.pack('agent-organon', nextVersion)]);
  assert.match(s.cli('init', ['--philosophy', 'core', '--apply', '--plan-sha256', second.planSha256], 1).error, /plan/);
  assert.ok(!fs.existsSync(path.join(s.project, 'PHILOSOPHY.md')));
  const final = s.cli('init', ['--philosophy', 'core']);
  s.cli('init', ['--philosophy', 'core', '--apply', '--plan-sha256', final.planSha256]);
});

test('an edit after journal creation is not overwritten by activation or recovery', t => {
  const s = sandbox(t); const store = path.join(s.project, '.organon'); fs.mkdirSync(store);
  const file = path.join(s.project, 'owned.txt'); write(file, 'Original.');
  const originalWrite = fs.writeFileSync;
  fs.writeFileSync = function (destination, ...args) {
    const result = originalWrite.call(fs, destination, ...args);
    if (destination === path.join(store, 'transaction.json')) originalWrite.call(fs, file, 'Concurrent user edit.');
    return result;
  };
  try { assert.throws(() => transact(store, s.project, [{ file, content: 'Candidate.' }]), /Recovery conflict/); }
  finally { fs.writeFileSync = originalWrite; }
  assert.equal(fs.readFileSync(file, 'utf8'), 'Concurrent user edit.');
  assert.ok(fs.existsSync(path.join(store, 'transaction.json')));
});

test('Claude and Gemini adoption uses native project instructions for project and global installations', t => {
  for (const [agent, name] of [['claude', 'CLAUDE.md'], ['gemini', 'GEMINI.md']]) {
    for (const scope of ['project', 'global']) {
      const s = sandbox(t);
      const run = (command, extra = [], expected = 0) => {
        const result = spawnSync(process.execPath, [s.runtime, command, '--product', 'agent-organon', '--agent', agent, '--scope', scope, '--project', s.project, ...extra], { env: s.env, cwd: s.project, encoding: 'utf8' });
        assert.equal(result.status, expected, result.stderr || result.stdout);
        return JSON.parse(expected ? result.stderr : result.stdout);
      };
      const native = path.join(s.project, name); const other = path.join(s.project, 'AGENTS.md');
      write(native, 'Existing native instructions.\n'); write(other, 'Other instructions.\n');
      run('install', ['--from', s.pack()]);
      const preview = run('init', ['--philosophy', 'core']);
      assert.equal(preview.instructions, native);
      assert.equal(fs.readFileSync(native, 'utf8'), 'Existing native instructions.\n');
      fs.appendFileSync(native, 'Changed since preview.\n');
      assert.match(run('init', ['--philosophy', 'core', '--apply', '--plan-sha256', preview.planSha256], 1).error, /plan/);
      const fresh = run('init', ['--philosophy', 'core']);
      run('init', ['--philosophy', 'core', '--apply', '--plan-sha256', fresh.planSha256]);
      const adopted = fs.readFileSync(native, 'utf8');
      assert.match(adopted, /^Existing native instructions\.\nChanged since preview\.\n/);
      assert.match(adopted, /\[PHILOSOPHY\.md\]\(PHILOSOPHY\.md\)/);
      assert.equal(fs.readFileSync(other, 'utf8'), 'Other instructions.\n');
      assert.ok(!fs.existsSync(path.join(s.home, name)));
      run('uninstall');
      assert.equal(fs.readFileSync(native, 'utf8'), adopted);
    }
  }
});
