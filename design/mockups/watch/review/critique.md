# Kimono Watch: a harsh review against Netflix

Reviewed 2026-11-10 on:

- **Web:** `/watch` in the dev Portal at 1440×900 and 375×812, signed in as kimono-test, playing Frieren S1:E4 through the HLS packager.
- **Android TV:** the release APK from `apps/compose/watchAndroid` on the Google TV emulator, driven with D-pad key events.
- **Android phone:** read from the code. The phone emulator was mid-playback for the build session, so I left it alone. I took one screenshot, which shows the outlined subtitles.
- **Reference:** `design/mockups/watch/index.html`.

The Android app isn't committed yet, so the TV findings are against the APK built at 02:21 today.

Screenshots are in `img/`. Severity runs from **S0** (breaks trust, or the owner hits it in a minute) to **S3** (polish).

---

## Verdict

The bones are right. The catalogue, rows, title modal, episodes, scrub thumbnails on the web, skip markers and the next-episode flow are all there, and the server is ahead of every client. What makes it feel unfinished:

1. **The clients hide or fake what the server knows.** The loader prints a made-up percentage. The quality menu is filed under a speed icon. The format badges the server computes are never drawn, and the language preferences the server stores have no screen.
2. **The 10-foot experience was ported, not designed.** On TV you can't see which control has focus and the buttons have no labels. The pause card, buffering ring and seek ripple pile up on top of each other.
3. **The typography sets titles as body text on top of art.** This comes straight from the reference. Netflix never types a title over a still when it has the title's logo, and we do have the logos.

---

## S0: fix before anyone else uses it

### 0. Web rows don't scroll, and there's no "See all" (the owner's report, confirmed)
- **Cause:** `.kw-rows` is a CSS grid, and its `section.kw-row` children keep the default `min-width: auto`. The grid track grows to the widest rail's content, 4331 px at a 1440 px window. The rail (`overflow-x: auto`) is then as wide as its content, so it never overflows. It just runs off the page.
- **Effect:**
  - trackpad and shift-wheel scrolling do nothing;
  - the arrow buttons have nothing to move, and they were invisible anyway (`opacity: 0` until hover, `display: none` under 900 px or without hover);
  - Films for tonight has 15 titles and only the first 6 can be reached. Because you watched has 12, about half reachable.
- **Proof:** adding `.kw .kw-row { min-width: 0 }` in the page (temporarily, not in the code) made every rail scroll: Top 10 2417 px, Popular series 2923 px, Films 4331 px, all inside a 1425 px viewport. The one-line fix is in the spec.
- **Netflix has more than scrolling:**
  - an always-visible "›" edge on rows that continue, and a page indicator (a dash per page) top right on hover;
  - a row title that opens the full category ("See all" / "Explore all ›");
  - wrap-around paging.
- **We have none of these.** There's also no category page to land on (no "See all" route in the app or the API).
- **TV:** D-pad scrolling works (`img/tv-13-row-right.jpg`), but there's no way to the full category either. The focused card wanders across the row instead of staying in the left slot.

### 0b. Brand: the made-up 観 seal is still Watch's face on Android, and the web tab wears Kimono's favicon
Audited against the house lockup: `AppLockup` with Watch's bloom (Kimono's flower with the play glyph), "kimono" in Mincho, then "watch" in Watch's colour, as in commit 8f47368, and the same as Photos and VPN.

