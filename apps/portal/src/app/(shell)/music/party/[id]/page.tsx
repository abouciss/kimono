import { notFound } from "next/navigation";
import { PartyPageView } from "../../party-ui";

/** A listen party's link, /music/party/<id>: what you send friends so they join. */
export default async function MusicParty({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[A-Za-z0-9_-]{8,40}$/.test(id)) notFound();
  return <PartyPageView key={id} id={id} />;
}
