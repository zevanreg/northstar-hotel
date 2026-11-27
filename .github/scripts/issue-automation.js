const crypto = require('node:crypto')
const labelDefinitions = require('../labels.json')

const qaBlockMarker = '<!-- minihack-qa-status -->'

function normalizeLabelNames(labels = []) {
  return labels.map((label) => typeof label === 'string' ? label : label.name)
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

function isCopilotLogin(user) {
  const login = (typeof user === 'string' ? user : user?.login || '').toLowerCase()
  return login === 'copilot' || login === 'copilot-swe-agent[bot]' || login.startsWith('copilot-swe-agent')
}

function evaluateCopilotDraftReadiness({ pr, timelineEvents = [], checkRuns = [], owner, repo }) {
  if (!pr) {
    return { ready: false, reason: 'Pull request details were not found.' }
  }

  const state = (pr.state || '').toUpperCase()
  const isDraft = Boolean(pr.isDraft ?? pr.draft)
  const headSha = pr.headRefOid || pr.head?.sha || ''
  const headRef = pr.headRefName || pr.head?.ref || ''
  const headRepo = (
    pr.headRepository?.nameWithOwner
    || pr.head?.repo?.full_name
    || ''
  ).toLowerCase()
  const expectedRepo = `${owner}/${repo}`.toLowerCase()

  if (state !== 'OPEN') {
    return { ready: false, headSha, reason: `Pull request is ${state.toLowerCase()}, not open.` }
  }
  if (!isDraft) {
    return { ready: false, headSha, reason: 'Pull request is already ready for review.' }
  }
  if (!headRepo || headRepo !== expectedRepo) {
    return { ready: false, headSha, reason: 'Pull request is not from the same repository.' }
  }

  const assignedToCopilot = Array.isArray(pr.assignees) && pr.assignees.some(isCopilotLogin)
  if (!headRef.startsWith('copilot/') && !assignedToCopilot) {
    return { ready: false, headSha, reason: 'Pull request is not a Copilot cloud agent pull request.' }
  }

  if (/^\s*\[wip\]/i.test(pr.title || '')) {
    return { ready: false, headSha, reason: 'Pull request title still starts with [WIP].' }
  }

  if (!headSha) {
    return { ready: false, headSha, reason: 'Pull request head commit SHA is missing.' }
  }

  let latestStartedMs = -1
  let latestFinishedMs = -1
  for (const event of timelineEvents) {
    if (!event) continue
    const ts = Date.parse(event.created_at || event.createdAt || '')
    if (Number.isNaN(ts)) continue
    if (event.event === 'copilot_work_started' && ts > latestStartedMs) {
      latestStartedMs = ts
    } else if (event.event === 'copilot_work_finished' && ts > latestFinishedMs) {
      latestFinishedMs = ts
    }
  }

  if (latestFinishedMs < 0) {
    return { ready: false, headSha, reason: 'Copilot cloud agent has not emitted copilot_work_finished yet.' }
  }
  if (latestStartedMs >= 0 && latestFinishedMs <= latestStartedMs) {
    return { ready: false, headSha, reason: 'Copilot cloud agent still has an active work session.' }
  }

  const matchingValidateRuns = checkRuns
    .filter((run) => run?.name === 'validate' && (!run.head_sha || run.head_sha === headSha))
    .sort((left, right) => Date.parse(left.started_at || 0) - Date.parse(right.started_at || 0))
  const latestValidate = matchingValidateRuns[matchingValidateRuns.length - 1]

  if (!latestValidate || latestValidate.status !== 'completed') {
    return { ready: false, headSha, reason: `The validate check has not completed for head commit ${headSha.slice(0, 7)}.` }
  }
  if (latestValidate.conclusion !== 'success') {
    return { ready: false, headSha, reason: `The validate check concluded with ${latestValidate.conclusion} for head commit ${headSha.slice(0, 7)}.` }
  }

  return {
    ready: true,
    headSha,
    reason: `Copilot finished work and validate passed for head commit ${headSha.slice(0, 7)}.`
  }
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

module.exports = {
  applyOwnedLabels,
  buildCopilotAssignment,
  chooseCustomAgent,
  computeRequirementFingerprint,
  countUnresolvedCopilotThreads,
  ensureLabels,
  evaluateCopilotDraftReadiness,
  evaluateQaPromotion,
  evaluateReleaseGate,
  filterLocalClosingIssues,
  findMergedClosingPrs,
  hasMaterialRequirementEdit,
  isCopilotReviewAuthor,
  labelDefinitions,
  normalizeLabelNames,
  planLabelChanges,
  qaBlockMarker,
  upsertMarkerComment
}
