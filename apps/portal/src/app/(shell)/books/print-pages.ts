/*
 * The print edition's page numbers, when the publisher marked them (EPUB 3's
 * page-list in the nav document, or EPUB 2's pageList in toc.ncx). An EPUB
 * reflows, so these are the only page numbers that mean the same thing on
 * every screen: what you'd cite, or what a class says to turn to.
 *
 * epub.js reads a page-list only when its links are CFIs, which publishers
 * don't write, so each marker (chapter.xhtml#page_112) is found in its
 * chapter here and turned into a CFI once, after the book opens.
 */

export type PrintPage = { label: string; cfi: string };

type Section = { href: string; document?: Document; load(request: unknown): Promise<unknown>; unload(): void; cfiFromElement(el: Element): string };
export type PagedBook = {
  packaging: { navPath?: string; ncxPath?: string };
  spine: { get(target: string): Section | null };
  load(path: string): Promise<unknown>;
};
type Cfi = { compare(a: string, b: string): number };

const OPS = "http://www.idpf.org/2007/ops";
const typeOf = (el: Element) => el.getAttributeNS(OPS, "type") ?? el.getAttribute("epub:type") ?? "";

/* The marks as written: a label ("112", or "xii" in the front matter) and where it points, from the package's folder. */
function marks(doc: Document, from: string): { label: string; href: string }[] {
  const out: { label: string; href: string }[] = [];
  const nav = [...doc.getElementsByTagName("nav")].find((n) => typeOf(n).split(/\s+/).includes("page-list"));
  if (nav) {
    for (const a of nav.getElementsByTagName("a")) {
      const label = (a.textContent ?? "").replace(/\s+/g, " ").trim(), href = a.getAttribute("href");
      if (label && href) out.push({ label, href });
    }
  } else {
    for (const t of doc.getElementsByTagName("pageTarget")) {
      const label = (t.getElementsByTagName("text")[0]?.textContent ?? t.getAttribute("value") ?? "").trim();
      const href = t.getElementsByTagName("content")[0]?.getAttribute("src");
      if (label && href) out.push({ label, href });
    }
  }
  /* Links are written from the nav document's folder; the spine knows them from the package's. */
  const base = new URL(from, "http://book/");
  return out.map((m) => {
    const u = new URL(m.href, base);
    return { label: m.label, href: decodeURIComponent(u.pathname.slice(1)) + u.hash };
  });
}

async function navDocument(book: PagedBook): Promise<{ doc: Document; path: string } | null> {
  for (const path of [book.packaging.navPath, book.packaging.ncxPath]) {
    if (!path) continue;
    try {
      const doc = await book.load(path);
      if (doc instanceof Document && marks(doc, path).length) return { doc, path };
    } catch { /* no page list there */ }
  }
  return null;
}

export async function printPages(book: PagedBook, epubcfi: Cfi, cancelled: () => boolean): Promise<PrintPage[]> {
  const nav = await navDocument(book);
  if (!nav) return [];
  const all = marks(nav.doc, nav.path);
  const bySection = new Map<Section, { label: string; id: string; at: number }[]>();
  all.forEach((m, at) => {
    const [file, id = ""] = m.href.split("#");
    const section = book.spine.get(file) ?? book.spine.get(encodeURI(file));
    if (!section) return;
    bySection.set(section, [...bySection.get(section) ?? [], { label: m.label, id: decodeURIComponent(id), at }]);
  });
  const found: (PrintPage & { at: number })[] = [];
  for (const [section, pages] of bySection) {
    if (cancelled()) return [];
    try {
      await section.load(book.load.bind(book));
      const doc = section.document;
      if (!doc) continue;
      for (const p of pages) {
        const el = p.id ? doc.getElementById(p.id) ?? doc.querySelector(`[id="${CSS.escape(p.id)}"]`) : doc.body ?? doc.documentElement;
        if (el) found.push({ label: p.label, cfi: section.cfiFromElement(el), at: p.at });
      }
    } catch { /* a chapter that won't load just has no page numbers */ } finally {
      section.unload();
    }
  }
  /* In reading order, which finding the page you're on relies on (the list is, nearly always, already). */
  return found.sort((a, b) => { try { return epubcfi.compare(a.cfi, b.cfi) || a.at - b.at; } catch { return a.at - b.at; } }).map(({ label, cfi }) => ({ label, cfi }));
}

/* The print page a place falls on: the last marker at or before it. */
export function pageAt(pages: PrintPage[], cfi: string, epubcfi: Cfi): PrintPage | null {
  let lo = 0, hi = pages.length - 1, hit = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    let c = 0;
    try { c = epubcfi.compare(pages[mid].cfi, cfi); } catch { return null; }
    if (c <= 0) { hit = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return hit >= 0 ? pages[hit] : null;
}

/* A page someone types, as the book labels it ("112", "xii", "A-3"). */
export function findPage(pages: PrintPage[], typed: string): PrintPage | null {
  const want = typed.trim().toLowerCase().replace(/^p(age|\.)?\s*/, "");
  return want ? pages.find((p) => p.label.toLowerCase() === want) ?? null : null;
}
