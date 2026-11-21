import "server-only";

import type { DatabaseSync } from "node:sqlite";
import { debridReady, debridToDrive, isMagnet, type Ask as DriveAsk, type DebridState } from "../drive/debrid";
import type { CodeConfig } from "./config";
import { downloadsFolder } from "./drive";
import type { Workspace } from "./model";
import { sandbox } from "./node";

/*
 * Downloads through Real-Debrid (infra/sandbox/bin/kimono-debrid): a magnet or a .torrent goes to
 * the Real-Debrid account Watch uses, its servers fetch it, and Kimono saves the files from its
 * https links into the person's Drive (Kimono AI → Downloads). Nothing peer-to-peer touches this
 * server or the sandbox, and nothing lands in the sandbox to run.
 *
 * kimono-debrid writes .kimono/debrid/<id>.json ({ magnet } or { torrent: <path in /workspace> })
 * and follows .kimono/debrid/<id>.state, which Kimono writes as the download goes.
 */

export const debridDir = ".kimono/debrid";

export const isDebridCommand = (input: string | undefined) => {
  if (!input) return false;
  try { const command = (JSON.parse(input) as { command?: unknown }).command; return typeof command === "string" && /(^|[\s;&|(/"'])kimono-debrid(\s|$|["'])/.test(command); } catch { return false; }
};

export { debridReady };

export const debridNote = "You can download a torrent for them: `kimono-progress \"Downloading <what>\" --run \"kimono-debrid '<magnet link>'\"` (or a .torrent file's path in place of the magnet). Real-Debrid fetches it on its own servers and the files go straight to their Drive, in AI → Downloads; nothing comes into this computer. Use it only for what they ask you to download.";

type Ask = { magnet?: string; torrent?: string };

/* Requests already taken, so a slow removal never starts one twice. */
const taken = new Set<string>();
const watching = new Set<string>();

/**
 * A kimono-debrid call was seen: look for its request for a while (it writes it as it starts)
 * and start each one found. Only for the chat's owner: it's their Drive the files go to.
 */
export function watchDebrid(db: DatabaseSync, config: CodeConfig, workspace: Workspace) {
  if (watching.has(workspace.id)) return;
  watching.add(workspace.id);
  void (async () => {
    try {
      for (let look = 0; look < 45; look++) {
        await new Promise((r) => setTimeout(r, look ? 2000 : 500));
        const listed = await sandbox.files(config, workspace, debridDir).catch(() => null);
        const asks = (listed?.entries ?? []).filter((e) => e.kind === "file" && /^\d{10,16}-[0-9a-f]{8}\.json$/.test(e.name)).map((e) => e.name.slice(0, -5)).filter((id) => !taken.has(id));
        for (const id of asks) {
          taken.add(id);
          if (taken.size > 500) taken.delete(taken.values().next().value!);
          const response = await sandbox.file(config, workspace, `${debridDir}/${id}.json`).catch(() => null);
          const text = response?.ok ? await response.text() : "";
          await sandbox.removeFile(config, workspace, `${debridDir}/${id}.json`).catch(() => {});
          let ask: Ask = {};
          try { ask = JSON.parse(text) as Ask; } catch { /* told below */ }
          void download(db, config, workspace, id, ask);
        }
        if (asks.length) look = Math.max(look, 40);
      }
    } finally { watching.delete(workspace.id); }
  })();
}

async function download(db: DatabaseSync, config: CodeConfig, workspace: Workspace, id: string, ask: Ask) {
  let last = 0;
  const write = (state: DebridState) => sandbox.write(config, workspace, `${debridDir}/${id}.state`, new TextEncoder().encode(JSON.stringify({ ...state, at: Date.now() }))).catch(() => {});
  const tell = async (state: DebridState) => {
    const ends = state.state === "done" || state.state === "failed" || state.state === "adding";
    if (!ends && Date.now() - last < 1500) return;
    last = Date.now();
    await write(state);
  };
  let what: DriveAsk;
  if (typeof ask.magnet === "string" && isMagnet(ask.magnet)) what = { magnet: ask.magnet };
  else if (typeof ask.torrent === "string" && ask.torrent && !ask.torrent.split("/").includes("..")) {
    const file = await sandbox.file(config, workspace, ask.torrent, true).catch(() => null);
    if (!file?.ok) return void await write({ state: "failed", status: "That .torrent file isn't there." });
    what = { torrent: new Uint8Array(await file.arrayBuffer()) };
  } else return void await write({ state: "failed", status: "Give a magnet link or a .torrent file." });
  const folder = downloadsFolder(db, workspace.owner);
  await debridToDrive(workspace.owner, folder, what, (state) => tell(state.state === "done" ? { ...state, saved: state.saved?.map((p) => `AI/Downloads/${p}`) } : state));
}
