# Design

Kimono's visual language is cut here before it reaches the app.

The workflow is **Katagami** (型紙 — the stencil a dyer cuts once, then presses
onto every bolt so the whole garment carries one pattern). Run it with
`/katagami`; the process itself lives in `.claude/skills/katagami/SKILL.md`.

## Shipped

型 Kata is a real package. `packages/ui/src/kata.css` holds the tokens and the
primitives, `packages/ui/src/index.tsx` exports them, and the contract is
`docs/design-system.md`. The Portal imports `@kimono/ui/kata.css` before its
own stylesheet, and the phone app reads the same tokens through
`apps/compose/scripts/tokens.mjs`.

## Where we are

**Foundations: Material 3, with Kata's personality** (ADR 0006, accepted
2026-11-04). The web runs on the phone's tonal roles, type scale, corner scale
and spring. The seal, joint, door, blooms, petals and the ink-and-wash hand
stay Kimono's. The paper system (edge weight, square corners, hairline boxes,
grain) is retired.

**Cut:** buttons (the hanko seal, hold-to-confirm), the switch (the joint),
the door, type (ADR 0005), petals (ink and wash, `specimens/12-petals.html`).

**Next:** containers (`specimens/14-containers.html`), then a proof page.

## How it runs

    0  Motif brief      name the devices and the job each one holds   → motifs.md
    1  Specimen sheet   one element class, real interactive variants  → specimens/
    2  Verdict          keep / adjust / kill, per specimen            → motifs.md
    3  Cut the stencil  accepted specimen becomes tokens and CSS      → decisions/
    4  Proof page       one real page, accepted vocabulary only
    5  Roll out         remaining pages, one at a time

Nothing is finished until it survives a proof page. Anything a page needs that
has not been cut goes back to Stage 1 rather than being improvised inline.

## Files

- `motifs.md` — the device vocabulary, the job each holds, and what has been ruled out
- `queue.md` — element classes in order, with status
- `specimens/` — one HTML sheet per round, viewable in a browser
- `decisions/` — one ADR per accepted element class, numbered as in `docs/decisions/`

## The rule everything is tested against

A device must do structural work, not just decorate. Vines that wrap the page
*and* underline its links are a language; vines that only sit in the corners are
wallpaper.

## Surface and hierarchy revision — 2026-10-04 (rejected)

A review proposed surface tiers, a semantic chip palette and an app's colour
across its headings. It lost because it did not read as Kimono. Its surface
tiers came back a month later as Material's tonal containers (ADR 0006). The
semantic palette and the tinted room are still ruled out. The record is
`decisions/0004-surface-hierarchy.md`.
