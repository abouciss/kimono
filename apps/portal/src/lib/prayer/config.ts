import type { AppIdentity } from "@kimono/ui";
import { accentOf } from "../apps";
import { getAppDefinition } from "../definitions";
import type { PlatformSettings } from "../settings";

export const prayerAppId = "kimono-prayer";

/** Prayer as the Applications admin sets it up: the Mawaqit account it signs in with. */
export function prayerConfig(settings: PlatformSettings) {
  const instance = settings.apps[prayerAppId];
  const value = (key: string) => instance?.environment[key]?.value?.trim() || "";
  const email = value("mawaqit_email");
  const password = instance?.environment.mawaqit_password?.value || "";
  return {
    enabled: Boolean(instance?.enabled),
    mawaqit: email && password ? { email, password } : null,
    colors: instance?.colors,
  };
}
export type PrayerConfig = ReturnType<typeof prayerConfig>;

export async function prayerIdentity(settings: PlatformSettings): Promise<AppIdentity> {
  const definition = await getAppDefinition(prayerAppId);
  const colors = settings.apps[prayerAppId]?.colors || definition?.metadata.colors;
  return { id: prayerAppId, name: "Prayer", accent: colors ? accentOf(colors) : "#2f5d62", glyph: "crescent" };
}
