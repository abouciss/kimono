# Music player controls: critique and spec

Mockup: `player-controls.html`, in this folder. Open it in a browser. It follows the system theme and has a light/dark switch.

## What's wrong today

1. **"+" reads as a fourth vote.** The bar shows four glyphs of the same size, colour and round hover: down, up, love, +. A bare + doesn't say what it adds to (queue? library? playlist?). Up and love *already* save the song to Liked songs (`liked()` keeps everything rated up or love), but nothing tells you that, so you go looking for a separate "save".
2. **Round buttons.** `.km-iconbtn` and `.km-rate` hover as 50% discs. The design system says round buttons aren't Kimono's. Only Play is a seal; everything else is a generic media-player icon.
3. **Lyrics and Queue look like chips.** When open they fill with the secondary container at 8px corners, which is the chip's look, not a toggle's. "Lyrics" really means "Now Playing": the cover and the title do the same thing, and when a song has no lyrics, Lyrics opens onto "No lyrics for this song."
4. **Rating is missing at ≤1100px.** Between 721 and 1100px the marks and + are hidden, seeking shrinks to a 2px line you can't grab, and volume drops to a mute toggle. Shuffle and repeat squeeze the song's name instead.
5. **Phone Now Playing is half a player.** It has no seek bar, no shuffle or repeat, no queue, no volume. The close chevron sits on the art's corner, and the floating mini bar covers the lyrics.
6. **Now Playing's actions are one undifferentiated row.** "Add to playlist" sits as a chip right after the marks, at the same weight. The artist and album look like plain grey text, so you can't tell they go anywhere. The queue floats over the lyrics instead of sitting beside them, and nothing says what's playing from (album, playlist, radio).
7. **Smaller misses.** A hairline over the bar (depth should come from tone). The on-state for shuffle and repeat is a 4px CSS dot, where the system draws small circles by brush.

## The idea

The bar has three groups, each with one meaning:

- **The song** (left): what it is, and how you feel about it.
- **Playing** (centre): the transport and your place in the song.
- **Around the song** (right): views (Lyrics, Queue), volume, and the song menu.

Rating is the save. Up and love put the song in Liked songs, and the first time you do it a toast says so and offers **Add to playlist**. Add to playlist never sits beside the marks. It lives in the song menu (⋯) everywhere, in the toast, and as a worded quiet seal in Now Playing's header.

## Shared parts

| Part | Spec |
| --- | --- |
| **Icon button** | 40×40 (48 hit area), 12px corners (`--k-r-m`), glyph 20–24px in `on-surface-variant`. Hover: a square wash, `on-surface` at 8%. Never round. |
| **Toggle** (shuffle, repeat, a view) | Off: a bare icon button. On: a **pressed stamp**, `secondary-container` fill with `on-secondary-container` glyph, sunk 1px with a 2px inner shadow on top, so it reads as pushed in. No dot. Repeat cycles off, all, one; "one" swaps the glyph. |
| **Rate tray** | The three marks as one object: a `container-high` strip with 12px corners and 2px padding. Cells are 32 in the bar, 40 on phone Now Playing and 44 in desktop Now Playing, with 8px corners. A set mark gets an **ink-and-wash blot** behind it (accent wash with a plum brush ring, seeded per song) and its glyph in the accent colour. Love does its 1.25× pop. Pressing the set mark again takes it back. Tooltips: "Not for me", "I like this", "Love this". Nothing else ever goes in the tray. |
| **View leaves** (Lyrics, Queue / Up next) | A `container-high` tray of worded leaves, each 36 tall with a 20px icon and a 13/700 word. The open leaf is seated on `secondary-container`, with a 3px accent marker under its word (the "one selected marker" rule). With no lyrics, the Lyrics leaf is lifted (no fill, muted word) and its tooltip says "No lyrics for this song". |
| **Song menu ⋯** | An icon button that opens the raised menu (ink-and-wash bar, `container-high`, `--k-shadow-raised`). Items: Add to playlist ›, Play next, Song radio, Go to artist, Go to album. When the rate tray isn't visible (bar ≤900px), the three marks come first as a row inside the menu. |
| **Liked toast** | Shown after a song's first up or love: "In Liked songs" plus an accent text action, **Add to playlist**, which opens the playlist list. It stays 5s, and longer while hovered. Never shown on down. |
| **Play** | The existing seal: 52×46 in the bar, 64×56 on phone Now Playing, 48×44 in the mini bar. |
| **Seek** | A 4px rail that grows to 6px on hover, with the knob on hover or drag and times in tabular figures. |

