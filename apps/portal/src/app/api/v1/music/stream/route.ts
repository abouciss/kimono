import { apiError, apiUser, unauthorized } from "@/lib/api-v1";
import { musicSettings, MusicProblem, onServer, recordingOf } from "@/lib/music";
import { serveAudio } from "@/lib/music/audio";
import { pace } from "@/lib/music/pace";

export const dynamic = "force-dynamic";

const parseRange = (header: string | null) => {
  const m = /^bytes=(\d+)-(\d*)$/.exec(header?.trim() ?? "");
  return m ? { start: Number(m[1]), end: m[2] ? Number(m[2]) : undefined } : undefined;
};

/**
 * `?key=dz:…`: the song's audio (AAC in MP4), with byte ranges so the player
 * can seek. The first time anyone plays it, it arrives as it's fetched; after
 * that it's served from the server's copy.
 *
 * `&for=keep` is a download in bulk (a phone keeping a playlist): one the
 * server doesn't have yet takes its turn with YouTube (./pace.ts), and until
 * then is answered 503 with Retry-After, the seconds to wait.
 */
export async function GET(request: Request) {
  if (!(await apiUser())) return unauthorized();
  const config = await musicSettings();
  if (!config.enabled) return apiError(404, "Music isn't switched on.");
  const params = new URL(request.url).searchParams;
  const key = params.get("key") ?? "";
  let settled: (() => void) | undefined;
  if (params.get("for") === "keep" && !onServer(key)) {
    const turn = pace().claimSong();
    if ("wait" in turn) {
      const seconds = Math.max(1, Math.ceil(turn.wait / 1000));
      return Response.json({ error: "Waiting its turn.", wait: seconds }, { status: 503, headers: { "retry-after": String(seconds), "cache-control": "no-store" } });
    }
    settled = turn.release;
  }
  try {
    const video = await recordingOf(key);
    const served = await serveAudio(config, video, parseRange(request.headers.get("range")), settled);
    const headers = new Headers({ "content-type": served.mime, "accept-ranges": "bytes", "cache-control": "private, max-age=86400" });
    if (served.range) {
      headers.set("content-range", `bytes ${served.range.start}-${served.range.end}/${served.size}`);
      headers.set("content-length", String(served.range.end - served.range.start + 1));
      return new Response(served.body, { status: 206, headers });
    }
    headers.set("content-length", String(served.size));
    return new Response(served.body, { status: 200, headers });
  } catch (error) {
    settled?.();
    if (error instanceof MusicProblem) return apiError(error.status, error.message);
    console.error("music stream:", error);
    return apiError(502, "This song won't play right now.");
  }
}
