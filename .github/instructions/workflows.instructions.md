---
applyTo: ".github/workflows/**/*.yml,.github/scripts/**/*.js,.github/labels.json"
---

# Automation instructions

- Preserve the human gates: `ready-for-building`, `develop-with-ai`, and `release-to-production`.
- Keep one single-owner workflow per SDLC stage (no duplicated deterministic/agentic triage or routing workflows):
  - Agentic (`gh-aw`, `.github/workflows/*.md` compiled via `gh aw compile` into `*.lock.yml`): issue triage (`01`), daily issue routing (`02`), CI failure investigation (`AW 04`), advisory QA audit (`AW 05`), documentation drift guard (`AW 06`), and pre-release readiness audit (`AW 07`).
  - Deterministic (`.yml`): label bootstrap (`00`), Copilot delegation (`03`), CI (`Build and test`), automatic Copilot code review (`04`), SHA-bound QA promotion and stale-QA revocation (`05`), simulated release (`06`), and GitHub Project v2 sync.
- Mutate only workflow-owned labels (avoid full `setLabels` replacement) and serialize per-issue or per-PR workflow runs with `concurrency`.
- Re-read live issue or PR state before privileged transitions; revoke stale `ready-for-building` deterministically on material requirement edits and stale `ready-for-qa` when new commits land on a PR.
- Bind QA promotion and release simulation to exact commit SHAs (verify current PR head, resolved Copilot review threads, same-repo closing references, merged closing PR on `main`, and full test/lint/build validation).
- Use least-privilege workflow permissions and never run untrusted pull request code with a privileged token.
- `GITHUB_TOKEN` cannot assign Copilot cloud agent or update Projects v2; retain dedicated token boundaries (`COPILOT_AGENT_TOKEN`, `PROJECT_TOKEN`) in deterministic jobs only—never expose them to AI agent jobs.
- Keep label creation idempotent and preserve labels outside the automation-managed prefixes.
- Route labels recommend the execution environment; VS Code and Copilot CLI are local tools and cannot be GitHub assignees.
- Exclude active `develop-with-ai` or Copilot-assigned work from daily routing (`skip-if-no-match` + routing rules) so lanes do not starve and empty-queue runs skip cleanly.
- A release remains a simulation that runs API tests, automation tests, web lint, and web build, and uploads an artifact. Do not add a cloud deployment.
- Recompile `.github/workflows/*.md` with `gh aw compile --validate` whenever agentic workflow sources change, and verify `gh-aw` behavior in a real fork before enabling for workshop attendees.
- Add pure-function tests when custom-agent selection, owned-label planning, edit detection, QA eligibility, release gating, or project-status logic changes.
