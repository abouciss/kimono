package app.kimono.android

import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.floatPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.glance.ColorFilter
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.Image
import androidx.glance.ImageProvider
import androidx.glance.LocalContext
import androidx.glance.LocalSize
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.color.ColorProvider
import androidx.glance.currentState
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.ColumnScope
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.size
import androidx.glance.layout.width
import androidx.glance.state.GlanceStateDefinition
import androidx.glance.state.PreferencesGlanceStateDefinition
import androidx.glance.text.FontFamily
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextAlign
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import app.kimono.prayer.NightPhase
import app.kimono.prayer.Prayer
import app.kimono.prayer.PrayerDay
import app.kimono.prayer.PrayerMine
import app.kimono.prayer.PrayerPlace
import app.kimono.prayer.Presentation
import app.kimono.prayer.ScheduleBuilder
import app.kimono.prayer.ScheduleView
import app.kimono.prayer.Timetable
import app.kimono.prayer.TitleMode
import kotlinx.datetime.DatePeriod
import kotlinx.datetime.TimeZone
import kotlinx.datetime.minus
import kotlinx.datetime.plus
import kotlinx.datetime.toLocalDateTime
import kotlin.time.Clock

/* ── How each widget is set (its configuration screen writes these into its own state) ── */

object WidgetKeys {
    val mode = stringPreferencesKey("mode")
    val iqama = booleanPreferencesKey("iqama")
    val night = booleanPreferencesKey("night")
    val theme = stringPreferencesKey("theme")
    val accent = stringPreferencesKey("accent")
    val opacity = floatPreferencesKey("opacity")
    val text = stringPreferencesKey("text")
}

/** A widget's settings: what it counts, what it shows, and how it looks. */
data class WidgetOptions(
    val mode: TitleMode = TitleMode.NextPrayer,
    val iqama: Boolean = true,
    val night: Boolean = true,
    /** "system" (the phone's own Material You colours), "tonal", "nothing", "light", "dark" or "clear". */
    val theme: String = "system",
    /** "system" (the phone's accent) or "prayer" (Prayer's teal). Nothing keeps its red. */
    val accent: String = "system",
    val opacity: Float = 1f,
    /** "s", "m" or "l". */
    val text: String = "m",
) {
    val scale get() = when (text) { "s" -> .86f; "l" -> 1.18f; else -> 1f }

    companion object {
        fun of(prefs: Preferences) = WidgetOptions(
            mode = if (prefs[WidgetKeys.mode] == "left") TitleMode.TimeLeft else TitleMode.NextPrayer,
            iqama = prefs[WidgetKeys.iqama] ?: true,
            night = prefs[WidgetKeys.night] ?: true,
            theme = prefs[WidgetKeys.theme]?.takeIf { it in setOf("tonal", "nothing", "light", "dark", "clear") } ?: "system",
            accent = if (prefs[WidgetKeys.accent] == "prayer") "prayer" else "system",
            opacity = prefs[WidgetKeys.opacity] ?: 1f,
            text = prefs[WidgetKeys.text] ?: "m",
        )
    }
}

/* ── Colours: the phone's own (Material You, so a Nothing or Pixel theme carries over), or a preset ── */

class WidgetColours(
    val ground: ColorProvider?,
    val ink: ColorProvider,
    val muted: ColorProvider,
    val faint: ColorProvider,
    val accent: ColorProvider,
    val tint: ColorProvider,
    val chip: ColorProvider,
    val onChip: ColorProvider,
    /** The face for names and numerals: the system's own, or monospace for Nothing's dot-matrix feel. */
    val face: FontFamily? = null,
    /** The open prayer is marked with an accent dot rather than a tinted row (Nothing). */
    val dot: Boolean = false,
)

private class Tone(val ground: Color, val ink: Color, val muted: Color, val accent: Color, val chip: Color, val onChip: Color)

