import "server-only";

import type { DatabaseSync } from "node:sqlite";
import { freeBytes, reserveBytes } from "../drive/storage";
import { maxFileBytes, root as driveRoot } from "../drive";
import { getPlatformSettings } from "../settings";
import { watchConfig } from "../watch/config";
import type { CodeConfig } from "./config";
import { addToDrive, blobFromWeb, downloadsFolder } from "./drive";
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
const api = "https://api.real-debrid.com/rest/1.0";

export const isDebridCommand = (input: string | undefined) => {
  if (!input) return false;
  try { const command = (JSON.parse(input) as { command?: unknown }).command; return typeof command === "string" && /(^|[\s;&|(/"'])kimono-debrid(\s|$|["'])/.test(command); } catch { return false; }
};

/** Whether downloads can go through: Watch is set up with Real-Debrid. */
export async function debridReady() {
  const cfg = watchConfig(await getPlatformSettings());
  return cfg.debrid.service === "realdebrid" && cfg.debrid.key ? cfg.debrid.key : null;
}

export const debridNote = "You can download a torrent for them: `kimono-progress \"Downloading <what>\" --run \"kimono-debrid '<magnet link>'\"` (or a .torrent file's path in place of the magnet). Real-Debrid fetches it on its own servers and the files go straight to their Drive, in AI → Downloads; nothing comes into this computer. Use it only for what they ask you to download.";

type State = { state: "adding" | "waiting" | "downloading" | "saving" | "done" | "failed"; status: string; percent?: number; saved?: string[]; at: number };
type Ask = { magnet?: string; torrent?: string };

class Refused extends Error {}

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
  const tell = async (state: Omit<State, "at">, force = false) => {
    if (!force && Date.now() - last < 1500) return;
    last = Date.now();
    await sandbox.write(config, workspace, `${debridDir}/${id}.state`, new TextEncoder().encode(JSON.stringify({ ...state, at: Date.now() }))).catch(() => {});
  };
  try {
    const key = await debridReady();
    if (!key) throw new Refused("Downloads need Real-Debrid set up in Watch.");
    const rd = (path: string, init: RequestInit = {}) => fetch(`${api}${path}`, { ...init, cache: "no-store", signal: AbortSignal.timeout(30_000), headers: { ...init.headers, Authorization: `Bearer ${key}` } }).then(async (response) => {
      if (response.status === 204) return {};
      const body = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (!response.ok) throw new Refused(rdWords(body.error_code, body.error));
      return body;
    });
    const form = (fields: Record<string, string>) => ({ method: "POST", body: new URLSearchParams(fields) });

    await tell({ state: "adding", status: "Adding it" }, true);
    let torrent: string;
    if (typeof ask.magnet === "string" && /^magnet:\?/i.test(ask.magnet.trim()) && /xt=urn:bt[im]h:/i.test(ask.magnet)) {
      torrent = String((await rd("/torrents/addMagnet", form({ magnet: ask.magnet.trim() }))).id ?? "");
    } else if (typeof ask.torrent === "string" && ask.torrent && !ask.torrent.split("/").includes("..")) {
      const file = await sandbox.file(config, workspace, ask.torrent, true);
      if (!file.ok) throw new Refused("That .torrent file isn't there.");
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes[0] !== 0x64) throw new Refused("That isn't a .torrent file.");
      torrent = String((await rd("/torrents/addTorrent", { method: "PUT", body: bytes as BodyInit })).id ?? "");
    } else throw new Refused("Give a magnet link or a .torrent file.");
    if (!torrent) throw new Refused("Real-Debrid didn't take it.");

    /* Real-Debrid fetches it on its own servers; a torrent it already has is ready at once. */
    let info: Info;
    for (const began = Date.now(); ; await new Promise((r) => setTimeout(r, 3000))) {
      info = await rd(`/torrents/info/${torrent}`) as unknown as Info;
      if (info.status === "waiting_files_selection") { await rd(`/torrents/selectFiles/${torrent}`, form({ files: "all" })); continue; }
      if (info.status === "downloaded") break;
      if (["magnet_error", "error", "virus", "dead"].includes(info.status)) throw new Refused(info.status === "virus" ? "Real-Debrid flagged it as a virus." : info.status === "dead" ? "Nobody is sharing it any more." : "Real-Debrid couldn't fetch it.");
      if (Date.now() - began > 12 * 3600_000) throw new Refused("It's taking too long to come down.");
      const percent = typeof info.progress === "number" ? info.progress : undefined;
      const status = info.status === "magnet_conversion" ? "Finding it" : info.status === "queued" ? "Waiting its turn" : info.status === "compressing" || info.status === "uploading" ? "Getting it ready" : `Fetching ${info.filename ?? "it"}`;
      await tell({ state: info.status === "downloading" ? "downloading" : "waiting", status, percent: percent === undefined ? undefined : Math.round(percent * 0.8) });
    }

    /* Each file from its own https link, straight into Drive. */
    const links: { download: string; filename: string; filesize: number }[] = [];
    for (const link of info.links ?? []) {
      const got = await rd("/unrestrict/link", form({ link })) as { download?: string; filename?: string; filesize?: number };
      const at = got.download ? new URL(got.download) : null;
      if (!at || at.protocol !== "https:" || !/(^|\.)real-debrid\.com$/i.test(at.hostname)) throw new Refused("Real-Debrid gave a link Kimono won't follow.");
      links.push({ download: got.download!, filename: safeName(got.filename || at.pathname.split("/").pop() || "file"), filesize: Number(got.filesize) || 0 });
    }
    if (!links.length) throw new Refused("There was nothing in it to save.");
    const total = links.reduce((n, l) => n + l.filesize, 0);
    if (links.some((l) => l.filesize > maxFileBytes)) throw new Refused("One of its files is too big for Drive.");
    if (total > (await freeBytes(driveRoot)) - reserveBytes) throw new Refused("Drive hasn't the room for it.");

    const folder = downloadsFolder(db, workspace.owner);
    const name = safeName(info.filename || links[0].filename);
    const saved: string[] = [];
    let before = 0;
    for (const link of links) {
      const response = await fetch(link.download, { cache: "no-store", signal: AbortSignal.timeout(Math.max(600_000, link.filesize / 2_000)) });
      if (!response.url.startsWith("https://")) { await response.body?.cancel(); throw new Refused("Real-Debrid gave a link Kimono won't follow."); }
      if (!response.ok || !response.body) throw new Refused("Real-Debrid's link didn't open.");
      const size = Number(response.headers.get("content-length")) || link.filesize;
      const stored = await blobFromWeb(response.body, size, (bytes) => {
        void tell({ state: "saving", status: "Saving to Drive", percent: 80 + Math.round(((before + bytes) / Math.max(total, 1)) * 20) });
      });
      const path = links.length > 1 ? `${name}/${link.filename}` : link.filename;
      const node = await addToDrive(folder, workspace.owner, path, stored);
      saved.push(`AI/Downloads/${links.length > 1 ? `${name}/` : ""}${node.name}`);
      before += stored.size;
    }
    await tell({ state: "done", status: "Saved to Drive", percent: 100, saved }, true);
  } catch (error) {
    const status = error instanceof Refused ? error.message : "The download stopped.";
    if (!(error instanceof Refused)) console.warn("Kimono AI couldn't finish a download:", error instanceof Error ? error.name : "unknown");
    await tell({ state: "failed", status }, true);
  }
}

type Info = { status: string; progress?: number; filename?: string; links?: string[] };

const safeName = (name: string) => name.replace(/[\u0000-\u001f/\\]+/g, " ").replace(/^\.+/, "").trim().slice(0, 200) || "download";

function rdWords(code: unknown, error: unknown) {
  if (code === 8 || code === 9 || code === 12 || code === 13) return "Real-Debrid didn't accept Watch's key.";
  if (code === 21 || code === 23) return "Real-Debrid has too many downloads going; try later.";
  if (code === 30 || code === 29) return "Real-Debrid can't read that torrent.";
  if (code === 34) return "Real-Debrid is busy; try again in a minute.";
  if (code === 35) return "Real-Debrid won't fetch that.";
  return typeof error === "string" ? `Real-Debrid said: ${error.replace(/_/g, " ")}.` : "Real-Debrid didn't answer.";
}
