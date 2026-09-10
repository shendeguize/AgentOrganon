---
name: organon-principled-review
description: Review claims, designs, methods, or systems under stated goals and the calling workspace's selected philosophy, using Organon Core's full-analysis triggers and six-dimension method.
---

# Organon Principled Review

1. Resolve the philosophy using [the resolution contract](../../OrganonCore/skills/references/philosophy-resolution.md). Run `node <AgentOrganon>/scripts/resolve.js --cwd <calling-directory>` with `--philosophy <path>` when explicitly supplied. Locate `<AgentOrganon>` from this skill's directory; preserve the caller's directory for resolution.
2. If resolution fails, stop. For missing default candidates, suggest `organon-philosophy init`; an invalid explicit path must be corrected, not replaced by a default or Core.
3. Read the selected `core_version` and compare it with `organon.coreVersion` in [package.json](../../package.json). Surface the resolver's source-version warning when outside the range. If metadata cannot be read, report the version as unknown and retain the selected text as the assessment baseline; managed writes still require valid supported metadata. These warnings are not philosophical validity judgments.
4. Delegate the request to [organon-core-principled-review](../../OrganonCore/skills/organon-core-principled-review/SKILL.md), passing the resolved philosophy path and its real source directory explicitly. Preserve the selected baseline and distinguish the object's commitments, any candidate replacement, selected review standards, and Core method constraints. Return findings under the delegated skill's scope.
