import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { templates, FormError } from "./model.mjs";

const assets = {
  "": ["index.html", "text/html; charset=utf-8"],
  "app.mjs": ["app.mjs", "text/javascript; charset=utf-8"],
  "model.mjs": ["model.mjs", "text/javascript; charset=utf-8"],
  "style.css": ["style.css", "text/css; charset=utf-8"],
};

export async function startServer({ store, draftId, repository }) {
  const prefix = `/${randomUUID()}/`;
  let origin;
  const server = createServer(async (req, res) => {
    const json = (status, data) => {
      res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(data));
    };
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'");
    try {
      if (req.headers.host !== new URL(origin).host || !req.url?.startsWith(prefix)) {
        throw new FormError("Not found.", 404);
      }
      const route = req.url.slice(prefix.length);
      if (req.method === "GET" && Object.hasOwn(assets, route)) {
        const [file, type] = assets[route];
        const content = await readFile(new URL(file, import.meta.url));
        res.writeHead(200, { "Content-Type": type });
        res.end(content);
      } else if (req.method === "GET" && route === "state") {
        json(200, { repository, templates, draft: await store.read(draftId) });
      } else if (req.method === "PUT" && route === "draft") {
        if (req.headers.origin !== origin || req.headers["content-type"] !== "application/json") {
          throw new FormError("Save requests must come from this form.", 403);
        }
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 65536) throw new FormError("The draft is too large.", 413);
          chunks.push(chunk);
        }
        let input;
        try {
          input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          throw new FormError("The draft must be valid JSON.");
        }
        json(200, await store.save(draftId, input));
      } else {
        throw new FormError("Not found.", 404);
      }
    } catch (error) {
      json(error instanceof FormError ? error.status : 500, {
        error: error instanceof FormError ? error.message : "Unable to access the draft. Check extension logs.",
      });
      if (!(error instanceof FormError)) console.error(error);
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  return { server, url: `${origin}${prefix}`, draftId, repository };
}
