import { argumentsFor, run } from './lib/cli.js';
import { prepare, applyPlan } from './lib/operations.js';
import { recover } from './lib/io.js';
run(() => {
  const args = argumentsFor(['prepare', 'report', 'candidate', 'decisions', 'record', 'plan', 'recover'], ['prepare']);
  if (args.positional.length || [args.prepare, args.plan, args.recover].filter(Boolean).length !== 1) throw new Error('Select exactly one of --prepare, --plan or --recover');
  if (args.prepare) return prepare(args);
  if (args.plan) return applyPlan(args.plan);
  return recover(args.recover);
});
