import { apiError, apiUser, unauthorized } from "@/lib/api-v1";
import { musicSettings, MusicProblem, recordingOf } from "@/lib/music";
import { serveAudio } from "@/lib/music/audio";

export const dynamic = "force-dynamic";

const parseRange = (header: string | null) => {
  const m = /^bytes=(\d+)-(\d*)$/.exec(header?.trim() ?? "");
  return m ? { start: Number(m[1]), end: m[2] ? Number(m[2]) : undefined } : undefined;
};

/**
 * `?key=dz:…`: the song's audio (AAC in MP4), with byte ranges so the player
 * can seek. The first time anyone plays it, it arrives as it's fetched; after
 * that it's served from the server's copy.
 */
export async function GET(request: Request) {
  if (!(await apiUser())) return unauthorized();
  const config = await musicSettings();
  if (!config.enabled) return apiError(404, "Music isn't switched on.");
  try {
    const video = await recordingOf(new URL(request.url).searchParams.get("key") ?? "");
    const served = await serveAudio(config, video, parseRange(request.headers.get("range")));
    const headers = new Headers({ "content-type": served.mime, "accept-ranges": "bytes", "cache-control": "private, max-age=86400" });
    if (served.range) {
      headers.set("content-range", `bytes ${served.range.start}-${served.range.end}/${served.size}`);
      headers.set("content-length", String(served.range.end - served.range.start + 1));
      return new Response(served.body, { status: 206, headers });
    }
    headers.set("content-length", String(served.size));
    return new Response(served.body, { status: 200, headers });
  } catch (error) {
    if (error instanceof MusicProblem) return apiError(error.status, error.message);
    console.error("music stream:", error);
    return apiError(502, "This song won't play right now.");
  }
}
