# Lean delivery moved into Core

The maintained implementation, evidence and bilingual reader editions now live in [OrganonCore/lean](../OrganonCore/lean/README.md). Core can run independently. This directory retains the migration entry rather than a second current evidence package.

The outer [formalization skill](../skills/organon-leanify-prove/SKILL.md), [translation skill](../skills/organon-lean-natural-language/SKILL.md), checker CLI and programmatic exports remain compatible forwarding entrypoints. Workspace-baseline resolution stays in AgentOrganon; explicit selection and lookup failures are passed through rather than replaced with Core defaults.

From the outer repository root, for example:

```sh
rtk proxy node skills/organon-leanify-prove/scripts/check.js OrganonCore/lean/core-v0.1.3/philosophy --manuscript manuscript.json
rtk proxy node skills/organon-leanify-prove/scripts/check.js OrganonCore/lean/core-v0.1.3/rationale-core-tools --manuscript manuscript.json
```

Caller-owned run paths remain explicit; paths are not silently redirected. See [current migration validation](../OrganonCore/lean/VALIDATION.md) and [the preceding historical validation](../OrganonCore/lean/history/reader-validation-before-migration.md). Historical frozen inputs and judgments are preserved inside Core; a replayable old theorem is not current-source approval.
