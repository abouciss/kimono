# Kimono Watch: the fix spec

To be read alongside `critique.md`. The mockups are in `index.html`, in this folder. Each section says what to build on **Web**, **Phone** (Compose, `watchAndroid` phone layouts, then iOS) and **TV** (Compose, `tv/`). **Server** lists what the API is missing. Item numbers (C0, C1…) refer to the critique.

The constraints below are kept: dark only, the night palette, Shippori Mincho for display and Zen Maru Gothic for UI, Kimono's logo and Watch's bloom, hanko seals for buttons, flat surfaces, and no pills.

---

## 0. Shared tokens and rules (all clients)

| Token | Value | Use |
|---|---|---|
| `--bg` | `#110C0A` | page |
| `--surface` / `-2` / `-3` | `#1B1412` / `#261E1B` / `#312825` | sheets, rows, focused tiles |
| `--fg` / `-2` / `-3` | `#EFE0DA` / `#D8C2BD` / `#A08C88` | text. **`--fg-3` never on imagery** |
| `--suo` / `--suo-deep` | `#D06A82` / `#7E3448` | accent, primary seal |
| `--moss` | `#BFD0AE` | "on" states, "ready" |
| Focus (TV) | 3 px `--paper #F4E9E1` ring, offset 4 px, plus 1.06 scale and a lift of `--surface-3` | every focusable item on TV, with no exceptions |
| Focus (web) | 2 px `--suo` outline, offset 3 px, `:focus-visible` only | |

**Type scale.** Mincho is for display only, at 24 px and up (hero fallback, page H1, title page name, profile question, end-card heading). Everything at or below 20 px is Zen Maru.

| Role | Web | Phone | TV (at 1080p) |
|---|---|---|---|
| Hero name, when there's no logo | Mincho 700, 56 | Mincho 700, 34 | Mincho 700, 72 |
| Page H1 | Mincho 700, 36 | Mincho 700, 28 | Mincho 700, 48 |
| Row title | Zen Maru 700, 20 | 700, 17 | 700, 30 |
| Body | 16 / 1.5 | 15 / 1.45 | 24 / 1.4 |
| Meta | 14, `--fg-2` | 13 | 22 |
| Tag | Zen Maru 700, 11, tracking .06em, capitals for 4K/HD/HDR only | 11 | 18 |

**Title art (C6).**
1. If `card.logo` exists, draw the logo. It's bottom-left, at most 62% of the card width and 38% of its height, `object-fit: contain`, with `filter: drop-shadow(0 1px 6px rgba(0,0,0,.6))`.
2. No logo: landscape cards draw **no text on the art**. The name goes under the card in Zen Maru 700, 15 px, one line with an ellipsis, and the year in `--fg-3`. Posters do the same.
3. A logo that's too dark (mean luminance < 0.25, worked out once on the server, see §S4) gets a 1 px paper-coloured glow. Otherwise it would sink like The Odyssey's does.

**Copy.**
- Minutes come out as "2 h 52 m left" or "21 m left".
- The row is "Continue watching", without the profile name.
- Track and source names are never shown raw (see §3.4).
- The UI never names upstream services.

**Buttons.** Seal primary (suō, carved ring, base) for Play / Resume / Next episode. Quiet seal for secondary. Options in sheets are **rows**, not chips. Filters inside a page (My list, See all, Search) are an **underline tab strip** (the joinery rail): text tabs on a 1 px rule, and the active one gets a 3 px suō bar that slides.