/* Where the phone has no Material You (before Android 12): Material's baseline neutrals with Prayer's teal. */
private val plainDay = Tone(Color(0xFFFDFBFA), Color(0xFF1B1B1D), Color(0xFF47464B), Color(0xFF2F5D62), Color(0xFFD9E7E8), Color(0xFF1C3D40))
private val plainNight = Tone(Color(0xFF1B1B1D), Color(0xFFE6E1E5), Color(0xFFC9C5CA), Color(0xFF9CC9CD), Color(0xFF2E4A4D), Color(0xFFD3ECEE))
private val prayerDay = plainDay
private val prayerNight = plainNight
/* Nothing: pure white or black, and one red. */
private val nothingRed = Color(0xFFD71921)
private val nothingDay = Tone(Color.White, Color.Black, Color(0xFF5C5C5C), nothingRed, Color(0xFFF0F0F0), Color.Black)
private val nothingNight = Tone(Color.Black, Color.White, Color(0xFFA6A6A6), nothingRed, Color(0xFF1F1F1F), Color.White)

private fun system(context: Context, id: Int) = Color(context.getColor(id))

/** The phone's own Material You tones (Android 12 and later): its surface, or (tonal) its accent container. */
private fun youTones(context: Context, tonal: Boolean): Pair<Tone, Tone>? {
    if (Build.VERSION.SDK_INT < 31) return null
    val r = android.R.color::class.java
    fun c(name: String) = system(context, r.getField(name).getInt(null))
    return if (tonal) Tone(c("system_accent1_100"), c("system_accent1_900"), c("system_accent2_700"), c("system_accent1_600"), c("system_accent1_200"), c("system_accent1_900")) to
        Tone(c("system_accent2_800"), c("system_accent1_50"), c("system_accent2_200"), c("system_accent1_200"), c("system_accent1_700"), c("system_accent1_50"))
    else Tone(c("system_neutral1_10"), c("system_neutral1_900"), c("system_neutral2_700"), c("system_accent1_600"), c("system_accent2_100"), c("system_accent2_900")) to
        Tone(c("system_neutral1_900"), c("system_neutral1_50"), c("system_neutral2_200"), c("system_accent1_200"), c("system_accent2_700"), c("system_accent2_100"))
}

@Suppress("UNUSED_PARAMETER")
fun widgetColours(context: Context, options: WidgetOptions, appearance: String): WidgetColours {
    val you = youTones(context, tonal = false)
    val nothing = options.theme == "nothing"
    var (day, night) = when (options.theme) {
        "nothing" -> nothingDay to nothingNight
        "tonal" -> youTones(context, tonal = true) ?: (plainDay to plainNight)
        else -> you ?: (plainDay to plainNight)
    }
    when (options.theme) {
        "light" -> night = day
        "dark" -> day = night
    }
    val (accentDay, accentNight) = when {
        nothing -> day to night
        options.accent == "prayer" -> prayerDay to prayerNight
        options.theme == "tonal" -> day to night
        else -> you ?: (prayerDay to prayerNight)
    }
    /* Clear sits on the wallpaper: ink follows the phone's light or dark. */
    fun pair(d: Color, n: Color) = ColorProvider(d, n)
    val alpha = options.opacity.coerceIn(0f, 1f)
    return WidgetColours(
        ground = if (options.theme == "clear") null else pair(day.ground.copy(alpha = alpha), night.ground.copy(alpha = alpha)),
        ink = pair(day.ink, night.ink),
        muted = pair(day.muted, night.muted),
        faint = pair(day.muted.copy(alpha = .55f), night.muted.copy(alpha = .55f)),
        accent = pair(accentDay.accent, accentNight.accent),
        tint = if (nothing) pair(Color.Transparent, Color.Transparent) else pair(accentDay.accent.copy(alpha = .12f), accentNight.accent.copy(alpha = .24f)),
        chip = pair(accentDay.chip, accentNight.chip),
        onChip = pair(accentDay.onChip, accentNight.onChip),
        face = if (nothing) FontFamily.Monospace else null,
        dot = nothing,
    )
}

