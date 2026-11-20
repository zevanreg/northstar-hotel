const form = document.querySelector("#issue");
const status = document.querySelector("#status");
const kind = document.querySelector("#kind");
const title = document.querySelector("#title");
const fields = document.querySelector("#fields");
const review = document.querySelector("#review");
let forms;
let draft;
let dirty = false;

async function request(route, data) {
    const response = await fetch(route, data === undefined ? {} : {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    return result;
}

function collect() {
    return {
        kind: kind.value, title: title.value, revision: draft.revision,
        fields: Object.fromEntries(forms[kind.value].fields.map((field) =>
            [field.id, document.getElementById(field.id).value])),
    };
}

function renderFields() {
    fields.replaceChildren();
    for (const field of forms[kind.value].fields) {
        const label = document.createElement("label");
        label.htmlFor = field.id;
        label.textContent = field.label + (field.required ? " *" : "");
        const input = document.createElement(field.options ? "select" : "textarea");
        input.id = field.id;
        input.name = field.id;
        input.required = Boolean(field.required);
        if (field.options) {
            for (const text of ["", ...field.options]) {
                const option = document.createElement("option");
                option.value = text;
                option.textContent = text || "Choose impact";
                input.append(option);
            }
        } else {
            input.rows = field.id === "acceptance" || field.id === "reproduce" ? 5 : 3;
            input.maxLength = 8000;
        }
        input.value = draft.fields[field.id] || "";
        fields.append(label, input);
        if (field.hint) {
            const hint = document.createElement("p");
            hint.id = `${field.id}-hint`;
            hint.className = "hint";
            hint.textContent = field.hint;
            input.setAttribute("aria-describedby", hint.id);
            fields.append(hint);
        }
    }
}

function markDirty() {
    dirty = true;
    review.hidden = true;
    status.textContent = "Unsaved changes. Save a local draft to keep them across reloads.";
}

async function run(action) {
    const controls = form.querySelectorAll("input, select, textarea, button");
    controls.forEach((control) => { control.disabled = true; });
    try { await action(); }
    catch (error) { status.textContent = error.message; }
    finally { controls.forEach((control) => { control.disabled = false; }); }
}

form.addEventListener("input", markDirty);
kind.addEventListener("change", () => {
    if (!window.confirm("Switch issue type? This clears the current fields. Saved drafts are unchanged until you save again.")) {
        kind.value = draft.kind;
        return;
    }
    draft = { ...draft, kind: kind.value, fields: {} };
    renderFields();
    markDirty();
});
document.querySelector("#save").addEventListener("click", () => run(async () => {
    draft = await request("save", collect());
    dirty = false;
    status.textContent = "Draft saved locally for this session. Nothing has been submitted.";
}));
form.addEventListener("submit", (event) => {
    event.preventDefault();
    run(async () => {
        const result = await request("prepare", collect());
        document.querySelector("#preview").textContent = `${result.title}\n\n${result.body}`;
        document.querySelector("#github").href = result.url;
        review.hidden = false;
        status.textContent = "Ready for review. GitHub submission is a separate, manual step.";
    });
});
window.addEventListener("beforeunload", (event) => {
    if (dirty) { event.preventDefault(); event.returnValue = ""; }
});

run(async () => {
    const state = await request("state");
    forms = state.forms;
    draft = state.draft;
    for (const [id, definition] of Object.entries(forms)) {
        const option = document.createElement("option");
        option.value = id;
        option.textContent = definition.name;
        kind.append(option);
    }
    kind.value = draft.kind;
    title.value = draft.title;
    renderFields();
    form.hidden = false;
    status.textContent = draft.revision ? "Saved draft loaded." : "New local draft. Nothing is sent to GitHub until you follow the review link.";
});
