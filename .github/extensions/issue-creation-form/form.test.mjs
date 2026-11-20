import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildIssue, repositoryUrl, templates, validateDraft } from "./model.mjs";
import { createDraftStore } from "./store.mjs";
import { startServer } from "./server.mjs";

const repository = "https://github.example/workshop/hotel";
const requirement = {
  type: "requirement",
  title: "Keep adjacent stays available & accessible",
  fields: {
    problem: "Guests need consecutive stays.",
    outcome: "Adjacent stays can be booked.",
    acceptance: "- [ ] Check-out and check-in can share a day.",
    context: "",
    impact: "Normal",
  },
  revision: 0,
};

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "issue-form-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, store: createDraftStore(directory) };
}

test("requirement links preserve all template sections, checkboxes, and lifecycle label", () => {
  const issue = buildIssue(repository, requirement);
  const url = new URL(issue.url);
  assert.equal(url.origin + url.pathname, `${repository}/issues/new`);
  assert.equal(url.searchParams.get("title"), "[Requirement] " + requirement.title);
  assert.equal(url.searchParams.get("body"), issue.body);
  assert.equal(url.searchParams.get("labels"), "status:new");
  assert.match(issue.body, /### Acceptance criteria\n\n- \[ \] Check-out/);
  assert.match(issue.body, /### Context and constraints\n\nN\/A/);
});

test("bug reports validate required fields and impact", () => {
  const bug = {
    type: "bug", title: "Booking fails", revision: 0,
    fields: { observed: "Error", expected: "Confirmation", reproduce: "1. Book a room", evidence: "<script>alert(1)</script>", impact: "Critical" },
  };
  const issue = buildIssue(repository, bug);
  assert.equal(issue.title, "[Bug] Booking fails");
  assert.match(issue.body, /### Evidence\n\n<script>alert\(1\)<\/script>/);
  assert.throws(() => buildIssue(repository, { ...bug, fields: { ...bug.fields, impact: "Normal" } }), /valid Impact/);
  assert.throws(() => buildIssue(repository, { ...bug, fields: { ...bug.fields, expected: " " } }), /What should happen/);
});

test("partial drafts can be saved but cannot become issue links", () => {
  const partial = { type: "requirement", title: "", fields: {}, revision: 0 };
  assert.equal(validateDraft(partial).fields.problem, "");
  assert.throws(() => buildIssue(repository, partial), /title/);
  assert.throws(() => validateDraft({ ...partial, type: ["bug"] }), /Invalid draft/);
  assert.throws(() => validateDraft({ ...partial, fields: { observed: "Wrong template" } }), /different template/);
  assert.throws(() => validateDraft({ ...partial, fields: { problem: 12 } }), /must be text/);
});

test("prefilled URLs encode issue text without adding query parameters", () => {
  const issue = buildIssue(repository, { ...requirement, title: "Room #2? labels=admin & café" });
  const url = new URL(issue.url);
  assert.deepEqual([...url.searchParams.keys()], ["title", "body", "labels"]);
  assert.equal(url.hash, "");
  assert.equal(url.searchParams.get("title"), "[Requirement] Room #2? labels=admin & café");
});

test("oversized encoded issue URLs fail explicitly rather than opening a broken link", () => {
  assert.throws(() => buildIssue(repository, {
    ...requirement, fields: { ...requirement.fields, context: "&".repeat(3000) },
  }), /link is too long/);
});

test("GitHub repository URLs are derived from supported origin formats", () => {
  assert.equal(repositoryUrl("git@github.example:workshop/hotel.git"), repository);
  assert.equal(repositoryUrl("ssh://git@github.example:22/workshop/hotel.git"), repository);
  assert.equal(repositoryUrl("https://github.example/workshop/hotel.git"), repository);
  assert.throws(() => repositoryUrl("file:///tmp/hotel"), /HTTPS or SSH/);
  assert.throws(() => repositoryUrl("https://github.example/workshop/hotel/extra"), /owner and repository/);
});

test("canvas field definitions stay aligned with the repository's issue forms", async () => {
  for (const [type, template] of Object.entries(templates)) {
    const yaml = await readFile(new URL(`../../ISSUE_TEMPLATE/${type}.yml`, import.meta.url), "utf8");
    const fields = [...yaml.matchAll(/    id: ([^\r\n]+)\r?\n([\s\S]*?)(?=  - type:|$)/g)];
    assert.deepEqual(fields.map((match) => match[1]), template.fields.map((field) => field.id));
    for (const [index, field] of template.fields.entries()) {
      const block = fields[index][2];
      assert.equal(block.match(/      label: ([^\r\n]+)/)[1], field.label);
      assert.equal(/      required: true/.test(block), Boolean(field.required));
      const optionBlock = block.match(/      options:\r?\n((?:        - [^\r\n]+\r?\n?)+)/)?.[1] ?? "";
      const options = [...optionBlock.matchAll(/        - ([^\r\n]+)/g)].map((match) => match[1]);
      assert.deepEqual(options, field.options ?? []);
    }
    assert.ok(yaml.includes(`title: "${template.prefix}"`));
    assert.ok(yaml.includes('labels: ["status:new"]'));
  }
});

test("drafts survive a fresh store and are keyed by draft ID, not panel ID", async (t) => {
  const { directory, store } = await fixture(t);
  const saved = await store.save("feature-one", requirement);
  assert.equal(saved.revision, 1);
  assert.deepEqual(await createDraftStore(directory).read("feature-one"), saved);
  assert.equal((await store.read("feature-two")).title, "");
  await assert.rejects(store.read("../escape"), /Invalid draft ID/);
});

test("concurrent stale saves cannot overwrite a draft and do not poison later saves", async (t) => {
  const { store } = await fixture(t);
  const first = store.save("shared", requirement);
  const second = store.save("shared", { ...requirement, title: "Stale edit" });
  await first;
  await assert.rejects(second, /another panel/);
  const current = await store.read("shared");
  assert.equal(current.title, requirement.title);
  const updated = await store.save("shared", { ...current, title: "Fresh edit" });
  assert.equal(updated.revision, 2);
});

test("the loopback form serves assets and saves drafts only from its own origin", async (t) => {
  const { store } = await fixture(t);
  const entry = await startServer({ store, draftId: "http-test", repository });
  t.after(() => new Promise((resolve) => {
    entry.server.close(resolve);
    entry.server.closeAllConnections();
  }));
  const origin = new URL(entry.url).origin;
  const page = await fetch(entry.url);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Create an issue/);
  const initial = await (await fetch(`${entry.url}state`)).json();
  assert.equal(initial.repository, repository);
  assert.equal(initial.draft.revision, 0);
  const put = (originHeader, body = requirement) => fetch(`${entry.url}draft`, {
    method: "PUT", headers: { Origin: originHeader, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  assert.equal((await put("https://unrelated.example")).status, 403);
  const saved = await put(origin);
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).revision, 1);
  assert.equal((await put(origin)).status, 409);
  assert.equal((await fetch(`${origin}/state`)).status, 404);
  assert.equal((await fetch(`${entry.url}draft`)).status, 404);
});
