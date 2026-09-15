---
name: organon-philosophy
description: Manage a workspace philosophy with init, check, export, import, and merge. Scripts handle deterministic files and differences; agents and users assess meaning and decide adoption.
---

# Organon Philosophy

Read the [format contract](../../OrganonCore/skills/references/structure.md) and the [shared iteration rules](../../OrganonCore/skills/references/iteration.md). Resolve existing philosophies under the [resolution contract](../../OrganonCore/skills/references/philosophy-resolution.md). Locate scripts relative to this skill's AgentOrganon checkout and execute them with absolute paths when outside it. The commands below assume that checkout is the current directory; `<...>` denotes a supplied path or value, not literal syntax. These are skill operations, not an installed CLI.

Keep the adopted philosophy, the proposed whole, and Core method constraints distinct. Adopters may reorganize, revise, or withdraw commitments. Mechanical validity, matching hashes, version compatibility, and agent agreement do not establish philosophical correctness or a reason to adopt. Scripts neither choose philosophical outcomes nor authorize them.

## Init and check

For `init`, take the target path and optionally a source file and source identity. The default source is bundled Core, identified as `https://github.com/shendeguize/OrganonCore`. For a custom source, explicitly pass its identity with `--source-id`; the script does not authenticate the publisher. A request to initialize the specified absent target authorizes creation of its philosophy and adjacent lock; reuse that authorization. Initialization copies the source and adds an empty section with stable ID `extensions` if it is missing. Existing targets or locks are not overwritten. The target's parent directory must already exist. In a Git workspace, ensure `.local/` is ignored before initialization; the script creates its private recovery-journal directory as needed.

```sh
node scripts/init.js --target <file> [--source <source-file>] [--source-id <id>]
node scripts/check.js <file>
node scripts/check.js --source <file>
```

`check` is read-only. Default mode checks a managed workspace and its lock, including whether `document_filename` matches the target; `--source` checks a document without requiring a lock. Report format, identity, and state findings with their limits. An out-of-range `core_version` is a source-version warning. Unsupported `format_version` stops managed writes. Root `PHILOSOPHY.md` in AgentOrganon is a read-only Core symlink with no derived lock; use source checking there and regular copies for the management workflow. Managed operations, including reads for init, export, and classification, stop when an input has a pending transaction. Follow the reported recovery command before continuing.

## Export

Take the source, absent output path, and optional `--core-only` and source identity. The user's export request authorizes the stated local output, not remote publication. Check the source before writing.

```sh
node scripts/export.js --source <file> --out <file> [--core-only] [--source-id <id>]
```

Export includes all content by default. `--core-only` removes the subtree identified by stable ID `extensions`, even when renamed or moved; if missing, stop and ask the user to define the intended scope. The result remains the adopter's text, not official Core text. `derived_from` identifies the full input's source, philosophy version, and SHA-256 before filtering; it is provenance, not proof of ancestry. The managed document's lock identity supplies the default source ID; provide one explicitly when needed. Export writes a new file and does not modify the source or lock.

## Import and merge: compare first

Take the local philosophy, incoming source, stable source identity, and operation kind. Use `core` only for the source designated by the lock's `core_source_id`; unrelated imports use `import`. Establish the intended source with the caller and use its existing checkpoint identity consistently. The script checks identity/kind correspondence but does not authenticate the incoming file's publisher. Matching versions or an unverified `derived_from` claim do not establish common history.

```sh
node scripts/classify.js --ours <file> --theirs <file> --source-id <id> --kind core|import [--base-file <file>]
```

For `merge --dry-run`, return this read-only JSON difference report and its limitations without adopting changes. Import uses the same comparison and proposal workflow for every adopted change, including when the resulting candidate replaces the whole document. Without a verifiable checkpoint for this source, report two-way differences and the missing baseline. `--base-file` may supply old text for a known checkpoint only when its hashes verify; never invent historical text from hashes or provenance. Preserve genuine structural changes without inventing an earlier movement when evidence is missing.

For a verified checkpoint, `B` is the reviewed source, `O` the current local unit, and `T` the incoming unit. Known absence differs from an unknown baseline. Classification is ordered: `O = T = B` is `unchanged`; `O = T != B` is `converged`; `O = B != T` is `theirs-changed`; `T = B != O` is `ours-changed`; all remaining cases are `conflict`. Addition, deletion, and modification are separate attributes. Structural differences are reported separately from body hashes.

A remembered decline binds the source, stable unit ID, and incoming hash or deletion marker. Unchanged incoming state stays suppressed even if local content changes; changed incoming state is proposed again. Suppression does not conceal the actual difference. The lock keeps source hashes and structure rather than old source text or the locally merged result.

