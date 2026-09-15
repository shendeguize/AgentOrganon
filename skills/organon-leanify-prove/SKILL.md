---
name: organon-leanify-prove
description: Forward philosophical Lean formalization to Core while retaining the caller-selected baseline.
---

# organon-leanify-prove

Use [organon-core-leanify-prove](../../OrganonCore/skills/organon-core-leanify-prove/SKILL.md) as the sole maintained method. Preserve the supplied source, output directory, language and explanation options, and existing authorization. This entrypoint does not maintain a separate formalization or translation method.

When a philosophical baseline is needed, resolve the caller workspace with `node <AgentOrganon>/scripts/resolve.js --cwd <caller> [--philosophy <path>]`, then pass the selected path and its real source directory to Core. Explicit or workspace lookup failure stops the dependent operation; do not invoke the Core default as fallback. Plain input text does not automatically become the adopted baseline.

The existing `node <AgentOrganon>/skills/organon-leanify-prove/scripts/check.js <run-dir> [--manuscript <manifest>]` command forwards to Core and preserves its CLI and programmatic interface. Run paths belong to the caller; current bundled runs are listed in [Core Lean delivery](../../OrganonCore/lean/README.md).
