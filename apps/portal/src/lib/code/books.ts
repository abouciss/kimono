import "server-only";

import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { booksSettings, byIsbn, getBook, listShelf, search, setProgress, setRating, setReview, setShelf, shelfStateOf, type Book, type Rating, type ShelfState } from "../books";
import type { CodeConfig } from "./config";
import { shared } from "./history";
import type { Workspace } from "./model";
import { sandbox } from "./node";
import type { BookChange } from "./book-changes";

/*
 * Kimono Books in Kimono AI (docs/kimono-ai.md, "Books").
 *
 * Before each of the owner's turns, their library goes into the sandbox at
 * .kimono/books/library.json (kept out of git and of Drive): every book on
 * their shelves with how far they are, how they rated it and their review.
 * kimono-books reads it there. A chat shared with anyone gets none of it, as
 * with earlier chats.
 *
 * Changes come back as `kimono-books-change {…}` lines in kimono-books'
 * output, read here from the tool results and applied to the owner's shelves
 * only. What couldn't be applied is told to the agent with the next message.
 */

export const booksDir = ".kimono/books";

const shelves: ShelfState[] = ["want", "reading", "read"];
const ratings: Rating[] = ["down", "up", "love"];

const words = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1);

/** The book a change names: its key, its ISBN, or "Title by Author" found in Books and matching every word of the title. */
async function bookFor(change: BookChange): Promise<Book | null> {
  if (change.key) return getBook(change.key);
  const config = await booksSettings();
  if (change.isbn) return (await byIsbn(config, change.isbn).catch(() => []))[0] ?? null;
  if (!change.query) return null;
  const [title, author] = change.query.split(/\s+by\s+/i);
  const wanted = words(title);
  const by = words(author ?? "");
  const found = await search(config, change.query, 10);
  return found.find((b) => {
    const has = new Set(words(`${b.title} ${b.subtitle}`));
    const wrote = new Set(words(b.authors.join(" ")));
    return wanted.every((w) => has.has(w)) && by.every((w) => wrote.has(w));
  }) ?? null;
}

/* What couldn't be done, per chat, for the agent's next message. */
const missed = new Map<string, string[]>();

/** Applies what kimono-books asked, on the owner's own shelves; only ever called for the owner's turns in an unshared chat. */
export async function applyBookChanges(db: DatabaseSync, workspace: Workspace, changes: BookChange[]): Promise<void> {
  if (!changes.length || shared(db, workspace.id) || !(await booksSettings()).enabled) return;
  const owner = workspace.owner;
  for (const change of changes) {
    const named = change.key ?? (change.isbn ? `ISBN ${change.isbn}` : `"${change.query}"`);
    try {
      const book = await bookFor(change);
      if (!book) { missed.set(workspace.id, [...(missed.get(workspace.id) ?? []), `${named} wasn't found in Books`]); continue; }
      const v = change.value;
      if (change.do === "shelve" && (v === null || shelves.includes(v as ShelfState))) setShelf(owner, book.key, v as ShelfState | null);
      else if (change.do === "rate" && (v === null || ratings.includes(v as Rating))) setRating(owner, book.key, v as Rating | null);
      else if (change.do === "progress" && typeof v === "number" && v >= 0 && v <= 100) await setProgress(await booksSettings(), owner, { key: book.key }, v / 100);
      else if (change.do === "review" && (v === null || typeof v === "string")) setReview(owner, book.key, v as string | null);
    } catch (error) {
      missed.set(workspace.id, [...(missed.get(workspace.id) ?? []), `${named} couldn't be changed: ${error instanceof Error ? error.message : "it failed"}`]);
    }
  }
  /* The library in the sandbox follows at once, for a later step this turn. */
  written.delete(workspace.id);
}

/** What kimono-books couldn't do last time, said once. */
export function takeBookMisses(workspaceId: string): string {
  const list = missed.get(workspaceId);
  missed.delete(workspaceId);
  return list?.length ? `Kimono Books didn't take some of your last changes: ${list.join("; ")}. Tell them if it matters.` : "";
}

/* The library last written to each chat's sandbox, by its hash: written again only when it changed. */
const written = new Map<string, string>();

function libraryOf(owner: string) {
  return {
    books: listShelf(owner).map((item) => {
      const book = getBook(item.key);
      const mine = shelfStateOf(owner, item.key);
      return {
        key: item.key, title: item.title, authors: item.authors, year: item.year,
        isbns: book?.isbns.slice(0, 4) ?? [], genres: book?.genres ?? [],
        state: item.state, percent: Math.round(item.fraction * 100), rating: item.rating,
        review: mine?.review ?? null, updated: item.updatedAt.slice(0, 10),
      };
    }),
  };
}

/** A sandbox made again from nothing has no library in it: write it again. */
export const forgetBooksWritten = (workspaceId: string) => { written.delete(workspaceId); };

/** Brings the sandbox's copy of the owner's library up to date. Returns whether the chat has it, for the instructions. */
export async function syncBooks(db: DatabaseSync, config: CodeConfig, workspace: Workspace, byOwner: boolean): Promise<boolean> {
  const on = byOwner && !shared(db, workspace.id) && (await booksSettings()).enabled;
  if (!on) {
    if (written.has(workspace.id) || !byOwner || shared(db, workspace.id)) {
      written.delete(workspace.id);
      await sandbox.removeFile(config, workspace, `${booksDir}/library.json`).catch(() => {});
    }
    return false;
  }
  const body = JSON.stringify(libraryOf(workspace.owner));
  const hash = createHash("sha256").update(body).digest("hex");
  if (written.get(workspace.id) !== hash) {
    await sandbox.write(config, workspace, `${booksDir}/library.json`, new TextEncoder().encode(body));
    written.set(workspace.id, hash);
  }
  return true;
}

/** What Kimono AI is told about Kimono Books, when the chat has the library. */
export const booksNote = [
  "Kimono Books is where they keep what they read: shelves Want to read, Reading and Read, how far along they are, a rating (down, up or love) and their reviews. Their library is in /workspace/.kimono/books, read with kimono-books:",
  "- `kimono-books list [--shelf want|reading|read]`, `kimono-books search <words>`, `kimono-books show <book>`. Look before recommending a book, saying what they've read or picking what's next, so you don't suggest one they've finished or disliked; lean on what they loved.",
  "- When they say they started, finished, want to read, liked or got partway through a book, change it for them in the same turn: `kimono-books shelve <book> want|reading|read|off`, `rate <book> down|up|love|off`, `progress <book> <percent>`, `review <book> \"<their words>\"`. <book> is its key from their library, an ISBN, or \"Title by Author\" for one not in it yet. Write a review only in their words, when they ask.",
  "- Afterwards say what changed in a few words (\"Put Dune on Reading.\"). Call them shelves and books, never files or keys.",
].join("\n");
