import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createCanvas, CanvasError, joinSession } from "@github/copilot-sdk/extension";
import { forms, draftSchema, createDraftStore, prepareIssue } from "./model.mjs";

const servers = new Map();
const assets = new Map(await Promise.all(
    ["index.html", "client.js", "style.css"].map(async (name) =>
        [name, await readFile(new URL(name, import.meta.url))]),
));
const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
let store;

function active(instanceId) {
    const entry = servers.get(instanceId);
    if (!entry) throw new CanvasError("issue_form_closed", "Open the issue form first.");
    return entry;
}

async function startServer(draftId) {
    const token = randomBytes(24).toString("hex");
    const prefix = `/${token}/`;
    const server = createServer(async (req, res) => {
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Referrer-Policy", "no-referrer");
        res.setHeader("Content-Security-Policy",
            "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'");
        const json = (status, data) => {
            res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify(data));
        };
        try {
            const route = req.url?.startsWith(prefix) ? req.url.slice(prefix.length) : null;
            if (req.method === "GET" && route === "state") {
                json(200, { forms, draft: await store.read(draftId) });
            } else if (req.method === "POST" && (route === "save" || route === "prepare")) {
                if (req.headers["content-type"] !== "application/json") {
                    json(415, { error: "Send JSON form data." });
                    return;
                }
                let body = "";
                for await (const chunk of req) {
                    body += chunk;
                    if (Buffer.byteLength(body) > 65536) {
                        json(413, { error: "Draft exceeds 64 KB. Shorten it before saving." });
                        return;
                    }
                }
                let draft;
                try { draft = JSON.parse(body); }
                catch { json(400, { error: "Invalid JSON form data." }); return; }
                if (route === "save") json(200, await store.save(draftId, draft));
                else json(200, await prepareIssue(repositoryRoot, draft));
            } else if (req.method === "GET" && (route === "" || assets.has(route))) {
                const name = route || "index.html";
                const type = name.endsWith(".js") ? "text/javascript" :
                    name.endsWith(".css") ? "text/css" : "text/html";
                res.writeHead(200, { "Content-Type": `${type}; charset=utf-8` });
                res.end(assets.get(name));
            } else json(404, { error: "Not found." });
        } catch (error) {
            json(error.code === "invalid_draft" ? 400 : error.code === "draft_conflict" ? 409 : 500,
                { error: error.message });
        }
    });
    server.requestTimeout = 10000;
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    return { server, draftId, url: `http://127.0.0.1:${server.address().port}${prefix}` };
}

const session = await joinSession({
    canvases: [createCanvas({
        id: "issue-form",
        displayName: "Northstar issue form",
        description: "Draft a bug report or product requirement and review it on GitHub before submitting.",
        inputSchema: {
            type: "object",
            properties: { draftId: { type: "string", pattern: "^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$" } },
            required: ["draftId"],
            additionalProperties: false,
        },
        actions: [
            {
                name: "read_draft",
                description: "Read the saved issue draft.",
                handler: (ctx) => store.read(active(ctx.instanceId).draftId),
            },
            {
                name: "prepare_issue",
                description: "Validate a draft and return Markdown and a GitHub review URL; never submit it.",
                inputSchema: draftSchema,
                handler: (ctx) => {
                    active(ctx.instanceId);
                    return prepareIssue(repositoryRoot, ctx.input);
                },
            },
        ],
        open: async (ctx) => {
            if (!session.workspacePath) {
                throw new CanvasError("workspace_missing", "A session artifact directory is required to save drafts.");
            }
            store ??= createDraftStore(join(session.workspacePath, "issue-form-drafts"));
            await store.read(ctx.input.draftId);
            let entry = servers.get(ctx.instanceId);
            if (!entry) {
                entry = await startServer(ctx.input.draftId);
                servers.set(ctx.instanceId, entry);
            } else if (entry.draftId !== ctx.input.draftId) {
                throw new CanvasError("draft_mismatch", "Use a new panel to open a different draft.");
            }
            return { title: "Northstar issue form", url: entry.url };
        },
        onClose: async (ctx) => {
            const entry = servers.get(ctx.instanceId);
            if (entry) {
                servers.delete(ctx.instanceId);
                await new Promise((resolve) => entry.server.close(resolve));
            }
        },
    })],
});
