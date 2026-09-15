import fs from 'node:fs';
import { SEMVER } from '../../OrganonCore/scripts/lib/frontmatter.js';

export * from '../../OrganonCore/scripts/lib/frontmatter.js';

export function coreWarnings(version, range = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).organon.coreVersion) {
  const bounds = /^>=(\d+\.\d+\.\d+) <(\d+\.\d+\.\d+)$/.exec(range);
  if (!bounds || !SEMVER.test(bounds[1]) || !SEMVER.test(bounds[2])) throw new Error('Unsupported organon.coreVersion range; use >=X.Y.Z <X.Y.Z');
  const compare = (a, b) => {
    const x = a.split('.').map(BigInt), y = b.split('.').map(BigInt);
    for (let index = 0; index < 3; index++) if (x[index] !== y[index]) return x[index] < y[index] ? -1 : 1;
    return 0;
  };
  if (!SEMVER.test(version) || compare(bounds[1], bounds[2]) >= 0) throw new Error('Invalid Core version or range');
  return compare(version, bounds[1]) >= 0 && compare(version, bounds[2]) < 0
    ? [] : [`Reviewed Core version ${version} is outside ${range}; this is a source-version warning, not a philosophical judgment.`];
}
