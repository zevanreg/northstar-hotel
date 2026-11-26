const test = require('node:test')
const assert = require('node:assert/strict')
const {
  buildCopilotAssignment,
  chooseCustomAgent,
  computeRequirementFingerprint,
  evaluateQaPromotion,
  evaluateReleaseGate,
  filterLocalClosingIssues,
  findMergedClosingPrs,
  hasMaterialRequirementEdit,
  planLabelChanges
} = require('./issue-automation')
const { desiredStatus } = require('./project-sync')

test('selects custom agents from classified work areas', () => {
  assert.equal(chooseCustomAgent(['area:frontend']), 'frontend')
  assert.equal(chooseCustomAgent(['area:full-stack']), 'fullstack')
  assert.equal(chooseCustomAgent(['area:documentation']), 'documentation')
  assert.equal(chooseCustomAgent(['kind:docs']), 'documentation')
  assert.equal(chooseCustomAgent(['area:backend', 'kind:logging']), 'clean-code')
})

test('builds a valid Copilot assignment with a custom agent', () => {
  assert.deepEqual(
    buildCopilotAssignment('owner/repository', 'frontend'),
    {
      assignees: ['copilot-swe-agent[bot]'],
      agent_assignment: {
        target_repo: 'owner/repository',
        base_branch: 'main',
        custom_instructions: 'Follow all repository instructions and skills. Implement the issue, update documentation, add tests, run validation, and open a pull request.',
        custom_agent: 'frontend'
      }
    }
  )
})

test('omits an empty custom agent from the Copilot assignment', () => {
  const payload = buildCopilotAssignment('owner/repository')

  assert.equal(payload.agent_assignment.custom_agent, undefined)
})

test('keeps release-approved work in QA until release succeeds', () => {
  assert.equal(
    desiredStatus(['ready-for-qa', 'release-to-production']),
    'QA'
  )
  assert.equal(
    desiredStatus(['ready-for-qa', 'release-to-production', 'released']),
    'Done'
  )
})

test('plans owned QA label changes without touching unrelated labels', () => {
  const plan = planLabelChanges(
    ['status:triaged', 'ready-for-building', 'develop-with-ai', 'custom:keep'],
    ['ready-for-qa'],
    (name) => name === 'ready-for-qa' || name === 'develop-with-ai'
  )

  assert.deepEqual(plan.toAdd, ['ready-for-qa'])
  assert.deepEqual(plan.toRemove, ['develop-with-ai'])
})

test('detects material requirement edits and changes fingerprint', () => {
  const before = computeRequirementFingerprint('Title A', 'Body A')
  const after = computeRequirementFingerprint('Title A', 'Body B')

  assert.notEqual(before, after)
  assert.equal(hasMaterialRequirementEdit({ body: { from: 'Body A' } }, 'Title A', 'Body B'), true)
  assert.equal(hasMaterialRequirementEdit({ body: { from: 'Body A' } }, 'Title A', 'Body A'), false)
  assert.equal(hasMaterialRequirementEdit({}, 'Title A', 'Body A'), false)
})

test('filters closing issue references strictly to the local repository', () => {
  const local = filterLocalClosingIssues(
    [
      { number: 5, repository: { nameWithOwner: 'other-org/other-repo' } },
      { number: 12, repository: { nameWithOwner: 'zevanreg/northstar-hotel' } },
      { number: 12, repository: { nameWithOwner: 'ZEVANREG/NORTHSTAR-HOTEL' } },
      { number: 18, repository: { owner: { login: 'zevanreg' }, name: 'northstar-hotel' } }
    ],
    'zevanreg',
    'northstar-hotel'
  )

  assert.deepEqual(local, [12, 18])
})

