# Release maintenance

Product versions, philosophical versions and the philosophy format are separate. The initial product candidate is `1.0.0-rc.1`; Core philosophy is `0.1.4`, SoftwareEngineering is `0.2.1`, and its considered Core checkpoint stays `0.1.2`. A path-maintenance patch does not adopt a new philosophy.

## Source and review boundaries

`main` is the integration branch. Candidates and stable maintenance use `release/1.0.0`. Changes arrive by PR; the owner decides merges. Candidate fixes also return to `main` through PRs. The protected branch patterns include nested `dev` and `release` names. Required CI is named `Repository / verify`; establish its actual successful execution before enabling the rule. Version tags cannot be updated or deleted.

Use a clean public HTTPS checkout of the exact three source commits. Preserve existing work and indexes when preparing branches. Core supplies the shared site theme. Child `release/tooling.json` files pin public tooling commits; they do not follow moving branches. The outer repository pins Core and AdvisedOrganons through gitlinks. Publish referenced revisions before their dependents. A shared tooling snapshot can precede the final product commits, avoiding circular source references.

## Platform preparation

Configure GitHub Actions environments using `scripts/release/security.mjs plan|apply|check --repository shendeguize/AgentOrganon` and the corresponding child repository names. Review-required environments use owner `shendeguize`, allow that owner to approve their own dispatch, and prohibit administrator bypass. The documented REST update does not expose the bypass setting: disable it in the GitHub environment UI and rerun `check`. Branch rules use `scripts/release/governance.mjs plan|apply|check --repository ...`; `apply` requires `--validated-ref` with the successful required check.

Use GitHub Secrets, never repository files or review messages, for `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `CURSOR_API_KEY`, `COPILOT_GITHUB_TOKEN` and `GEMINI_API_KEY` in the coordinator's `agent-validation` environment. Configure `OPENCODE_MODEL` explicitly. Optional model variables are documented in [agent validation](../scripts/agents/README.md). CLI authentication, actual invocation and required independent delegation are observed on hosted runners; filesystem discovery checks alone do not establish support.

Initial npm publication needs a short-lived, package-scoped `NPM_BOOTSTRAP_TOKEN` in each repository. After each package exists, configure its trusted publisher for that exact repository and `publish.yml`. Use an environment binding that permits the intended RC and stable workflow environments. Validate a subsequent publication using OIDC, then revoke the bootstrap credential and remove its GitHub secret. npm trust configuration has separate account/2FA requirements; a bootstrap token is not automatically authorized to configure trust. See [npm prerequisites](https://docs.npmjs.com/cli/v11/commands/npm-trust/#prerequisites).

`NPM_CHANNEL_STRATEGY` must reflect an explicit owner decision. `direct` publishes Core, AdvisedOrganons, then AgentOrganon directly to `rc` or `latest`; the CLI package is last and unified site recommendation waits for all three. `deferred` publishes temporary tags and requires a separate authorized `NPM_TAG_TOKEN` for channel promotion. OIDC supports publication, not `npm dist-tag`. No strategy is implicitly selected.

## Candidate procedure

1. Merge reviewed sources into the candidate branch and run **Candidate validation** (`candidate.yml`) from its exact commit. It builds all three packages once, checks content, sites, governance and Lean readers, and runs native Linux/macOS/Windows installer lifecycles against the actual candidate packages. Keep `candidate-packages-{attempt}` and its canonical manifest digest.
2. Run **Actual agent validation** (`agent-e2e.yml`) against that candidate run and digest. Probe authentication first. Every candidate needs the complete smoke matrix and Linux full matrix. A completed execution awaiting independent review has process code 3; the workflow preserves it as a successful capture, never an approved release result. Failed calls or missing credentials remain failures.
3. Download and preserve the actual outputs. A distinct reviewer reads the frozen inputs and raw responses before comparison. Run `scripts/agents/review.mjs` with the exact original report, independent receipt and assessment. Disclose exposure and limitations. Do not replace actual delegation evidence with evaluator agreement.
4. Put only the new reviewer inputs, assessments, receipts and derived approved summaries under `reviewed/` on a separate evidence branch. Do not change the product source commits or copy altered execution originals into this branch. Dispatch **Seal independently reviewed candidate** with its exact review commit, candidate run, actual agent runs and prepared digest. It downloads trusted original bytes, binds their provenance, and revalidates the complete execution and review closure before creating `validated-release-{attempt}`.
5. Dispatch coordinator `publish.yml` with `bootstrap-bundle` using the successful seal run and sealed digest. This publishes the fully validated public bundle. Then publish each product from its own exact `release/1.0.0` source, choosing the previously approved npm strategy. Each worker retrieves the same bundle; existing identical versions are reused, while differing bytes stop publication.
6. Complete the channel step only after all npm tarballs, GitHub assets, tags and manifest bytes match. Run each site's **Verified release Pages** with that same version and digest; [Pages and stars](pages-and-stars.md) describes the independent data branch.

Partial publication is not an atomic failure rollback: retain successful immutable products and retry only missing items from the same sealed manifest. Any content revision requires the next RC number and all candidate gates again. Keep an audit bundle containing source commits, package hashes, matrix reports, independent reviews, install commands, actual release links and remaining limitations. Submit the RC for owner review.

## Stable publication

An RC is not the stable release. The owner first approves its exact manifest digest. Store `APPROVED_RC_MANIFEST_SHA256` in the protected `npm-stable` environment of all three repositories, and make that approved identity available for stable candidate preparation. Use the RC's exact version as the candidate workflow's `approved_rc_version`.

Prepare new product `1.0.0` commits. Change only product metadata, exact internal dependency versions and matching public installation/version text; update peer gitlinks to those exact stable commits. Philosophy, rationale, Lean and runtime logic stay byte-identical. The stable transition validator downloads the approved public RC and compares the entire three-repository Git trees, modes and changed blob bytes. Unexpected changes require a new reviewed RC.

Build and validate fresh stable packages through the same complete gates. `publish.yml` separately requires the protected environment's approval and checks the RC-to-stable transition before any stable mutation. Never convert an old RC into `1.0.0` by editing its prerelease label. Preserve the RC-to-stable manifest relationship.

## Rerunnable gates

Run `npm test`, `npm run check:content`, `npm run check:site`, `npm run test:install`, and the documented current Lean gates during development. Package checks consume real `.tgz` files via `npm run check:package -- --package FILE`. `npm run check:release -- --manifest FILE` verifies the full sealed closure; it cannot turn missing real-agent or platform evidence into success. Platform compatibility and publication remain incomplete until the corresponding hosted runs and public downloads actually pass.

Reruns preserve old artifacts and select fixed artifact IDs and service digests from one complete attempt. If rerunning only failed jobs leaves the current matrix incomplete, use `Rerun all jobs` or a new dispatch; earlier attempts are never silently borrowed.
