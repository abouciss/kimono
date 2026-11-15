"use client";

import { Crossing, useCrossTo } from "@/components/crossing";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AppLockup, cx, InkPortraitFrame, Seal, type AppIdentity } from "@kimono/ui";
import { useTabTitle } from "@/components/tab-title";
import { clock, forget, hrefOf, length, musicApi, useMusic, type Album, type Track } from "./api";
import { askName, askSure } from "./ask";
import { Icon } from "./icons";
import { AlbumCard, ArtistCard, Cover, Head, Loading, MoreButton, Mosaic, PlayActions, playlistItems, Problem, RateMarks, SetCard, Shelf, Songs } from "./parts";
import { usePlayer } from "./player";

/* ── Along the top of every page: search, and where you are ────────────── */

export function TopBar({ app }: { app: AppIdentity }) {
  const router = useRouter();
  const path = usePathname();
  const home = path === "/music";
  /* Pages opened inside Music this visit: back goes to the last of them, else up to Music's home. */
  const steps = useRef(-1);
  useEffect(() => { steps.current += 1; }, [path]);
  const params = useSearchParams();
  const onSearch = path === "/music/search";
  const crossTo = useCrossTo();
  const [text, setText] = useState(onSearch ? params.get("q") ?? "" : "");
  /* Leaving search empties the field (set while drawing, as React has it for a change from outside). */
  const [wasSearch, setWasSearch] = useState(onSearch);
  if (wasSearch !== onSearch) { setWasSearch(onSearch); if (!onSearch) setText(""); }
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const slash = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (e.key === "/" && el?.tagName !== "INPUT" && el?.tagName !== "TEXTAREA") { e.preventDefault(); input.current?.focus(); }
    };
    addEventListener("keydown", slash);
    return () => removeEventListener("keydown", slash);
  }, []);
  /* Typing searches as you go; the address follows, so back returns to the results. */
  useEffect(() => {
    if (!onSearch && !text.trim()) return;
    const t = setTimeout(() => {
      const url = text.trim() ? `/music/search?q=${encodeURIComponent(text.trim())}` : "/music/search";
      /* Results change in place as you type: the same page, so no crossing for each letter. */
      // eslint-disable-next-line no-restricted-syntax -- the search page replacing its own query, not a move between pages
      if (onSearch) router.replace(url, { scroll: false }); else if (text.trim()) crossTo("kakejiku", url);
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on what's typed
  }, [text]);
  return <div className="km-top">
    <div className="km-top-start">
      {home ? null : <button type="button" className="km-iconbtn km-back" data-nav-back aria-label="Back"
        onClick={() => { if (steps.current > 0) { steps.current -= 2; history.back(); } else crossTo("kakejiku", "/music"); }}><Icon name="back" /></button>}
      <Crossing kind="kakejiku" href="/music" className="km-brand" aria-label="Kimono Music, home"><AppLockup identity={app} /></Crossing>
    </div>
    <label className="km-search">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" /></svg>
      <input ref={input} type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Songs, albums, artists" aria-label="Search Music"
        onKeyDown={(e) => { if (e.key === "Escape") { setText(""); input.current?.blur(); } }} />
    </label>
    <nav className="km-tabs" aria-label="Music">
      <Crossing kind="kakejiku" href="/music" aria-current={path === "/music" ? "page" : undefined}>Home</Crossing>
      <Crossing kind="kakejiku" href="/music/library" aria-current={path.startsWith("/music/library") ? "page" : undefined}>Library</Crossing>
    </nav>
  </div>;
}

/* ── Home ──────────────────────────────────────────────────────────────── */

export function HomeView() {
  useTabTitle(undefined, "Kimono Music");
  const p = usePlayer();
  const { data: home, error, retry } = useMusic("home", musicApi.home);
  if (error) return <Problem text={error} onRetry={retry} />;
  if (!home) return <Loading />;
  return <div className="km-page km-home">
    {home.jumpBack.length ? <section className="km-jump">
      <h2 className="k-heading">Jump back in</h2>
      <div className="km-jump-grid">
        {home.jumpBack.slice(0, 8).map((t, i) => <button key={t.key} type="button" className={cx("km-jump-tile", p.current?.key === t.key && "km-now")}
          onClick={() => p.play(home.jumpBack, i, { kind: "history", id: "recent", title: "Recently played" })}>
          <Cover src={t.album?.cover} size={56} />
          <span className="km-jump-name"><span>{t.title}</span><span className="km-jump-by">{t.artists[0]?.name}</span></span>
          <Icon name="play" className="km-jump-mark" />
        </button>)}
      </div>
    </section> : null}

    {home.mixes.length ? <Shelf title="Made for you">
      {home.mixes.map((m) => <SetCard key={m.id} title={m.title} sub={`${m.items.length} songs`} covers={[...new Set(m.items.map((t) => t.album?.cover).filter((c): c is string => Boolean(c)))]}
        href={hrefOf.mix(m.id)} onPlay={() => p.play(m.items, 0, { kind: "mix", id: m.id, title: m.title })} />)}
    </Shelf> : null}

    {home.playlists.length ? <Shelf title="Your playlists" href="/music/library">
      {home.playlists.map((pl) => <SetCard key={pl.id} title={pl.name} sub={`${pl.count} songs`} covers={pl.covers} href={hrefOf.playlist(pl.id)} />)}
    </Shelf> : null}

    <section className="km-chart">
      <header><h2 className="k-heading">{home.charts.title}</h2><Crossing kind="kakejiku" className="km-shelf-all" href={hrefOf.mix("chart")}>Show all</Crossing></header>
      <Songs tracks={home.charts.items.slice(0, 10)} source={{ kind: "mix", id: "chart", title: home.charts.title }} numbered className="km-chart-songs" />
    </section>

    {home.artists.length ? <Shelf title={home.greeting === "back" ? "Artists for you" : "Popular artists"}>
      {home.artists.map((a) => <ArtistCard key={a.key} artist={a} />)}
    </Shelf> : null}

    {home.albums.length ? <Shelf title="Popular albums">
      {home.albums.map((a) => <AlbumCard key={a.key} album={a} />)}
    </Shelf> : null}

    {home.genres.length ? <section className="km-genres">
      <h2 className="k-heading">Genres</h2>
      <div className="km-genre-grid">
        {home.genres.map((g) => <Crossing kind="kakejiku" key={g.id} href={hrefOf.genre(g.id)} className="km-genre"><span>{g.name}</span>{g.picture ? <Cover src={g.picture} className="km-genre-art" /> : null}</Crossing>)}
      </div>
    </section> : null}
  </div>;
}

/* ── Search ────────────────────────────────────────────────────────────── */

export function SearchView() {
  const q = useSearchParams().get("q")?.trim() ?? "";
  useTabTitle(q ? `“${q}”` : "Search", "Kimono Music");
  const { data, error, retry } = useMusic(q ? `search:${q.toLowerCase()}` : null, () => musicApi.search(q));
  if (!q) return <div className="km-page"><p className="km-quiet">Find any song, album or artist.</p></div>;
  if (error) return <Problem text={error} onRetry={retry} />;
  if (!data) return <Loading />;
  if (!data.tracks.length && !data.albums.length && !data.artists.length) return <div className="km-page"><p className="km-quiet">Nothing found for “{q}”.</p></div>;
  const top = data.artists[0];
  return <div className="km-page km-results">
    <div className="km-results-top">
      {top ? <section className="km-best">
        <h2 className="k-heading">Top result</h2>
        <Crossing kind="kakejiku" href={hrefOf.artist(top.key)} className="km-best-card">
          <Cover src={top.picture} round size={112} />
          <span className="km-best-name">{top.name}</span>
          <span className="km-card-sub">Artist</span>
        </Crossing>
      </section> : null}
      {data.tracks.length ? <section className="km-results-songs">
        <h2 className="k-heading">Songs</h2>
        <Songs tracks={data.tracks.slice(0, 6)} source={{ kind: "search", id: q, title: `“${q}”` }} album={false} />
      </section> : null}
    </div>
    {data.artists.length > 1 ? <Shelf title="Artists">{data.artists.map((a) => <ArtistCard key={a.key} artist={a} />)}</Shelf> : null}
    {data.albums.length ? <Shelf title="Albums">{data.albums.map((a) => <AlbumCard key={a.key} album={a} />)}</Shelf> : null}
    {data.tracks.length > 6 ? <section><h2 className="k-heading">More songs</h2><Songs tracks={data.tracks.slice(6)} source={{ kind: "search", id: q, title: `“${q}”` }} /></section> : null}
  </div>;
}

/* ── An artist ─────────────────────────────────────────────────────────── */

const kindOrder: Album["kind"][] = ["album", "ep", "single", "compile"];

export function ArtistView({ id }: { id: string }) {
  const key = `dz:${id}`;
  const p = usePlayer();
  const { data, error, retry } = useMusic(`artist:${key}`, () => musicApi.artist(key));
  const [more, setMore] = useState(false);
  useTabTitle(data?.artist.name, "Kimono Music");
  if (error) return <Problem text={error} onRetry={retry} />;
  if (!data) return <Loading />;
  const { artist, top, albums, related } = data;
  const source = { kind: "artist", id: key, title: artist.name };
  const albumsOnly = albums.filter((a) => a.kind === "album");
  const rest = albums.filter((a) => a.kind !== "album").sort((a, b) => kindOrder.indexOf(a.kind) - kindOrder.indexOf(b.kind) || (b.year ?? 0) - (a.year ?? 0));
  return <div className="km-page">
    <Head kind="Artist" title={artist.name}
      art={<InkPortraitFrame seed={key} weight={4}><Cover src={artist.picture} quality="full" round className="km-head-portrait" /></InkPortraitFrame>}
      meta={<>{artist.fans ? `${artist.fans.toLocaleString()} fans` : null}{artist.tags.length ? <span className="km-tags">{artist.tags.slice(0, 4).map((t) => <span key={t} className="km-tag">{t}</span>)}</span> : null}</>}>
      <PlayActions tracks={top} source={source} />
      <Seal tone="quiet" onClick={() => musicApi.radio(top[0]?.key ?? "", []).then(({ tracks }) => p.play([...top.slice(0, 3), ...tracks], 0, { kind: "radio", id: key, title: `${artist.name} radio` })).catch(() => p.say("No radio for them right now."))} disabled={!top.length}>
        <Icon name="radio" />Radio
      </Seal>
      <RateMarks kind="artist" keyOf={key} />
    </Head>
    {top.length ? <section>
      <h2 className="k-heading">Popular</h2>
      <Songs tracks={more ? top : top.slice(0, 5)} source={source} numbered album={false} />
      {top.length > 5 ? <button type="button" className="km-textbtn" onClick={() => setMore(!more)}>{more ? "Show less" : "Show more"}</button> : null}
    </section> : null}
    {albumsOnly.length ? <Shelf title="Albums">{albumsOnly.map((a) => <AlbumCard key={a.key} album={a} sub={String(a.year ?? "")} />)}</Shelf> : null}
    {rest.length ? <Shelf title="Singles and EPs">{rest.map((a) => <AlbumCard key={a.key} album={a} sub={[a.kind === "ep" ? "EP" : a.kind === "single" ? "Single" : "Compilation", a.year].filter(Boolean).join(" · ")} />)}</Shelf> : null}
    {related.length ? <Shelf title="Fans also like">{related.map((a) => <ArtistCard key={a.key} artist={a} />)}</Shelf> : null}
  </div>;
}

/* ── An album ──────────────────────────────────────────────────────────── */

export function AlbumView({ id }: { id: string }) {
  const key = `dz:${id}`;
  const p = usePlayer();
  const { data, error, retry } = useMusic(`album:${key}`, () => musicApi.album(key));
  useTabTitle(data?.album.title, "Kimono Music");
  if (error) return <Problem text={error} onRetry={retry} />;
  if (!data) return <Loading />;
  const { album } = data;
  const source = { kind: "album", id: key, title: album.title };
  const kind = album.kind === "ep" ? "EP" : album.kind === "single" ? "Single" : album.kind === "compile" ? "Compilation" : "Album";
  return <div className="km-page">
    <Head kind={kind} title={album.title} art={<Cover src={album.cover} quality="full" className="km-head-cover" alt="" />}
      meta={<>{album.artist ? <Crossing kind="kakejiku" href={hrefOf.artist(album.artist.key)}>{album.artist.name}</Crossing> : null}{album.year ? ` · ${album.year}` : ""} · {album.tracks.length} {album.tracks.length === 1 ? "song" : "songs"}, {length(album.tracks)}</>}>
      <PlayActions tracks={album.tracks} source={source} />
      <RateMarks kind="album" keyOf={key} />
      <MoreButton label="More for this album" items={() => [
        { label: "Add to queue", icon: "queue", run: () => p.addToQueue(album.tracks) },
        { label: "Add to playlist", icon: "playlist", sub: playlistItems(album.tracks.map((t) => t.key), p.say) },
      ]} />
    </Head>
    <Songs tracks={album.tracks} source={source} numbered art={false} album={false} />
  </div>;
}

/* ── A playlist ────────────────────────────────────────────────────────── */

export function PlaylistView({ id }: { id: string }) {
  const p = usePlayer();
  const crossTo = useCrossTo();
  const { data, error, retry, replace } = useMusic(`playlist:${id}`, () => musicApi.playlist(id).then((r) => r.playlist));
  useTabTitle(data?.name, "Kimono Music");
  if (error) return <Problem text={error} onRetry={retry} />;
  if (!data) return <Loading />;
  const source = { kind: "playlist", id, title: data.name };
  const covers = [...new Set(data.tracks.map((t) => t.album?.cover).filter((c): c is string => Boolean(c)))];
  const set = (keys: string[]) => musicApi.setPlaylist(id, keys).then((r) => { replace(r.playlist); forget("playlists"); forget("home"); }).catch(() => p.say("That change didn't save."));
  return <div className="km-page">
    <Head kind="Playlist" title={data.name} art={<Mosaic covers={covers} className="km-head-cover" />}
      meta={data.tracks.length ? `${data.tracks.length} ${data.tracks.length === 1 ? "song" : "songs"}, ${length(data.tracks)}` : "No songs yet"}>
      <PlayActions tracks={data.tracks} source={source} />
      <MoreButton label="More for this playlist" items={() => [
        { label: "Rename", icon: "edit", run: async () => {
          const name = await askName("Rename the playlist", "Rename", data.name);
          if (name && name !== data.name) musicApi.renamePlaylist(id, name).then((r) => { replace(r.playlist); forget("playlists"); forget("home"); }).catch(() => p.say("That name didn't save."));
        } },
        { label: "Add to queue", icon: "queue", run: () => p.addToQueue(data.tracks) },
        { label: "Delete playlist", icon: "trash", danger: true, run: async () => {
          if (!await askSure(`Delete “${data.name}”?`, "The songs in it stay in Music.", "Delete")) return;
          musicApi.deletePlaylist(id).then(() => { forget("playlists"); forget("home"); crossTo("kakejiku", "/music/library"); }).catch(() => p.say("It wasn't deleted."));
        } },
      ]} />
    </Head>
    {data.tracks.length
      ? <Songs tracks={data.tracks} source={source} numbered rowExtra={(_t, i) => [{ label: "Remove from this playlist", icon: "trash", danger: true, run: () => set(data.tracks.filter((_, j) => j !== i).map((x) => x.key)) }]} />
      : <p className="km-quiet">Add songs from any song’s menu.</p>}
  </div>;
}

/* ── A genre, and a mix ────────────────────────────────────────────────── */

export function GenreView({ id }: { id: number }) {
  const { data, error, retry } = useMusic(`genre:${id}`, () => musicApi.genre(id));
  useTabTitle(data?.genre.name, "Kimono Music");
  if (error) return <Problem text={error} onRetry={retry} />;
  if (!data) return <Loading />;
  const source = { kind: "genre", id: String(id), title: data.genre.name };
  return <div className="km-page">
    <Head kind="Genre" title={data.genre.name} art={<Cover src={data.genre.picture} className="km-head-cover" />}>
      <PlayActions tracks={data.tracks} source={source} />
    </Head>
    <section><h2 className="k-heading">Top songs</h2><Songs tracks={data.tracks.slice(0, 20)} source={source} numbered /></section>
    {data.artists.length ? <Shelf title="Artists">{data.artists.map((a) => <ArtistCard key={a.key} artist={a} />)}</Shelf> : null}
    {data.albums.length ? <Shelf title="Albums">{data.albums.map((a) => <AlbumCard key={a.key} album={a} />)}</Shelf> : null}
  </div>;
}

export function MixView() {
  const id = useSearchParams().get("id") ?? "";
  const { data, error, retry } = useMusic(id ? `mix:${id}` : null, () => musicApi.mix(id));
  useTabTitle(data?.mix.title, "Kimono Music");
  if (error) return <Problem text={error} onRetry={retry} />;
  if (!data) return <Loading />;
  const { mix } = data;
  const source = { kind: "mix", id, title: mix.title };
  const covers = [...new Set(mix.items.map((t) => t.album?.cover).filter((c): c is string => Boolean(c)))];
  return <div className="km-page">
    <Head kind={id === "chart" ? "Chart" : "Mix"} title={mix.title} art={<Mosaic covers={covers} className="km-head-cover" />} meta={`${mix.items.length} songs, ${length(mix.items)}`}>
      <PlayActions tracks={mix.items} source={source} />
    </Head>
    <Songs tracks={mix.items} source={source} numbered />
  </div>;
}

/* ── Your library ──────────────────────────────────────────────────────── */

type Shelfname = "playlists" | "liked" | "history";

export function LibraryView() {
  useTabTitle("Your music", "Kimono Music");
  const params = useSearchParams();
  const router = useRouter();
  const crossTo = useCrossTo();
  const p = usePlayer();
  const tab = (["playlists", "liked", "history"] as Shelfname[]).find((t) => t === params.get("show")) ?? "playlists";
  // eslint-disable-next-line no-restricted-syntax -- a tab within the library page, kept in its address
  const go = (t: Shelfname) => router.replace(t === "playlists" ? "/music/library" : `/music/library?show=${t}`, { scroll: false });
  return <div className="km-page">
    <header className="km-lib-head">
      <h1 className="km-page-title">Your music</h1>
      <Seal tone="quiet" onClick={async () => {
        const name = await askName("New playlist", "Make it");
        if (!name) return;
        musicApi.createPlaylist(name).then(({ playlist }) => { forget("playlists"); forget("home"); crossTo("kakejiku", hrefOf.playlist(playlist.id)); }).catch(() => p.say("That playlist wasn't made."));
      }}><Icon name="add" />New playlist</Seal>
    </header>
    <div className="km-chips" role="tablist">
      {([["playlists", "Playlists"], ["liked", "Liked songs"], ["history", "Recently played"]] as [Shelfname, string][]).map(([t, label]) =>
        <button key={t} type="button" role="tab" aria-selected={tab === t} className={cx("km-chip", tab === t && "km-on")} onClick={() => go(t)}>{label}</button>)}
    </div>
    {tab === "playlists" ? <Playlists /> : tab === "liked" ? <Liked /> : <History />}
  </div>;
}

function Playlists() {
  const { data, error, retry } = useMusic("playlists", () => musicApi.playlists().then((r) => r.playlists));
  if (error) return <Problem text={error} onRetry={retry} />;
  if (!data) return <Loading />;
  if (!data.length) return <p className="km-quiet">Your playlists will be here.</p>;
  return <div className="km-grid">{data.map((pl) => <SetCard key={pl.id} title={pl.name} sub={`${pl.count} ${pl.count === 1 ? "song" : "songs"}`} covers={pl.covers} href={hrefOf.playlist(pl.id)} />)}</div>;
}

function Liked() {
  const { data, error, retry } = useMusic("liked", () => musicApi.liked().then((r) => r.tracks));
  if (error) return <Problem text={error} onRetry={retry} />;
  if (!data) return <Loading />;
  if (!data.length) return <p className="km-quiet">Songs you like or love will be here.</p>;
  const source = { kind: "liked", id: "liked", title: "Liked songs" };
  return <><div className="km-lib-actions"><PlayActions tracks={data} source={source} /></div><Songs tracks={data} source={source} numbered /></>;
}

function History() {
  const { data, error, retry } = useMusic("history", () => musicApi.history().then((r) => r.tracks));
  if (error) return <Problem text={error} onRetry={retry} />;
  if (!data) return <Loading />;
  if (!data.length) return <p className="km-quiet">What you play will be here.</p>;
  return <Songs tracks={data as Track[]} source={{ kind: "history", id: "recent", title: "Recently played" }} />;
}

export { clock };
