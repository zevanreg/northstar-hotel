const test = require('node:test')
const assert = require('node:assert/strict')
const {
  buildCopilotAssignment,
  classifyIssue,
  chooseCustomAgent,
  chooseRoute,
  rankIssue
} = require('./issue-automation')
const { desiredStatus } = require('./project-sync')

test('classifies cross-stack database requirements as high complexity', () => {
  const result = classifyIssue(
    'Add a guest booking amendment screen',
    `Update the React page and the .NET API. Persist changes to the database.

- [ ] Guest can change dates
- [ ] API rejects conflicts
- [ ] Database is updated
- [ ] UI displays validation`
  )

  assert.equal(result.area, 'area:full-stack')
  assert.equal(result.complexity, 'complexity:high')
})

test('routes a low complexity frontend feature to Copilot on GitHub', () => {
  const route = chooseRoute([
    'area:frontend',
    'kind:feature',
    'complexity:low',
    'priority:p3'
  ])

  assert.equal(route.label, 'agent:copilot-app')
})

test('routes scripts to Copilot CLI', () => {
  const route = chooseRoute([
    'area:automation',
    'kind:script',
    'complexity:medium'
  ])

  assert.equal(route.label, 'agent:copilot-cli')
})

test('does not classify description text as a script', () => {
  const result = classifyIssue(
    '[Requirement] Add hotel highlights to the home page',
    'The page needs a hotel description, customer reviews, awards, highlights, and more visual detail.'
  )

  assert.equal(result.area, 'area:frontend')
  assert.equal(result.kind, 'kind:feature')
})

test('selects custom agents from classified work areas', () => {
  assert.equal(chooseCustomAgent(['area:frontend']), 'frontend')
  assert.equal(chooseCustomAgent(['area:full-stack']), 'fullstack')
  assert.equal(chooseCustomAgent(['area:documentation']), 'documentation')
  assert.equal(chooseCustomAgent(['kind:docs']), 'documentation')
  assert.equal(chooseCustomAgent(['area:backend', 'kind:logging']), 'clean-code')
})

test('routes documentation work to the cloud documentation agent', () => {
  const route = chooseRoute([
    'area:documentation',
    'kind:docs',
    'complexity:low'
  ])

  assert.equal(route.label, 'agent:cloud')
  assert.equal(route.customAgent, 'documentation')
})

test('routes bounded backend work to the cloud clean-code agent', () => {
  const route = chooseRoute([
    'area:backend',
    'kind:logging',
    'complexity:low'
  ])

  assert.equal(route.label, 'agent:cloud')
  assert.equal(route.customAgent, 'clean-code')
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

test('ranks urgent issues above normal issues', () => {
  const now = new Date().toISOString()
  const p1 = { labels: [{ name: 'priority:p1' }, { name: 'complexity:low' }], created_at: now }
  const p3 = { labels: [{ name: 'priority:p3' }, { name: 'complexity:high' }], created_at: now }

  assert.ok(rankIssue(p1) > rankIssue(p3))
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
