package app.kimono.prayer

import androidx.compose.ui.graphics.Color

/*
 * The looks Times can wear, on its screen and on each widget: Kimono's own,
 * the phone's (Material You, so a Nothing or Pixel theme carries over), its
 * accent, or a preset. A preset has a day and a night tone; the screen and the
 * widgets follow the phone's light or dark between them.
 */

/** One side of a look: the paper, the ink on it, and the accent with the plate it stamps countdowns on. */
class LookTone(val ground: Color, val ink: Color, val muted: Color, val accent: Color, val chip: Color, val onChip: Color)

class Look(
    val id: String,
    val label: String,
    /** Fixed colours; null for the looks that come from Kimono or the phone. */
    val day: LookTone? = null,
    val night: LookTone? = day,
    /** Shows the open prayer with a dot of accent instead of a tinted row, in monospace numerals. */
    val dotted: Boolean = false,
)

object Looks {
    const val SKY = "sky"
    const val KIMONO = "kimono"
    const val PHONE = "system"
    const val TONAL = "tonal"
    const val CLEAR = "clear"

    private fun tone(ground: Long, ink: Long, muted: Long, accent: Long, chip: Long, onChip: Long) =
        LookTone(Color(ground), Color(ink), Color(muted), Color(accent), Color(chip), Color(onChip))

    /* Where the phone has no Material You: Material's neutrals with Times' teal. */
    val plainDay = tone(0xFFFDFBFA, 0xFF1B1B1D, 0xFF47464B, 0xFF2F5D62, 0xFFD9E7E8, 0xFF1C3D40)
    val plainNight = tone(0xFF1B1B1D, 0xFFE6E1E5, 0xFFC9C5CA, 0xFF9CC9CD, 0xFF2E4A4D, 0xFFD3ECEE)

    val presets = listOf(
        /* Nothing: pure white or black, and one red. */
        Look("nothing", "Nothing", tone(0xFFFFFFFF, 0xFF000000, 0xFF5C5C5C, 0xFFD71921, 0xFFF0F0F0, 0xFF000000), tone(0xFF000000, 0xFFFFFFFF, 0xFFA6A6A6, 0xFFD71921, 0xFF1F1F1F, 0xFFFFFFFF), dotted = true),
        /* Mono: dark grey, white ink, and white for the accent too. */
        Look("mono", "Mono", tone(0xFF1E1E20, 0xFFFFFFFF, 0xFFA8A8AC, 0xFFFFFFFF, 0xFF2E2E31, 0xFFFFFFFF)),
        Look("paper", "Paper", tone(0xFFFBF5EA, 0xFF2E2620, 0xFF6F6257, 0xFF9A4B32, 0xFFF0DCCB, 0xFF4A2214)),
        Look("sumi", "Sumi", tone(0xFF1C1A18, 0xFFEDE6DA, 0xFFB3AA9C, 0xFFE0B26A, 0xFF3A3328, 0xFFF6E7C8)),
        Look("midnight", "Midnight", tone(0xFF0E1726, 0xFFE4EAF4, 0xFF9AA8BE, 0xFF8FB4FF, 0xFF1F3152, 0xFFDCE6FF)),
        Look("dune", "Dune", tone(0xFFF4E7CF, 0xFF3B2A17, 0xFF7A6448, 0xFFB5652B, 0xFFE8CFA7, 0xFF4B2A10), tone(0xFF2A2117, 0xFFF1E3CA, 0xFFC2AE90, 0xFFE59A5C, 0xFF4A3622, 0xFFF8E2C6)),
        Look("olive", "Olive", tone(0xFFF2F2E6, 0xFF26291C, 0xFF5E634C, 0xFF5B6B3F, 0xFFDDE3C6, 0xFF263012), tone(0xFF1C1F16, 0xFFE6E8D8, 0xFFB4B99E, 0xFFB5C78E, 0xFF364026, 0xFFE4EECB)),
        Look("sakura", "Sakura", tone(0xFFFCF1F2, 0xFF33222A, 0xFF7A5E68, 0xFFB8506B, 0xFFF4D6DE, 0xFF4E1A2B), tone(0xFF261A1F, 0xFFF4E3E8, 0xFFC5A7B1, 0xFFF0A3B8, 0xFF4A2B36, 0xFFFBE0E8)),
        Look("ocean", "Ocean", tone(0xFFEEF5F7, 0xFF16272D, 0xFF4E6870, 0xFF1F6F86, 0xFFCDE5EC, 0xFF0D3542), tone(0xFF0F1D22, 0xFFDDEDF2, 0xFF97B4BD, 0xFF7CC7DD, 0xFF1C3A44, 0xFFD3F0F8)),
        Look("forest", "Forest", tone(0xFFEFF4EE, 0xFF1A2A1E, 0xFF4F6553, 0xFF2E6B45, 0xFFCFE4D3, 0xFF0F3A1F), tone(0xFF111B14, 0xFFDDEBE0, 0xFF9BB4A1, 0xFF85C99B, 0xFF203A28, 0xFFD5F2DE)),
        Look("lavender", "Lavender", tone(0xFFF4F1FA, 0xFF261F33, 0xFF645A78, 0xFF6A55A6, 0xFFE2DBF4, 0xFF2C1F55), tone(0xFF1A1724, 0xFFE9E3F5, 0xFFADA4C2, 0xFFBBA8F0, 0xFF332A4D, 0xFFEDE5FF)),
        Look("light", "Light", plainDay, plainDay),
        Look("dark", "Dark", plainNight, plainNight),
    )

    /** What the Times screen offers. */
    val screen = listOf(Look(KIMONO, "Kimono"), Look(PHONE, "Follow phone"), Look(TONAL, "Phone accent")) + presets

    /** What a widget offers: the sky at this hour first, then the phone's own, and Clear over the wallpaper. */
    val widget = listOf(Look(SKY, "Sky"), Look(PHONE, "Follow phone"), Look(TONAL, "Phone accent"), Look(KIMONO, "Kimono")) + presets + Look(CLEAR, "Clear")

    fun of(id: String?): Look? = (screen + widget).firstOrNull { it.id == id }
}
