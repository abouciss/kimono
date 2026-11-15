import test from 'node:test';
import assert from 'node:assert/strict';
import { matchScore, parseLrc, plainTitle } from '../src/lib/music/model.ts';

const track = (title, artist, duration) => ({ key: 'dz:1', title, artists: [{ key: 'dz:2', name: artist }], album: null, duration, isrc: null, explicit: false, rank: 0 });
const song = (title, artists, seconds) => ({ id: title, title, artists, seconds, kind: 'song' });
const video = (title, artists, seconds) => ({ id: title, title, artists, seconds, kind: 'video' });
const best = (t, cands) => cands.map((c) => ({ c, s: matchScore(t, c) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s)[0]?.c.id ?? null;

/* Real YouTube Music results for "Mariya Takeuchi Plastic Love" (Nov 2026): the original is only a music video, with an intro. */
test('a song only on YouTube as its music video finds that, not a cover', () => {
  const t = track('Plastic Love', 'Mariya Takeuchi', 294);
  assert.equal(best(t, [
    song('Plastic love 竹内 まりや (Acoustic Version)', ['FUKUSHU BAND'], 326),
    song('Plastic Love', [], 233),
    song('プラスティック・ラブ (Cover) - Plastic Love (Cover)', ['Yumi Matsuzawa'], 279),
    video('Mariya Takeuchi - PLASTIC LOVE covered by SC93 WITH FRIENDS FEATURING OTJJ', ['SC93 PROJECT'], 285),
    video('プラスティック・ラブ - Plastic Love', ['Mariya Takeuchi'], 309),
    video('Mariya Takeuchi - Plastic Love  竹内 まりや - プラスティックラブ 1984', ['SOULCITYWALK'], 477),
    video('mariya takeuchi - plastic love (432hz + slowed + reverb)', ['reefa'], 358),
    video('プラスティック・ラブ (Live) - Plastic Love (Live)', ['Mariya Takeuchi'], 346),
  ]), 'プラスティック・ラブ - Plastic Love');
});

test('the radio edit is told from the album version by its length', () => {
  const t = track('Get Lucky (Radio Edit - feat. Pharrell Williams and Nile Rodgers)', 'Daft Punk', 248);
  assert.equal(best(t, [
    song('Get Lucky (feat. Pharrell Williams and Nile Rodgers)', ['Daft Punk', 'Pharrell Williams', 'Nile Rodgers'], 369),
    song('Get Lucky (Radio Edit - feat. Pharrell Williams and Nile Rodgers)', ['Daft Punk', 'Pharrell Williams', 'Nile Rodgers'], 248),
  ]), 'Get Lucky (Radio Edit - feat. Pharrell Williams and Nile Rodgers)');
});

test('words in the song’s own name are not taken for another version', () => {
  assert.ok(matchScore(track('Live Forever (Remastered)', 'Oasis', 276), song('Live Forever', ['Oasis'], 277)) > 0);
  assert.ok(matchScore(track('All About That Bass', 'Meghan Trainor', 189), song('All About That Bass', ['Meghan Trainor'], 188)) > 0);
  assert.equal(matchScore(track('Wonderwall', 'Oasis', 258), song('Wonderwall (Live)', ['Oasis'], 260)), 0);
  assert.equal(matchScore(track('Wonderwall', 'Oasis', 258), song('Wonderwall', ['Some Covers Band'], 258)), 0);
});

test('a title only has to contain the song’s name, in any script beside it', () => {
  assert.equal(plainTitle('Get Lucky (feat. Pharrell)'), 'get lucky');
  assert.ok(matchScore(track('Shinunoga E-Wa', 'Fujii Kaze', 185), song('Shinunoga E-Wa', ['Fujii Kaze'], 186)) > 0);
  assert.equal(matchScore(track('Love', 'Kendrick Lamar', 213), song('Lovely', ['Kendrick Lamar'], 213)), 0);
});

test('LRC lines become seconds, with repeated stamps', () => {
  assert.deepEqual(parseLrc('[00:12.50]Hello\n[01:02.00][02:00.00]Chorus\nno stamp\n[00:00.00]'), [
    { at: 0, line: '' }, { at: 12.5, line: 'Hello' }, { at: 62, line: 'Chorus' }, { at: 120, line: 'Chorus' },
  ]);
});
