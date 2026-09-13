#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCli } from '../../../OrganonCore/skills/organon-core-leanify-prove/scripts/check.js';

export * from '../../../OrganonCore/skills/organon-core-leanify-prove/scripts/check.js';

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli('Usage: node skills/organon-leanify-prove/scripts/check.js <run-dir> [--manuscript <run-relative-manifest>]');
}
