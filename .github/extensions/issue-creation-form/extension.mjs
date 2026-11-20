import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { join } from "node:path";
import { joinSession, createCanvas } from "@github/copilot-sdk/extension";
import { buildIssue, repositoryUrl } from "./model.mjs";
import { createDraftStore } from "./store.mjs";
import { startServer } from "./server.mjs";

const servers = new Map();
const root = fileURLToPath(new URL("../../../", import.meta.url));
const git = promisify(execFile);
let store;

const draftInputSchema = {
  type: "object",
  properties: { draftId: { type: "string", pattern: "^[a-zA-Z0-9_-]{1,64}$" } },
  required: ["draftId"],
  additionalProperties: false,
};

function draftStore() {
  if (!session.workspacePath) throw new Error("Session artifact storage is unavailable.");
  store ??= createDraftStore(join(session.workspacePath, "files", "issue-drafts"));
  return store;
}

async function currentRepository() {
  const { stdout } = await git("git", ["remote", "get-url", "origin"], { cwd: root });
  return repositoryUrl(stdout.trim());
}

const session = await joinSession({
  canvases: [
    createCanvas({
      id: "issue-creation-form",
      displayName: "Create an issue",
      description: "Draft a requirement or bug report and review the prefilled issue on GitHub.",
      inputSchema: draftInputSchema,
      actions: [
        {
          name: "read_draft",
          description: "Read a saved issue draft by its draftId, including after an extension reload.",
          inputSchema: draftInputSchema,
          handler: (ctx) => draftStore().read(ctx.input.draftId),
        },
        {
          name: "prepare_issue",
          description: "Validate the saved draft and return a prefilled GitHub URL without creating an issue.",
          inputSchema: draftInputSchema,
          handler: async (ctx) => {
            const draft = await draftStore().read(ctx.input.draftId);
            return buildIssue(await currentRepository(), draft);
          },
        },
      ],
      open: async (ctx) => {
        draftStore();
        let entry = servers.get(ctx.instanceId);
        if (entry && entry.draftId !== ctx.input.draftId) {
          throw new Error("Open another panel to use a different draftId.");
        }
        if (!entry) {
          const repository = await currentRepository();
          entry = await startServer({ store, draftId: ctx.input.draftId, repository });
          servers.set(ctx.instanceId, entry);
        }
        return { title: "Create an issue", url: entry.url };
      },
      onClose: async (ctx) => {
        const entry = servers.get(ctx.instanceId);
        if (entry) {
          servers.delete(ctx.instanceId);
          await new Promise((resolve) => entry.server.close(resolve));
        }
      },
    }),
  ],
});
