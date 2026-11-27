# SDLC Workflow Test Plan

Verify Northstar Hotel's single-owner SDLC pipeline—combining GitHub Agentic Workflows (`gh-aw`) for reasoning-heavy stages (`01`, `02`, `AW 04`–`AW 07`) with deterministic GitHub Actions workflows for mechanical gates and builds (`00`, `03`, `Build and test`, `04`, `05`, `06`, Project v2 sync).

## Mandatory vs. optional scope

- **Core SDLC pipeline:** Stages 1, 3, and 4 (triage `01`, daily routing `02`, Copilot delegation `03`, CI, review `04`, QA promotion `05`, simulated release `06`).
- **Pre-merge trials & optional audits:** Stage 2 (`gh aw trial`), advisory workflows (`AW 04`–`AW 07`), and Stage 5 (fork compatibility trial).

---

## Stage 1: Local validation (mandatory, zero GitHub side effects)

**Outcome:** Confirm unit tests, API integration tests, web lint/build, and `gh-aw` lock-file compilation all succeed locally before pushing.

### Actions

From the repository root:

```powershell
node --test .github\scripts\issue-automation.test.js
dotnet test HotelBooking.slnx
dotnet build HotelBooking.slnx --configuration Release
cd src\hotel-booking-web
npm ci
npm run lint
npm run build
cd ..\..
```

Optional (`gh-aw` CLI installed):

```powershell
gh aw compile --validate --show-all
```

### Expected evidence

- All Node tests in `.github/scripts/issue-automation.test.js` pass.
- All .NET API tests pass and Release build succeeds.
- `npm run lint` reports zero errors and `npm run build` outputs assets under `src/hotel-booking-web/dist`.
- `gh aw compile --validate --show-all` succeeds with zero errors across all `.github/workflows/*.md` files.

### Recovery

- If `gh aw compile` reports errors, fix the YAML frontmatter in the named `.github/workflows/*.md` file and re-run `gh aw compile --validate --show-all`.
- If `npm ci` or `dotnet test` fails, confirm Node.js 20.19+ (or 22.12+), .NET 10 SDK, and .NET 8 SDK/runtime are installed.

---

## Stage 2: Pre-merge trial for agentic workflows (optional)

**Outcome:** Preview `gh-aw` safe-output behavior in an isolated temporary repository before merging new workflows to `main`.

GitHub Actions only registers new `workflow_dispatch`, `issues`, and `workflow_run` triggers once they exist on the default branch (`main`). Use `gh aw trial` to test changes before merging without mutating real issues or pull requests.

### Actions

Replace `<owner>/<repo>` with your repository slug and `<ISSUE_NUMBER>` with an existing issue number (`gh aw trial` synthesizes a required `issue_number` input for `issues`-triggered workflows, populated via `--trigger-context`):

```powershell
# Preview without creating any repository
gh aw trial .github/workflows/qa-advisory.md --dry-run

# Run isolated trials that capture safe-outputs without mutating the target repository
gh aw trial .github/workflows/issue-triage-agentic.md --logical-repo <owner>/<repo> --trigger-context https://github.com/<owner>/<repo>/issues/<ISSUE_NUMBER> --delete-host-repo-after
gh aw trial .github/workflows/qa-advisory.md --logical-repo <owner>/<repo> --delete-host-repo-after
gh aw trial .github/workflows/daily-router-agentic.md --logical-repo <owner>/<repo> --delete-host-repo-after
```

### Expected evidence

- Local trial output is saved under `trials/` showing what context the agent read and which `safe-outputs` were proposed.
- No labels, comments, or pull requests are modified in `<owner>/<repo>`.

### Recovery

- If a trial repository already exists, add `--delete-host-repo-before` or delete the temporary trial repo in GitHub Settings before retrying.
- Remove the local `trials/` folder after inspection so trial artifacts are not committed.

---

## Stage 3: GitHub prerequisites (before live testing)