test('blocks QA promotion for stale reviews, unresolved Copilot threads, or failed checks', () => {
  const headSha = 'aaaaaaa111111111111111111111111111111111'
  const oldSha = 'bbbbbbb222222222222222222222222222222222'
  const openPr = { state: 'OPEN', isDraft: false, headRefOid: headSha }
  const passingChecks = [
    { name: 'validate', head_sha: headSha, status: 'completed', conclusion: 'success', started_at: '2026-11-26T10:00:00Z' }
  ]
  const copilotUser = { type: 'Bot', login: 'copilot-pull-request-reviewer[bot]' }

  const staleReview = evaluateQaPromotion({
    pr: openPr,
    reviews: [{ user: copilotUser, commit_id: oldSha, state: 'COMMENTED', submitted_at: '2026-11-26T10:01:00Z' }],
    checkRuns: passingChecks,
    reviewThreads: []
  })
  assert.equal(staleReview.eligible, false)

  const unresolvedThread = evaluateQaPromotion({
    pr: openPr,
    reviews: [{ user: copilotUser, commit_id: headSha, state: 'COMMENTED', submitted_at: '2026-11-26T10:02:00Z' }],
    checkRuns: passingChecks,
    reviewThreads: [
      { isResolved: false, isOutdated: false, comments: { nodes: [{ author: { login: 'copilot-pull-request-reviewer' } }] } }
    ]
  })
  assert.equal(unresolvedThread.eligible, false)
  assert.equal(unresolvedThread.unresolvedThreads, 1)

  const requestedChanges = evaluateQaPromotion({
    pr: openPr,
    reviews: [{ user: copilotUser, commit_id: headSha, state: 'CHANGES_REQUESTED', submitted_at: '2026-11-26T10:03:00Z' }],
    checkRuns: passingChecks,
    reviewThreads: []
  })
  assert.equal(requestedChanges.eligible, false)

  const failedCheck = evaluateQaPromotion({
    pr: openPr,
    reviews: [{ user: copilotUser, commit_id: headSha, state: 'COMMENTED', submitted_at: '2026-11-26T10:03:00Z' }],
    checkRuns: [{ name: 'validate', head_sha: headSha, status: 'completed', conclusion: 'failure', started_at: '2026-11-26T10:00:00Z' }],
    reviewThreads: []
  })
  assert.equal(failedCheck.eligible, false)
})

test('allows QA promotion when current head SHA passes validate and Copilot threads are resolved', () => {
  const headSha = 'aaaaaaa111111111111111111111111111111111'
  const result = evaluateQaPromotion({
    pr: { state: 'OPEN', isDraft: false, headRefOid: headSha },
    reviews: [
      { user: { type: 'Bot', login: 'copilot-pull-request-reviewer[bot]' }, commit_id: headSha, state: 'COMMENTED', submitted_at: '2026-11-26T10:02:00Z' }
    ],
    checkRuns: [
      { name: 'validate', head_sha: headSha, status: 'completed', conclusion: 'success', started_at: '2026-11-26T10:00:00Z' }
    ],
    reviewThreads: [
      { isResolved: true, isOutdated: false, comments: { nodes: [{ author: { login: 'copilot-pull-request-reviewer' } }] } },
      { isResolved: false, isOutdated: true, comments: { nodes: [{ author: { login: 'Copilot' } }] } }
    ]
  })

  assert.equal(result.eligible, true)
  assert.equal(result.headSha, headSha)
})

test('rejects premature release gate and requires merged local closing PR on main', () => {
  assert.equal(evaluateReleaseGate(['release-to-production']).approved, false)
  assert.equal(evaluateReleaseGate(['ready-for-qa']).approved, false)
  assert.equal(evaluateReleaseGate(['ready-for-qa', 'release-to-production']).approved, true)

  const merged = findMergedClosingPrs({
    closedByPrs: [
      { number: 9, merged: false, baseRefName: 'main', mergeCommit: null, repository: { nameWithOwner: 'zevanreg/northstar-hotel' } },
      { number: 10, merged: true, baseRefName: 'develop', mergeCommit: { oid: '111' }, repository: { nameWithOwner: 'zevanreg/northstar-hotel' } },
      { number: 11, merged: true, baseRefName: 'main', mergeCommit: { oid: '222' }, repository: { nameWithOwner: 'other/repo' } },
      { number: 12, merged: true, baseRefName: 'main', mergeCommit: { oid: '333' }, repository: { nameWithOwner: 'zevanreg/northstar-hotel' } }
    ],
    closedEvents: [
      { closer: { number: 12, merged: true, baseRefName: 'main', mergeCommit: { oid: '333' }, repository: { nameWithOwner: 'zevanreg/northstar-hotel' } } }
    ],
    owner: 'zevanreg',
    repo: 'northstar-hotel',
    baseBranch: 'main'
  })

  assert.deepEqual(merged, [{ number: 12, mergeCommitSha: '333', url: '' }])
})
