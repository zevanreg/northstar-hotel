# SDLC Workflow Test Plan

Verify that Northstar Hotel's hardened deterministic GitHub Actions workflows (`00`–`06`) and optional companion GitHub Agentic Workflows (`AW 01`–`AW 07`) enforce every human gate, commit-SHA check, and read-only boundary end to end.

## Mandatory vs. optional scope

- **Mandatory workshop baseline:** Stages 1, 3, and the deterministic checks in Stage 4 (`00`–`06` and `Build and test`).
- **Optional companion agentic workflows (`gh-aw`):** Stage 2 (`gh aw trial`), the `AW *` steps in Stage 4, and Stage 5 (fork compatibility check).

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

GitHub Actions only registers new `workflow_dispatch`, `issue_comment` (slash commands), and `workflow_run` triggers once they exist on the default branch (`main`). Use `gh aw trial` to test changes before merging without mutating real issues or pull requests.

### Actions

Replace `<owner>/<repo>` with your repository slug:

```powershell
# Preview without creating any repository
gh aw trial .github/workflows/qa-advisory.md --dry-run

# Run isolated trials that capture safe-outputs without mutating the target repository
gh aw trial .github/workflows/issue-triage-agentic.md --logical-repo <owner>/<repo> --delete-host-repo-after
gh aw trial .github/workflows/qa-advisory.md --logical-repo <owner>/<repo> --delete-host-repo-after
```

### Expected evidence

- Local trial output is saved under `trials/` showing what context the agent read, which `safe-outputs` were proposed, and threat-detection results.
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
| `COPILOT_GITHUB_TOKEN` | Secret | `AW 01`–`AW 07` (`*.lock.yml`) *(optional)* | Runs the Copilot engine in `gh-aw` (unless org token-based billing is enabled) |
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

**Outcome:** Prove every deterministic human gate, stale-approval reset, SHA-bound QA/release check, and companion agentic workflow works on GitHub.

Create one disposable test issue (for example, a small UI copy note with 2 clear acceptance criteria) and run through sections A–D in order.

### A. Triage, concurrency, and stale-approval revocation

| Step | Action | Expected evidence |
|---|---|---|
| A1 | Open the test issue. | `01 - Triage issue` applies `area:*`, `kind:*`, `priority:*`, `complexity:*`, and `status:triaged`, removes `status:new`, and posts an `Automated triage` comment with a `Requirement revision` hash. |
| A2 *(optional)* | Comment `/triage` on the issue (or run `gh aw run issue-triage-agentic --raw-field issue_number=<ISSUE>`). | `Agentic Commands` adds an `👀` reaction and dispatches `AW 01 - Semantic issue triage`. One replaceable comment is posted with codebase touchpoints, duplicate check, and clarifying questions. No human gate labels are touched. |
| A3 *(optional)* | Comment `/help` on the issue. | `Agentic Commands` replies with the list of registered slash commands (`/diagnose-ci`, `/triage`, `/verify-release`). |
| A4 | Add `ready-for-building`, then edit the issue body. | `01 - Triage issue` automatically removes `ready-for-building`, updates the `Requirement revision` hash, and appends the **Approval reset** notice. Re-apply `ready-for-building` to continue. |

**Recovery:** If `/triage` does not fire, confirm `.github/workflows/agentic_commands.yml` is on `main` and check the **Actions → `Agentic Commands`** log.

### B. Routing and Copilot delegation gate

| Step | Action | Expected evidence |
|---|---|---|
| B1 *(optional)* | Run **Actions → `AW 02 - Conflict-aware daily issue router`** with `apply_labels: true` (or `gh aw run daily-router-agentic --raw-field apply_labels=true`). | Recommends an `agent:*` lane with conflict checks against open PRs; never adds or removes human gate labels. |
| B2 | On a second issue **without** `ready-for-building`, add `develop-with-ai`. | `03 - Delegate approved issue to Copilot` removes `develop-with-ai` and comments that `ready-for-building` is required first. |
| B3 | On the approved test issue (which has `ready-for-building`), add `develop-with-ai`. | `03 - Delegate approved issue to Copilot` re-reads live labels, assigns `copilot-swe-agent[bot]` with the matched custom agent, and posts confirmation. |
| B4 | Run **Actions → `02 - Route top ready issues` → Run workflow**. | The active `develop-with-ai` / Copilot-assigned test issue is **excluded** from routing so the lane does not starve other ready issues. |

**Recovery:** If delegation comments that `COPILOT_AGENT_TOKEN` is missing, add the secret in Repository Settings, remove and re-add `develop-with-ai`, and re-check the run log.

### C. CI failure investigation, QA promotion, and stale QA revocation

