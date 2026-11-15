"use client";

import { Crossing, useCrossTo } from "@/components/crossing";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AppLockup, cx, InkPortraitFrame, Seal, type AppIdentity } from "@kimono/ui";
import { useTabTitle } from "@/components/tab-title";
import { ago, byline, clock, forget, hrefOf, length, musicApi, useMusic, type Album, type FriendListening, type Track } from "./api";
import { askName, askSure } from "./ask";
import { Icon } from "./icons";
import { Portrait } from "@/components/portrait";
import { AlbumCard, ArtistCard, Bars, Cover, Head, Loading, MoreButton, Mosaic, PlayActions, playlistItems, Problem, RateMarks, SetCard, Shelf, Songs } from "./parts";
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
      <nav className="km-tabs" aria-label="Music">
        <Crossing kind="kakejiku" href="/music" aria-current={path === "/music" ? "page" : undefined}>Home</Crossing>
        <Crossing kind="kakejiku" href="/music/you" aria-current={path === "/music/you" ? "page" : undefined}>You</Crossing>
      </nav>
    </div>
    <label className="km-search">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" /></svg>
      <input ref={input} type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Songs, albums, artists" aria-label="Search Music"
        onKeyDown={(e) => { if (e.key === "Escape") { setText(""); input.current?.blur(); } }} />
    </label>
  </div>;
}

/* ── Home ──────────────────────────────────────────────────────────────── */

