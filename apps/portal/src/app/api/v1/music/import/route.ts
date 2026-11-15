import { apiError, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { music, MusicProblem } from "@/lib/music";
import { readMine } from "@/lib/music/connect";
import { fromLink, importPlaylist, type Service } from "@/lib/music/imports";

export const dynamic = "force-dynamic";
export const maxDuration = 900;

/**
 * `{ url, name? }`, or `{ service, playlist }` for one of your own on a
 * service you've connected: a Spotify, Apple Music or YouTube Music
 * playlist made a playlist here. Answers as it goes, one JSON object a line: `read`, then
 * `match` with how many are done, then `done` (or `error`).
 */
export async function POST(request: Request) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if ("response" in read) return read.response;
  const body = (read.body ?? {}) as { url?: unknown; name?: unknown; service?: unknown; playlist?: unknown };
  const mine = (body.service === "spotify" || body.service === "apple" || body.service === "youtube") && typeof body.playlist === "string";
  if (!mine && (typeof body.url !== "string" || !body.url.trim())) return apiError(400, "Paste a playlist link.");
  const name = typeof body.name === "string" ? body.name : undefined;
  return music((config) => {
    const source = mine ? () => readMine(config, user.username, body.service as Service, body.playlist as string) : fromLink(body.url as string);
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(out) {
        const say = (value: unknown) => { try { out.enqueue(encoder.encode(`${JSON.stringify(value)}\n`)); } catch { /* the reader left */ } };
        try {
          await importPlaylist(user.username, source, say, name);
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
