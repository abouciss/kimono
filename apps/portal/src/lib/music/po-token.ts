import "server-only";

import { createRequire } from "node:module";
import { readdirSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { Worker } from "node:worker_threads";

/*
 * YouTube hands out a song's audio a megabyte at a time unless the request
 * carries a PO token: proof that a real player asked. The token is minted by
 * running Google's BotGuard challenge, which wants a browser's globals, so it
 * runs in a worker thread with jsdom standing in for the browser. The
 * Portal's own globals never see a `window`, or React would think it's in one.
 *
 * One BotGuard run lasts about 12 hours; tokens for a visitor or a video are
 * minted from it in milliseconds. The worker is replaced before it expires,
 * and whenever it fails.
 */

/*
 * These run in the worker, which finds them by path, so the build never sees them used. They're named
 * here, behind a switch that's never set, so the standalone build traces and ships them (and all they
 * need): an export nobody calls is shaken out of the bundle, and then production has no jsdom.
 */
if (process.env.KIMONO_TRACE_WORKER_PACKAGES === "never") void Promise.all([import("jsdom"), import("bgutils-js/botguard"), import("bgutils-js/webpo"), import("bgutils-js/utils")]);

/*
 * Where a package the worker needs is: the Portal's own node_modules in development; in the standalone image,
 * where the build links its server externals, as `.next/node_modules/<name>-<hash>` (nothing else points there).
 */
function locate(spec: string): string {
  const name = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
  const roots = [process.cwd(), join(process.cwd(), "apps/portal")];
  for (const dir of roots) {
    try { return createRequire(join(dir, "package.json")).resolve(spec); } catch { /* the next */ }
  }
  for (const dir of roots) {
    const linked = join(dir, ".next/node_modules");
    let entries: string[] = [];
    try { entries = readdirSync(linked); } catch { continue; }
    const hit = entries.find((e) => e.startsWith(`${name.replace("/", "+")}-`) || e.startsWith(`${name}-`));
    if (!hit) continue;
    /* The link leads into pnpm's store, beside the package's own dependencies: resolve from there. */
    const real = realpathSync(join(linked, hit));
    try { return createRequire(join(dirname(real), "_.js")).resolve(spec); } catch { /* the next */ }
  }
  throw new Error(`music: ${name} isn't installed where the Portal runs`);
}

const workerCode = `
const { parentPort, workerData } = require("node:worker_threads");
(async () => {
  const { JSDOM } = require(workerData.jsdom);
  const { BotGuardClient, parseChallengeData } = await import(workerData.botguard);
  const { WebPoMinter } = await import(workerData.webpo);
  const { buildURL, GOOG_API_KEY, USER_AGENT } = await import(workerData.utils);
  const dom = new JSDOM("<!DOCTYPE html><html><head></head><body></body></html>", { url: "https://www.youtube.com/", referrer: "https://www.youtube.com/", userAgent: USER_AGENT });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document });
  for (const k of ["location", "origin", "navigator"]) if (!Reflect.has(globalThis, k)) Object.defineProperty(globalThis, k, { value: dom.window[k], configurable: true });
  const headers = { "content-type": "application/json+protobuf", "x-goog-api-key": GOOG_API_KEY, "x-user-agent": "grpc-web-javascript/0.1" };
  const requestKey = "O43z0dpjhgX20SCx4KAo";
  const post = async (name, body) => {
    const res = await fetch(buildURL(name, true), { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(name + ": " + res.status);
    return res.json();
  };
  const bg = parseChallengeData(await post("Create", [requestKey]));
  if (!bg || !bg.interpreterJavascript || !bg.interpreterJavascript.privateDoNotAccessOrElseSafeScriptWrappedValue) throw new Error("no BotGuard challenge");
  new Function(bg.interpreterJavascript.privateDoNotAccessOrElseSafeScriptWrappedValue)();
  const client = await BotGuardClient.create({ program: bg.program, globalName: bg.globalName, globalObject: globalThis });
  const signals = [];
  const snapshot = await client.snapshot({ webPoSignalOutput: signals });
  const [integrityToken, ttl] = await post("GenerateIT", [requestKey, snapshot]);
  if (!integrityToken) throw new Error("no integrity token");
  const minter = await WebPoMinter.create({ integrityToken }, signals);
  parentPort.on("message", async ({ id, binding }) => {
    try { parentPort.postMessage({ id, token: await minter.mintAsWebsafeString(binding) }); }
    catch (e) { parentPort.postMessage({ id, error: String((e && e.message) || e) }); }
  });
  parentPort.postMessage({ ready: true, ttl: Number(ttl) || 43200 });
})().catch((e) => parentPort.postMessage({ ready: false, error: String((e && e.message) || e) }));
`;

type Minter = { mint(binding: string): Promise<string>; expires: number; stop(): void };

function start(): Promise<Minter> {
  const url = (spec: string) => `file://${locate(spec)}`;
  const worker = new Worker(workerCode, {
    eval: true,
    workerData: { jsdom: locate("jsdom"), botguard: url("bgutils-js/botguard"), webpo: url("bgutils-js/webpo"), utils: url("bgutils-js/utils") },
    resourceLimits: { maxOldGenerationSizeMb: 256 },
  });
  worker.unref();
  const waiting = new Map<number, { ok: (t: string) => void; fail: (e: Error) => void }>();
  let next = 0;
  return new Promise((ready, failed) => {
    const timer = setTimeout(() => { failed(new Error("BotGuard took too long")); void worker.terminate(); }, 60_000);
    worker.on("message", (m: { ready?: boolean; ttl?: number; error?: string; id?: number; token?: string }) => {
      if ("ready" in m) {
        clearTimeout(timer);
        if (!m.ready) { failed(new Error(`BotGuard: ${m.error}`)); void worker.terminate(); return; }
        ready({
          /* A little before BotGuard's own end, so no request carries a dying token. */
          expires: Date.now() + Math.max(600, (m.ttl ?? 43200) - 1800) * 1000,
          mint: (binding) => new Promise((ok, fail) => {
            const id = ++next;
            waiting.set(id, { ok, fail });
            worker.postMessage({ id, binding });
            setTimeout(() => { if (waiting.delete(id)) fail(new Error("minting took too long")); }, 10_000);
          }),
          stop: () => void worker.terminate(),
        });
        return;
      }
      const w = waiting.get(m.id!);
      if (!w) return;
      waiting.delete(m.id!);
      if (m.error) w.fail(new Error(m.error)); else w.ok(m.token!);
    });
    worker.on("error", (e) => { clearTimeout(timer); failed(e); for (const w of waiting.values()) w.fail(e); waiting.clear(); });
    worker.on("exit", () => { for (const w of waiting.values()) w.fail(new Error("the token worker stopped")); waiting.clear(); });
  });
}

const g = globalThis as unknown as { kimonoMusicPo?: Promise<Minter> };

/** A PO token bound to a visitor (the session's) or a video id (its stream). */
export async function poToken(binding: string): Promise<string> {
  let current = g.kimonoMusicPo;
  if (current) {
    const m = await current.catch(() => null);
    if (!m || Date.now() > m.expires) { m?.stop(); current = undefined; }
  }
  if (!current) {
    current = g.kimonoMusicPo = start();
    current.catch(() => { if (g.kimonoMusicPo === current) g.kimonoMusicPo = undefined; });
  }
  const minter = await current;
  try { return await minter.mint(binding); }
  catch (error) { if (g.kimonoMusicPo === current) { minter.stop(); g.kimonoMusicPo = undefined; } throw error; }
}

/** When the current BotGuard run ends: the session made with it must be made again by then. */
export async function poExpires(): Promise<number> {
  return (await g.kimonoMusicPo?.catch(() => null))?.expires ?? 0;
}