const greeting = () => { const h = new Date().getHours(); return h < 5 ? "Good night" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"; };

export function HomeView() {
  useTabTitle(undefined, "Kimono Music");
  const p = usePlayer();
  const { data: home, error, retry } = useMusic("home", musicApi.home);
  const { data: friends } = useMusic("friends", () => musicApi.friends().then((r) => r.friends));
  if (error) return <Problem text={error} onRetry={retry} />;
  if (!home) return <Loading />;
  const first = p.you.name.split(/\s+/)[0];
  return <div className="km-page km-home">
    <header className="km-hello">
      <Crossing kind="kakejiku" href="/music/you" className="km-hello-you" aria-label="Your music">
        <InkPortraitFrame seed={p.you.username} weight={4}><Portrait name={p.you.name} username={p.you.username} picture={p.you.picture} size={56} /></InkPortraitFrame>
      </Crossing>
      <h1 className="km-hello-title">{greeting()}, {first}</h1>
    </header>

    <div className="km-quick">
      <Crossing kind="kakejiku" href="/music/liked" className="km-quick-tile km-quick-liked"><span className="km-quick-art"><Icon name="love" /></span><span>Liked songs</span></Crossing>
      {home.playlists.slice(0, 5).map((pl) => <Crossing kind="kakejiku" key={pl.id} href={hrefOf.playlist(pl.id)} className="km-quick-tile"><Mosaic covers={pl.covers} className="km-quick-art" /><span>{pl.name}</span></Crossing>)}
      {home.jumpBack.slice(0, Math.max(0, 7 - home.playlists.length)).map((t, i) => <button key={t.key} type="button" className={cx("km-quick-tile", p.current?.key === t.key && "km-now")}
        onClick={() => p.play(home.jumpBack, i, { kind: "history", id: "recent", title: "Recently played" })}>
        <Cover src={t.album?.cover} className="km-quick-art" /><span>{t.title}</span>{p.current?.key === t.key && p.playing ? <Bars /> : null}
      </button>)}
    </div>

    {friends?.length ? <FriendsListening friends={friends} /> : null}

    {home.mixes.length ? <Shelf title="Made for you">
      {home.mixes.map((m) => <SetCard key={m.id} title={m.title} sub={`${m.items.length} songs`} covers={[...new Set(m.items.map((t) => t.album?.cover).filter((c): c is string => Boolean(c)))]}
        href={hrefOf.mix(m.id)} onPlay={() => p.play(m.items, 0, { kind: "mix", id: m.id, title: m.title })} />)}
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

/** What friends are on: live first, each with the song (press it to play it) and when. */
function FriendsListening({ friends }: { friends: FriendListening[] }) {
  const p = usePlayer();
  return <section className="km-friends">
    <h2 className="k-heading">Friends</h2>
    <div className="km-friends-row">
      {friends.map((f) => <div key={f.username} className={cx("km-friend", f.live && "km-live")}>
        <Crossing kind="kakejiku" href={`/account/people/${encodeURIComponent(f.username)}`} className="km-friend-who">
          <InkPortraitFrame seed={f.username} weight={3}><Portrait name={f.name} username={f.username} picture={f.picture} size={44} /></InkPortraitFrame>
          <span className="km-friend-name"><b>{f.name.split(/\s+/)[0]}</b><small>{f.live ? <><span className="km-live-dot" />Listening now</> : ago(f.at)}</small></span>
        </Crossing>
        <button type="button" className="km-friend-song" onClick={() => p.play([f.track], 0, { kind: "friend", id: f.username, title: `${f.name.split(/\s+/)[0]}'s pick` })} aria-label={`Play ${f.track.title}`}>
          <Cover src={f.track.album?.cover} size={44} />
          <span><b>{f.track.title}</b><small>{byline(f.track)}</small></span>
        </button>
      </div>)}
    </div>
  </section>;
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
  const mine = data.mine !== false;
  const covers = [...new Set(data.tracks.map((t) => t.album?.cover).filter((c): c is string => Boolean(c)))];
  const set = (keys: string[]) => musicApi.setPlaylist(id, keys).then((r) => { replace(r.playlist); forget("playlists"); forget("home"); }).catch(() => p.say("That change didn't save."));
  return <div className="km-page">
    <Head kind="Playlist" title={data.name} art={<Mosaic covers={covers} className="km-head-cover" />}
      meta={<>{!mine && data.owner ? <Crossing kind="kakejiku" href={`/account/people/${encodeURIComponent(data.owner.username)}`} className="km-owner"><Portrait name={data.owner.name} username={data.owner.username} picture={data.owner.picture} size={24} />{data.owner.name}</Crossing> : null}
        {data.tracks.length ? `${data.tracks.length} ${data.tracks.length === 1 ? "song" : "songs"}, ${length(data.tracks)}` : "No songs yet"}</>}>
      <PlayActions tracks={data.tracks} source={source} />
      {mine ? <MoreButton label="More for this playlist" items={() => [
        { label: "Rename", icon: "edit", run: async () => {
          const name = await askName("Rename the playlist", "Rename", data.name);
          if (name && name !== data.name) musicApi.renamePlaylist(id, name).then((r) => { replace(r.playlist); forget("playlists"); forget("home"); }).catch(() => p.say("That name didn't save."));
        } },
        { label: "Add to queue", icon: "queue", run: () => p.addToQueue(data.tracks) },
        { label: "Delete playlist", icon: "trash", danger: true, run: async () => {
          if (!await askSure(`Delete “${data.name}”?`, "The songs in it stay in Music.", "Delete")) return;
          musicApi.deletePlaylist(id).then(() => { forget("playlists"); forget("home"); forget("me"); crossTo("kakejiku", "/music/you"); }).catch(() => p.say("It wasn't deleted."));
        } },
      ]} /> : null}
    </Head>
    {data.tracks.length
      ? <Songs tracks={data.tracks} source={source} numbered rowExtra={(_t, i) => !mine ? [] : [{ label: "Remove from this playlist", icon: "trash", danger: true, run: () => set(data.tracks.filter((_, j) => j !== i).map((x) => x.key)) }]} />
      : <p className="km-quiet">{mine ? "Add songs from any song’s menu." : "Nothing in it yet."}</p>}
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

/* ── Your space ─────────────────────────────────────────────────────────── */

export function YouView() {
  useTabTitle("Your music", "Kimono Music");
  const p = usePlayer();
  const crossTo = useCrossTo();
  const { data: me, error, retry } = useMusic("me", musicApi.me);
  const { data: friends } = useMusic("friends", () => musicApi.friends().then((r) => r.friends));
  const newPlaylist = async () => {
    const name = await askName("New playlist", "Make it");
    if (!name) return;
    musicApi.createPlaylist(name).then(({ playlist }) => { forget("me"); forget("playlists"); forget("home"); crossTo("kakejiku", hrefOf.playlist(playlist.id)); }).catch(() => p.say("That playlist wasn't made."));
  };
  if (error) return <Problem text={error} onRetry={retry} />;
  if (!me) return <Loading />;
  const hours = me.minutes >= 90 ? `${Math.round(me.minutes / 60)} hours` : `${me.minutes} minutes`;
  return <div className="km-page km-you">
    <header className="km-head km-you-head">
      <div className="km-head-art km-you-portrait"><InkPortraitFrame seed={p.you.username} weight={5}><Portrait name={p.you.name} username={p.you.username} picture={p.you.picture} size={180} /></InkPortraitFrame></div>
      <div className="km-head-text">
        <span className="k-label">Your music</span>
        <h1 className="km-head-title">{p.you.name}</h1>
        <p className="km-head-meta">{me.plays ? `${me.plays} ${me.plays === 1 ? "song" : "songs"} and ${hours} this month` : "Play something and it starts here."}</p>
        {me.tags.length ? <span className="km-tags">{me.tags.map((t) => <span key={t} className="km-tag">{t}</span>)}</span> : null}
        <div className="km-head-actions">
          <Seal onClick={newPlaylist}><Icon name="add" />New playlist</Seal>
          <Crossing kind="kakejiku" href={`/account/people/${encodeURIComponent(p.you.username)}`} className="km-textbtn km-you-profile">Your profile</Crossing>
        </div>
      </div>
    </header>

    <section>
      <h2 className="k-heading">Playlists</h2>
      <div className="km-grid km-you-lists">
        <Crossing kind="kakejiku" href="/music/liked" className="km-card km-card-link km-liked-card">
          <span className="km-card-pic km-liked-art"><Icon name="love" /></span>
          <span className="km-card-title">Liked songs</span>
          <span className="km-card-sub">{me.liked} {me.liked === 1 ? "song" : "songs"}</span>
        </Crossing>
        {me.playlists.map((pl) => <SetCard key={pl.id} title={pl.name} sub={`${pl.count} ${pl.count === 1 ? "song" : "songs"}`} covers={pl.covers} href={hrefOf.playlist(pl.id)} />)}
        <button type="button" className="km-card km-new-card" onClick={newPlaylist}>
          <span className="km-card-pic km-new-art"><Icon name="add" /></span>
          <span className="km-card-title">New playlist</span>
        </button>
      </div>
    </section>

    {me.onRepeat.length ? <section>
      <h2 className="k-heading">On repeat</h2>
      <Songs tracks={me.onRepeat.slice(0, 6)} source={{ kind: "repeat", id: "me", title: "On repeat" }} numbered album={false} className="km-chart-songs" />
    </section> : null}

    {me.artists.length ? <Shelf title="Your top artists">{me.artists.map((a) => <ArtistCard key={a.key} artist={a} />)}</Shelf> : null}

    {me.recent.length ? <section>
      <header className="km-section-head"><h2 className="k-heading">Recently played</h2><Crossing kind="kakejiku" className="km-shelf-all" href="/music/history">Show all</Crossing></header>
      <Songs tracks={me.recent.slice(0, 6)} source={{ kind: "history", id: "recent", title: "Recently played" }} />
    </section> : null}

    {friends?.length ? <FriendsListening friends={friends} /> : <section className="km-friends-none">
      <h2 className="k-heading">Friends</h2>
      <p className="km-quiet">See what your friends are listening to.</p>
      <Crossing kind="kakejiku" href="/account/friends" className="km-textbtn">Find friends</Crossing>
    </section>}
  </div>;
}

export function LikedView() {
  useTabTitle("Liked songs", "Kimono Music");
  const { data, error, retry } = useMusic("liked", () => musicApi.liked().then((r) => r.tracks));
  if (error) return <Problem text={error} onRetry={retry} />;
  if (!data) return <Loading />;
  const source = { kind: "liked", id: "liked", title: "Liked songs" };
  return <div className="km-page">
    <Head kind="Playlist" title="Liked songs" art={<span className="km-head-cover km-liked-art"><Icon name="love" /></span>}
      meta={data.length ? `${data.length} ${data.length === 1 ? "song" : "songs"}, ${length(data)}` : "Songs you like or love land here."}>
      <PlayActions tracks={data} source={source} />
    </Head>
    {data.length ? <Songs tracks={data} source={source} numbered /> : null}
  </div>;
}

export function HistoryView() {
  useTabTitle("Recently played", "Kimono Music");
  const { data, error, retry } = useMusic("history", () => musicApi.history().then((r) => r.tracks));
  if (error) return <Problem text={error} onRetry={retry} />;
  if (!data) return <Loading />;
  return <div className="km-page">
    <h1 className="km-page-title">Recently played</h1>
    {data.length ? <Songs tracks={data as Track[]} source={{ kind: "history", id: "recent", title: "Recently played" }} /> : <p className="km-quiet">What you play will be here.</p>}
  </div>;
}

export { clock };
