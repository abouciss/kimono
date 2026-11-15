import { notFound } from "next/navigation";
import { GenreView } from "../../views";

export default async function MusicGenre({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,9}$/.test(id)) notFound();
  return <GenreView key={id} id={Number(id)} />;
}
