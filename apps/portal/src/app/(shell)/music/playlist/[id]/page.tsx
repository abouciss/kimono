import { notFound } from "next/navigation";
import { PlaylistView } from "../../views";

export default async function MusicPlaylist({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[\w-]{1,64}$/.test(id)) notFound();
  return <PlaylistView key={id} id={id} />;
}
