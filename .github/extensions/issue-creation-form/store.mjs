import { mkdir, readFile, rename, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { FormError, validateDraft } from "./model.mjs";

export function createDraftStore(directory) {
  let pending = Promise.resolve();
  function pathFor(id) {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) throw new FormError("Invalid draft ID.");
    return join(directory, `${id}.json`);
  }
  async function read(id) {
    const path = pathFor(id);
    try {
      return validateDraft(JSON.parse(await readFile(path, "utf8")));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      return { type: "requirement", title: "", fields: {}, revision: 0 };
    }
  }
  function save(id, input) {
    const next = pending.then(async () => {
      const draft = validateDraft(input);
      const current = await read(id);
      if (current.revision !== draft.revision) {
        throw new FormError("This draft changed in another panel. Reload before saving.", 409);
      }
      const saved = { ...draft, revision: draft.revision + 1 };
      await mkdir(directory, { recursive: true });
      const destination = pathFor(id);
      const temporary = `${destination}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(saved, null, 2), { flag: "wx" });
        await rename(temporary, destination);
      } finally {
        await rm(temporary, { force: true });
      }
      return saved;
    });
    // A rejected save must not block subsequent saves; its caller still receives the error.
    pending = next.catch(() => {});
    return next;
  }
  return { read, save };
}