/* ── The three widgets ── */

/** What a widget needs to draw, whether placed or shown as a preview. */
class WidgetScene(val mine: PrayerMine?, val view: ScheduleView?, val options: WidgetOptions, val colours: WidgetColours, val h24: Boolean)

abstract class PrayerWidget : GlanceAppWidget() {
    override val stateDefinition: GlanceStateDefinition<*> = PreferencesGlanceStateDefinition

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        PrayerWidgets.read(context)
        provideContent {
            val mine by PrayerWidgets.mine.collectAsState()
            val now by PrayerWidgets.now.collectAsState()
            val appearance by PrayerWidgets.appearance.collectAsState()
            val options = WidgetOptions.of(currentState<Preferences>())
            val ctx = LocalContext.current
            val view = mine?.timetable?.let { ScheduleBuilder.build(it, now) }
            Draw(WidgetScene(mine, view, options, widgetColours(ctx, options, appearance), android.text.format.DateFormat.is24HourFormat(ctx)))
        }
    }

    override suspend fun providePreview(context: Context, widgetCategory: Int) {
        val sample = sampleMine()
        provideContent {
            val options = WidgetOptions()
            Draw(WidgetScene(sample, sample.timetable?.let { ScheduleBuilder.build(it, Clock.System.now()) }, options, widgetColours(context, options, "system"), android.text.format.DateFormat.is24HourFormat(context)))
        }
    }

    @Composable abstract fun Draw(scene: WidgetScene)
}

/** Small: the countdown, written large, with the open prayer beneath it. */
class NextPrayerWidget : PrayerWidget() {
    override val sizeMode = SizeMode.Responsive(setOf(DpSize(110.dp, 48.dp), DpSize(110.dp, 110.dp), DpSize(200.dp, 110.dp)))

    @Composable override fun Draw(scene: WidgetScene) {
        val size = LocalSize.current
        Frame(scene) {
            val view = scene.view ?: return@Frame Empty(scene)
            val c = scene.colours
            val s = scene.options.scale
            val (what, howLong) = Presentation.titleParts(view, scene.options.mode)
            if (size.height < 90.dp) {
                Row(verticalAlignment = Alignment.CenterVertically, modifier = GlanceModifier.fillMaxSize()) {
                    Mark(c, 18)
                    Spacer(GlanceModifier.width(8.dp))
                    Column {
                        Text(what, maxLines = 1, style = TextStyle(color = c.ink, fontSize = (17 * s).sp, fontWeight = FontWeight.Bold, fontFamily = c.face))
                        Text(howLong, maxLines = 1, style = TextStyle(color = c.accent, fontSize = (13 * s).sp, fontWeight = FontWeight.Medium))
                    }
                }
                return@Frame
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Mark(c, 16)
                Spacer(GlanceModifier.width(6.dp))
                Text(scene.mine?.place?.name ?: "", maxLines = 1, style = TextStyle(color = c.muted, fontSize = (11 * s).sp))
            }
            Spacer(GlanceModifier.defaultWeight())
            Text(what, maxLines = 1, style = TextStyle(color = c.ink, fontSize = (30 * s).sp, fontWeight = FontWeight.Bold, fontFamily = c.face))
            Text(howLong, maxLines = 1, style = TextStyle(color = if (c.dot) c.muted else c.accent, fontSize = (16 * s).sp, fontWeight = FontWeight.Medium, fontFamily = c.face))
            Spacer(GlanceModifier.height(8.dp))
            val current = view.current
            val next = view.next
            if (current != null) {
                Row(GlanceModifier.fillMaxWidth().background(c.tint).cornerRadius(10.dp).padding(horizontal = 8.dp, vertical = 5.dp), verticalAlignment = Alignment.CenterVertically) {
                    if (c.dot) Text("● ", maxLines = 1, style = TextStyle(color = c.accent, fontSize = (12 * s).sp))
                    Text(current.name, maxLines = 1, style = TextStyle(color = if (c.dot) c.ink else c.accent, fontSize = (12 * s).sp, fontWeight = FontWeight.Bold))
                    Spacer(GlanceModifier.defaultWeight())
                    Text(current.end?.let { "until ${Presentation.clock(ScheduleBuilder.time(it, view.timezone), scene.h24)}" } ?: "", maxLines = 1, style = TextStyle(color = c.muted, fontSize = (12 * s).sp))
                }
            } else if (next != null) {
                Text("${next.name} at ${Presentation.clock(next.time, scene.h24)}", maxLines = 1, style = TextStyle(color = c.muted, fontSize = (12 * s).sp))
            }
        }
    }
}