| Step | Action | Expected evidence |
|---|---|---|
| C1 *(optional)* | On a PR targeting `main` (on a `copilot/**` branch, or manually via `/diagnose-ci` on any PR), introduce a temporary lint or test error so `Build and test` fails. | `AW 04 - CI failure investigator` posts one replaceable comment identifying the failing step, file, and suggested fix without modifying code or labels. |
| C2 | Fix the error and mark the PR ready for review with `Closes #<ISSUE>` in the PR body. | `Build and test` (`validate`) passes and `04 - Start automatic Copilot code review` requests `copilot-pull-request-reviewer[bot]`. |
| C3 | If Copilot leaves an unresolved review thread, inspect `05 - Promote reviewed work to QA`. | Promotion is **blocked** and a status comment explains the remaining blocker (unresolved Copilot threads, stale review commit, or pending `validate`). |
| C4 | Resolve all Copilot review threads so `validate` is green and Copilot review matches the current PR head SHA. If resolving a thread did not trigger a new event, run **Actions → `05 - Promote reviewed work to QA` → Run workflow** with `pr_number: <PR>`. | `05 - Promote reviewed work to QA` swaps `develop-with-ai` → `ready-for-qa` on local linked issues only and posts a comment citing the exact PR head SHA. |
| C5 | Push one more commit to the same-repo PR branch after `ready-for-qa` was applied. | `invalidate-stale-qa` in `05 - Promote reviewed work to QA` automatically removes `ready-for-qa` and posts a comment referencing the new commit SHA. Wait for `validate` + fresh Copilot review (or re-run `05` via `workflow_dispatch`) to restore `ready-for-qa`. |
| C6 *(optional)* | Run `gh aw run qa-advisory --raw-field pr_number=<PR>` (or **Actions → `AW 05 - Advisory QA and acceptance verification`**). | Posts one replaceable acceptance-criteria and booking-invariant audit stamped with the exact PR head SHA and issue `updated_at`, with zero label mutations. |

**Recovery:** If `05 - Promote reviewed work to QA` reports no linked local issue, add `Closes #<ISSUE>` to the PR description and manually dispatch `05 - Promote reviewed work to QA` with `pr_number`.

### D. Docs drift, pre-release audit, and immutable release simulation

| Step | Action | Expected evidence |
|---|---|---|
| D1 *(optional)* | Run `gh aw run docs-drift-guard --raw-field pr_number=<PR> --raw-field open_pr=false`. | Posts one comment listing confirmed doc drift (or confirming no drift) without opening a PR. Optionally test with `open_pr=true` to verify at most one draft `[docs]` PR is created. |
| D2 | **Before** merging the PR, add `release-to-production` to the `ready-for-qa` issue. | `06 - Simulate production release` **rejects and removes** `release-to-production` and comments that a linked PR must be merged into `main` first. |
| D3 | Merge the PR into `main`. | Linked PR is merged on `main` and `Build and test` runs on `main`. |
| D4 *(optional)* | Comment `/verify-release` on the issue (or run `gh aw run release-readiness-audit --raw-field issue_number=<ISSUE>`). | `AW 07 - Pre-release readiness audit` posts one replaceable Go/No-Go checklist verifying `ready-for-qa`, merged closing PR on `main`, and green `main` CI, without mutating labels. |
| D5 | Add `release-to-production` to the issue (or retry via **Actions → `06 - Simulate production release`** with `issue_number`). | Workflow resolves and checks out an immutable `main` SHA, verifies `git merge-base --is-ancestor`, runs API tests + Node automation tests + web lint + web build, uploads the `simulated-production-release` artifact, adds `released`, and syncs Project status to `Done`. |
| D6 | Download and inspect `release/manifest.json` from the `simulated-production-release` artifact. | Contains `commit` matching the tested `main` HEAD SHA, `issue`, `mergedPr`, `mergeCommit`, `run`, `releasedAt`, and `"environment": "simulation"`. |

**Recovery:** If a premature `release-to-production` label was added before `ready-for-qa`, the workflow removes it automatically. Once `ready-for-qa` is present and the PR is merged, re-apply `release-to-production` or run `06 - Simulate production release` via `workflow_dispatch`.

---

## Stage 5: Fork compatibility trial (optional, required before workshop rollout)

**Outcome:** Verify whether `gh-aw` agentic jobs execute or skip in repositories marked as forks before instructing attendees to use them.

### Actions

1. Fork the repository into a separate test account or organization.
2. Enable GitHub Actions on the fork and configure `COPILOT_GITHUB_TOKEN`.
3. Run `gh aw run qa-advisory --raw-field pr_number=<PR>` and comment `/triage` on a test issue in the fork.

### Expected evidence

- Observe whether the `gh-aw` activation and agent jobs execute or are skipped because the repository is a fork.

### Recovery

- If `gh-aw` skips jobs in forked repositories, keep the deterministic `00`–`06` workflows as the attendee workshop path and reserve `AW 01`–`AW 07` for standalone or template-created repositories.
