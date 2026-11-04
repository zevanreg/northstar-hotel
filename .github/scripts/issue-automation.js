const labelDefinitions = require('../labels.json')

const managedPrefixes = ['area:', 'complexity:', 'priority:', 'kind:']
const routePrefix = 'agent:'
const triageMarker = '<!-- minihack-triage -->'
const routeMarker = '<!-- minihack-route -->'

function hasAny(text, words) {
  return words.some((word) => text.includes(word))
}

function hasAnyKeyword(text, words) {
  return words.some((word) => {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`\\b${escaped}\\b`).test(text)
  })
}

function classifyIssue(title, body = '') {
  const text = `${title}\n${body}`.toLowerCase()
  const frontend = hasAny(text, [
    'react', 'frontend', 'front-end', 'browser', 'page', 'screen', 'button', 'form',
    'css', 'accessibility', 'responsive', 'ui ', 'ux '
  ])
  const backend = hasAny(text, [
    '.net', 'backend', 'back-end', 'api', 'endpoint', 'database', 'sqlite', 'entity framework',
    'booking rule', 'validation', 'server'
  ])
  const automation = hasAnyKeyword(text, [
    'workflow', 'github action', 'automation', 'powershell', 'bash', 'script', 'cli', 'pipeline'
  ])
  const documentation = hasAny(text, [
    'documentation', 'readme', 'guide', 'instructions', 'runbook'
  ])

  let area = 'area:backend'
  if (frontend && backend) area = 'area:full-stack'
  else if (automation) area = 'area:automation'
  else if (frontend) area = 'area:frontend'
  else if (documentation) area = 'area:documentation'

  let kind = 'kind:feature'
  if (hasAny(text, ['logging', 'log message', 'telemetry', 'diagnostic'])) kind = 'kind:logging'
  else if (automation) kind = 'kind:script'
  else if (hasAny(text, ['bug', 'broken', 'error', 'fails', 'incorrect', 'fix '])) kind = 'kind:bug'
  else if (documentation) kind = 'kind:docs'

  let priority = 'priority:p3'
  if (hasAny(text, ['critical', 'security', 'production down', 'blocker', 'data loss'])) {
    priority = 'priority:p1'
  } else if (kind === 'kind:bug' || hasAny(text, ['important', 'customer', 'regression'])) {
    priority = 'priority:p2'
  }

  let score = 0
  if (body.length > 600) score += 1
  if (body.length > 1400) score += 1
  if (area === 'area:full-stack') score += 2
  if (hasAny(text, ['database', 'migration', 'authentication', 'authorization', 'security'])) score += 1
  if ((body.match(/- \[[ xX]\]/g) || []).length >= 4) score += 1

  const complexity = score >= 4
    ? 'complexity:high'
    : score >= 2
      ? 'complexity:medium'
      : 'complexity:low'

  return { area, kind, priority, complexity, score }
}

function chooseCustomAgent(labelNames) {
  const labels = new Set(labelNames)

  if (labels.has('area:full-stack')) return 'fullstack'
  if (labels.has('area:frontend')) return 'frontend'
  if (labels.has('area:documentation') || labels.has('kind:docs')) return 'documentation'
  if (labels.has('area:backend')) return 'clean-code'
  return ''
}

function buildCopilotAssignment(targetRepo, customAgent = '') {
  const agentAssignment = {
    target_repo: targetRepo,
    base_branch: 'main',
    custom_instructions: 'Follow all repository instructions and skills. Implement the issue, update documentation, add tests, run validation, and open a pull request.'
  }

  if (customAgent) {
    agentAssignment.custom_agent = customAgent
  }

  return {
    assignees: ['copilot-swe-agent[bot]'],
    agent_assignment: agentAssignment
  }
}