**Header (owner's call, 2026-11-10).**
- **The Series / Films / Anime pill row goes away.** They become top-level destinations in the header nav: **Home · Series · Films · Anime · New & hot · My list**.
- **The active item** is `--fg` with a 2 px suō underline. The rest are `--fg-2`.
- **Phone:** the bottom bar stays Home · New & hot · My list. Series / Films / Anime become a text tab strip at the top of Home that collapses into the header on scroll (Netflix's phone pattern), in text, not pills.
- **TV:** the same six items in the top nav, then Search and Settings (gear) at the right, then the avatar.
- **Each of Series, Films and Anime** is a Home filtered to that shelf (the API already takes `shelf`), with its own hero.

**The avatar is about the person.**
- Its menu holds only: the profile switcher (faces of the household), "Settings", and "Kimono account".
- **Quality comes out of it.** It lives in Settings → Quality on this device, and in the player's Quality control. A per-device quality has nothing to do with who you are.

---

## 1. The player (top priority)

### 1.1 Layout, shared by all clients
- **Top band:** title (logo if there is one, else Zen Maru 700) and `S1:E4 · The Land Where Souls Rest`. **Only here**: remove the duplicate title from the bottom bar (C11).
- **Bottom band:** the scrub bar, then the control row. Left: play/pause, back 10, forward 10 (and volume on the web). Right: **Episodes · Audio & subtitles · Quality · Next episode** (and fullscreen on the web, once).
  - **Speed** moves into the Quality sheet's footer, as a single row reading "Speed: 1×". Playback speed is rare. Quality isn't.
- **Every control on the right has a visible label:** web at ≥1100 px, TV always, phone landscape icons only with the label in a tooltip on long-press.
- **The Quality control shows what's playing**, as a tag: `1080p`, `4K HDR`, `4K DV`. That makes it findable and honest (C4).
- **Skip intro / Skip recap:** a seal at bottom right, above the control row. It's visible from the marker start until 6 s before its end, or for 10 s and then a slim version.
  - **TV:** when it appears it **takes focus**, so OK skips because the button you can see has focus. If the person presses anything else, focus goes back to where it was.
  - With `skipIntros` on, it skips by itself and shows a toast, "Intro skipped · Undo", for 5 s (Undo is reachable with Up).

### 1.2 TV remote model (C3)
The states are **Playing** (chrome hidden), **Chrome** (bands visible), **Sheet** (a side panel is open), **Scrub** (the thumbnail strip is open), **Pause card**, **Post** (next episode or end).

| Key | Playing | Chrome | Sheet | Scrub |
|---|---|---|---|---|
| OK | Pause and show Chrome, focus on ⏯ | Activates the focused control | Picks the focused row; stays open (audio and subtitles change live) | Commits the seek and goes back to Chrome |
| Left / Right (tap) | Seek −10 / +10 s, ripple, **no chrome** | Moves focus | Moves between columns | Steps −10 / +10 s |
| Left / Right (hold) | Enters **Scrub**, then accelerates: 10 s, 30 s after 1.5 s held, 60 s after 3 s, 5 min after 5 s | Moves focus (repeats) | — | Same acceleration |
| Up | Shows Chrome, focus on the **scrub bar** | Row → scrub bar → (top band isn't focusable) | Moves up | Leaves Scrub without seeking |
| Down | Shows Chrome, focus on ⏯ | Scrub bar → control row; from the row: opens **Episodes** | Moves down | — |
| Back | Shows Chrome. **A second Back within 3 s exits.** (Netflix exits at once, but its "are you leaving" behaviour is a known pain point. This is the gentler version.) | Hides Chrome | Closes the Sheet, focus returns to its button | Cancels Scrub (back to where it was) |
| Play/Pause | Toggle | Toggle | Toggle | Commit and play |
| FF / RW (media keys) | ±10 s; held scrubs | same | same | same |

Rules:
- **Chrome auto-hides** after 5 s of no keys while playing, never while paused, and never while a Sheet or Scrub is open.
- **The pause card** (title logo, episode, synopsis) appears after 8 s paused, **only when Chrome is hidden**. Any key dismisses it and does nothing else: the first press only wakes the screen. It must **never** be drawn together with the buffering ring or the seek ripple (C3). Priority: Sheet > Scrub > Chrome > Pause card > buffering ring.
- **The Back arrow at the top left is not drawn on TV.**
- **Nothing traps focus.** Each state has one entry point and Back always goes one level up. A sheet remembers the row last focused in it.
- **Focus on the control row:** a paper ring plus the label, written in full under the icon at 22 px. The focused control's label is in `--fg`, the others in `--fg-2`.

### 1.3 Scrubbing with thumbnails
- **The strip:** 5 thumbnails, 320×180 at 1080p, centred on the target. The middle one is 1.25× with its timecode in Zen Maru 700 24. The scrub bar shows a ghost knob at the target and the real knob at the current time.
- **Markers on the bar:** intro and recap are drawn as 4 px moss segments, and credits as a tick.
- **Web:** keep the hover preview. Add the same strip while dragging, and on keyboard ←/→ with the bar focused.
- **Phone:** dragging the knob shows one large thumbnail above the finger, with haptic ticks at chapter markers.
- **Source:** `player/Thumbs.kt` already exists on Android, and the web has thumbnails. Both should use the same server thumbnail track (see §S6 if it's web-only today).

### 1.4 Sheets: Audio & subtitles, Quality
They are side panels on TV and web (40% width on TV, 420 px on the web) and bottom sheets on phone. They follow the ink-and-wash dialog style (2043f86): a flat `--surface` panel with a brushed top edge, and no glassmorphism.

**Audio & subtitles** has two columns, **Audio** and **Subtitles**.
- **Rows:** a language name plus at most one qualifier ("Japanese · Original", "English · Dub", "English · Signs & songs", "English · SDH"). The checked row gets a moss tick and a `--surface-3` fill.
- **Footer rows:**
  - "Subtitle style ›" opens §2.3 inline as a third column.
  - A **remember** line, "Keep for Frieren", is **on by default** (writes `tracks`). It's a joint switch.
  - "Your defaults ›" opens Settings → Languages.
- **Live changes.** Picking a row applies at once, without closing. On a non-HLS native play, an audio change that needs a different release shows "Switching to the dub…" in the loader's stage line (§4).

**Quality**
- **Rows:**
  - "Auto · 1080p now", with a moss dot;
  - "4K · Dolby Vision · Atmos" (only when `quality.options` includes 2160 **and** the device can show it);
  - "1080p", "720p", "Data saver";
  - each row carries its tags (§5).
- **Footer:** "Speed 1× ›", and "Make this the default on this TV" (writes the device quality).
- **Picking a quality** calls `play` again with `quality` and the position, and **keeps the frame on screen** under the loader band (§4.3) instead of going to black.

### 1.5 Next episode and the end of an episode
- **At `markers.credits`**, or 20 s before the end when there's none, a card appears at bottom right. It has the next episode's still (16:9, 360 px wide on TV), "Next episode", its name, and a **seal with a draining countdown bar** inside the seal's base (not a ring). It has focus on TV.
- **Back** dismisses it and keeps watching the credits.
- **Countdown:** 8 s with `autoplayNext` on. With it off, the seal reads "Play next" and doesn't count.
- **Filler ahead** (`fillerAhead`, fillers=ask): the card instead reads "Episodes 5–6 are filler" with the seals **Skip to 7** (primary) and **Watch 5**, plus a quiet "Always skip filler" that writes `fillers: skip`. No countdown.
- **The end of a series or a film:** the frame shrinks to the corner (keep the reference's motion, 700 ms), and "More like this" fills the screen. TV focus starts on the first suggestion.

### 1.6 Phone player specifics
- **Landscape only** (already the case).
- **Gestures:**
  - double-tap left or right thirds: ±10 s, and it stacks (+20, +30) while tapping;
  - a vertical drag on the left half: brightness, on the right half: volume;
  - pinch: fill or fit.
- **The control row:** icons at 24 dp in 48 dp targets. The Quality tag sits next to the Audio & subtitles icon, so quality is always one tap away.
- **Bottom chrome** follows the `bottomChrome` rule (it sits in the home-indicator inset).

### 1.7 Web player specifics
- Remove the top-right fullscreen button. Keep the one in the bar.
- Keyboard:
  - Space or K: play/pause;
  - J / L or ← / →: ±10 s;
  - F: fullscreen;
  - M: mute;
  - C: cycle subtitles;
  - Shift+N: next episode;
  - Esc: close the sheet, then exit fullscreen, then leave the player.
- Make Home and the modal `inert` while the player is open (C18).
- Subtitles use the house style (§2.3), not the browser's grey box: `::cue { background: transparent; text-shadow: …; }`, or render the cues ourselves from the VTT track for full control of the outline.

---

## 2. Preferences: one surface, reachable from everywhere (C2)

### 2.1 Where it lives
- **Web:** a **Settings** gear in the header, between Search and the avatar. It opens a full page at `/watch?p=settings`. The avatar menu also has "Settings", next to the profile switcher. There's no quality item in the avatar menu.
- **Phone:** the gear at top right of Home and My list opens the Settings screen. The avatar sheet has the profile switcher, Settings and Kimono account.
- **TV:** a **gear** item in the top nav after My list and Search, labelled "Settings" when focused. It's a full-screen two-pane layout: a list on the left and options on the right.
- **From the player:** the footer rows of the Audio & subtitles and Quality sheets ("Your defaults ›", "Make this the default…").
- **From the title page:** a **Sub / Dub** segmented joint for anime, and "Audio: Japanese, English · Subtitles: 6 languages" under the synopsis (§6).

### 2.2 The groups and controls (same order everywhere)
1. **Languages**
   - *My language:* a picker (default from the Kimono account locale) → `audioLanguage`.
   - *Anime:* Original with subtitles / Dubbed when there is one → `animeAudio`.
   - *Films & series:* Original audio / My language when there is one → `filmAudio`.
   - *Subtitles:* Automatic / Always / Off → `subtitles`. Under "Automatic", one line: "When the audio isn't in your language." That's the only helper line on the page.
   - *Subtitle language:* Same as my language / a picker → `subtitleLanguage`.
2. **Subtitle style:** Size S / M / L / XL, Look Outline / Shadow / Box, Colour Paper / Yellow, with a **live preview** over a still (§2.3). → `subtitleStyle` (new, §S3).
3. **Playing**
   - *Autoplay next episode:* switch → `autoplayNext`.
   - *Skip intros and recaps:* switch → `skipIntros`.
   - *Filler episodes:* Ask / Skip / Watch → `fillers`.
4. **Quality on this device:** Auto / 4K / 1080p / 720p / Data saver.
   - It shows only the tiers this device can play. The web never offers 4K (C4).
   - Under it, in `--fg-3`: "This TV plays 4K · HDR10 · Dolby Vision · Dolby Atmos". That's the device profile, in plain words.
   - Writes `PUT /prefs {device, quality}`.

Every change saves at once (no Save button) and confirms with a 1.2 s moss tick beside the control. Controls are segmented joints (the shoji and joint switch from Kata), not dropdowns, wherever there are ≤4 options.

### 2.3 Subtitle house style
- **Default:** Zen Maru Gothic 700, paper `#F4E9E1`, a 2 px ink `#110C0A` outline plus a soft shadow `0 2px 6px rgba(0,0,0,.6)`, and no box.
- **Size:** M is 4.4% of the video height (S 3.6%, L 5.4%, XL 6.6%).
- **Position:** bottom margin 7% of height, raised to 16% while the chrome is up.
- **Box:** `rgba(17,12,10,.72)`, 4 px radius, 0.3 em padding.

---

## 3. Rows, sorting and filtering (C0, C16)

### 3.1 Fix web row scrolling now (C0)
```css
.kw .kw-rows > * { min-width: 0; }      /* or grid-template-columns: minmax(0,1fr) on .kw-rows */
```
- **Arrows:**
  - always visible when the rail can scroll that way. A 48 px edge on `--bg` at 78%, flat, with a 28 px chevron; it brightens on hover;
  - hidden on the side it can't go, which leaves a 0.4-opacity sliver that hints there is more;
  - each click pages by `floor(railWidth / cardWidth)` cards.
- **Page dashes:** top right of the row title on hover, 12×2 px each, current one in `--fg`.
- **Inputs:** keep trackpad and shift-wheel scrolling (they work once the width is fixed), and keep snap.
- **The row title is a link.** "Popular series ›" opens §3.3. The chevron slides 4 px on hover, and "Explore all" fades in beside it.

### 3.2 TV rows
- **The focused card stays in a fixed slot**, the first column. The row slides under it, so the eye doesn't chase focus.
- **The last item in every row** is a **"See all"** tile: `--surface-2`, the row name in Mincho 28, and "See all ›" in Zen Maru.
- **Vertical movement:** the page moves one row per Down, and the hero collapses to a 30%-height band with the focused title's backdrop and metadata (Netflix's "billboard follows focus").

### 3.3 The category page ("See all") and My list
- **The header:** H1 (Mincho), then the **filter rail** (underline tabs: All · Series · Films · Anime), then the **Sort** control on the right.
- **Sort is a quiet seal** labelled with the current choice ("Sort: Recently added"). It opens a small menu:
  - **My list:** Recently added (default) · Recently watched · Release year (newest) · Release year (oldest) · A–Z.
  - **Category pages:** Popular (default) · Release year · A–Z · Recently added to Kimono.
  - **Search:** Best match (default) · Release year · A–Z.
- **More filters** in My list and categories, as a "Filters" quiet seal:
  - *Genre* (multi-select);
  - *Not started / In progress / Finished*;
  - *Plays in 4K* (only on 4K devices);
  - *Has a dub in my language*.
- **Active filters** show as one line of text under the rail, "Anime · In progress · ✕ Clear", not as chips.
- **Grid:** posters (2:3), 6 columns at 1440, 3 on phone, 7 on TV with focus. The name and year sit under each poster (C15: the two Doraemons become "Doraemon · 1979" and "Doraemon · 2005").
- **Choices stick** per page, per profile (local storage on web, DataStore on Android).

### 3.4 Search
- **Desktop and TV:** a poster grid (not list rows), the filter rail (All / Series / Films / Anime), and sort.
- **Phone:** keep the list rows, but add the year and kind ("2023 · Anime · 28 episodes").
- **The skeleton** matches the grid.
- **Results stream in:** local catalogue hits first (instant), then the remote ones.
- **A missing poster** becomes the backdrop crop or a `--surface-2` tile with the name in Mincho. Never a lone initial.

### 3.5 Things Netflix has that a household would miss (cheap wins)
- **Continue watching:** a "⋯" on the card, with *Remove from row* and *Mark as watched*.
- **"Because you added X"** and **"Watch it again"** rows.
- **Title page:** an *Episodes* sort (oldest/newest), *Download season* on the phone, and *Remind me* for unreleased seasons (`reminders` already exists).
- **Profile-level kids mode** (max maturity) as part of settings. Flag it for later; it needs the server.

---

## 4. Loading with real progress (C1, C12)

### 4.1 What is knowable, and where
| Stage | Known by | Signal | Shown as |
|---|---|---|---|
| **Finding** the stream | server | cache hit (instant), or a search under way: sources answered / asked | "Finding the best copy" with source dots filling (3 of 5) |
| **Choosing** a version | server | ranked count, chosen label and badges | "1080p · 5.1 picked" with tags, and moss ticks |
| **Preparing** (HLS only: web, cast, transcode) | server, from the packager | probe done; first segment encoding (seconds encoded / target 6 s) | "Getting it ready", with a real fraction |
| **Connecting** | client | first byte of the media | the stage line only |
| **Buffering** to start | client | ExoPlayer `bufferedPosition − start` over `bufferForPlaybackMs` (2.5 s); hls.js `FRAG_LOADING` bytes and buffer ahead / `startBuffer` | a real percentage, **only for this last stage** |

### 4.2 How it looks (built only from the house loaders)
**The house rule: no custom spinners.**
- **InkLoader** (the morphing shape, `packages/ui/src/loading.tsx` / Compose `InkLoader.kt`) for any wait with no measure.
- **InkWave** (`InkProgress.kt`) for linear real progress.
- **InkRing** (the brushed wave round a circle) for the start of playback.
- Watch's `WavyRing` is deleted on Android. Every call site (`Root.kt`, `Profiles.kt`, `TitleScreen.kt` downloads, `PlayerScreen.kt`) moves to one of these three.

The start-of-playback screen:
- **The backdrop:** the episode still (or the title backdrop), blurred 24 px and darkened to 35%. Not black.
- **Centre:** the title logo, then `S1:E4 · The Land Where Souls Rest`.
- **Below that, the InkRing** (96 px web/phone, 120 px TV) with `percent` on. Its value is the overall start progress, built from the stages below. Each stage owns a span of the ring: Find 0–25%, Choose 25–35%, Prepare 35–70% (HLS only; without it, Buffer takes 35–100%), Buffer 70–100%.
  - A span fills by its real signal: sources answered out of asked, seconds encoded out of 6, buffer ahead out of the start threshold.
  - **With no signal** (for example a search with no per-source count), the ring holds at its span's start and the stage line says what's happening. It never creeps.
- **Under the ring, four small stage words** (Find · Choose · Prepare · Buffer) in Zen Maru 14. Done = `--fg-2` with a moss tick, current = `--fg`, to come = `--fg-3`. Text, not dots, so it adds no second loader.
- **One line of Zen Maru 16 under the stage words** names the current stage in plain words:
  - "Finding the best copy…"
  - "Picked 1080p · 5.1"
  - "Getting it ready · 40%"
  - "Buffering · 72%"
- **Percentages are only shown where they are real.**
- **After 12 s with no stage change,** add a quiet line: "This one's taking a while." After 25 s, a quiet seal "Try another copy" (calls `play` with `version: index+1`) next to Back.
- **Stages already done when the screen opens** (cache hits) appear filled immediately. Don't animate fake progress through them.
- **Prepare** is skipped on native direct play. Show three marks.

### 4.3 Mid-play loads (quality change, version switch, seek)
- **Keep the last frame**, dimmed to 60%, and put a slim band at the bottom: the stage line, plus an **InkWave** above the scrub bar carrying the same value.
- **Buffering while playing:** a 48 px **InkLoader** in the centre after 600 ms of stall (not before). If the stall lasts more than 4 s, add "Buffering · 3.2 s ahead" under it.
- **Elsewhere:**
  - signing in, the profile picker and app start: InkLoader;
  - downloads on the title page: InkWave under the episode row (the real bytes);
  - the web's "waiting for Watch to start": InkLoader (already done).

### 4.4 Start faster
- **Web:** on title page open (or when Resume gets focus on TV), call `play` with `prewarm: true` (§S1). The packager probes and makes the first segment while the person reads the synopsis.

---

## 5. Quality and format tags (C5)

- **Set:** `4K` · `HD` · `Dolby Vision` · `HDR10+` · `HDR` · `Dolby Atmos` · `5.1` · `7.1`. Also `Audio description` and `SDH` when the server knows them.
- **Only what this device will actually get.** Hidden when unknown. Never show a skeleton for tags.
- **Style:** a 1 px `--fg-3` border, 2 px radius, Zen Maru 700 11 px with `.06em` tracking, `--fg-2` text, 18 px high. Dolby Vision and Atmos use the words, not logos (no licence). No fills, no colour, no gradient. It is a **stamp**, not a pill.
- **Where:**
  - **Title page / modal:** in the meta line after the year, maturity and season count: `2023 · 13+ · 1 season · HD · 5.1`.
  - **Hover card / TV focused-card metadata:** the same line.
  - **Cards:** only the **top** tag (4K, else nothing), at the poster's top-right corner. Netflix doesn't tag cards at all, so keep it to one, or none.
  - **Player:** in the Quality control and each Quality row.
  - **Loader:** at the "Choosing" stage.

---

## 6. Title page fixes
- **The tracker copy (C13):** "Episode 4 of 28 · 24 left". When it's caught up: "You're up to date · New episode Fri". When it has ended: "Finished the series". Never two contradicting lines.
- **Under the synopsis:** "Audio: Japanese, English · Subtitles: English, Portuguese +4". Tapping or OK opens the language column of the sheet.
- **Anime:** a **Sub | Dub** joint next to the Resume seal. It's only there when both exist, and writes `tracks` for the title.
- **Meta line:** year · maturity · seasons · tags (§5) · genres (max 3).
- **Episodes:** a sort (oldest/newest). Filler episodes get a small "Filler" stamp in the tag style, and recap episodes "Recap".

---

## 7. Brand, consistency, accessibility
- **Lockup on every client:** the **bloom with the play glyph** + "kimono" (Mincho 700) + "watch" (Mincho 700, Watch's colour). On the web this is `AppLockup` (commit 8f47368). On Compose it's the shared `InkBloom` with the play glyph, plus the same two words. **Remove 観 everywhere**:
  - `Atoms.kt` `Seal()` and `Brand()`;
  - `Profiles.kt` (two places);
  - `ic_seal.xml`, `ic_seal_mono.xml` and `banner.xml`;
  - the comments in `watch-app.tsx` and `Models.kt`.
- **Android launcher:**
  - the adaptive icon's foreground is the bloom with the play glyph (as a vector, from `bloomSvg(…, {glyph:"play", standalone:true})`) on `night`;
  - **monochrome** is a single-path silhouette of the five petals with the play triangle cut out of the heart. Check it at 48 dp in themed-icon mode;
  - the label is "Kimono Watch".
- **TV banner (320×180):** the bloom at 72 px, "kimono" and "watch" in Mincho 700 at 34, centred on `#110C0A`. It must stay legible at the launcher's ~160 px row height.
- **Notification icon:** the bloom silhouette, white.
- **Web favicon and tab:** Watch's bloom at 16, 32 and 48 px, plus an apple-touch icon at 180, set in `watch/page.tsx` metadata so `/watch` stops showing Kimono's generic favicon. The tab title is "Kimono Watch", or "{Title} · Kimono Watch" while a title is open or playing, without a second "· Kimono".
- **Loading screens:** the house loaders only (§4.2). App start shows the bloom with InkLoader under it, never a custom ring.
- **Avatars:** the rounded square (28%) on every client. On TV, focus is a ring, not a shape morph.
- **Typography:** curly apostrophes everywhere. Kotlin strings use `’`.
- **Web layering:**
  - the menus render in a top-layer portal (fixes the account menu behind the modal);
  - the modal and player make the rest `inert`;
  - focus returns to the opener.
- **Contrast:**
  - nothing below 4.5:1 on imagery;
  - row and hero text sits on a `--bg` scrim;
  - minimum text 13 px web, 12 sp phone, 20 px TV.
- **Deep links:** `/watch?t=` renders the modal skeleton over a blurred backdrop from the first paint (C20).
- **Empty My list:** a bloom outline at 64 px, "Nothing saved yet", and a quiet seal "Browse anime" that goes to the Anime filter.

---

## Server: what's missing

| # | Need | Shape | Notes |
|---|---|---|---|
| S1 | **Play progress** | `POST /play` with `Accept: application/x-ndjson` streams `{"stage":"find","cached":false,"asked":5,"answered":2}`, `{"stage":"choose","versions":14,"label":"1080p · 5.1","badges":[…]}`, `{"stage":"prepare","encoded":2.1,"target":6}` (HLS), then the usual answer as `{"stage":"ready",…play}`. Without the header: today's JSON. Also `prewarm: true`: run find, choose and prepare, and answer `{ready}` without a token. | `streams.ts` needs a per-source callback; the packager needs a probe/segment status hook (`/hls/<token>/status` or a callback). |
| S2 | **Badges for cards and title pages** | `formats: string[] \| null` on `titleView`, and an optional `formats` on `Card`, when releases are **already cached** for the first or resume episode. Ranked for the device given by an `X-Kimono-Device` header (the same JSON as `play.device`). Never start a search just for badges. | `badges()` exists, so reuse it with `rank(found, device, quality…)`. |
| S3 | **Subtitle style pref** | `subtitleStyle: { size: "s"\|"m"\|"l"\|"xl", look: "outline"\|"shadow"\|"box", colour: "paper"\|"yellow" }` in `Prefs`. | It's just stored. |
| S4 | **Clean track labels** | `languages.audio` / `subtitles` become `{ id, lang, label, kind: "full"\|"signs"\|"forced"\|"sdh"\|"commentary", original: boolean }[]`, deduped, with group names stripped. `label` is already human ("Portuguese (Brazil)"). | Today they're raw strings. |
| S5 | **Sort and filter** | `GET /list?sort=added\|watched\|year\|az&shelf=&state=&genre=`, `GET /browse/:rowId?sort=&shelf=&genre=&page=` (a "See all" for every Home row), and `search?q=&shelf=&sort=`. Cards gain `addedAt` (list) and `watchedAt`. | `list.added_at` and `progress.updated_at` already exist. Browse pages call the same TMDB discover queries with `page`. |
| S6 | **Thumbnail track** | A `thumbs` URL on the play answer (a WebVTT sprite map), for native as well as web. | Check what the web uses now; `Thumbs.kt` may be generating its own. |
| S7 | **Device capability in plain words** | `GET /prefs?device=` adds `device.can: ["4K","HDR10","Dolby Vision","Dolby Atmos"]`, from the last device profile sent with `play`. | For §2.2's "This TV plays …" line. |
| S8 | **Title audio and subtitle summary** | `titleView.languages: { audio: string[], subtitles: string[] } \| null` from the cached releases. | §6. |
| S9 | **Continue-watching edits** | `DELETE /progress/:titleId` (remove from row), `POST /progress {finished:true}`. | §3.5. |
| S10 | **Logo luminance** | `logoTone: "light"\|"dark"` on cards, worked out once per image in `images.ts`. | §0 title art. |

---

## Build order (suggested)
1. **Web:** the row fix (§3.1, one line plus the arrows). Then the Quality control on its own button with its tag, the track labels (needs S4), and the subtitle house style.
2. **TV:** the focus ring and labels on the control row, the remote state machine (§1.2), and skip taking focus.
3. **All clients:** the Settings surface (§2), reading and writing existing prefs (S3 can follow).
4. **Server S1, then the staged loader** on all three.
5. **Title art** (§0, logos on cards), and tags (needs S2).
6. **Sort and filter, and the category pages** (needs S5).