/** Medium and large: today's five, the open one tinted, the next with its countdown, the past ones faded. */
class TodayPrayerWidget : PrayerWidget() {
    override val sizeMode = SizeMode.Responsive(setOf(DpSize(180.dp, 110.dp), DpSize(250.dp, 180.dp), DpSize(250.dp, 270.dp), DpSize(320.dp, 300.dp)))

    @Composable override fun Draw(scene: WidgetScene) {
        val size = LocalSize.current
        Frame(scene) {
            val view = scene.view ?: return@Frame Empty(scene)
            val c = scene.colours
            val s = scene.options.scale
            val tight = size.height < 150.dp
            val wide = size.width >= 230.dp
            val (what, howLong) = Presentation.titleParts(view, scene.options.mode)
            Row(GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Mark(c, if (tight) 14 else 18)
                Spacer(GlanceModifier.width(6.dp))
                Text(what, maxLines = 1, style = TextStyle(color = c.ink, fontSize = ((if (tight) 14 else 19) * s).sp, fontWeight = FontWeight.Bold, fontFamily = c.face))
                Spacer(GlanceModifier.width(6.dp))
                Text(howLong, maxLines = 1, style = TextStyle(color = c.accent, fontSize = ((if (tight) 12 else 14) * s).sp, fontWeight = FontWeight.Medium))
                Spacer(GlanceModifier.defaultWeight())
                if (wide && !tight) Text(scene.mine?.place?.name ?: "", maxLines = 1, style = TextStyle(color = c.faint, fontSize = (11 * s).sp, textAlign = TextAlign.End))
            }
            Spacer(GlanceModifier.height(if (tight) 2.dp else 8.dp))
            val iqama = scene.options.iqama && wide && view.today.any { it.iqama != null }
            /* Glance holds at most ten in a column: the five go in one of their own. */
            Column(GlanceModifier.fillMaxWidth()) { Presentation.displayPrayers(view).forEach { prayer -> PrayerLine(prayer, view, scene, tight, wide, iqama) } }
            if (view.jumua.isNotEmpty() && !tight) {
                Text("Jumu'a ${view.jumua.joinToString(" · ") { Presentation.clock(it, scene.h24) }}", maxLines = 1,
                    style = TextStyle(color = c.muted, fontSize = (11 * s).sp), modifier = GlanceModifier.padding(start = 8.dp, top = 2.dp))
            }
            if (scene.options.night && size.height >= 250.dp) {
                Spacer(GlanceModifier.height(8.dp))
                val m = view.milestones
                Column(GlanceModifier.fillMaxWidth()) { listOf(Triple("Islamic midnight", m.midnight, NightPhase.Midnight), Triple("Last third", m.lastThird, NightPhase.LastThird), Triple("Sunrise", m.sunrise, NightPhase.Sunrise)).forEach { (title, at, phase) ->
                    val on = m.phase == phase
                    val note = Presentation.milestoneDetail(phase, at, view)
                    Row(GlanceModifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(title, maxLines = 1, style = TextStyle(color = if (on) c.ink else c.muted, fontSize = (12 * s).sp, fontWeight = if (on) FontWeight.Bold else FontWeight.Normal))
                        Spacer(GlanceModifier.defaultWeight())
                        if (note != null) Text(note, maxLines = 1, style = TextStyle(color = if (on) c.accent else c.faint, fontSize = (11 * s).sp), modifier = GlanceModifier.padding(end = 8.dp))
                        Text(Presentation.clock(ScheduleBuilder.time(at, view.timezone), scene.h24), maxLines = 1, style = TextStyle(color = if (on) c.ink else c.muted, fontSize = (12 * s).sp, fontWeight = if (on) FontWeight.Bold else FontWeight.Normal))
                    }
                } }
            }
        }
    }

