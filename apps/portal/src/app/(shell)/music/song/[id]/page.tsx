import { notFound } from "next/navigation";
import { SongView } from "../../views";

/** A song's own address, /music/song/<Deezer id> (or yt-<video> for one only YouTube has): what you send someone. */
export default async function MusicSong({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^(\d{1,20}|yt-[A-Za-z0-9_-]{11})$/.test(id)) notFound();
  return <SongView key={id} id={id} />;
}
