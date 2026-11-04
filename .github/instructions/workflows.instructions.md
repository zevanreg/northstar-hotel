---
applyTo: ".github/workflows/**/*.yml,.github/scripts/**/*.js,.github/labels.json"
---

# Automation instructions

- Preserve the human gates: `ready-for-building`, `develop-with-ai`, and `release-to-production`.
- Use least-privilege workflow permissions and never run untrusted pull request code with a privileged token.
- `GITHUB_TOKEN` cannot assign Copilot cloud agent or update Projects v2; retain the dedicated token boundaries.
- Keep label creation idempotent and preserve labels outside the automation-managed prefixes.
- Route labels recommend the execution environment; VS Code and Copilot CLI are local tools and cannot be GitHub assignees.
- A release remains a simulation that runs tests and uploads an artifact. Do not add a cloud deployment.
- Add pure-function tests when classification, ranking, routing, or project-status logic changes.
