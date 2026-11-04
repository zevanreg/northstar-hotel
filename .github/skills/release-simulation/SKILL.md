---
name: release-simulation
description: Validate and simulate a production release without deploying to an environment.
---

# Release simulation skill

1. Confirm the linked issue has `ready-for-qa` and explicit `release-to-production` approval.
2. Validate the main branch, not unmerged pull request code.
3. Run API tests and create a production web build.
4. Produce a manifest containing repository, commit, issue, workflow run, UTC timestamp, and `environment: simulation`.
5. Upload the manifest and web assets as a short-lived workflow artifact.
6. Add `released` and comment with the workflow run only after every validation step succeeds.
7. Never add cloud credentials, infrastructure, or an actual deployment target.
