# Actual agent validation

This harness runs actual agent processes only on GitHub-hosted temporary runners from a manually dispatched, reviewed `main` or `release/1.0.0` source. It never copies local authentication. The `agent-validation` environment supplies one provider credential to its matching invocation step. Repository tokens are used only to verify/download the trusted candidate artifact; they are not agent credentials. Copilot needs a separate token with Copilot Requests permission.

## Run and preserve

Dispatch `.github/workflows/agent-e2e.yml` at the candidate outer commit. Supply the successful `.github/workflows/candidate.yml` run ID and canonical manifest digest. The downloaded `candidate-packages` artifact contains `release-manifest.json` and the three content archives. Its source commit, manifest digest and every archive digest must match before package code runs.

`--probe` checks process/authentication feasibility without installing products. `probe_completed` means the process returned output; it is not an independent authentication judgment or release evidence. Non-probe smoke invokes `organon-assess` on all three native platforms. Linux full invokes the five outer, four Core and one domain entry independently. Each method receives new HOME/config/cache/workspace directories, actual package installations and explicitly previewed/approved project philosophy setup.

```sh
node scripts/agents/run.mjs --agent codex --matrix smoke --package-dir candidate --manifest candidate/release-manifest.json --out candidate/evidence/codex-linux-smoke
```

Exit 3 means `needs_independent_review`, not a pass. Failure, timeout, missing credentials, missing model evidence or uncompleted delegation cannot authorize publication. Fixture tests run locally with Node subprocesses; they do not call providers or count as actual validation.

## Independent comparison

The raw response index, per-case raw captures, task text, selected philosophy and available native reviewer artifacts are preserved before comparison. Only literal supplied credential values and their JSON/URL/base64 forms are redacted. Raw output is not rewritten into an expected answer. Discovery, installed resource access, actual method use and independent-first behavior require a separate reviewer; a tool event claiming success is insufficient.

Give a distinct non-author reviewer the frozen report, inputs, raw artifacts and the selected skills. Save the review request and substantive assessment as separate artifacts beside the release manifest. The request must include the report, input and raw-index hashes. A receipt uses schema 1 and binds `report_sha256`, `source_digest`, `artifact_digest`, `inputs_sha256`, `raw_sha256`, `reviewer`, `reviewer_input`, `assessment`, `raw_preserved_before_comparison`, `exposure`, `limits`, `observed_model` and every case.

Each case identifies its exact ID, accepted bounded findings and limits, discovered path, and raw citations for discovery, invocation, payload access and subject session. A citation is `{ "artifact": { "file": "relative/path", "sha256": "actual digest" }, "quote": "exact observed text" }`. Every citation must resolve to captured raw evidence. Actual model identity must have such a citation; a requested model/default is not an observation. The external reviewer session must differ from the observed subject session.

Delegation is `completed` with a distinct reviewer/session and citations for its initial input, initial response and later comparison, plus `initial_before_candidate: true`; or it is `not_required` with grounds from the applicable method. Absorption never uses the latter escape. Unavailable native delegation remains incomplete. Receipt checking verifies bindings and required evidence structure; the attributed reviewer retains responsibility for the judgment and its limits.

```sh
node scripts/agents/review.mjs --manifest candidate/release-manifest.json --report candidate/evidence/codex-linux-smoke/report.json --receipt candidate/reviews/codex-linux-smoke.json --out candidate/evidence/codex-linux-smoke-reviewed.json
```

The accepted evidence file and preserved receipt are new objects; the original pending report stays unchanged. Add the new evidence reference to the release manifest before sealing it. All artifact paths are relative to the manifest directory. A changed package set invalidates the review even when source commits are unchanged.

## Pinned adapter sources

`release/agents.json` fixes the npm CLI versions and Cursor installer hashes. Setup records actual launcher bytes and `--version`; a changed installer fails closed. Updating a tool requires review of its current official parameters and real new probes. Defaults are left to the installed CLI unless the corresponding model variable is explicitly configured. OpenCode requires `OPENCODE_MODEL` in provider/model form.

Primary references: [Codex](https://learn.chatgpt.com/docs/non-interactive-mode), [Claude](https://code.claude.com/docs/en/headless), [Cursor](https://cursor.com/docs/cli/reference/parameters) and [native installation](https://cursor.com/docs/cli/installation), [Copilot](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-programmatic-reference), [Gemini](https://geminicli.com/docs/cli/headless/), [OpenCode](https://opencode.ai/docs/cli/). Documentation establishes supported interfaces; it does not establish that this candidate has passed them.
