import { apiError, apiJson, apiUser, unauthorized } from "@/lib/api-v1";
import { forgetMissingRecording, getTrack, musicSettings, recordingOf } from "@/lib/music";
import { audioReport, probeSources } from "@/lib/music/audio";
import { recordingCandidates } from "@/lib/music/youtube";

export const dynamic = "force-dynamic";

/**
 * `?key=`: why a song won't play, step by step: the song, the YouTube
 * recording it maps to, the server's copy (and how it last failed), then
 * each way of fetching its audio tried live. For Music's "Why?".
 */
export async function GET(request: Request) {
  if (!(await apiUser())) return unauthorized();
  const config = await musicSettings();
  if (!config.enabled) return apiError(404, "Music isn't switched on.");
  const key = new URL(request.url).searchParams.get("key") ?? "";
  try { return await report(config, key); } catch (error) {
    console.error("music why:", error);
    return apiError(500, `The check itself failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function report(config: Awaited<ReturnType<typeof musicSettings>>, key: string) {
  const said = (error: unknown) => (error instanceof Error ? error.message : String(error));
  const steps: { step: string; ok: boolean; said: string }[] = [];
  const track = await getTrack(key).catch((e) => { steps.push({ step: "Song", ok: false, said: said(e) }); return null; });
  if (track) steps.push({ step: "Song", ok: true, said: `${track.title} · ${track.artists.map((a) => a.name).join(", ")} · ${track.duration}s (${key})` });
  else if (!steps.length) steps.push({ step: "Song", ok: false, said: `No song ${key}` });
  let video: string | null = null;
  /* Looked for afresh: a lookup that failed before isn't taken as the answer here. */
  forgetMissingRecording(key);
  try { video = await recordingOf(key); steps.push({ step: "Recording", ok: true, said: `https://youtu.be/${video}` }); }
  catch (e) {
    steps.push({ step: "Recording", ok: false, said: said(e) });
    /* What YouTube Music offered, and why each was turned down (a score of 0), so a near miss shows. */
    if (track) {
      const c = await recordingCandidates(track).catch(() => null);
      if (c) steps.push({ step: "YouTube Music offered", ok: false, said: [`searched “${c.query}”, ${track.duration}s wanted`, ...c.offered.map((o) => `${o.score > 0 ? "✓" : "·"} ${o.kind} ${o.title} — ${o.by} · ${o.seconds}s · score ${o.score} · https://youtu.be/${o.id}`)].join("\n") });
    }
  }
  if (video) {
    const r = audioReport(video);
    steps.push({ step: "Server's copy", ok: Boolean(r.kept), said: r.kept ? `kept, ${(r.kept.size / 1024 / 1024).toFixed(1)} MB` : r.arriving ? `arriving via ${r.arriving.via}: ${r.arriving.got} of ${r.arriving.size} bytes` : "not kept yet" });
    if (r.lastFailure) steps.push({ step: "Last failure", ok: false, said: `${new Date(r.lastFailure.at).toISOString()}: ${r.lastFailure.notes.join(" → ")}` });
    if (r.fastPathOff) steps.push({ step: "YouTube.js", ok: false, said: `sitting out for ${Math.ceil(r.fastPathOff / 60_000)} more min after a failure; yt-dlp goes first` });
    for (const p of await probeSources(config, video)) steps.push({ step: `Try ${p.via}`, ok: p.ok, said: `${p.said} (${p.ms} ms)` });
  }
  return apiJson({ key, steps });
}
