import { ProfileView } from "../../account/friends/friends-ui";
import "../../account/friends/friends.css";
import "../../account/friends/widgets.css";

export const metadata = { title: "Profile" };

/** Someone's profile at a short address: anyone with it sees a public profile, signed in or not. */
export default async function PublicProfilePage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  return <div className="fr-public"><ProfileView username={decodeURIComponent(username)} standalone /></div>;
}
