/*
 * What kimono-books asks Kimono Books to change: `kimono-books-change {…}` lines in its
 * output (infra/sandbox/bin/kimono-books), taken out of what the chat shows. Pure, so
 * events.ts can use it on both sides; lib/code/books.ts applies them.
 */

export type BookChange = { do: "shelve" | "rate" | "progress" | "review"; value: unknown; key?: string; isbn?: string; query?: string };

/** The kimono-books changes in a command's output, and the output without the lines that carry them. */
export function bookChanges(text: string): { changes: BookChange[]; shown: string } {
  if (!text.includes("kimono-books-change ")) return { changes: [], shown: text };
  const changes: BookChange[] = [];
  const shown = text.split("\n").filter((line) => {
    const found = /^kimono-books-change (\{.*\})\s*$/.exec(line);
    if (!found) return true;
    try {
      const c = JSON.parse(found[1]) as Record<string, unknown>;
      const ref = { ...(typeof c.key === "string" ? { key: c.key.slice(0, 120) } : {}), ...(typeof c.isbn === "string" ? { isbn: c.isbn.slice(0, 20) } : {}), ...(typeof c.query === "string" ? { query: c.query.slice(0, 200) } : {}) };
      if (["shelve", "rate", "progress", "review"].includes(c.do as string) && Object.keys(ref).length && changes.length < 20) changes.push({ do: c.do as BookChange["do"], value: c.value ?? null, ...ref });
    } catch { /* not ours */ }
    return false;
  }).join("\n");
  return { changes, shown };
}