## The bar

### Wide (>1100px), 88px tall

| Place | Control | Notes |
| --- | --- | --- |
| Left | Cover 56 → title (15/700) and artists (13, links) → 20px gap → **rate tray** | The name truncates first (min 160px), and the tray never moves. Cover or title opens Now Playing. |
| Centre | Shuffle · Previous · **Play** · Next · Repeat, with the seek row below (time, rail ≤640, time) | Shuffle and repeat are toggles. |
| Right | **View leaves** (Lyrics, Queue) → volume (icon + 96px rail) → **⋯** | The ⋯ is last, away from the marks. |

### Medium (721–1100px), 80px tall

| Place | Control | Notes |
| --- | --- | --- |
| Top edge | Seek: a 4px rail across the bar's full width, grabbable, with a 12px hit area. Times show on hover as small raised tags. | This replaces the 2px line you can't grab. |
| Left | Cover 48, name, **rate tray** | The tray stays down to 900px. At ≤900 it leaves the bar for the ⋯ menu (and stays in Now Playing). |
| Centre | Previous · **Play** · Next | **Shuffle and repeat move into the Queue panel's header** as worded toggles. Order belongs to the queue. |
| Right | View leaves (words kept) → volume icon (tap mutes, a long press opens a small raised vertical slider) → ⋯ | At ≤900 the leaves stack their word under the icon (11/700) so they stay worded. |

### Phone (≤720px), the floating mini bar, 64px tall

| Place | Control |
| --- | --- |
| Top edge | 3px progress line (display only; seek in Now Playing) |
| Left | Cover 44, title, artists |
| Right | **Play** seal 48×44, Next |

Nothing else goes on the mini bar. Tapping it opens Now Playing, and swiping up on it opens Now Playing too.

## Now Playing

### Desktop

- **Header** (64px): on the left, a 12/700 "Playing from" label over the source as a link ("Top songs", the album, the playlist). On the right: an **Add to playlist** quiet compact seal (40 tall, playlist-add icon and the words), then ⋯, then close ⌄. Close is in the header, never on the art.
- **Left column**: art up to 420px; title in Mincho 32/38; the byline, where the artist and album are links in `--k-app-text` that underline on hover, so "go to artist or album" is the byline itself. Then the **rate tray** (44 cells), centred, 20px below, alone on its row.
- **Right column**: the **view leaves** at the top, "Lyrics | Up next". Up next is the queue, drawn here instead of as a panel floating over the lyrics, with shuffle and repeat in its header. The bar's Lyrics and Queue leaves switch this column while Now Playing is open, and open the floating queue panel only when it's closed.
- Lyrics keep their current treatment.

### Phone (a full sheet over the bottom bar)

1. Header: close ⌄ on the left, "Playing from / Top songs" centred, ⋯ on the right.
2. The art, square with 16px corners. The Lyrics leaf swaps it for lyrics in place; the seek and transport stay put.
3. Name row: the title (Mincho 24) and byline links on the left, with the **rate tray** (40 cells) on the right. This is the one place the marks sit beside the name, because at this size the name has its own line and the tray is the row's only other object.
4. Seek: a full-width rail with times below.
5. Transport: Shuffle · Previous · **Play** (64×56) · Next · Repeat, spread across the width.
6. Bottom leaves: **Lyrics | Up next**, full width.

The mini bar hides while the sheet is open, so it no longer covers the lyrics. Volume is the device's.

## Answers

1. **Where things live in the bar.** Rating is with the song on the left as one tray at wide and medium (≥900), and in ⋯ and Now Playing below that. Add to playlist goes in ⋯, the toast and Now Playing's header, never the bar's face. Lyrics and Queue are worded leaves on the right at every width above a phone. Volume is a slider at wide, an icon with a long-press slider at medium, and the device's on a phone. Shuffle and repeat sit in the transport at wide, and in the queue's header at medium and on phones.
2. **Now Playing's song actions.** Rate sits under the name, alone. Artist and album are the byline's links. Add to playlist is a worded quiet seal in the header. Queue is the "Up next" leaf beside the lyrics. Everything else is in ⋯.
3. **Add to playlist: both, plus the heart.** Up and love already save to Liked songs, so they *are* the save. The fix is to say so: a toast that offers Add to playlist right then. Don't add a separate heart (it would be a fourth love), and don't make long-press the only way in (nobody finds it). A long press or right-click on the rate tray can open the playlist list as a shortcut, but only as a shortcut.
