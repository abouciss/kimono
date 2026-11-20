import type { AppIdentity } from "@kimono/ui";
import { accentOf } from "../apps";
import { getAppDefinition } from "../definitions";
import type { PlatformSettings } from "../settings";

export const prayerAppId = "kimono-prayer";

/** Times as the Applications admin sets it up. */
export function prayerConfig(settings: PlatformSettings) {
  const instance = settings.apps[prayerAppId];
  return {
    enabled: Boolean(instance?.enabled),
    colors: instance?.colors,
  };
}
export type PrayerConfig = ReturnType<typeof prayerConfig>;

export async function prayerIdentity(settings: PlatformSettings): Promise<AppIdentity> {
  const definition = await getAppDefinition(prayerAppId);
  const colors = settings.apps[prayerAppId]?.colors || definition?.metadata.colors;
  return { id: prayerAppId, name: "Times", accent: colors ? accentOf(colors) : "#2f5d62", glyph: "crescent" };
}
