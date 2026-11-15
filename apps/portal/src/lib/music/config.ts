import type { AppIdentity } from "@kimono/ui";
import { accentOf } from "../apps";
import { getAppDefinition } from "../definitions";
import type { PlatformSettings } from "../settings";

export const musicAppId = "kimono-music";

/** Music as the Applications admin sets it up. Deezer and LRCLIB need no keys; Last.fm's makes similar tracks and tags better. */
export function musicConfig(settings: PlatformSettings) {
  const instance = settings.apps[musicAppId];
  const value = (key: string) => instance?.environment[key]?.value?.trim() || "";
  return {
    enabled: Boolean(instance?.enabled),
    lastfmKey: value("lastfm_key") || process.env.LASTFM_API_KEY?.trim() || "",
    /* yt-dlp beside the Portal (infra/compose/server/music-fetcher), for when YouTube.js can't get a song. */
    fetcher: {
      url: (process.env.KIMONO_MUSIC_FETCHER_URL || "http://music-fetcher:8080").replace(/\/+$/, ""),
      key: process.env.KIMONO_MUSIC_FETCHER_KEY?.trim() || "",
    },
    colors: instance?.colors,
  };
}
export type MusicConfig = ReturnType<typeof musicConfig>;

export async function musicIdentity(settings: PlatformSettings): Promise<AppIdentity> {
  const definition = await getAppDefinition(musicAppId);
  const colors = settings.apps[musicAppId]?.colors || definition?.metadata.colors;
  return { id: musicAppId, name: "Music", accent: colors ? accentOf(colors) : "#8f6f14", glyph: "music" };
}
