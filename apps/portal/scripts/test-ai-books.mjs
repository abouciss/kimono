import assert from "node:assert/strict";
import { test } from "node:test";
import { bookChanges } from "../src/lib/code/book-changes.ts";
import { kimonoCommand } from "../src/lib/code/kimono-commands.ts";

test("kimono-books changes come out of the output the chat shows", () => {
  const out = 'kimono-books-change {"do": "shelve", "value": "read", "key": "ol:OL893415W"}\nPut on Read: Dune.\nkimono-books-change {"do": "rate", "value": "love", "query": "Project Hail Mary by Andy Weir"}\nRated it.';
  const { changes, shown } = bookChanges(out);
  assert.deepEqual(changes, [{ do: "shelve", value: "read", key: "ol:OL893415W" }, { do: "rate", value: "love", query: "Project Hail Mary by Andy Weir" }]);
  assert.equal(shown, "Put on Read: Dune.\nRated it.");
});

test("lines that aren't kimono-books' own change nothing", () => {
  assert.deepEqual(bookChanges('kimono-books-change {"do": "delete", "key": "ol:x"}').changes, []);
  assert.deepEqual(bookChanges('kimono-books-change {"do": "rate", "value": "up"}').changes, []);
  assert.deepEqual(bookChanges("echo kimono-books-change {}").changes, []);
  assert.equal(bookChanges("plain output").shown, "plain output");
});

test("kimono-books reads as words in the chat", () => {
  assert.deepEqual(kimonoCommand('kimono-books shelve "Dune by Frank Herbert" reading'), { label: "Put on Reading", detail: "Dune by Frank Herbert", doing: "Changing your books" });
  assert.equal(kimonoCommand("kimono-books rate ol:OL1W love")?.label, "Marked loved");
  assert.equal(kimonoCommand("kimono-books rate ol:OL1W love")?.detail, undefined);
  assert.equal(kimonoCommand("kimono-books search sci fi")?.detail, "sci fi");
  assert.equal(kimonoCommand("kimono-books list --shelf read | head -20")?.label, "Looked through your books");
});
