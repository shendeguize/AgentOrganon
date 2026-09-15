# Workspace files and scripts reference

## Files and versions

An adopting workspace uses a regular `PHILOSOPHY.md` and adjacent `PHILOSOPHY.lock.json`, whose `document_filename` identifies the managed file in that directory. The [format contract](../OrganonCore/skills/references/structure.md) defines the four supported frontmatter fields and stable IDs for every heading with its direct body and for introductory text. It supports unindented ATX headings such as `## Title`; other ATX forms and Setext headings are rejected. The current three-chapter Core organization is an initialization template; adopters may reorganize it. Initialization adds an empty Extensions section, identified by stable ID `extensions` rather than its title or position.

- `format_version` identifies the supported file format. Unsupported formats stop managed writes.
- `philosophy_version` describes semantic revision, proposed by an agent and decided by the user: changed or withdrawn commitments, meanings, or applicability require major; additions preserving existing commitments require minor; meaning-preserving wording or structural maintenance requires patch.
- `core_version` records the last fully reviewed Core source version. A version outside `package.json`'s `organon.coreVersion` range produces a source-version warning, not a philosophical verdict.
- `derived_from` records export provenance. Neither provenance nor matching versions establishes a common ancestor.

The lock stores hashes and structure for reviewed source checkpoints, plus remembered declines. It contains no old source text. Local differences from a checkpoint are expected. A declined source unit is not proposed again until its incoming state changes; the actual difference remains visible. Imports with no verifiable source checkpoint use two-way differences and never advance Core's reviewed version.

This repository's root `PHILOSOPHY.md` is a relative symlink to `OrganonCore/PHILOSOPHY.md`, used only for reading; relative references resolve from the real source directory. There is no root derived lock. Management scripts reject writes through or over this symlink and writes to the Core source. Core changes use its explicit maintenance or absorption workflow.

## Local use

Use Node.js 22; there are no third-party runtime dependencies. Run these commands from this checkout, with the OrganonCore submodule present. Use absolute script paths when working from another directory. The target's parent directory must already exist. In a Git workspace, ignore `.local/` before initialization so recovery journals remain private; the scripts create the journal directory when needed.

```sh
node scripts/check.js --source OrganonCore/PHILOSOPHY.md
node scripts/check.js --source PHILOSOPHY.md
node scripts/init.js --target /path/to/workspace/PHILOSOPHY.md
node scripts/check.js /path/to/workspace/PHILOSOPHY.md
node scripts/export.js --source /path/to/workspace/PHILOSOPHY.md --out /path/to/export.md
node scripts/export.js --source /path/to/workspace/PHILOSOPHY.md --out /path/to/core-part.md --core-only
node --test tests/*.test.js
```

Initialization and export require absent output paths. `--core-only` removes the subtree identified by `extensions`; a missing marker stops export. The remaining text is still the adopter's text, not an official Core copy. Source identities are caller-supplied labels or stored document identities, not authenticated publisher identities. Managed operations, including reads for initialization, export, and classification, stop when an input has a pending transaction; use the reported recovery command before resuming.

Use `organon-philosophy merge --dry-run` to request a read-only difference report. The skill invokes `classify.js`; there is no installed `organon-philosophy` executable. The skill documents candidate preparation, decisions, recovery, and application commands. Keep reports, candidates, plans, and six-part merge records in ignored `.local/iterations/merges/`. A prepared plan binds the reviewed inputs and candidate; stale inputs stop application. Preparation and successful file checks do not supply adoption authorization.

[Maintenance and iteration protocol](../maintenance/self-iteration.md)
