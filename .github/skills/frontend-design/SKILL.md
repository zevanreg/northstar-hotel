---
name: frontend-design
description: Create distinctive, accessible Northstar Hotel interfaces through deliberate visual direction, typography, layout, copy, and restrained motion.
license: Apache-2.0; see LICENSE.txt
---

# Frontend design

This file is adapted from Anthropic's `frontend-design` skill:
https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md

Modified for the Northstar Hotel workshop to preserve its established design language, accessibility requirements, dependency limits, and 90-minute scope.

Use this skill for new UI or meaningful visual changes. Repository and frontend instructions take precedence.

## Ground the design in Northstar Hotel

Before editing:

1. State the page's audience and single job.
2. Reuse the established harbour green, warm coral, serif display headings, compact cards, and hotel terminology.
3. Identify one restrained signature element that supports booking rather than decorating it.
4. Prefer real room, stay, price, availability, and booking content over generic placeholders.

## Plan before building

Create a compact design plan:

- **Color:** name the existing palette roles and any required extension.
- **Type:** define display, body, and utility roles without adding a font dependency unless the issue requires it.
- **Layout:** describe desktop and mobile hierarchy with a short wireframe.
- **Signature:** choose one memorable element tied to the hotel experience.
- **Interaction:** identify the few states that need motion or feedback.

Critique the plan before coding. Remove choices that could belong to any generic dashboard or travel template.

## Build deliberately

- Make hierarchy communicate booking priority and state.
- Use structural devices only when they encode real information.
- Keep interface copy direct, consistent, and written from the guest's perspective.
- Make empty, loading, success, and error states explain what happened and what to do next.
- Spend visual boldness in one place; keep supporting elements disciplined.
- Keep CSS selectors predictable and avoid specificity conflicts.
- Match implementation complexity to the workshop scope.

## Quality floor

Do not trade usability for novelty:

- preserve semantic HTML and keyboard operation,
- provide visible focus and associated labels,
- announce asynchronous status changes,
- respect reduced-motion preferences,
- support narrow mobile layouts,
- keep contrast readable,
- retain strict TypeScript and existing API contracts.

Review the rendered interface after implementation. Remove one unnecessary decorative element, then run `npm run lint` and `npm run build`.