function chooseRoute(labelNames) {
  const labels = new Set(labelNames)
  const customAgent = chooseCustomAgent(labelNames)

  if (labels.has('area:full-stack') && labels.has('complexity:high')) {
    return {
      label: 'agent:vscode',
      owner: 'Human maintainer using GitHub Copilot in VS Code',
      reason: 'The highest-complexity full-stack work benefits from interactive architecture decisions.',
      customAgent
    }
  }

  if (labels.has('area:frontend') && labels.has('complexity:low')) {
    return {
      label: 'agent:copilot-app',
      owner: 'Copilot on GitHub using the frontend custom agent',
      reason: 'This isolated UI change is a good asynchronous Copilot task.',
      customAgent
    }
  }

  if (labels.has('area:documentation') || labels.has('kind:docs')) {
    return {
      label: 'agent:cloud',
      owner: 'Copilot cloud agent using the documentation custom agent',
      reason: 'Documentation-only work is bounded, reviewable, and can use the dedicated documentation agent.',
      customAgent
    }
  }

  if (labels.has('kind:script') || labels.has('area:automation')) {
    return {
      label: 'agent:copilot-cli',
      owner: 'Human maintainer using Copilot CLI',
      reason: 'The work is command-line or workflow focused and can be validated locally.',
      customAgent
    }
  }

  if (labels.has('kind:logging')
      || (labels.has('area:backend') && labels.has('complexity:low'))) {
    return {
      label: 'agent:cloud',
      owner: 'Copilot cloud agent using the clean-code custom agent',
      reason: 'This is a bounded backend change with a short validation loop.',
      customAgent
    }
  }

  return {
    label: 'agent:human',
    owner: 'Human maintainer',
    reason: 'The issue needs a maintainer decision before an implementation tool is selected.',
    customAgent
  }
}

function rankIssue(issue) {
  const labels = issue.labels.map((label) => typeof label === 'string' ? label : label.name)
  const priority = labels.includes('priority:p1') ? 300 : labels.includes('priority:p2') ? 200 : 100
  const complexity = labels.includes('complexity:high') ? 30 : labels.includes('complexity:medium') ? 20 : 10
  const ageInDays = Math.min(30, Math.floor((Date.now() - Date.parse(issue.created_at)) / 86_400_000))
  return priority + complexity + ageInDays
}

async function ensureLabels(github, owner, repo, names = labelDefinitions.map((label) => label.name)) {
  const selected = labelDefinitions.filter((definition) => names.includes(definition.name))

  for (const label of selected) {
    try {
      await github.rest.issues.getLabel({ owner, repo, name: label.name })
      await github.rest.issues.updateLabel({
        owner,
        repo,
        name: label.name,
        color: label.color,
        description: label.description
      })
    } catch (error) {
      if (error.status !== 404) throw error
      await github.rest.issues.createLabel({ owner, repo, ...label })
    }
  }
}

async function upsertMarkerComment(github, owner, repo, issueNumber, marker, body) {
  const comments = await github.paginate(github.rest.issues.listComments, {
    owner,
    repo,
    issue_number: issueNumber,
    per_page: 100
  })
  const existing = comments.find((comment) =>
    comment.user?.type === 'Bot' && comment.body?.includes(marker))

  if (existing) {
    await github.rest.issues.updateComment({
      owner,
      repo,
      comment_id: existing.id,
      body
    })
    return
  }

  await github.rest.issues.createComment({
    owner,
    repo,
    issue_number: issueNumber,
    body
  })
}

async function triage({ github, context, core }) {
  const { owner, repo } = context.repo
  const issue = context.payload.issue
  const classification = classifyIssue(issue.title, issue.body || '')
  const managedLabels = [
    classification.area,
    classification.kind,
    classification.priority,
    classification.complexity,
    'status:triaged'
  ]

  await ensureLabels(github, owner, repo, managedLabels)

  const preservedLabels = issue.labels
    .map((label) => typeof label === 'string' ? label : label.name)
    .filter((name) =>
      name !== 'status:new'
      && !managedPrefixes.some((prefix) => name.startsWith(prefix)))

  await github.rest.issues.setLabels({
    owner,
    repo,
    issue_number: issue.number,
    labels: [...new Set([...preservedLabels, ...managedLabels])]
  })

  const body = `${triageMarker}
## Automated triage

| Signal | Result |
| --- | --- |
| Area | \`${classification.area}\` |
| Kind | \`${classification.kind}\` |
| Priority | \`${classification.priority}\` |
| Complexity | \`${classification.complexity}\` (score ${classification.score}) |

**Human gate:** confirm the requirement and add \`ready-for-building\`. Run the daily router to get an implementation lane. Add \`develop-with-ai\` only when Copilot should start implementation.

The score is deterministic and intentionally explainable for the workshop. A maintainer remains accountable for scope and priority.`

  await upsertMarkerComment(github, owner, repo, issue.number, triageMarker, body)
  core.notice(`Triaged issue #${issue.number} as ${classification.complexity}.`)
}