| Surface | Now | Verdict |
|---|---|---|
| Web header | `AppLockup` with the bloom, "kimono", and "watch" in suō (`watch-app.tsx:178`) | ✅ Right |
| Web profile picker, entry and waiting screens | `WatchBloom` (AppIcon with the play glyph) | ✅ Right |
| Web favicon | Kimono's generic favicon from the root `layout.tsx` (`/brand/favicon-32.png`). No Watch icon. | ❌ It should be Watch's bloom, at 16, 32 and 48 px plus an apple-touch icon, set in `watch/page.tsx` metadata |
| Web tab title | "Kimono Watch · Kimono" (the shell appends the house name) | ⚠️ Reads twice. It should be "Kimono Watch", or "Frieren · Kimono Watch" while a title is open or playing |
| Web source comment | `watch-app.tsx:15` still opens "観 Kimono Watch" | Cosmetic, but it's where new code copies from |
| **Android launcher icon** | Adaptive icon with the foreground `ic_seal`: a plum rounded square with a traced 観 | ❌ **Off-brand.** The demo's made-up seal. It should be the bloom with the play glyph on `night` |
| **Android themed icon (monochrome)** | `ic_seal_mono`: the 観 seal in one colour | ❌ It should be the bloom's silhouette (five petals, plus the play glyph cut out of the heart) as a single path |
| Android launcher label | "Watch" | ❌ It should be "Kimono Watch", as on the web tab and in the app's own copy |
| **TV banner** (`banner.xml`) | The 観 seal and a wordmark on night | ❌ It should be the lockup at banner scale: the bloom, "kimono", and "watch" in suō, centred on night (320×180) |
| **TV and phone header** (`Atoms.kt` `Brand()`) | `Seal(32.dp)` 観, then "KIMONO" in capitals, letter-spaced 2.8 sp (`img/tv-02.jpg`) | ❌ Both the mark and the wordmark are wrong. It should be the shared Compose lockup: `InkBloom` from `apps/compose/shared` with the play glyph, "kimono" Mincho 700, "watch" in suō |
| **Profile picker and sign-in** (`Profiles.kt:88,185`) | `Seal(44.dp)` 観 above "Who's watching?" (`img/tv-01.jpg`) | ❌ It should be the bloom, as on the web |
| Notification icon `ic_stat_watch` | A traced glyph (the download notification) | ⚠️ Check it's the bloom's silhouette and not 観 |
| Loading screens | Web: `InkLoader` / `InkRing` (since e0833b0). Android: a custom `WavyRing` everywhere (`Root.kt:83`, `Profiles.kt:143,202`, `TitleScreen.kt:293,386`, `PlayerScreen.kt:319`, and the start loader) | ❌ Android breaks the house loader rule (below) |

