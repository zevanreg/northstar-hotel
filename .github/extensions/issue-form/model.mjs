import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Keep field labels, order, and choices aligned with .github/ISSUE_TEMPLATE.
export const forms = {
    requirement: {
        name: "Product requirement", prefix: "[Requirement] ",
        fields: [
            { id: "problem", label: "Problem or opportunity", required: true, hint: "Who needs what, and why?" },
            { id: "outcome", label: "Desired outcome", required: true, hint: "Describe observable product behavior." },
            { id: "acceptance", label: "Acceptance criteria", required: true, hint: "Use testable statements, one per line." },
            { id: "context", label: "Context and constraints", hint: "Accessibility, data rules, and non-goals." },
            { id: "impact", label: "Business impact", required: true, options: ["Normal", "Important", "Blocking"] },
        ],
    },
    bug: {
        name: "Bug report", prefix: "[Bug] ",
        fields: [
            { id: "observed", label: "What happened?", required: true },
            { id: "expected", label: "What should happen?", required: true },
            { id: "reproduce", label: "Steps to reproduce", required: true, hint: "Number the steps needed to reproduce the bug." },
            { id: "evidence", label: "Evidence", hint: "Logs or screenshot links with sensitive data removed." },
            { id: "impact", label: "Impact", required: true, options: ["Minor", "Important", "Critical"] },
        ],
    },
};

export const draftSchema = {
    type: "object",
    properties: {
        kind: { type: "string", enum: Object.keys(forms) },
        title: { type: "string", maxLength: 200 },
        fields: {
            type: "object",
            properties: Object.fromEntries([...new Set(Object.values(forms).flatMap(
                (form) => form.fields.map((field) => field.id),
            ))].map((id) => [id, { type: "string", maxLength: 8000 }])),
            additionalProperties: false,
        },
        revision: { type: "integer", minimum: 0 },
    },
    required: ["kind", "title", "fields", "revision"],
    additionalProperties: false,
};

function fail(message, code = "invalid_draft") {
    throw Object.assign(new Error(message), { code });
}

export function validateDraft(draft, complete = false) {
    if (!draft || !Object.hasOwn(forms, draft.kind) || typeof draft.title !== "string" ||
        draft.title.length > 200 || !Number.isSafeInteger(draft.revision) || draft.revision < 0 ||
        !draft.fields || typeof draft.fields !== "object" || Array.isArray(draft.fields) ||
        Object.keys(draft).some((key) => !Object.hasOwn(draftSchema.properties, key))) {
        fail("Invalid issue draft.");
    }
    const form = forms[draft.kind];
    for (const [id, value] of Object.entries(draft.fields)) {
        const field = form.fields.find((item) => item.id === id);
        if (!field || typeof value !== "string" || value.length > 8000 ||
            (field.options && value.trim() !== "" && !field.options.includes(value))) {
            fail(`Invalid value for ${id}.`);
        }
    }
    if (complete) {
        if (!draft.title.trim()) fail("Enter an issue title.");
        for (const field of form.fields) {
            if (field.required && !draft.fields[field.id]?.trim()) fail(`Complete "${field.label}".`);
        }
    }
    return draft;
}

export function issueContent(draft) {
    validateDraft(draft, true);
    const form = forms[draft.kind];
    const title = draft.title.startsWith(form.prefix) ? draft.title.trim() : form.prefix + draft.title.trim();
    const body = form.fields.map((field) =>
        `### ${field.label}\n\n${draft.fields[field.id]?.trim() || "_No response_"}`
    ).join("\n\n");
    return { title, body };
}

export async function prepareIssue(repositoryRoot, draft) {
    const content = issueContent(draft);
    const { stdout } = await promisify(execFile)("git", ["remote", "get-url", "origin"], {
        cwd: repositoryRoot, windowsHide: true,
    });
    const remote = stdout.trim().replace(/^git@([^:]+):/, "https://$1/");
    const url = new URL(remote);
    if (url.protocol !== "https:" || url.hostname !== "github.com" ||
        !/^\/[^/]+\/[^/]+$/.test(url.pathname) || url.username || url.password) {
        fail("The origin remote must identify a GitHub.com repository.");
    }
    url.pathname = url.pathname.replace(/\.git$/, "") + "/issues/new";
    url.search = "";
    url.hash = "";
    url.searchParams.set("title", content.title);
    url.searchParams.set("body", content.body);
    url.searchParams.set("labels", "status:new");
    if (url.href.length > 8000) fail("This draft is too long for a GitHub review link. Shorten it before preparing.");
    return { ...content, url: url.href };
}

export function createDraftStore(directory) {
    let pending = Promise.resolve();
    function path(draftId) {
        if (typeof draftId !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(draftId)) {
            fail("Invalid draft ID.");
        }
        return join(directory, `${draftId}.json`);
    }
    async function read(draftId) {
        try {
            return validateDraft(JSON.parse(await readFile(path(draftId), "utf8")));
        } catch (error) {
            if (error.code !== "ENOENT") throw error;
            return { kind: "requirement", title: "", fields: {}, revision: 0 };
        }
    }
    return {
        read,
        save(draftId, draft) {
            const operation = pending.then(async () => {
                validateDraft(draft);
                const previous = await read(draftId);
                if (draft.revision !== previous.revision) {
                    fail("This draft changed in another panel. Reload before saving.", "draft_conflict");
                }
                const saved = { ...draft, revision: draft.revision + 1 };
                const filename = path(draftId);
                await mkdir(directory, { recursive: true });
                await writeFile(`${filename}.tmp`, JSON.stringify(saved, null, 2), "utf8");
                await rename(`${filename}.tmp`, filename);
                return saved;
            });
            // A rejected save must not poison the queue for subsequent saves.
            pending = operation.catch(() => {});
            return operation;
        },
    };
}
