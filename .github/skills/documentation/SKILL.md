---
name: documentation
description: Keep attendee, facilitator, setup, architecture, and feature documentation accurate when behavior or automation changes.
---

# Documentation skill

Use this skill whenever a change affects product behavior, commands, repository setup, labels, workflow gates, secrets, or participant instructions.

1. Identify every audience affected: guest/user, attendee, facilitator, and repository administrator.
2. Compare the implementation with `README.md`, both `docs/ATTENDEE-GUIDE-PHASE-*.md` files, and `docs/WORKFLOW.md`.
3. Update only the sources made inaccurate by the change.
4. Use exact commands and label names copied from the repository.
5. Include expected evidence and one concise troubleshooting action for workshop-critical steps.
6. Preserve the 90-minute agenda unless the task explicitly changes it.
7. Check links and make sure no secret or personal identifier appears in the result.

Report which documentation surfaces changed in the pull request.