**Loader rule (the owner's):** no custom spinners.
- A wait with no measure uses **InkLoader**: Kimono's painted version of M3 Expressive's morphing shape (`packages/ui/src/loading.tsx`, Compose `shared/…/InkLoader.kt`).
- Real progress uses **InkWave** (`InkProgress.kt`).
- The start of playback, with a real percentage, uses **InkRing**.
- Watch's own `WavyRing` (on Android, and in the old web code) must go. The web has already moved over.

### 1. The loading percentage is made up, on every client
> **Update, the same afternoon:** the web build session's commit e0833b0 replaced the web's timer with `InkRing`. It's driven by events (10% when play is asked, 30% when it answers, 50% once the manifest is in, then buffer ahead out of 4 s). That's much better. The first three steps are still fixed values rather than the server's real stages, which needs S1 in the spec. Android still fakes its percentage.
- **Web:** `player.tsx:123` counts up on a timer toward 90% (`p + (90 - p) * 0.05`). It sat at **89% for about 50 seconds** while the packager made the first segment. The screen is the same at second 5 and second 50, so a slow start looks like a hang (`img/web-07-loader.jpg`, then `img/web-08-loader-stuck-89.jpg`).
- **Android:** `PlayerScreen.kt:552-557` reaches 99% in 6 s whatever is happening, then sits there. The TV did exactly that (`img/tv-05.jpg`).
- A fake number is worse than none. Netflix shows no number at all. Our server actually knows the stages, so we can do better than Netflix (see the spec, §Loading).
- Measured on the web: play answered at once (streams cached), both playlists loaded, then `init.mp4` hung for about 45 s. That is the packager probing the file and encoding the first segment, and it is exactly the stage the screen should name.

### 2. Preferences have no home on any client
The server stores a complete `Prefs` (`lib/watch/model.ts`): audio language, subtitle language, sub or dub for anime, original audio or dub for everything else, subtitles auto/always/off, autoplay next, skip intros, fillers, plus a quality per device.

- **Web:** the only setting anywhere is *Quality on this device*, in the avatar menu (`img/web-15-account-menu.jpg`). Nothing else is reachable.
- **Android phone and TV:** nothing. `WatchApi.prefs()` exists and no screen calls it. Fillers are only ever asked inline.
- **Subtitle style** (size, outline or box) exists nowhere, not even on the server.
- **In the player:** you can switch audio and subtitles for the current play. Nothing tells you whether that sticks for this show, and nothing links to the defaults.

### 3. TV remote: focus is invisible and controls fight each other
- **No visible focus on the control row.** `LabBtn` collects `focused` and never uses it. Focus shows only as a 1.08× scale on a 28 dp white icon, so on a TV across the room you can't tell what OK will do (`img/tv-09.jpg`).
- **The labels are hidden on TV** (`if (!tv) Text(label)`). That is backwards. TV is where labels matter, because there's no hover tooltip.
- **The pause card takes over the D-pad.** Five seconds after pausing, the card sets `ctl = false`. Left and right then seek a paused video you can't see. The card, the buffering ring and the "10 seconds" ripple all draw over each other (`img/tv-12.jpg`).
- **OK does something different during the intro.** While the skip offer shows, OK skips instead of pausing. Netflix gives the skip button focus, so OK skips because the skip has focus, and the button shows it.
- **A dead Back arrow sits at the top left on TV.** On TV, Back is the remote's button. The arrow is a focus stop that does nothing a remote can't.
- **The page scrolls under the hero on Home.** The hero half-scrolls away and the Top 10 numerals clip at the bottom edge. TV home should move one row at a time, with the focused row in a fixed slot (`img/tv-03.jpg`).
- **The filter chips overlap the hero logo** on TV ("Anime" lands on "THE", `img/tv-02.jpg`).

### 4. Quality is there but can't be found
- **Web player:** Quality sits inside the speed icon, whose label is "Speed and quality" (`img/web-10-speed-quality.jpg`). The owner's "can't even change quality" is a fair reading of the UI.
- **Android:** there is no quality control at all. The player sheets are `Tracks | Speed | Episodes`.
- **"Auto" never says what it picked.** It should read "Auto · 1080p".
- **Web avatar menu:** it offers **4K** on a browser where the player's own menu tops out at 1080p. The two menus disagree.

### 5. Quality and format tags aren't shown anywhere
- `play()` returns `version.badges`, for example `["4K","Dolby Vision","Dolby Atmos"]`, ranked for this device. No client draws them.
- Cards (`Card` type) and title pages carry no format data. `prepare` answers only `ready: true/false`. A household that pays for 4K HDR never sees it.

---

## S1: the Netflix gap

### 6. Titles are typeset over the art, and that reads as unpolished
- Every landscape card types the title in Shippori Mincho 800 over the backdrop. This comes from the reference (`.card .t`, `.mlt .shot .t`).
- **Wrapping:** long names wrap into the middle of the art ("Somali and the Forest Spirit"). Others run off the edge ("Demon Slayer: Kimetsu no Yaiba").
- **Contrast:** the text sinks into light art (Doraemon, One Piece). Mincho's thin hairlines die at 15 to 20 px over a photo (`img/web-04-rows-titles.jpg`).
- **The fix is already in the data:** TMDB title logos come back for nearly every card (`card.logo`) and only the hero uses them. Netflix's rule is logo art on the card, or no text on the card at all.
- **The Odyssey's logo** is slate blue on an orange fire: low contrast, and it looks like a rendering bug.

### 7. Raw release track names leak into the subtitle menu
- The subtitle list shows "Portuguese (FULL)" twice, **"English (9volt)"** (a fansub group's name), and "Portuguese (FORCED)" twice, all in capitals (`img/web-11-audio-subs.jpg`).
- These are internals. The menu should say "English", "English · Signs & songs", "Portuguese (Brazil)", with duplicates folded together and forced tracks hidden behind the language they belong to.

### 8. Generic pills in the wrong place, and an avatar menu that holds settings
- **Series / Films / Anime** are rounded, outlined filter chips on both web and TV, sitting on top of the hero. Kimono's rule is no generic pills.
- **They're also in the wrong place** (the owner's note). They are destinations, so they belong in the header nav beside Home, New & hot and My list, as Netflix does with Shows and Movies.
- **The avatar menu holds "Quality on this device".** The avatar is about *who is watching*. Device quality belongs in Settings and in the player.

### 9. Three different brands on one app (see 0b for the full audit)
| | Web | TV | Android launcher |
|---|---|---|---|
| Mark | Bloom with play glyph | 観 hanko square | — |
| Wordmark | "kimono watch" (lower case, Mincho) | "KIMONO" (capitals, letter-spaced) | "Watch" |
| Avatar | Rounded square, moss | Circle, ochre | — |
| Apostrophe | Who’s (curly) | Who's (straight) | — |

### 10. Subtitles look different on every client, and you can't change them
- The web uses the browser's grey box (`::cue` default). Android draws an outline. The house style should be one look, with a size setting.

### 11. Duplicated player chrome
- **The title appears twice:** in the top bar and in the bottom bar, on web and TV.
- **The web has two fullscreen buttons**, top right and bottom right.
- **A ghost panel** stays at the bottom right after closing a sheet on the web (`img/web-12-scrub-thumb.jpg`).
- **The centre play glyph** sits over the subtitles while paused.

### 12. Start time
About **55 s to the first frame** on the web (play, then packager probe, then the first segment). The title page already pre-finds streams (`findAhead`), but nothing pre-warms the HLS session. Netflix starts in 2 to 4 s. We can't match that with on-demand packaging, but we can:
- start the packager when the title page opens, or when the Resume button gets focus;
- say what is happening while it works (see item 1).

---

## S2

13. **Title page copy contradicts itself.** "35 episodes left in Season 1" sits next to "That's the end of the series so far". Read together, they say the series has ended (`img/web-05-title.jpg`).
14. **The title page lacks what Netflix lists:** audio and subtitle languages, format tags, maturity reasons. Anime has no **Sub / Dub** choice there, although `tracks` is in the payload.
15. **Search is weak.** On desktop it shows phone-style list rows (`img/web-17-search.jpg`).
    - There's no year or kind, so search can't tell two "Doraemon"s apart, and Home's Anime row shows two Doraemons (1979 and 2005) with no year to separate them.
    - A missing poster becomes a grey "Y" tile.
    - The skeleton is shaped like neither the results nor the cards.
    - There are no filters and no sort.
    - About 5 s pass with nothing partial on screen.
16. **There's no sorting or filtering anywhere:** not in My list, search, rows, or "See all" (which doesn't exist).
17. **My list's empty state** is one grey line with no action and no art (`img/web-16-mylist-empty.jpg`).
18. **Layering and focus on the web:**
    - the account menu opens behind the title modal (`img/web-14-menu-behind-modal.jpg`);
    - Home stays in the tab order behind the open player, which isn't `inert`.