async function routeDaily({ github, context, core, maintainer }) {
  const { owner, repo } = context.repo
  await ensureLabels(github, owner, repo)

  const issues = await github.paginate(github.rest.issues.listForRepo, {
    owner,
    repo,
    state: 'open',
    per_page: 100
  })

  const candidates = issues
    .filter((issue) => !issue.pull_request)
    .filter((issue) => {
      const labels = issue.labels.map((label) => typeof label === 'string' ? label : label.name)
      return labels.includes('status:triaged')
        && labels.includes('ready-for-building')
        && !labels.includes('ready-for-qa')
        && !labels.includes('released')
    })
    .sort((left, right) => rankIssue(right) - rankIssue(left))

  const selectedByRoute = new Map()
  for (const issue of candidates) {
    const labels = issue.labels.map((label) => typeof label === 'string' ? label : label.name)
    const route = chooseRoute(labels)
    if (!selectedByRoute.has(route.label)) {
      selectedByRoute.set(route.label, { issue, route })
    }
  }

  for (const { issue, route } of selectedByRoute.values()) {
    const currentLabels = issue.labels.map((label) => typeof label === 'string' ? label : label.name)
    const nextLabels = currentLabels.filter((name) => !name.startsWith(routePrefix))
    nextLabels.push(route.label)

    await github.rest.issues.setLabels({
      owner,
      repo,
      issue_number: issue.number,
      labels: [...new Set(nextLabels)]
    })

    if (maintainer && ['agent:vscode', 'agent:copilot-cli', 'agent:human'].includes(route.label)) {
      await github.rest.issues.addAssignees({
        owner,
        repo,
        issue_number: issue.number,
        assignees: [maintainer]
      })
    }

    const startInstruction = ['agent:copilot-app', 'agent:cloud'].includes(route.label)
      ? 'When the owner agrees, add `develop-with-ai` to start Copilot.'
      : `Assigned to \`${maintainer || 'the workshop maintainer'}\` for local or human-led work.`

    const body = `${routeMarker}
## Daily issue router

| Routing signal | Decision |
| --- | --- |
| Recommended lane | \`${route.label}\` |
| Owner/tool | ${route.owner} |
| Custom agent | ${route.customAgent ? `\`${route.customAgent}\`` : 'Default Copilot agent'} |

**Why:** ${route.reason}

${startInstruction}

The router selects the highest-ranked ready issue in each lane. Copilot code review remains the review lane for every pull request.`

    await upsertMarkerComment(github, owner, repo, issue.number, routeMarker, body)
    core.notice(`Routed issue #${issue.number} to ${route.label}.`)
  }

  await core.summary
    .addHeading('Daily issue routing')
    .addTable([
      [{ data: 'Issue', header: true }, { data: 'Route', header: true }, { data: 'Score', header: true }],
      ...[...selectedByRoute.values()].map(({ issue, route }) => [
        `#${issue.number} ${issue.title}`,
        route.label,
        String(rankIssue(issue))
      ])
    ])
    .write()
}

module.exports = {
  buildCopilotAssignment,
  classifyIssue,
  chooseCustomAgent,
  chooseRoute,
  ensureLabels,
  labelDefinitions,
  rankIssue,
  routeDaily,
  triage
}
