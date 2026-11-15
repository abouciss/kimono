import { notFound } from "next/navigation";
import { AlbumView } from "../../views";

export default async function MusicAlbum({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,20}$/.test(id)) notFound();
  return <AlbumView key={id} id={id} />;
}
