---
applyTo: "tests/**/*,.github/scripts/**/*.test.js"
---

# Test instructions

- Test externally visible behavior and business rules, not implementation details.
- Use dates far enough in the future that tests do not expire.
- Give every test an isolated database name; do not use or modify the local SQLite file.
- Include the assertion that would have caught the reported defect.
- Keep tests deterministic and independent of network services, clock timing, or execution order.
- Node automation tests use the built-in `node:test` module and require no package installation.
