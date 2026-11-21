import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

/* Portal's state in a scratch folder, with Watch set up on Real-Debrid. */
const state = mkdtempSync(join(tmpdir(), "kimono-debrid-"));
process.env.KIMONO_STATE_DIR = state;
writeFileSync(join(state, "settings.json"), JSON.stringify({ version: 4, apps: { "kimono-watch": { id: "kimono-watch", definitionId: "kimono-watch", enabled: true, environment: { debrid_service: { value: "Real-Debrid", secret: false }, debrid_key: { value: "rd-secret", secret: true } } } } }));

const { kimonoCommand } = await import("../src/lib/code/kimono-commands.ts");
const { isDebridCommand, watchDebrid, debridReady } = await import("../src/lib/code/debrid.ts");
const { db } = await import("../src/lib/code/index.ts");
const drive = await import("../src/lib/drive/index.ts");

test("kimono-debrid reads as words in the chat", () => {
  assert.deepEqual(kimonoCommand("kimono-debrid 'magnet:?xt=urn:btih:abc&dn=Big+Buck+Bunny'"), { label: "Downloaded to Drive", detail: "Big Buck Bunny", doing: "Downloading" });
  assert.equal(kimonoCommand("kimono-debrid /workspace/films.torrent")?.detail, "films.torrent");
  assert.ok(isDebridCommand(JSON.stringify({ command: `kimono-progress "Downloading it" --run "kimono-debrid 'magnet:?xt=urn:btih:abc'"` })));
  assert.ok(!isDebridCommand(JSON.stringify({ command: "echo kimono-debridx" })));
});

test("a magnet goes through Real-Debrid and lands in Drive, with its progress told to the sandbox", async () => {
  assert.equal(await debridReady(), "rd-secret");
  const files = new Map([[".kimono/debrid/1732000000000-abcd1234.json", JSON.stringify({ magnet: "magnet:?xt=urn:btih:abc&dn=Bunny" })]]);
  const states = [];
  const rdCalls = [];
  let looks = 0;
  const body = new TextEncoder().encode("x".repeat(4096));
  const real = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    if (url.origin === "http://node.test") {
      const path = url.searchParams.get("path");
      if (url.pathname.endsWith("/files")) return Response.json({ path, entries: [...files.keys()].map((p) => ({ name: p.split("/").pop(), kind: "file", size: 1 })) });
      if (method === "GET") return files.has(path) ? new Response(files.get(path)) : new Response("{}", { status: 404 });
      if (method === "DELETE") { files.delete(path); return new Response(null, { status: 204 }); }
      if (method === "PUT") { states.push(JSON.parse(new TextDecoder().decode(init.body))); return new Response(null, { status: 204 }); }
    }
    if (url.hostname === "api.real-debrid.com") {
      assert.equal(init.headers.Authorization, "Bearer rd-secret");
      const at = url.pathname.replace("/rest/1.0", "");
      rdCalls.push(at);
      if (at === "/torrents/addMagnet") return Response.json({ id: "T1" });
      if (at === "/torrents/selectFiles/T1") return new Response(null, { status: 204 });
      if (at === "/torrents/info/T1") {
        looks++;
        if (looks === 1) return Response.json({ status: "waiting_files_selection", progress: 0 });
        if (looks === 2) return Response.json({ status: "downloading", progress: 50, filename: "Bunny" });
        return Response.json({ status: "downloaded", progress: 100, filename: "Bunny", links: ["https://real-debrid.com/d/A", "https://real-debrid.com/d/B"] });
      }
      if (at === "/unrestrict/link") {
        const link = new URLSearchParams(String(init.body)).get("link");
        return Response.json({ download: `https://sgp1.download.real-debrid.com/d/${link.slice(-1)}/part-${link.slice(-1)}.mkv`, filename: `part-${link.slice(-1)}.mkv`, filesize: body.length });
      }
    }
    if (url.hostname.endsWith(".download.real-debrid.com")) {
      const response = new Response(body, { headers: { "content-length": String(body.length) } });
      Object.defineProperty(response, "url", { value: url.href });
      return response;
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  try {
    watchDebrid(db(), { nodeAddress: "http://node.test", nodeKey: "k" }, { id: "w1", owner: "akram" });
    for (let i = 0; i < 100 && !states.some((s) => s.state === "done" || s.state === "failed"); i++) await new Promise((r) => setTimeout(r, 200));
  } finally { globalThis.fetch = real; }
  const last = states.at(-1);
  assert.equal(last.state, "done", JSON.stringify(states));
  assert.deepEqual(last.saved, ["AI/Downloads/Bunny/part-A.mkv", "AI/Downloads/Bunny/part-B.mkv"]);
  assert.ok(states.some((s) => s.state === "downloading" && s.percent === 40));
  assert.ok(rdCalls.includes("/torrents/selectFiles/T1"));
  assert.ok(!files.has(".kimono/debrid/1732000000000-abcd1234.json"), "the request is taken out of the sandbox");
  const found = drive.searchNodes(drive.db(), "akram", "part-A");
  assert.equal(found.length, 1);
  assert.equal(found[0].size, body.length);
});

test("Drive's Magnet saves into the folder it was started in, and lists only the person's own", async () => {
  const { startDriveDownload, driveDownloads } = await import("../src/lib/drive/debrid.ts");
  const space = drive.createSpace(drive.db(), "mina", { name: "Films" });
  const real = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const at = url.pathname.replace("/rest/1.0", "");
    if (at === "/torrents/addMagnet") return Response.json({ id: "T2" });
    if (at === "/torrents/info/T2") return Response.json({ status: "downloaded", progress: 100, filename: "Open Movie.mkv", links: ["https://real-debrid.com/d/C"] });
    if (at === "/unrestrict/link") return Response.json({ download: "https://x.download.real-debrid.com/d/C/Open%20Movie.mkv", filename: "Open Movie.mkv", filesize: 5 });
    if (url.hostname.endsWith(".download.real-debrid.com")) { const r = new Response("12345"); Object.defineProperty(r, "url", { value: url.href }); return r; }
    throw new Error(`unexpected fetch ${url}`);
  };
  try {
    const started = startDriveDownload("mina", space.rootId, { magnet: "magnet:?xt=urn:btih:def&dn=Open+Movie" }, "Open Movie");
    for (let i = 0; i < 50 && driveDownloads("mina")[0]?.state !== "done"; i++) await new Promise((r) => setTimeout(r, 100));
    assert.equal(driveDownloads("mina")[0].id, started.id);
    assert.equal(driveDownloads("mina")[0].state, "done", JSON.stringify(driveDownloads("mina")));
    assert.deepEqual(driveDownloads("mina")[0].saved, ["Open Movie.mkv"]);
    assert.equal(driveDownloads("akram").length, 0);
    assert.deepEqual(drive.childrenOf(drive.db(), space.rootId, "mina").children.map((n) => [n.name, n.size]), [["Open Movie.mkv", 5]]);
  } finally { globalThis.fetch = real; }
});

