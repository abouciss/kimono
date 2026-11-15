export const dynamic = "force-dynamic";

/** The server's clock, `{ now }` in ms, for listen-party players to set theirs by (NTP-style). Answered at once, so the round trip stays even. */
export function GET() {
  return Response.json({ now: Date.now() }, { headers: { "Cache-Control": "no-store" } });
}
