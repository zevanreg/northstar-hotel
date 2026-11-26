---
applyTo: ".github/workflows/**/*.yml,.github/scripts/**/*.js,.github/labels.json"
---

# Automation instructions

- Preserve the human gates: `ready-for-building`, `develop-with-ai`, and `release-to-production`.
- Mutate only workflow-owned labels (avoid full `setLabels` replacement) and serialize per-issue or per-PR workflow runs with `concurrency`.
- Re-read live issue or PR state before privileged transitions; revoke stale `ready-for-building` on material requirement edits and stale `ready-for-qa` when new commits land on a PR.
- Bind QA promotion and release simulation to exact commit SHAs (verify current PR head, resolved Copilot review threads, same-repo closing references, merged closing PR on `main`, and full test/lint/build validation).
- Use least-privilege workflow permissions and never run untrusted pull request code with a privileged token.
- `GITHUB_TOKEN` cannot assign Copilot cloud agent or update Projects v2; retain the dedicated token boundaries.
- Keep label creation idempotent and preserve labels outside the automation-managed prefixes.
- Route labels recommend the execution environment; VS Code and Copilot CLI are local tools and cannot be GitHub assignees.
- Exclude active `develop-with-ai` or Copilot-assigned work from daily routing so lanes do not starve.
- A release remains a simulation that runs API tests, automation tests, web lint, and web build, and uploads an artifact. Do not add a cloud deployment.
- Keep GitHub Agentic Workflows (`.github/workflows/*.md` compiled via `gh aw compile` into `*.lock.yml` plus centralized `agentic_commands.yml`) scoped with read-only agent permissions and explicit `safe-outputs` guardrails (`blocked` lists protecting human gates, `create-issue: false`, and zero unauthorized gate transitions); recompile whenever a `.md` workflow changes and verify behavior in a fork before enabling for workshop attendees.
- Add pure-function tests when classification, ranking, routing, QA eligibility, release gating, or project-status logic changes.