test("a download that fails says why, not just that it stopped", async () => {
  const { debridToDrive } = await import("../src/lib/drive/debrid.ts");
  const space = drive.createSpace(drive.db(), "ren", { name: "Stuff" });
  const real = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const at = new URL(String(input)).pathname.replace("/rest/1.0", "");
    if (at === "/torrents/addMagnet") return Response.json({ id: "T3" });
    if (at === "/torrents/info/T3") return Response.json({ status: "downloaded", progress: 100, filename: "x", links: ["https://real-debrid.com/d/D"] });
    throw new TypeError("fetch failed");
  };
  try {
    const ended = await debridToDrive("ren", space.rootId, { magnet: "magnet:?xt=urn:btih:aaa" }, () => {});
    assert.deepEqual(ended, { state: "failed", status: "Couldn't reach Real-Debrid. Try again." });
  } finally { globalThis.fetch = real; }
});

test("a file Real-Debrid says is over a gigabyte starts saving instead of failing on its timer", async () => {
  const { startDriveDownload, driveDownloads } = await import("../src/lib/drive/debrid.ts");
  const space = drive.createSpace(drive.db(), "ren", { name: "Big" });
  const real = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    const at = url.pathname.replace("/rest/1.0", "");
    if (at === "/torrents/addMagnet") return Response.json({ id: "T3" });
    if (at === "/torrents/info/T3") return Response.json({ status: "downloaded", progress: 100, filename: "Big.mkv", links: ["https://real-debrid.com/d/D"] });
    if (at === "/unrestrict/link") return Response.json({ download: "https://x.download.real-debrid.com/d/D/Big.mkv", filename: "Big.mkv", filesize: 1_500_000_001 });
    if (url.hostname.endsWith(".download.real-debrid.com")) { const r = new Response("123", { headers: { "content-length": "3" } }); Object.defineProperty(r, "url", { value: url.href }); return r; }
    throw new Error(`unexpected fetch ${url}`);
  };
  try {
    startDriveDownload("ren", space.rootId, { magnet: "magnet:?xt=urn:btih:big" }, "Big");
    for (let i = 0; i < 50 && !["done", "failed"].includes(driveDownloads("ren")[0]?.state); i++) await new Promise((r) => setTimeout(r, 100));
    assert.equal(driveDownloads("ren")[0].state, "done", driveDownloads("ren")[0].status);
  } finally { globalThis.fetch = real; }
});