**Outcome:** Register workflows on `main`, configure required secrets/variables, and ensure all workshop labels exist.

### Actions

1. Merge the workflow branch into `main`.
2. In GitHub, open **Settings → Secrets and variables → Actions** and configure:

| Name | Type | Used by | Purpose |
|---|---|---|---|
| `COPILOT_AGENT_TOKEN` | Secret | `03 - Delegate approved issue to Copilot` | Assigns `copilot-swe-agent[bot]` |
| `COPILOT_GITHUB_TOKEN` | Secret *(fallback)* | `01`, `02`, `AW 04`–`AW 07` (`*.lock.yml`) | Only needed if centralized Copilot billing for `permissions.copilot-requests: write` is unavailable |
| `PROJECT_TOKEN` | Secret | `Sync issue to GitHub Project` and post-step syncs *(optional)* | Updates GitHub Projects v2 status |
| `PROJECT_OWNER`, `PROJECT_OWNER_TYPE`, `PROJECT_NUMBER` | Variables | Project sync *(optional)* | Identifies the target Project v2 board |
| `HUMAN_MAINTAINER` | Variable | `02 - Route top ready issues` *(optional)* | GitHub username assigned to local/human lanes |

3. Open **Actions → `00 - Set up repository labels` → Run workflow** to create or update all labels from `.github/labels.json`.

### Expected evidence

- `00 - Set up repository labels` succeeds and all labels from `.github/labels.json` appear under **Issues → Labels**.

### Recovery

- If `00 - Set up repository labels` fails with permissions errors, confirm **Settings → Actions → General → Workflow permissions** allows `GITHUB_TOKEN` to run with repository permissions declared in workflow YAML.

---

## Stage 4: Live end-to-end SDLC test plan

**Outcome:** Prove every agentic reasoning stage, human gate, stale-approval reset, and SHA-bound QA/release check works on GitHub without duplicated workflows.

Create one disposable test issue (for example, a small UI copy note with 2 clear acceptance criteria) and run through sections A–D in order.

### Manual handoffs between stages (at a glance)

Automation never crosses a human gate on its own, while draft readiness (`04`), QA/docs advisory checks (`AW 05`, `AW 06`), and post-merge release readiness (`AW 07`) run automatically once their preconditions pass. To move one issue all the way from intake to `released`, you perform these exact manual actions in order:

