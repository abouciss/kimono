import "server-only";

import { randomBytes } from "node:crypto";
import { addToDrive, blobFromWeb } from "../code/drive";
import { getPlatformSettings } from "../settings";
import { watchConfig } from "../watch/config";
import { maxFileBytes, root as driveRoot } from "./index";
import { freeBytes, reserveBytes } from "./storage";

/*
 * Downloads through Real-Debrid, into Drive: a magnet or a .torrent goes to the Real-Debrid
 * account Watch uses (its stored key), Real-Debrid's servers fetch it, and each file streams
 * from its https link into a Drive folder. Nothing peer-to-peer runs on this server. Drive's
 * "Magnet" (app/api/v1/drive/downloads) and Kimono AI's kimono-debrid (lib/code/debrid.ts) both
 * come here.
 */

const api = "https://api.real-debrid.com/rest/1.0";

export type Ask = { magnet: string } | { torrent: Uint8Array };
export type DebridState = {
  state: "adding" | "waiting" | "downloading" | "saving" | "done" | "failed";
  status: string;
  percent?: number;
  /** Where the files went, by their names in the folder ("Name/file.mkv" when they're in a folder of their own). */
  saved?: string[];
};

/** Real-Debrid's key when Watch is set up with it; null otherwise. */
export async function debridReady() {
  const cfg = watchConfig(await getPlatformSettings());
  return cfg.debrid.service === "realdebrid" && cfg.debrid.key ? cfg.debrid.key : null;
}

export const isMagnet = (value: string) => /^magnet:\?/i.test(value.trim()) && /xt=urn:bt[im]h:/i.test(value);

/** What a magnet calls itself (its dn), if it says. */
export function magnetName(link: string) {
  const dn = /[?&]dn=([^&]+)/.exec(link)?.[1];
  if (!dn) return undefined;
  try { return decodeURIComponent(dn.replace(/\+/g, " ")).slice(0, 200); } catch { return undefined; }
}

class Refused extends Error {}

/** Fetches `ask` through Real-Debrid into `folderId` as `owner`, telling `tell` how it goes. Never throws. */
export async function debridToDrive(owner: string, folderId: string, ask: Ask, tell: (state: DebridState) => void | Promise<void>): Promise<DebridState> {
  const end = async (state: DebridState) => { await tell(state); return state; };
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

    await tell({ state: "adding", status: "Adding it" });
    let torrent: string;
    if ("magnet" in ask) {
      if (!isMagnet(ask.magnet)) throw new Refused("That isn't a magnet link.");
      torrent = String((await rd("/torrents/addMagnet", form({ magnet: ask.magnet.trim() }))).id ?? "");
    } else {
      if (ask.torrent[0] !== 0x64) throw new Refused("That isn't a .torrent file.");
      torrent = String((await rd("/torrents/addTorrent", { method: "PUT", body: ask.torrent as BodyInit })).id ?? "");
    }
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
      const node = await addToDrive(folderId, owner, links.length > 1 ? `${name}/${link.filename}` : link.filename, stored);
      saved.push(links.length > 1 ? `${name}/${node.name}` : node.name);
      before += stored.size;
    }
    return await end({ state: "done", status: "Saved to Drive", percent: 100, saved });
  } catch (error) {
    if (!(error instanceof Refused)) console.warn("Couldn't finish a download:", error instanceof Error ? error.name : "unknown");
    return await end({ state: "failed", status: error instanceof Refused ? error.message : "The download stopped." });
  }
}

/* ── Drive's own downloads, followed by the page while they run ── */

export type DriveDownload = DebridState & { id: string; name: string; folderId: string; startedAt: number };
const downloads = new Map<string, DriveDownload & { owner: string }>();
const keepFor = 24 * 3600_000;

/** Starts one for `owner` into `folderId`; it carries on without the page. */
export function startDriveDownload(owner: string, folderId: string, ask: Ask, name: string): DriveDownload {
  for (const [id, d] of downloads) if (Date.now() - d.startedAt > keepFor && (d.state === "done" || d.state === "failed")) downloads.delete(id);
  const id = randomBytes(9).toString("base64url");
  const entry = { id, owner: owner.toLowerCase(), folderId, name, startedAt: Date.now(), state: "adding" as const, status: "Adding it" };
  downloads.set(id, entry);
  void debridToDrive(owner, folderId, ask, (state) => { const d = downloads.get(id); if (d) Object.assign(d, { percent: undefined }, state); });
  return view(entry);
}

export const driveDownloads = (owner: string) => [...downloads.values()].filter((d) => d.owner === owner.toLowerCase()).map(view);
export function forgetDriveDownload(owner: string, id: string) {
  const d = downloads.get(id);
  if (d && d.owner === owner.toLowerCase() && (d.state === "done" || d.state === "failed")) downloads.delete(id);
}

function view({ owner: _owner, ...d }: DriveDownload & { owner: string }): DriveDownload { return { ...d }; }

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
