import { accountContext } from "./account-frame";
import { PictureSheetRoute } from "./friends/picture-sheet";
import { ProfileView } from "./friends/friends-ui";
import "./friends/friends.css";
import "./friends/widgets.css";

export const metadata = { title: "You" };

/* You: your profile as friends see it, changed in place. The account's own things are on Settings, off its gear. */
export default async function YouPage({ searchParams }: { searchParams: Promise<{ saved?: string; sheet?: string }> }) {
  const { account } = await accountContext();
  const query = await searchParams;

  return <>
    {query.saved ? <p className="admin-notice success" role="status">Saved.</p> : null}
    <ProfileView username={account.username} home />
    {query.sheet === "picture" ? <PictureSheetRoute name={account.name} username={account.username} picture={account.picture} /> : null}
  </>;
}