## Form a candidate and decide

Save the report and working artifacts in the target workspace's ignored `.local/iterations/merges/`. Check that this directory is ignored before writing. Use a record named `YYYY-MM-DD-<source>.md`, with a disambiguating suffix when a record already exists. Do not overwrite earlier evidence.

For each proposed change, present retaining ours, taking theirs, manual editing, and an agent draft as meaningful candidate options. Choosing `ours` for an incoming difference retains the local unit and remembers rejection of that incoming state; `decline` explicitly requests the same behavior. Explain that consequence when obtaining the choice. These choices form candidate text; they do not by themselves justify its adoption. Review the entire proposed philosophy, including interactions between individually conflict-free units and structural reorganization. Do not let scripts guess where reorganized material belongs.

Delegate substantive adoption to [organon-core-absorb](../../OrganonCore/skills/organon-core-absorb/SKILL.md), passing the local philosophy as the fixed baseline and exact adoption target, and the complete candidate separately. Use assess to identify current compatibility and support limits; examine reasons to change or withdraw commitments independently of that result. Follow absorb's independent-first review, applicable principled review, wording, and translation checks. Without required independent review, retain a proposal. Reuse valid prior review and explicit authorization for the same concrete change; do not request it again. A new or materially changed philosophical decision remains with the user.

Propose `philosophy_version` from semantic impact and record the user's decision: major changes or withdraws commitments, meanings, or applicability; minor adds content while preserving existing commitments; patch preserves meaning in wording or structural maintenance. Retain the version for a no-change outcome where appropriate. Scripts validate the supplied version, not its semantic justification.

Prepare a complete final candidate and a decisions JSON object:

```json
{
  "sections": { "local.unit": "theirs", "local.another": "decline" },
  "structure": "manual",
  "philosophy_version": "0.1.1"
}
```

Section choices are `theirs`, `ours`, `decline`, `manual`, or `agent`. Every unsuppressed incoming change that differs from the local unit requires an explicit choice; local-only changes and converged units default to `ours`, and unchanged remembered declines default to `decline`. Candidate-only IDs require `manual` or `agent`. `theirs`, `ours`, and `decline` must match the respective source or local body, including absence; `manual` and `agent` designate candidate text. Always specify structure as `ours`, `theirs`, `manual`, or `agent`; the first two must match that document's structure.

Candidate metadata retains local `format_version` and `derived_from`. Its `philosophy_version` matches the confirmed decision. For a completed Core review, candidate `core_version` matches the incoming Core version; an external import retains the local `core_version`. Finish decisions for all proposals, including explicit refusals, before advancing the reviewed source checkpoint. Completion records what was reviewed, not adoption of every upstream change.

## Apply and record

Keep a six-part record under the shared iteration rules:

1. **Object and baseline:** local and source identities, versions, input snapshots or hashes, and known or missing common baseline.
2. **Problem and objective:** intended decision, scope, constraints, and a useful outcome, including no adoption.
3. **Grounds and additional premises:** applicable commitments, evidence, reasons for revision, and limits.
4. **Candidates and trade-offs:** retained or withdrawn commitments, complete candidate, unit and structural choices, declines, and version proposal.
5. **Assessment and counterexamples:** actual tests, independent initial response and subsequent comparison, whole-document review, wording, and any translation checks.
6. **Decision and remaining questions:** specific authorization, confirmed version, actual changes or proposal status, and unresolved limits.

After review and the required user decision, prepare an application plan from the report, candidate, decisions, and record:

```sh
node scripts/apply.js --prepare --report <report.json> --candidate <candidate.md> --decisions <decisions.json> --record <record.md>
node scripts/apply.js --plan <plan.json>
```

Preparation outputs plan JSON to stdout; save it under the same ignored merge directory before application. It rechecks the report's inputs, recomputes classification, checks mechanical consistency, and binds hashes of local, source, lock, candidate, decisions, and record inputs. A record's existence or prepared plan does not prove review or authorization. Apply only the concrete reviewed and authorized plan. Changed inputs require a fresh report and reassessment of the affected decisions rather than editing plan hashes to bypass the check.

Application updates the local document and source checkpoint together, retaining declined states and other source checkpoints. It refuses protected Core targets and symlink writes, including aliases to the Core source. The write protocol retains recoverable state; after an interrupted transaction use `node scripts/apply.js --recover <file>` for the affected philosophy file and inspect the reported outcome before resuming. Do not manually discard recovery evidence. Verify the resulting document with `check` and compare it with the authorized candidate; then append the actual result to the record. Stop under the shared rules when the decision and relevant checks are complete. No operation in this skill authorizes upstream contribution or remote publication.
