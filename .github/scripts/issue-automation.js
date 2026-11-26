const crypto = require('node:crypto')
const labelDefinitions = require('../labels.json')

const managedPrefixes = ['area:', 'complexity:', 'priority:', 'kind:']
const routePrefix = 'agent:'
const triageMarker = '<!-- minihack-triage -->'
const routeMarker = '<!-- minihack-route -->'
const qaBlockMarker = '<!-- minihack-qa-status -->'

function normalizeLabelNames(labels = []) {
  return labels.map((label) => typeof label === 'string' ? label : label.name)
}

function isTriageOwnedLabel(name) {
  return name === 'status:new'
    || name === 'status:triaged'
    || managedPrefixes.some((prefix) => name.startsWith(prefix))
}

function planLabelChanges(currentLabels, desiredLabels, ownedPredicate) {
  const currentSet = new Set(normalizeLabelNames(currentLabels))
  const desiredSet = new Set(desiredLabels)

  const toAdd = [...desiredSet].filter((name) => !currentSet.has(name))
  const toRemove = [...currentSet].filter((name) => ownedPredicate(name) && !desiredSet.has(name))

  return { toAdd, toRemove }
}

function computeRequirementFingerprint(title = '', body = '') {
  return crypto
    .createHash('sha256')
    .update(`${title}\n---\n${body}`)
    .digest('hex')
    .slice(0, 12)
}

function hasMaterialRequirementEdit(changes, currentTitle = '', currentBody = '') {
  if (!changes) return true

  const titleChanged = Object.prototype.hasOwnProperty.call(changes, 'title')
    && changes.title?.from !== currentTitle
  const bodyChanged = Object.prototype.hasOwnProperty.call(changes, 'body')
    && (changes.body?.from || '') !== (currentBody || '')

  return titleChanged || bodyChanged
}

function isCopilotAssignee(assignee) {
  const login = (typeof assignee === 'string' ? assignee : assignee?.login || '').toLowerCase()
  return login === 'copilot' || login === 'copilot-swe-agent[bot]' || login.startsWith('copilot-swe-agent')
}

function isRoutableIssue(issue) {
  if (!issue || issue.pull_request) return false
  const labels = normalizeLabelNames(issue.labels)
  if (!labels.includes('status:triaged') || !labels.includes('ready-for-building')) {
    return false
  }
  if (labels.includes('develop-with-ai') || labels.includes('ready-for-qa') || labels.includes('released')) {
    return false
  }
  if (Array.isArray(issue.assignees) && issue.assignees.some(isCopilotAssignee)) {
    return false
  }
  return true
}

function isCopilotReviewAuthor(user, actor = '') {
  const login = (user?.login || '').toLowerCase()
  const actorLogin = (actor || '').toLowerCase()
  const isBotType = !user?.type || user.type === 'Bot'
  if (!isBotType) return false

  return actorLogin === 'copilot'
    || login === 'copilot'
    || login.startsWith('copilot-pull-request-reviewer')
}

function filterLocalClosingIssues(closingIssuesReferences = [], owner, repo) {
  const expectedRepo = `${owner}/${repo}`.toLowerCase()
  const numbers = []

  for (const ref of closingIssuesReferences) {
    if (!ref || typeof ref.number !== 'number') continue
    const refRepo = (
      ref.repository?.nameWithOwner
      || (ref.repository?.owner?.login && ref.repository?.name
        ? `${ref.repository.owner.login}/${ref.repository.name}`
        : '')
    ).toLowerCase()

    if (refRepo !== expectedRepo) continue
    if (!numbers.includes(ref.number)) {
      numbers.push(ref.number)
    }
  }

  return numbers
}

function countUnresolvedCopilotThreads(reviewThreads = []) {
  return reviewThreads.filter((thread) => {
    if (!thread || thread.isResolved || thread.isOutdated) return false
    const firstAuthor = thread.comments?.nodes?.[0]?.author || thread.author
    const login = (firstAuthor?.login || '').toLowerCase()
    return login === 'copilot' || login.startsWith('copilot-pull-request-reviewer')
  }).length
}

