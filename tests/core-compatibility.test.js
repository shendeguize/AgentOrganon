import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as outerSections from '../scripts/lib/sections.js';
import * as coreSections from '../OrganonCore/scripts/lib/sections.js';
import * as outerFrontmatter from '../scripts/lib/frontmatter.js';
import * as coreFrontmatter from '../OrganonCore/scripts/lib/frontmatter.js';
import * as outerCheck from '../skills/organon-leanify-prove/scripts/check.js';
import * as coreCheck from '../OrganonCore/skills/organon-core-leanify-prove/scripts/check.js';
import * as outerManuscript from '../skills/organon-leanify-prove/scripts/manuscript.js';
import * as coreManuscript from '../OrganonCore/skills/organon-core-leanify-prove/scripts/manuscript.js';

const root = fileURLToPath(new URL('../', import.meta.url));

test('old Lean and parser import paths expose the Core implementations', () => {
  for (const [outer, core] of [[outerSections, coreSections], [outerFrontmatter, coreFrontmatter], [outerCheck, coreCheck], [outerManuscript, coreManuscript]]) {
    for (const key of Object.keys(core)) assert.equal(outer[key], core[key], key);
  }
});

test('old Lean CLI keeps its usage, exit status and argument dispatch', t => {
  const run = fs.mkdtempSync(path.join(os.tmpdir(), 'organon-cli-adapter-'));
  t.after(() => fs.rmSync(run, { recursive: true, force: true }));
  const oldCli = path.join(root, 'skills/organon-leanify-prove/scripts/check.js');
  const newCli = path.join(root, 'OrganonCore/skills/organon-core-leanify-prove/scripts/check.js');
  const usage = 'Usage: node skills/organon-leanify-prove/scripts/check.js <run-dir> [--manuscript <run-relative-manifest>]\n';
  for (const args of [[], [run, '--bad'], [run, '--bad', 'manifest.json']]) {
    const result = spawnSync(process.execPath, [oldCli, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, usage);
  }
  for (const args of [[run], [run, '--manuscript', 'manuscript.json']]) {
    const results = [oldCli, newCli].map(cli => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' }));
    for (const result of results) { assert.equal(result.status, 1); assert.equal(result.stderr, ''); }
    const normalized = results.map(result => {
      const value = JSON.parse(result.stdout);
      delete value.evidence;
      return value;
    });
    assert.deepEqual(normalized[0], normalized[1]);
  }
});

test('version warnings retain the outer package configuration as their default', t => {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'organon-warning-adapter-'));
  t.after(() => fs.rmSync(copy, { recursive: true, force: true }));
  for (const name of ['scripts/lib/frontmatter.js', 'OrganonCore/scripts/lib/frontmatter.js', 'OrganonCore/package.json']) {
    const destination = path.join(copy, name);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(root, name), destination);
  }
  fs.writeFileSync(path.join(copy, 'package.json'), JSON.stringify({ type: 'module', organon: { coreVersion: '>=3.4.0 <4.0.0' } }));
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { coreWarnings } from './scripts/lib/frontmatter.js';
    assert.deepEqual(coreWarnings('3.4.2'), []);
    assert.equal(coreWarnings('0.1.3').length, 1);
    assert.deepEqual(coreWarnings('0.1.3', '>=0.1.0 <0.2.0'), []);
  `], { cwd: copy, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
