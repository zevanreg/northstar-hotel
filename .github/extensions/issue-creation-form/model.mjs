export const templates = {
  requirement: {
    name: "Product requirement",
    prefix: "[Requirement] ",
    fields: [
      { id: "problem", label: "Problem or opportunity", help: "Who needs what, and why?", required: true },
      { id: "outcome", label: "Desired outcome", help: "Describe the observable product behavior.", required: true },
      { id: "acceptance", label: "Acceptance criteria", help: "Use testable statements, one per line.", required: true },
      { id: "context", label: "Context and constraints", help: "Accessibility needs, data rules, or non-goals." },
      { id: "impact", label: "Business impact", options: ["Normal", "Important", "Blocking"], required: true },
    ],
  },
  bug: {
    name: "Bug report",
    prefix: "[Bug] ",
    fields: [
      { id: "observed", label: "What happened?", required: true },
      { id: "expected", label: "What should happen?", required: true },
      { id: "reproduce", label: "Steps to reproduce", help: "List the steps needed to reproduce the bug.", required: true },
      { id: "evidence", label: "Evidence", help: "Add logs or screenshot links with sensitive data removed." },
      { id: "impact", label: "Impact", options: ["Minor", "Important", "Critical"], required: true },
    ],
  },
};

export class FormError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export function repositoryUrl(remote) {
  const normalized = remote.replace(/^git@([^:]+):/, "https://$1/");
  const url = new URL(normalized);
  if (!["https:", "ssh:"].includes(url.protocol) || url.search || url.hash) {
    throw new FormError("Origin must be an HTTPS or SSH GitHub repository.");
  }
  const path = url.pathname.replace(/\.git$/, "");
  if (!/^\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(path)) {
    throw new FormError("Origin must identify an owner and repository.");
  }
  return `https://${url.protocol === "ssh:" ? url.hostname : url.host}${path}`;
}

export function validateDraft(input, complete = false) {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
    typeof input.type !== "string" || !Object.hasOwn(templates, input.type) ||
    typeof input.title !== "string" || input.title.length > 200 ||
    !input.fields || typeof input.fields !== "object" || Array.isArray(input.fields) ||
    !Number.isSafeInteger(input.revision) || input.revision < 0) {
    throw new FormError("Invalid draft. Choose a template and provide a title, fields, and revision.");
  }
  const template = templates[input.type];
  if (complete && !input.title.trim()) throw new FormError("Enter an issue title.");
  if (Object.keys(input.fields).some((id) => !template.fields.some((field) => field.id === id))) {
    throw new FormError("The draft contains fields from a different template.");
  }
  const fields = {};
  for (const field of template.fields) {
    const value = input.fields[field.id] ?? "";
    if (typeof value !== "string" || value.length > 8000) {
      throw new FormError(`${field.label} must be text of at most 8,000 characters.`);
    }
    if (complete && field.required && !value.trim()) throw new FormError(`Complete ${field.label}.`);
    if (field.options && value && !field.options.includes(value)) {
      throw new FormError(`Choose a valid ${field.label}.`);
    }
    fields[field.id] = value;
  }
  return { type: input.type, title: input.title, fields, revision: input.revision };
}

export function buildIssue(repository, input) {
  const draft = validateDraft(input, true);
  const template = templates[draft.type];
  const title = `${template.prefix}${draft.title.trim()}`;
  const body = template.fields.map((field) => `### ${field.label}\n\n${draft.fields[field.id].trim() || "N/A"}`).join("\n\n");
  const url = new URL(`${repository}/issues/new`);
  url.search = new URLSearchParams({ title, body, labels: "status:new" }).toString();
  if (url.href.length > 8000) {
    throw new FormError("The prefilled GitHub link is too long. Shorten the issue text before reviewing.");
  }
  return { title, body, url: url.href };
}