1. **Create the issue** (starts `01 - Semantic issue triage` automatically).
2. **Add `ready-for-building`** on the issue once triage finishes (unlocks `02 - Route top ready issues` and `03 - Delegate approved issue to Copilot`).
3. **Manually dispatch `02 - Route top ready issues`** (unless waiting for the daily schedule).
4. **Add `develop-with-ai`** on the issue to start Copilot implementation (`03 - Delegate approved issue to Copilot` → Copilot opens a draft PR, runs validation, removes `[WIP]`, and finishes → `04` automatically marks the PR ready for review once `validate` passes and requests Copilot code review → `05` promotes to `ready-for-qa` once review is clean → **`AW 05` and `AW 06` run automatically**).
5. **Resolve any Copilot review threads** if Copilot left review findings (and manually dispatch `05 - Promote reviewed work to QA` with `pr_number` if resolving threads didn't trigger a new CI/review run).
6. **Review QA & Docs comments and merge the PR into `main`** (`Build and test` runs on `main` → **`AW 07` runs automatically** and posts the Go/No-Go checklist on the issue).
7. **Add `release-to-production`** on the `ready-for-qa` issue (triggers `06 - Simulate production release` → applies `released` and uploads the artifact).

---

### A. Semantic triage, manual re-triage, and stale-approval revocation

| Step | Action / trigger | Expected evidence | Manual action required to proceed |
|---|---|---|---|
| A1 | **Manual:** Open a new issue using the **Product requirement** template (`status:new` is added automatically). | `01 - Semantic issue triage` (`issue-triage-agentic.lock.yml`) runs automatically, applies `area:*`, `kind:*`, `priority:*`, `complexity:*`, and `status:triaged`, removes `status:new`, posts one replaceable codebase-grounded triage comment, and runs `sync-project` if configured. No human gate labels are touched. | Wait for `01 - Semantic issue triage` to finish (`status:triaged` present). To test manual re-triage, go to **A2**; otherwise skip directly to **A3**. |
| A2 *(optional)* | **Manual:** Run **Actions → `01 - Semantic issue triage` → Run workflow** with `issue_number: <ISSUE>` (or `gh aw run issue-triage-agentic --raw-field issue_number=<ISSUE>`). | Re-runs triage and updates the existing triage comment in place. | Wait for the run to complete, then continue to **A3**. |
| A3 | **Manual:** On the issue, add the `ready-for-building` label, wait ~5 seconds, then edit the issue body (add a clarifying sentence) and click **Save**. | `01 - Semantic issue triage` runs on `issues: [edited]`; its deterministic `reset-stale-approval` job removes `ready-for-building`, posts an **Approval reset** comment with the new revision hash, and syncs Project status. | **Wait for `reset-stale-approval` to finish, then manually re-add the `ready-for-building` label on the issue.** Section B cannot route or delegate the issue without `ready-for-building`. |

**Recovery:** If `01 - Semantic issue triage` skips on issue open, check the `pre_activation` job log to confirm the actor has repository write/maintain/admin membership.

---

### B. Conflict-aware routing and Copilot delegation gate

| Step | Action / trigger | Expected evidence | Manual action required to proceed |
|---|---|---|---|
| B1 | **Manual:** Run **Actions → `02 - Route top ready issues` → Run workflow** with `apply_labels: true` (or `gh aw run daily-router-agentic --raw-field apply_labels=true`). | `pre_activation` (`skip-if-no-match`) finds the eligible `status:triaged` + `ready-for-building` issue, applies one `agent:*` lane label, posts a routing comment with conflict checks against open PRs, and never touches human gate labels. | Inspect the routing comment and `agent:*` label. (Routing does **not** start Copilot automatically.) Continue to **B2** to verify gate rejection, or **B3** to delegate. |
| B2 *(gate test)* | **Manual:** Pick or open a second issue that does **not** have `ready-for-building`, and add `develop-with-ai`. | `03 - Delegate approved issue to Copilot` runs automatically, removes `develop-with-ai`, and comments that `ready-for-building` is required first. | Confirm `develop-with-ai` was removed, then return to your approved test issue for **B3**. |
| B3 | **Manual:** On the approved test issue (which has `ready-for-building`), add the `develop-with-ai` label. | `03 - Delegate approved issue to Copilot` re-reads live labels, assigns `copilot-swe-agent[bot]` with the matched custom agent, and posts confirmation. | Wait for Copilot to accept the issue and open a pull request (visible in the issue timeline). While Copilot is working, optionally run **B4**; otherwise proceed to **Section C** once the PR exists. |
| B4 *(optional)* | **Manual:** Run `02 - Route top ready issues` again (via Actions UI or `gh aw run daily-router-agentic --raw-field apply_labels=true`) while no other unstarted `ready-for-building` issues exist. | `skip-if-no-match` skips the agent job cleanly (zero LLM run) because the active `develop-with-ai` issue is excluded from the query. | Proceed to **Section C** once the PR for your test issue is open. |

**Recovery:** If delegation comments that `COPILOT_AGENT_TOKEN` is missing, add the secret in Repository Settings, remove and re-add `develop-with-ai`, and re-check the run log.

---

### C. CI failure investigation, QA promotion, and stale QA revocation

| Step | Action / trigger | Expected evidence | Manual action required to proceed |
|---|---|---|---|
| C1 *(optional)* | **Manual:** On a PR targeting `main` (on a `copilot/**` branch for automatic trigger, or on any PR followed by `gh aw run ci-failure-investigator --raw-field pr_number=<PR>`), push a commit with a temporary lint or test error so `Build and test` fails. | `AW 04 - CI failure investigator` posts one replaceable comment identifying the failing step, file, and suggested fix without modifying code or labels. | **Manual:** Push a fix commit reverting the temporary error so `Build and test` can pass in **C2**. |
| C2 | **Automatic (for Copilot PRs) or Manual (for human PRs):** Once Copilot removes `[WIP]`, emits `copilot_work_finished`, and `Build and test` (`validate`) passes on the PR head SHA, `04 - Start automatic Copilot code review` (`ready-copilot-draft`) marks the draft PR ready for review and requests `copilot-pull-request-reviewer[bot]`. For human PRs, verify `Closes #<ISSUE>` is in the PR body and click **Ready for review**. | PR transitions from draft to ready for review, `Build and test` (`validate`) is green, and `copilot-pull-request-reviewer[bot]` is requested. | Wait for Copilot's code review to finish before moving to **C3** / **C4**. (If GitHub prompts **Approve and run** on the PR's workflow run, click it so `Build and test` can complete.) |
| C3 *(if review has findings)* | **Automatic:** `05 - Promote reviewed work to QA` runs when Copilot submits its review. | If Copilot left unresolved review threads (or `validate` is not yet green on the current head SHA), promotion is **blocked** and a status comment explains the exact blocker. | **Manual:** Address any real review feedback (pushing commits if needed) and click **Resolve conversation** on every Copilot review thread so zero unresolved Copilot threads remain. |
| C4 | **Automatic or Manual:** If you pushed new commits, `Build and test` + fresh Copilot review re-trigger `05 - Promote reviewed work to QA`. If you only clicked **Resolve conversation** (no new commit/review event), **manually run Actions → `05 - Promote reviewed work to QA` → Run workflow** with `pr_number: <PR>`. | `05 - Promote reviewed work to QA` verifies the current PR head SHA has both passing `validate` and clean Copilot review, swaps `develop-with-ai` → `ready-for-qa` on local linked issues only, and posts a comment citing the exact commit SHA. | Confirm `ready-for-qa` is now on the issue; **`AW 05` and `AW 06` trigger automatically** (see **C6** and **D1**). Proceed to **C5** to test stale-QA revocation, or wait for **C6** / **D1** and move to **Section D**. |
| C5 *(stale-QA test)* | **Manual:** Push one trivial commit to the same-repo PR branch *after* `ready-for-qa` was applied. | `invalidate-stale-qa` in `05 - Promote reviewed work to QA` automatically removes `ready-for-qa` and posts a comment referencing the new commit SHA. | Wait for `Build and test` to pass on the new head SHA, **manually re-request Copilot review** on the PR (or push/reconcile once Copilot reviews the new head SHA), and **re-run `05 - Promote reviewed work to QA`** (`pr_number: <PR>`) if needed until `ready-for-qa` is restored. |
| C6 | **Automatic (after `05 - Promote reviewed work to QA`) or Manual:** `AW 05 - Advisory QA and acceptance verification` runs automatically when `05` succeeds while an open `ready-for-qa` issue exists (or run manually via `gh aw run qa-advisory --raw-field pr_number=<PR>`). | Posts one replaceable acceptance-criteria and booking-invariant audit stamped with the exact PR head SHA and issue `updated_at`, with zero label mutations. | Review the advisory QA report and proceed to **Section D**. |