19. **Time formats:** "172m left" should read "2 h 52 m left".
20. **A deep link** (`/watch?t=…`) first paints a blank black page with the Portal rail showing, then the modal snaps in.
21. **"Continue watching for Kimono"** puts the profile's display name into a row title. Netflix does this too, but with a household name like "Kimono" it reads as the app's name. Use "Continue watching".

## S3

22. The profile name label on the web is 11 px in fg-3: too small, too low contrast.
23. The centre play/pause glyph on the web is a small outline icon, about 24 px. It looks like a leftover.
24. The Top 10 numerals on the web clip into the card art at some widths (`img/web-03-rows.jpg`).
25. The search box has a placeholder and no label; the scroll arrows on rows have no visible focus.

---

## Where the approved reference itself falls short of Netflix

- **Mincho 800 titles on card art.** This is the root of item 6. Mincho belongs in display sizes (hero fallback, title page heading, profile question), not on 15 px card labels.
- **No settings or language surface.** That is why none got built.
- **No quality or format tags, and no sort or filter controls.**
- **A single generic loader,** with no stages.
- **The player is designed for mouse and touch only.** There's no TV focus model, no labelled control row, and no remote-friendly sheets. The TV app inherited a layout that was never meant for a remote.
- **Pill filter chips** (`.chip`) go against Kimono's button rule.
- **It gets these right, and they should stay:** the night palette, the Top 10 treatment, the hover card, the pause card, and the end-of-episode card that shrinks the picture into the corner.

---

## What already works (keep it)

- Scrub thumbnails on the web, and their timestamp.
- The skip intro and recap markers, and next-episode prep at about 70%.
- Filler awareness (ask once, then remember).
- Android's subtitle outline. It's the better of the two looks, so make it the house style.
- The TV hold-to-scrub acceleration (10 s, then 30 s after 2 s held, then 60 s after 4 s) is the right shape. It just needs a visible thumbnail strip.
- The title modal's season tracker dots are a nice, Kimono-ish touch, once the copy is fixed.
