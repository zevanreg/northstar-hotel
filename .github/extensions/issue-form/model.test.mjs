import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { forms, createDraftStore, issueContent, prepareIssue } from "./model.mjs";

function complete(kind) {
    return {
        kind, title: "Booking outcome", revision: 0,
        fields: Object.fromEntries(forms[kind].fields.map((field) =>
            [field.id, field.options?.[0] || `Details for ${field.id}`])),
    };
}

for (const kind of Object.keys(forms)) {
    test(`${kind} preserves template headings, choices, and required fields`, async () => {
        const template = await readFile(new URL(`../../ISSUE_TEMPLATE/${kind}.yml`, import.meta.url), "utf8");
        const blocks = template.split(/\n  - type: /).slice(1).filter((block) => !block.startsWith("markdown"));
        assert.deepEqual(forms[kind].fields.map((field) => field.label),
            blocks.map((block) => block.match(/label: (.+)/)[1]));
        for (const [index, field] of forms[kind].fields.entries()) {
            assert.equal(Boolean(field.required), blocks[index].includes("required: true"));
            if (field.options) {
                assert.deepEqual(field.options, [...blocks[index].matchAll(/^\s+- (.+)$/gm)].map((match) => match[1]));
            }
        }
        const draft = complete(kind);
        const { body, title } = issueContent(draft);
        assert.ok(title.startsWith(forms[kind].prefix));
        for (const field of forms[kind].fields) {
            assert.ok(body.includes(`### ${field.label}\n\n${draft.fields[field.id]}`));
            if (field.required) {
                assert.throws(() => issueContent({ ...draft, fields: { ...draft.fields, [field.id]: " " } }),
                    /Complete/);
            }
        }
    });
}

test("review URL encodes content and keeps the intake label without submitting", async () => {
    const draft = complete("bug");
    draft.fields.observed = "Dates & <script>literal text</script>\nNew line #1";
    const result = await prepareIssue(new URL("../../../", import.meta.url), draft);
    const url = new URL(result.url);
    assert.ok(url.pathname.endsWith("/issues/new"));
    assert.equal(url.searchParams.get("body"), result.body);
    assert.equal(url.searchParams.get("labels"), "status:new");
    assert.equal(url.searchParams.get("title"), result.title);
    await assert.rejects(prepareIssue(new URL("../../../", import.meta.url), {
        ...draft, fields: { ...draft.fields, observed: "&".repeat(3000) },
    }), /too long/);
});

test("rejects invalid impact, blank titles, and unknown fields", () => {
    const draft = complete("bug");
    assert.throws(() => issueContent({ ...draft, title: " " }), /title/);
    assert.throws(() => issueContent({ ...draft, fields: { ...draft.fields, impact: "Blocking" } }), /impact/);
    assert.throws(() => issueContent({ ...draft, fields: { ...draft.fields, unknown: "x" } }), /unknown/);
});

test("drafts survive store recreation, reject stale writes, and recover after errors", async () => {
    const directory = await mkdtemp(join(tmpdir(), "northstar-issue-form-"));
    try {
        const store = createDraftStore(directory);
        const initial = await store.read("work-item");
        const saved = await store.save("work-item", { ...initial, title: "Partial draft" });
        assert.deepEqual(await createDraftStore(directory).read("work-item"), saved);
        await assert.rejects(store.save("work-item", initial), /another panel/);
        const next = await store.save("work-item", saved);
        assert.equal(next.revision, 2);
        await assert.rejects(store.read("../escape"), /Invalid draft ID/);
        const results = await Promise.allSettled([
            store.save("work-item", next), store.save("work-item", next),
        ]);
        assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
        assert.equal(results.filter((result) => result.status === "rejected").length, 1);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
