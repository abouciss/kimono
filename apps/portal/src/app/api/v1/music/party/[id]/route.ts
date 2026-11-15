import { apiError, apiJson, apiUser, crossSite, readJson, unauthorized } from "@/lib/api-v1";
import { music, musicSettings } from "@/lib/music";
import { cleanClient, cleanPartyId } from "@/lib/music/party";
import { act, listen, partyNow, type LiveEvent } from "@/lib/music/party-live";

type Context = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

/**
 * A listen party. As JSON: `{ state, chat, people }` now. As
 * `text/event-stream` with `?client=<id>`: `state` now and after every change,
 * `chat`, `react`, `ping` every 10 s with the server's clock, and `ended`.
 */
export async function GET(request: Request, { params }: Context) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const id = cleanPartyId((await params).id);
  if (!id) return apiError(404, "This listen party has ended.");
  if (!request.headers.get("accept")?.includes("text/event-stream")) return music(async () => apiJson(await partyNow(id, user.username)));
  const client = cleanClient(new URL(request.url).searchParams.get("client"));
  if (!client) return apiError(400, "Say which player this is.");
  const config = await musicSettings();
  if (!config.enabled) return apiError(404, "Music isn't switched on.");
  const encoder = new TextEncoder();
  let close = () => {};
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (text: string) => { try { controller.enqueue(encoder.encode(text)); } catch { close(); } };
      const send = (event: LiveEvent) => {
        if (event.type === "state") write(`id: ${event.state.seq}\nevent: state\ndata: ${JSON.stringify(event.state)}\n\n`);
        else write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
        if (event.type === "ended") close();
      };
      write("retry: 1500\n\n");
      const stop = await listen(config, id, client, user.username, send).catch(() => null);
      if (!stop) { write("event: ended\ndata: {}\n\n"); try { controller.close(); } catch { /* closed */ } return; }
      const beat = setInterval(() => write(`event: ping\ndata: {"now":${Date.now()}}\n\n`), 10_000);
      close = () => { clearInterval(beat); stop(); try { controller.close(); } catch { /* closed */ } };
      request.signal.addEventListener("abort", () => close());
    },
    cancel() { close(); },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store", "X-Accel-Buffering": "no", Connection: "keep-alive" } });
}

/** Something a player does (lib/music/party-live.ts `act`). Answers `{ ok, state }`; 409 `stale` when someone moved first. */
export async function POST(request: Request, { params }: Context) {
  const refused = crossSite(request);
  if (refused) return refused;
  const user = await apiUser();
  if (!user) return unauthorized();
  const id = cleanPartyId((await params).id);
  if (!id) return apiError(404, "This listen party has ended.");
  const read = await readJson(request);
  if ("response" in read) return read.response;
  return music(async (config) => {
    const { status, body } = await act(config, id, user.username, (read.body ?? {}) as Record<string, unknown>);
    return apiJson(body, status);
  });
}