    @Composable private fun PrayerLine(prayer: Prayer, view: ScheduleView, scene: WidgetScene, tight: Boolean, wide: Boolean, iqama: Boolean) {
        val c = scene.colours
        val s = scene.options.scale
        val current = prayer.id == view.current?.id
        val next = prayer.id == view.next?.id
        val past = prayer.end?.let { it <= view.now } ?: false
        val ink = if (past) c.faint else c.ink
        val size = ((if (tight) 12 else 14) * s).sp
        var row = GlanceModifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = if (tight) 1.dp else 4.dp)
        if (current) row = GlanceModifier.fillMaxWidth().background(c.tint).cornerRadius(10.dp).padding(horizontal = 8.dp, vertical = if (tight) 1.dp else 4.dp)
        Row(row, verticalAlignment = Alignment.CenterVertically) {
            if (current && c.dot) Text("● ", maxLines = 1, style = TextStyle(color = c.accent, fontSize = size))
            Text(prayer.name, maxLines = 1, style = TextStyle(color = if (current && !c.dot) c.accent else ink, fontSize = size, fontWeight = if (current || next) FontWeight.Bold else FontWeight.Normal))
            if (current && wide && !tight) {
                Text("  ${Presentation.currentDetail(prayer, view, scene.h24, scene.options.iqama).let { if (it.startsWith("Ends at ")) "until ${it.removePrefix("Ends at ")}" else it }}", maxLines = 1, style = TextStyle(color = c.muted, fontSize = (11 * s).sp))
            }
            Spacer(GlanceModifier.defaultWeight())
            if (next) {
                Box(GlanceModifier.background(c.chip).cornerRadius(8.dp).padding(horizontal = 6.dp, vertical = 1.dp)) {
                    Text(Presentation.prayerDetail(prayer, view, scene.h24), maxLines = 1, style = TextStyle(color = c.onChip, fontSize = ((if (tight) 10 else 11) * s).sp, fontWeight = FontWeight.Bold))
                }
                Spacer(GlanceModifier.width(8.dp))
            }
            Text(Presentation.clock(prayer.time, scene.h24), maxLines = 1, style = TextStyle(color = if (current && !c.dot) c.accent else ink, fontSize = size, fontWeight = if (current || next) FontWeight.Bold else FontWeight.Medium, fontFamily = c.face))
            if (iqama) Text(prayer.iqama?.let { Presentation.clock(it, scene.h24) } ?: "", maxLines = 1,
                style = TextStyle(color = c.faint, fontSize = ((if (tight) 10 else 12) * s).sp, textAlign = TextAlign.End),
                modifier = GlanceModifier.width((if (scene.h24) 44 else 62).dp))
        }
    }
}

/** A single line for narrow spaces: the countdown, then (where there's room) the day's times with the open one inked. */
class StripPrayerWidget : PrayerWidget() {
    override val sizeMode = SizeMode.Responsive(setOf(DpSize(150.dp, 40.dp), DpSize(280.dp, 40.dp), DpSize(380.dp, 40.dp)))