function evaluateQaPromotion({ pr, reviews = [], checkRuns = [], reviewThreads = [] }) {
  if (!pr) {
    return { eligible: false, reason: 'Pull request details were not found.' }
  }

  const headSha = pr.headRefOid || pr.head?.sha || ''
  const state = (pr.state || '').toUpperCase()
  const isDraft = Boolean(pr.isDraft ?? pr.draft)

  if (state !== 'OPEN') {
    return { eligible: false, headSha, reason: `Pull request is ${state.toLowerCase()}, not open.` }
  }
  if (isDraft) {
    return { eligible: false, headSha, reason: 'Pull request is still a draft.' }
  }
  if (!headSha) {
    return { eligible: false, headSha, reason: 'Pull request head commit SHA is missing.' }
  }

  const matchingValidateRuns = checkRuns
    .filter((run) => run?.name === 'validate' && (!run.head_sha || run.head_sha === headSha))
    .sort((left, right) => Date.parse(left.started_at || 0) - Date.parse(right.started_at || 0))
  const latestValidate = matchingValidateRuns[matchingValidateRuns.length - 1]

  if (!latestValidate || latestValidate.status !== 'completed') {
    return {
      eligible: false,
      headSha,
      checkConclusion: latestValidate?.status || 'missing',
      reason: `The validate check has not completed for head commit ${headSha.slice(0, 7)}.`
    }
  }
  if (latestValidate.conclusion !== 'success') {
    return {
      eligible: false,
      headSha,
      checkConclusion: latestValidate.conclusion,
      reason: `The validate check concluded with ${latestValidate.conclusion} for head commit ${headSha.slice(0, 7)}.`
    }
  }

  const copilotReviews = reviews
    .filter((review) => isCopilotReviewAuthor(review?.user))
    .sort((left, right) => Date.parse(left.submitted_at || 0) - Date.parse(right.submitted_at || 0))

  const reviewsForHead = copilotReviews.filter((review) => review.commit_id === headSha)
  if (reviewsForHead.length === 0) {
    const latestOverall = copilotReviews[copilotReviews.length - 1]
    return {
      eligible: false,
      headSha,
      reviewCommitId: latestOverall?.commit_id || null,
      reason: latestOverall
        ? `Latest Copilot review targeted ${latestOverall.commit_id?.slice(0, 7) || 'an earlier commit'}, not current head ${headSha.slice(0, 7)}.`
        : `No Copilot review has been submitted for head commit ${headSha.slice(0, 7)}.`
    }
  }

  const latestHeadReview = reviewsForHead[reviewsForHead.length - 1]
  if ((latestHeadReview.state || '').toUpperCase() === 'CHANGES_REQUESTED') {
    return {
      eligible: false,
      headSha,
      reviewCommitId: latestHeadReview.commit_id,
      reason: `Copilot requested changes on head commit ${headSha.slice(0, 7)}.`
    }
  }

  const unresolvedThreads = countUnresolvedCopilotThreads(reviewThreads)
  if (unresolvedThreads > 0) {
    return {
      eligible: false,
      headSha,
      reviewCommitId: latestHeadReview.commit_id,
      unresolvedThreads,
      reason: `${unresolvedThreads} unresolved Copilot review thread(s) remain on this pull request.`
    }
  }

  return {
    eligible: true,
    headSha,
    reviewCommitId: latestHeadReview.commit_id,
    unresolvedThreads: 0,
    checkConclusion: 'success',
    reason: `Copilot review and validate check passed for head commit ${headSha.slice(0, 7)}.`
  }
}

function evaluateReleaseGate(labelNames = []) {
  const labels = new Set(normalizeLabelNames(labelNames))
  if (!labels.has('ready-for-qa')) {
    return {
      approved: false,
      reason: 'Release simulation was not started because the issue does not have `ready-for-qa`.'
    }
  }
  if (!labels.has('release-to-production')) {
    return {
      approved: false,
      reason: 'Release simulation was not started because `release-to-production` is no longer present.'
    }
  }
  return { approved: true, reason: 'QA and release approval labels are present.' }
}

function findMergedClosingPrs({ closedByPrs = [], closedEvents = [], owner, repo, baseBranch = 'main' }) {
  const expectedRepo = `${owner}/${repo}`.toLowerCase()
  const byNumber = new Map()

  const candidates = [
    ...closedByPrs,
    ...closedEvents.map((event) => event?.closer).filter(Boolean)
  ]

  for (const pr of candidates) {
    if (!pr || typeof pr.number !== 'number') continue
    if (!pr.merged) continue
    if (baseBranch && pr.baseRefName !== baseBranch) continue

    const prRepo = (
      pr.repository?.nameWithOwner
      || (pr.repository?.owner?.login && pr.repository?.name
        ? `${pr.repository.owner.login}/${pr.repository.name}`
        : '')
    ).toLowerCase()
    if (prRepo !== expectedRepo) continue

    const mergeCommitSha = pr.mergeCommit?.oid || pr.mergeCommitSha || ''
    if (!mergeCommitSha) continue

    if (!byNumber.has(pr.number)) {
      byNumber.set(pr.number, {
        number: pr.number,
        mergeCommitSha,
        url: pr.url || ''
      })
    }
  }

  return [...byNumber.values()]
}

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

async function applyOwnedLabels(github, owner, repo, issueNumber, currentLabels, desiredLabels, ownedPredicate) {
  const { toAdd, toRemove } = planLabelChanges(currentLabels, desiredLabels, ownedPredicate)

  if (toAdd.length > 0) {
    await github.rest.issues.addLabels({
      owner,
      repo,
      issue_number: issueNumber,
      labels: toAdd
    })
  }

  for (const name of toRemove) {
    try {
      await github.rest.issues.removeLabel({
        owner,
        repo,
        issue_number: issueNumber,
        name
      })
    } catch (error) {
      if (error.status !== 404) throw error
    }
  }

  return { toAdd, toRemove }
}

