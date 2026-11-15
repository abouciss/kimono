import { notFound } from "next/navigation";
import { SongView } from "../../views";

/** A song's own address, /music/song/<Deezer id>: what you send someone. */
export default async function MusicSong({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,20}$/.test(id)) notFound();
  return <SongView key={id} id={id} />;
}
