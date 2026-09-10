---
name: organon-absorb
description: Examine reasons to revise the calling workspace's adopted philosophy and delegate reviewed, authorized adoption to Organon Core. General documentation maintenance is separate.
---

# Organon Absorb

1. Resolve the philosophy using [the resolution contract](../../OrganonCore/skills/references/philosophy-resolution.md). Run `node <AgentOrganon>/scripts/resolve.js --cwd <calling-directory>` with `--philosophy <path>` when explicitly supplied. Locate `<AgentOrganon>` from this skill's directory; preserve the caller's directory for resolution.
2. If resolution fails, stop. For missing default candidates, suggest `organon-philosophy init`; an invalid explicit path must be corrected, not replaced by a default or Core.
3. Read the selected `core_version` and compare it with `organon.coreVersion` in [package.json](../../package.json). Surface the resolver's source-version warning when outside the range. If metadata cannot be read, report the version as unknown and retain the selected text as the assessment baseline; managed writes still require valid supported metadata. These warnings are not philosophical validity judgments.
4. Delegate the request to [organon-core-absorb](../../OrganonCore/skills/organon-core-absorb/SKILL.md), passing the resolved philosophy path as both the fixed adopted baseline and the intended adoption target, with its real source directory. Keep a proposed replacement and Core method constraints distinct. Apply Core's required independent review and concrete user decision to that target; a read-only Core symlink requires the explicit Core workflow rather than a management write.