async function triage({ github, context, core }) {
  const { owner, repo } = context.repo
  const issueNumber = context.payload.issue.number
  const { data: issue } = await github.rest.issues.get({
    owner,
    repo,
    issue_number: issueNumber
  })

  const classification = classifyIssue(issue.title, issue.body || '')
  const fingerprint = computeRequirementFingerprint(issue.title, issue.body || '')
  const managedLabels = [
    classification.area,
    classification.kind,
    classification.priority,
    classification.complexity,
    'status:triaged'
  ]

  await ensureLabels(github, owner, repo, managedLabels)

  const currentLabels = normalizeLabelNames(issue.labels)
  await applyOwnedLabels(github, owner, repo, issue.number, currentLabels, managedLabels, isTriageOwnedLabel)

  const isEdited = context.payload.action === 'edited'
  const materialEdit = isEdited && hasMaterialRequirementEdit(context.payload.changes, issue.title, issue.body || '')
  let approvalResetNotice = ''

  if (materialEdit && currentLabels.includes('ready-for-building') && !currentLabels.includes('released')) {
    try {
      await github.rest.issues.removeLabel({
        owner,
        repo,
        issue_number: issue.number,
        name: 'ready-for-building'
      })
      approvalResetNotice = '\n\n> **Approval reset:** The issue title or body was edited after `ready-for-building` was applied, so `ready-for-building` was removed. Please re-review the updated requirements and re-apply `ready-for-building` when ready.'
      core.notice(`Revoked stale ready-for-building on edited issue #${issue.number}.`)
    } catch (error) {
      if (error.status !== 404) throw error
    }
  }

  const body = `${triageMarker}
## Automated triage

| Signal | Result |
| --- | --- |
| Area | \`${classification.area}\` |
| Kind | \`${classification.kind}\` |
| Priority | \`${classification.priority}\` |
| Complexity | \`${classification.complexity}\` (score ${classification.score}) |
| Requirement revision | \`${fingerprint}\` |

**Human gate:** confirm the requirement and add \`ready-for-building\`. Run the daily router to get an implementation lane. Add \`develop-with-ai\` only when Copilot should start implementation.${approvalResetNotice}

The score is deterministic and intentionally explainable for the workshop. A maintainer remains accountable for scope and priority.`

  await upsertMarkerComment(github, owner, repo, issue.number, triageMarker, body)
  core.notice(`Triaged issue #${issue.number} as ${classification.complexity} (rev ${fingerprint}).`)
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
    .filter(isRoutableIssue)
    .sort((left, right) => rankIssue(right) - rankIssue(left))

  const selectedByRoute = new Map()
  for (const issue of candidates) {
    const labels = normalizeLabelNames(issue.labels)
    const route = chooseRoute(labels)
    if (!selectedByRoute.has(route.label)) {
      selectedByRoute.set(route.label, { issue, route })
    }
  }

  const routed = []
  for (const { issue, route } of selectedByRoute.values()) {
    const { data: liveIssue } = await github.rest.issues.get({
      owner,
      repo,
      issue_number: issue.number
    })

    if (!isRoutableIssue(liveIssue)) {
      core.notice(`Skipped issue #${issue.number} because its labels or assignees changed before routing.`)
      continue
    }

    const liveLabels = normalizeLabelNames(liveIssue.labels)
    await applyOwnedLabels(
      github,
      owner,
      repo,
      issue.number,
      liveLabels,
      [route.label],
      (name) => name.startsWith(routePrefix)
    )

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
    routed.push({ issue: liveIssue, route })
  }

  await core.summary
    .addHeading('Daily issue routing')
    .addTable([
      [{ data: 'Issue', header: true }, { data: 'Route', header: true }, { data: 'Score', header: true }],
      ...routed.map(({ issue, route }) => [
        `#${issue.number} ${issue.title}`,
        route.label,
        String(rankIssue(issue))
      ])
    ])
    .write()
}

module.exports = {
  applyOwnedLabels,
  buildCopilotAssignment,
  classifyIssue,
  chooseCustomAgent,
  chooseRoute,
  computeRequirementFingerprint,
  countUnresolvedCopilotThreads,
  ensureLabels,
  evaluateQaPromotion,
  evaluateReleaseGate,
  filterLocalClosingIssues,
  findMergedClosingPrs,
  hasMaterialRequirementEdit,
  isCopilotReviewAuthor,
  isRoutableIssue,
  isTriageOwnedLabel,
  labelDefinitions,
  normalizeLabelNames,
  planLabelChanges,
  qaBlockMarker,
  rankIssue,
  routeDaily,
  triage,
  upsertMarkerComment
}
