import { apiError, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { music, MusicProblem } from "@/lib/music";
import { importPlaylist } from "@/lib/music/imports";

export const dynamic = "force-dynamic";
export const maxDuration = 900;

/**
 * `{ url, name? }`: a Spotify, Apple Music or YouTube Music playlist made a
 * playlist here. Answers as it goes, one JSON object a line: `read`, then
 * `match` with how many are done, then `done` (or `error`).
 */
export async function POST(request: Request) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  const body = (read.body ?? {}) as { url?: unknown; name?: unknown };
  if (typeof body.url !== "string" || !body.url.trim()) return apiError(400, "Paste a playlist link.");
  const url = body.url, name = typeof body.name === "string" ? body.name : undefined;
  return music(() => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(out) {
        const say = (value: unknown) => { try { out.enqueue(encoder.encode(`${JSON.stringify(value)}\n`)); } catch { /* the reader left */ } };
        try {
          await importPlaylist(user.username, url, say, name);
        } catch (error) {
          if (!(error instanceof MusicProblem)) console.error("music import:", error);
          say({ stage: "error", error: error instanceof MusicProblem ? error.message : "That playlist couldn't be brought in. Try again in a moment." });
        }
        try { out.close(); } catch { /* closed */ }
      },
    });
    return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" } });
  });
}
