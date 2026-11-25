import "server-only";

import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { db as driveDb, deleteGoneChatFolders, driveOn, root as driveRoot } from "../drive";
import { removeBlob } from "../drive/storage";
import { stateDir } from "../state";
import type { CodeConfig } from "./config";
import { chatBranchesGone } from "./forgejo";
import { forgetFromHistory } from "./history";
import type { Workspace } from "./model";
import { sandbox } from "./node";

/*
 * What chats deleted before deleting meant everything (eraseWorkspace) left behind, swept once a process:
 * their Drive folders, sandboxes, copies in other chats, code/ branches, files kept for thumbs that went
 * with them, and their folders on disk. A deleted chat is known by what it left: Kimono keeps no list.
 */

const code = join(stateDir, "code");
const perChat = ["attachments", "shots", "media", "temp-links"].map((dir) => join(code, dir));
const feedbackFiles = join(code, "feedback-files");
const idShape = /^[0-9a-f]{16}$/;
/* A folder younger than this may be one a chat being made is about to own. */
const settled = 60 * 60 * 1000;

async function oldEntries(dir: string, now: number): Promise<string[]> {
  const out: string[] = [];
  for (const name of await readdir(dir).catch(() => [] as string[])) {
    const at = await stat(join(dir, name)).then((s) => s.mtimeMs, () => now);
    if (now - at > settled) out.push(name);
  }
  return out;
}

export async function sweepDeletedChats(db: DatabaseSync, config: CodeConfig, now = Date.now()) {
  const chats = new Set((db.prepare("SELECT id FROM workspaces").all() as { id: string }[]).map((r) => r.id));
  const gone = new Set<string>();
  let blobs = 0, branches = 0, kept = 0;

  if (await driveOn()) {
    const swept = deleteGoneChatFolders(driveDb(), chats);
    for (const ref of swept.refs) if (idShape.test(ref)) gone.add(ref);
    await Promise.all(swept.blobs.map((blob) => removeBlob(driveRoot, blob)));
    blobs = swept.blobs.length;
  }

  for (const row of db.prepare("SELECT DISTINCT chat_id FROM history_synced WHERE chat_id != ''").all() as { chat_id: string }[]) {
    if (!chats.has(row.chat_id)) gone.add(row.chat_id);
  }
  for (const dir of perChat) {
    for (const id of await oldEntries(dir, now)) {
      if (!idShape.test(id) || chats.has(id)) continue;
      gone.add(id);
      await rm(join(dir, id), { recursive: true, force: true });
    }
  }

  if (config.nodeAddress && config.nodeKey) {
    for (const id of gone) {
      /* Removing a sandbox that isn't there is fine; the node says so for nothing. */
      await sandbox.remove(config, { id } as Workspace).catch(() => {});
      await forgetFromHistory(db, config, id);
    }
  }

  if (config.gitAddress) {
    const known = new Set((db.prepare("SELECT branch FROM workspaces WHERE branch LIKE 'code/%'").all() as { branch: string }[]).map((r) => r.branch));
    branches = await chatBranchesGone(config, known).catch((error) => { console.warn("Kimono AI couldn't sweep deleted chats' branches:", error instanceof Error ? error.message : error); return 0; });
  }

  /* Files kept for thumbs whose rating went with its chat: nothing in the feedback bank names them any more. */
  const named = new Set<string>();
  for (const sql of ["SELECT answer AS t FROM ai_ratings", "SELECT chat AS t FROM ai_reports", "SELECT takes AS t FROM ai_take_picks"]) {
    for (const row of db.prepare(sql).all() as { t: string | null }[]) for (const m of (row.t ?? "").matchAll(/\/kept\/([0-9a-f-]{36})\//g)) named.add(m[1]);
  }
  for (const id of await oldEntries(feedbackFiles, now)) {
    if (!/^[0-9a-f-]{36}$/.test(id) || named.has(id)) continue;
    await rm(join(feedbackFiles, id), { recursive: true, force: true });
    kept++;
  }

  if (gone.size || blobs || branches || kept) console.info(`Kimono AI swept what deleted chats left: ${gone.size} chats, ${blobs} Drive files, ${branches} branches, ${kept} kept feedback folders.`);
}
