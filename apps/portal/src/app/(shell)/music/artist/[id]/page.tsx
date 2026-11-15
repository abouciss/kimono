import { notFound } from "next/navigation";
import { ArtistView } from "../../views";

export default async function MusicArtist({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,20}$/.test(id)) notFound();
  return <ArtistView key={id} id={id} />;
}
