import { trickplayFile } from "@/lib/watch";

type Context = { params: Promise<{ token: string; file: string }> };

/* The scrubber's pictures: index.json and the sheets. The sealed token is the permission, like a stream's. */
export async function GET(_request: Request, { params }: Context) {
  const { token, file } = await params;
  return trickplayFile(token, file);
}
