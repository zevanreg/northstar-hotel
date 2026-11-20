import { buildIssue } from "./model.mjs";

const form = document.querySelector("#issue-form");
const status = document.querySelector("#status");
const preview = document.querySelector("#preview");
const type = document.querySelector("#type");
const title = document.querySelector("#title");
const fieldContainer = document.querySelector("#fields");
let state;
let dirty = false;
let activeType;

function message(text, error = false) {
  status.textContent = text;
  status.dataset.error = String(error);
}

async function request(path, options) {
  const response = await fetch(new URL(path, location.href), options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data;
}

function renderFields(values = {}) {
  fieldContainer.replaceChildren();
  for (const field of state.templates[type.value].fields) {
    const label = document.createElement("label");
    label.htmlFor = field.id;
    label.textContent = field.label + (field.required ? " (required)" : "");
    const input = document.createElement(field.options ? "select" : "textarea");
    input.id = field.id;
    input.name = field.id;
    input.required = Boolean(field.required);
    if (field.options) {
      for (const value of ["", ...field.options]) {
        input.add(new Option(value || "Select impact", value));
      }
    } else {
      input.maxLength = 8000;
    }
    input.value = values[field.id] ?? "";
    fieldContainer.append(label, input);
    if (field.help) {
      const help = document.createElement("p");
      help.id = `${field.id}-help`;
      help.className = "hint";
      help.textContent = field.help;
      input.setAttribute("aria-describedby", help.id);
      fieldContainer.append(help);
    }
  }
}

function draft() {
  return {
    type: type.value,
    title: title.value,
    fields: Object.fromEntries(state.templates[type.value].fields.map((field) => [field.id, form.elements.namedItem(field.id).value])),
    revision: state.draft.revision,
  };
}

async function save(review) {
  const input = draft();
  const issue = review ? buildIssue(state.repository, input) : undefined;
  const buttons = form.querySelectorAll("button");
  buttons.forEach((button) => { button.disabled = true; });
  // Keep the submitted snapshot stable until the optimistic save completes.
  const controls = form.querySelectorAll("input, textarea, select");
  controls.forEach((control) => { control.disabled = true; });
  try {
    state.draft = await request("draft", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    dirty = false;
    message("Draft saved in this session. No issue has been created.");
    if (issue) {
      document.querySelector("#preview-title").textContent = issue.title;
      document.querySelector("#preview-body").textContent = issue.body;
      document.querySelector("#github").href = issue.url;
      preview.hidden = false;
      document.querySelector("#github").focus();
    }
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
    controls.forEach((control) => { control.disabled = false; });
  }
}

form.addEventListener("input", (event) => {
  if (event.target === type) return;
  dirty = true;
  preview.hidden = true;
  message("Unsaved changes.");
});
type.addEventListener("change", () => {
  const hasContent = [...fieldContainer.querySelectorAll("textarea, select")].some((input) => input.value.trim());
  if (hasContent && !confirm("Change template and clear the current fields?")) {
    type.value = activeType;
    return;
  }
  activeType = type.value;
  renderFields();
  dirty = true;
  preview.hidden = true;
  message("Template changed. Save to keep this draft.");
});
document.querySelector("#save").addEventListener("click", () => save(false).catch((error) => message(error.message, true)));
form.addEventListener("submit", (event) => {
  event.preventDefault();
  save(true).catch((error) => message(error.message, true));
});
window.addEventListener("beforeunload", (event) => {
  if (dirty) event.preventDefault();
});

try {
  state = await request("state");
  document.querySelector("#repository").textContent = state.repository;
  type.value = state.draft.type;
  activeType = type.value;
  title.value = state.draft.title;
  renderFields(state.draft.fields);
  form.hidden = false;
  message(state.draft.revision ? "Saved draft restored." : "Choose a template to get started.");
} catch (error) {
  message(`${error.message} Reopen the canvas to retry.`, true);
}