    @Composable override fun Draw(scene: WidgetScene) {
        val size = LocalSize.current
        Frame(scene, vertical = 4) {
            val view = scene.view ?: return@Frame Empty(scene)
            val c = scene.colours
            val s = scene.options.scale
            Row(GlanceModifier.fillMaxSize(), verticalAlignment = Alignment.CenterVertically) {
                Mark(c, 16)
                Spacer(GlanceModifier.width(8.dp))
                Text(Presentation.panelTitle(view, scene.options.mode), maxLines = 1, style = TextStyle(color = c.ink, fontSize = (14 * s).sp, fontWeight = FontWeight.Bold))
                if (size.width >= 280.dp) {
                    Spacer(GlanceModifier.defaultWeight())
                    val all = Presentation.displayPrayers(view)
                    val shown = if (size.width >= 380.dp) all else all.filter { it.end?.let { end -> end > view.now } ?: true }.take(3)
                    shown.forEach { p ->
                        val current = p.id == view.current?.id
                        val past = p.end?.let { it <= view.now } ?: false
                        Text("${p.name.take(if (size.width >= 380.dp) 3 else 4)} ${Presentation.clock(p.time, scene.h24).removeSuffix(" AM").removeSuffix(" PM")}", maxLines = 1,
                            style = TextStyle(color = if (current) c.accent else if (past) c.faint else c.muted, fontSize = (12 * s).sp, fontWeight = if (current) FontWeight.Bold else FontWeight.Normal, fontFamily = c.face),
                            modifier = GlanceModifier.padding(start = 10.dp))
                    }
                }
            }
        }
    }
}

/* ── Shared pieces ── */

@Composable
private fun Frame(scene: WidgetScene, vertical: Int = 12, content: @Composable ColumnScope.() -> Unit) {
    val context = LocalContext.current
    val open = Intent(context, MainActivity::class.java).setAction("app.kimono.prayer.OPEN").putExtra(AppUpdates.ROUTE, "prayer")
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    var modifier = GlanceModifier.fillMaxSize()
    scene.colours.ground?.let { ground ->
        modifier = modifier.background(ground)
        modifier = if (Build.VERSION.SDK_INT >= 31) modifier.cornerRadius(android.R.dimen.system_app_widget_background_radius) else modifier.cornerRadius(20.dp)
    }
    Column(modifier.padding(horizontal = 12.dp, vertical = vertical.dp).clickable(actionStartActivity(open)), content = content)
}

@Composable
private fun Mark(c: WidgetColours, size: Int) {
    Image(ImageProvider(R.drawable.ic_crescent), null, colorFilter = ColorFilter.tint(c.accent), modifier = GlanceModifier.size(size.dp))
}

@Composable
private fun Empty(scene: WidgetScene) {
    val c = scene.colours
    Row(GlanceModifier.fillMaxSize(), verticalAlignment = Alignment.CenterVertically) {
        Mark(c, 18)
        Spacer(GlanceModifier.width(8.dp))
        Text(if (scene.mine?.place == null) "Choose your place in Times" else "Open Times to refresh", maxLines = 2,
            style = TextStyle(color = c.muted, fontSize = (13 * scene.options.scale).sp))
    }
}

/** For the widget picker: a mosque's ordinary day, around now. */
private fun sampleMine(): PrayerMine {
    val zone = TimeZone.currentSystemDefault()
    val today = Clock.System.now().toLocalDateTime(zone).date
    val times = listOf("05:52", "07:12", "12:01", "14:19", "16:28", "17:58")
    val days = (-1..2).map { d -> PrayerDay((if (d < 0) today.minus(DatePeriod(days = -d)) else today.plus(DatePeriod(days = d))).toString(), times, listOf("06:15", "12:30", "14:35", "16:33", "18:15")) }
    val place = PrayerPlace("sample", "mawaqit", "Your mosque")
    return PrayerMine(place, Timetable(place, zone.id, days))
}

