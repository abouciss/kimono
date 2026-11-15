export const metadata = { title: "Privacy" };

/** Kimono's privacy note: what it keeps, and what it does with an account you connect. Public, for anyone and for the services you sign in with. */
export default function PrivacyPage() {
  return <main className="privacy">
    <h1>Privacy</h1>
    <p>Kimono is a private service run for a small group of people. It keeps what you put in it (your files, notes, library and profile) on its own server, and never sells or shares it.</p>
    <h2>Accounts you connect</h2>
    <p>Music can bring in your playlists and liked songs from Spotify, YouTube or Apple Music. When you connect one, Kimono asks only to read them, keeps the sign-in it is given on its server, and uses it for nothing else. It never posts, changes or deletes anything there.</p>
    <p>Disconnect in Music at any time and Kimono forgets that sign-in. You can also remove Kimono from your Google, Spotify or Apple account settings.</p>
    <p>Kimono&rsquo;s use of information received from Google APIs follows the Google API Services User Data Policy, including its Limited Use requirements.</p>
    <h2>Questions</h2>
    <p>Ask whoever invited you to Kimono.</p>
    <style>{`.privacy { max-width: 640px; margin: 0 auto; padding: 56px 20px 80px; color: var(--k-on-surface); }
.privacy h1 { font: 600 40px/1.1 var(--k-display); margin: 0 0 24px; }
.privacy h2 { font: 600 22px/1.3 var(--k-display); margin: 32px 0 8px; }
.privacy p { font: 400 16px/1.6 var(--k-sans); color: var(--k-on-surface-variant); margin: 0 0 12px; }`}</style>
  </main>;
}
