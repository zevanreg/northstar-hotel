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

const session = await joinSession({
  canvases: [
    createCanvas({
      id: "issue-creation-form",
      displayName: "Create an issue",
      description: "Draft a requirement or bug report and review the prefilled issue on GitHub.",
      inputSchema: {
        type: "object",
        properties: { draftId: { type: "string", pattern: "^[a-zA-Z0-9_-]{1,64}$" } },
        required: ["draftId"],
        additionalProperties: false,
      },
      actions: [
        {
          name: "read_draft",
          description: "Read this panel's saved issue draft.",
          handler: (ctx) => store.read(servers.get(ctx.instanceId).draftId),
        },
        {
          name: "prepare_issue",
          description: "Validate the saved draft and return a prefilled GitHub URL without creating an issue.",
          handler: async (ctx) => {
            const entry = servers.get(ctx.instanceId);
            return buildIssue(entry.repository, await store.read(entry.draftId));
          },
        },
      ],
      open: async (ctx) => {
        if (!session.workspacePath) throw new Error("Session artifact storage is unavailable.");
        store ??= createDraftStore(join(session.workspacePath, "files", "issue-drafts"));
        let entry = servers.get(ctx.instanceId);
        if (entry && entry.draftId !== ctx.input.draftId) {
          throw new Error("Open another panel to use a different draftId.");
        }
        if (!entry) {
          const { stdout } = await git("git", ["remote", "get-url", "origin"], { cwd: root });
          const repository = repositoryUrl(stdout.trim());
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
