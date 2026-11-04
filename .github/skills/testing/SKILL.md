---
name: testing
description: Design and run focused tests for .NET booking behavior, React build quality, and GitHub issue automation.
---

# Testing skill

1. Translate each acceptance criterion into observable behavior.
2. Select the smallest relevant layer:
   - API and booking rules: xUnit integration tests through `WebApplicationFactory`.
   - React correctness: TypeScript build and lint; add a UI test framework only when explicitly requested.
   - Routing and scoring: pure Node tests with `node:test`.
3. Cover the successful path plus relevant validation, conflict, or missing-data path.
4. Use isolated data and future fixed dates.
5. Run the targeted test first, then the repository validation commands before delivery.
6. Never replace a failing assertion with a weaker assertion unless the requirement changed.

Summarize the behavior proven, not only the command that passed.