**Recovery:** If `05 - Promote reviewed work to QA` reports no linked local issue, edit the PR description to add `Closes #<ISSUE>` and manually dispatch `05 - Promote reviewed work to QA` with `pr_number`.

---

### D. Docs drift, pre-release audit, and immutable release simulation

| Step | Action / trigger | Expected evidence | Manual action required to proceed |
|---|---|---|---|
| D1 | **Automatic (comment-only after `05 - Promote reviewed work to QA`) or Manual:** `AW 06 - Documentation drift guard` runs automatically in comment-only mode after `05` succeeds. (Optionally dispatch manually with `gh aw run docs-drift-guard --raw-field pr_number=<PR> --raw-field open_pr=true` to test draft `[docs]` PR creation.) | Posts one comment on the PR listing confirmed doc drift (or confirming no drift) without opening a PR on automatic runs; manual `open_pr=true` opens at most one draft `[docs]` PR if drift exists. | Continue to **D2** (keep the feature PR **unmerged** if you want to test premature release rejection). |
| D2 *(gate test)* | **Manual:** **Before** merging the PR, add the `release-to-production` label to the `ready-for-qa` issue. | `06 - Simulate production release` runs automatically, **rejects and removes** `release-to-production`, and comments that a linked PR must be merged into `main` first. | Confirm `release-to-production` was removed, then proceed to **D3**. |
| D3 | **Manual:** Click **Merge pull request** on the reviewed PR to merge it into `main`. | The PR merges into `main` (closing the linked issue automatically if `Closes #<ISSUE>` is present) and `Build and test` runs on `main`. | Wait for `Build and test` on `main` to go green — this automatically triggers **D4** (`AW 07`). |
| D4 | **Automatic (after `Build and test` passes on `main` push) or Manual:** `AW 07 - Pre-release readiness audit` runs automatically while any `ready-for-qa` (and not `released`) issue exists (or dispatch manually via `gh aw run release-readiness-audit --raw-field issue_number=<ISSUE>`). | `AW 07 - Pre-release readiness audit` posts one replaceable Go/No-Go checklist verifying `ready-for-qa`, merged closing PR on `main`, and green `main` CI, without mutating labels. | Review the Go/No-Go verdict on the issue, then proceed to **D5**. |
| D5 | **Manual:** On the issue (which still has `ready-for-qa`), add the `release-to-production` label (or run **Actions → `06 - Simulate production release` → Run workflow** with `issue_number: <ISSUE>`). | Workflow resolves and checks out an immutable `main` SHA, verifies `git merge-base --is-ancestor`, runs API tests + Node automation tests + web lint + web build, uploads the `simulated-production-release` artifact, adds `released`, and syncs Project status to `Done`. | Wait for `06 - Simulate production release` to succeed (`released` label added), then complete **D6**. |
| D6 | **Manual:** Open the completed `06 - Simulate production release` run in GitHub Actions, download the `simulated-production-release` artifact zip, and inspect `release/manifest.json`. | Contains `commit` matching the tested `main` HEAD SHA, `issue`, `mergedPr`, `mergeCommit`, `run`, `releasedAt`, and `"environment": "simulation"`. | **End of test plan.** (Optionally close any disposable test issues and delete temporary branches.) |

**Recovery:** If a premature `release-to-production` label was added before `ready-for-qa`, the workflow removes it automatically. Once `ready-for-qa` is present and the PR is merged, re-apply `release-to-production` or run `06 - Simulate production release` via `workflow_dispatch`.

---

## Stage 5: Fork compatibility trial (optional, required before workshop rollout)

**Outcome:** Verify whether `gh-aw` agentic jobs execute or skip in repositories marked as forks before instructing attendees to use them.

### Actions

1. Fork the repository into a separate test account or organization.
2. Enable GitHub Actions on the fork and configure `COPILOT_GITHUB_TOKEN`.
3. Open a test issue in the fork (to test `01 - Semantic issue triage`) and run `gh aw run qa-advisory --raw-field pr_number=<PR>`.

### Expected evidence

- Observe whether the `gh-aw` activation and agent jobs execute or are skipped because the repository is a fork.

### Recovery

- If `gh-aw` skips jobs in forked repositories, keep the deterministic `00`–`06` workflows as the attendee workshop path and reserve `AW 01`–`AW 07` for standalone or template-created repositories.
