import test from 'node:test';
import assert from 'node:assert/strict';
import { likeness, linkOf } from '../src/lib/music/imports.ts';

test('playlist links from each service', () => {
  assert.deepEqual(linkOf('https://open.spotify.com/playlist/37i9dQZF1DX4UtSsGT1Sbe?si=abc'), { service: 'spotify', id: '37i9dQZF1DX4UtSsGT1Sbe', storefront: '' });
  assert.deepEqual(linkOf('https://open.spotify.com/intl-fr/playlist/37i9dQZF1DX4UtSsGT1Sbe'), { service: 'spotify', id: '37i9dQZF1DX4UtSsGT1Sbe', storefront: '' });
  assert.deepEqual(linkOf('spotify:playlist:37i9dQZF1DX4UtSsGT1Sbe'), { service: 'spotify', id: '37i9dQZF1DX4UtSsGT1Sbe', storefront: '' });
  assert.deepEqual(linkOf('https://music.apple.com/ca/playlist/todays-hits/pl.f4d106fed2bd41149aaacabb233eb5eb'), { service: 'apple', id: 'pl.f4d106fed2bd41149aaacabb233eb5eb', storefront: 'ca' });
  assert.deepEqual(linkOf('music.youtube.com/playlist?list=RDCLAK5uy_kmPRjHDECIcuVwnKsx2Ng7fyNgFKWNJFs'), { service: 'youtube', id: 'RDCLAK5uy_kmPRjHDECIcuVwnKsx2Ng7fyNgFKWNJFs', storefront: '' });
  assert.deepEqual(linkOf('https://www.youtube.com/watch?v=abc&list=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI'), { service: 'youtube', id: 'PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI', storefront: '' });
  assert.equal(linkOf('https://open.spotify.com/track/3h5T5JypYU7huFiVYhv1dr'), null);
  assert.equal(linkOf('hello'), null);
});

const track = (title, artist, duration) => ({ key: 'dz:1', title, artists: [{ key: 'dz:2', name: artist }], album: null, duration, isrc: null, explicit: false, rank: 0 });
const want = (title, artist, seconds, video = false) => ({ title, artists: [artist], album: null, seconds, isrc: null, video });

test('a remaster is the same song, a live take is not', () => {
  assert.ok(likeness(want('In the Air Tonight - 2015 Remaster', 'Phil Collins', 336), track('In the Air Tonight (2015 Remaster)', 'Phil Collins', 335)) > 0);
  assert.equal(likeness(want('Fast Car', 'Tracy Chapman', 297), track('Fast Car (Live)', 'Tracy Chapman', 301)), 0);
  assert.equal(likeness(want('Fast Car', 'Tracy Chapman', 297), track('Fast Car', 'Luke Combs', 265)), 0);
});

test('a music video can run minutes past its song, never short of it', () => {
  assert.ok(likeness(want('FN8', 'Arcangel', 400, true), track('FN8', 'Arcangel', 210)) > 0);
  assert.equal(likeness(want('FN8', 'Arcangel', 150, true), track('FN8', 'Arcangel', 210)), 0);
  assert.equal(likeness(want('Fast Car', 'Tracy Chapman', 400), track('Fast Car', 'Tracy Chapman', 297)), 0);
});

test('connecting: Apple developer token verifies, sign-in links carry PKCE, a forged return is refused', async () => {
  const { generateKeyPairSync, verify } = await import('node:crypto');
  const { developerToken, signInUrl, finishSignIn } = await import('../src/lib/music/connect.ts');
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  /* Pasted into a one-line field: no line breaks left. */
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString().replace(/\n/g, ' ');
  const config = { spotify: { id: 'sp-id', secret: 'sp-secret' }, google: { id: 'g-id', secret: 'g-secret' }, apple: { team: 'TEAM123456', keyId: 'KEY1234567', key: pem } };
  const [head, body, sig] = developerToken(config).split('.');
  assert.deepEqual(JSON.parse(Buffer.from(head, 'base64url')), { alg: 'ES256', kid: 'KEY1234567' });
  assert.equal(JSON.parse(Buffer.from(body, 'base64url')).iss, 'TEAM123456');
  assert.ok(verify('sha256', Buffer.from(`${head}.${body}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url')));

  const sp = new URL(signInUrl(config, 'Someone', 'spotify'));
  assert.equal(sp.host, 'accounts.spotify.com');
  assert.equal(sp.searchParams.get('code_challenge_method'), 'S256');
  assert.match(sp.searchParams.get('redirect_uri'), /\/api\/v1\/music\/connect\/spotify\/callback$/);
  assert.match(sp.searchParams.get('scope'), /playlist-read-private/);
  const yt = new URL(signInUrl(config, 'someone', 'youtube'));
  assert.equal(yt.searchParams.get('access_type'), 'offline');
  assert.match(yt.searchParams.get('scope'), /youtube\.readonly/);

  await assert.rejects(finishSignIn(config, 'spotify', 'made-up', 'code', 'someone'), /ran out/);
  /* Someone else can't finish your sign-in. */
  await assert.rejects(finishSignIn(config, 'spotify', sp.searchParams.get('state'), 'code', 'mallory'), /ran out/);
});
