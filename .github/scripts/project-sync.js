async function findProject(github, ownerType, login, projectNumber) {
  const ownerField = ownerType === 'user' ? 'user' : 'organization'
  const query = `query($login: String!, $number: Int!) {
    ${ownerField}(login: $login) {
      projectV2(number: $number) {
        id
        fields(first: 50) {
          nodes {
            ... on ProjectV2SingleSelectField {
              id
              name
              options { id name }
            }
          }
        }
      }
    }
  }`
  const result = await github.graphql(query, { login, number: Number(projectNumber) })
  return result[ownerField]?.projectV2
}

function desiredStatus(labelNames) {
  if (labelNames.includes('released')) return 'Done'
  if (labelNames.includes('ready-for-qa')) return 'QA'
  if (labelNames.includes('develop-with-ai')) return 'In progress'
  if (labelNames.includes('ready-for-building')) return 'Ready'
  if (labelNames.includes('status:triaged')) return 'Triage'
  return 'Backlog'
}

async function syncProject({
  github,
  context,
  core,
  ownerType,
  projectOwner,
  projectNumber,
  issue = context.payload.issue
}) {
  const project = await findProject(github, ownerType, projectOwner, projectNumber)
  if (!project) throw new Error(`Project ${projectOwner}/${projectNumber} was not found.`)

  const addResult = await github.graphql(`mutation($project: ID!, $content: ID!) {
    addProjectV2ItemById(input: { projectId: $project, contentId: $content }) {
      item { id }
    }
  }`, {
    project: project.id,
    content: issue.node_id
  })

  const statusField = project.fields.nodes.find((field) => field?.name === 'Status')
  const labels = issue.labels.map((label) => typeof label === 'string' ? label : label.name)
  const statusName = desiredStatus(labels)
  const statusOption = statusField?.options.find((option) =>
    option.name.toLowerCase() === statusName.toLowerCase())

  if (!statusField || !statusOption) {
    core.warning(`Project item added, but Status option "${statusName}" is missing.`)
    return
  }

  await github.graphql(`mutation($project: ID!, $item: ID!, $field: ID!, $option: String!) {
    updateProjectV2ItemFieldValue(input: {
      projectId: $project
      itemId: $item
      fieldId: $field
      value: { singleSelectOptionId: $option }
    }) {
      projectV2Item { id }
    }
  }`, {
    project: project.id,
    item: addResult.addProjectV2ItemById.item.id,
    field: statusField.id,
    option: statusOption.id
  })

  core.notice(`Project status set to ${statusName}.`)
}

module.exports = { desiredStatus, syncProject }
