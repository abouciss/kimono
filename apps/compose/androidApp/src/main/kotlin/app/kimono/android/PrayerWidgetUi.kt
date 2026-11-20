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
    /** A look from [app.kimono.prayer.Looks.widget]: "system" (the phone's own Material You colours), "tonal", "kimono", a preset, or "clear". */
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
            theme = prefs[WidgetKeys.theme]?.takeIf { id -> app.kimono.prayer.Looks.widget.any { it.id == id } } ?: "system",
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
    /** The accent and the ink as plain colours, by day and by night, for what's painted rather than laid out (the sky). */
    val paint: (night: Boolean) -> Pair<Color, Color> = { Color(0xFF2F5D62) to Color.Black },
) {
    /** The face for the countdown: Times' Mincho isn't on the phone, so the system's serif stands in; Nothing keeps its monospace. */
    val display: FontFamily get() = face ?: FontFamily.Serif
}

private typealias Tone = app.kimono.prayer.LookTone

private val plainDay = app.kimono.prayer.Looks.plainDay
private val plainNight = app.kimono.prayer.Looks.plainNight
private val prayerDay = plainDay
private val prayerNight = plainNight
/* Kimono's own: its paper and plum ink, with Times' teal. */
private val kimonoDay = Tone(Color(0xFFFFF8F4), Color(0xFF4E2B37), Color(0xFF7A5E68), Color(0xFF2F5D62), Color(0xFFDCE7E5), Color(0xFF1C3D40))
private val kimonoNight = Tone(Color(0xFF231A1D), Color(0xFFF2E1CA), Color(0xFFBFA9A4), Color(0xFF9CC9CD), Color(0xFF2E4A4D), Color(0xFFD3ECEE))

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
    val look = app.kimono.prayer.Looks.of(options.theme)
    val nothing = look?.dotted == true
    val preset = look?.day
    val (day, night) = when {
        preset != null -> preset to (look.night ?: preset)
        options.theme == "kimono" -> kimonoDay to kimonoNight
        options.theme == "tonal" -> youTones(context, tonal = true) ?: (plainDay to plainNight)
        else -> you ?: (plainDay to plainNight)
    }
    /* The phone's own looks take the accent asked for; a preset and Kimono bring their own. */
    val own = options.theme == "system" || options.theme == "clear"
    val (accentDay, accentNight) = when {
        !own -> day to night
        options.accent == "prayer" -> prayerDay to prayerNight
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
        paint = { dark -> if (dark) accentNight.accent to night.ink else accentDay.accent to day.ink },
    )
}

/* ── The sky, painted ── */

/** Whether the widget draws by night, as Kimono's own light or dark says. */
private fun nightFor(context: Context, appearance: String): Boolean = when (appearance) {
    "dark" -> true
    "light" -> false
    else -> (context.resources.configuration.uiMode and android.content.res.Configuration.UI_MODE_NIGHT_MASK) == android.content.res.Configuration.UI_MODE_NIGHT_YES
}

/**
 * The day's arc, as the Times screen paints it but small: dotted from sunrise
 * to Maghrib (or Maghrib to sunrise by night), inked in brush as far as now,
 * the sun or a crescent where we are, over a soft horizon. A widget can't draw
 * shapes of its own, so this is a picture, made again each minute.
 */
private fun skyBitmap(view: ScheduleView, accent: Color, ink: Color, w: Int, h: Int): android.graphics.Bitmap {
    val bitmap = android.graphics.Bitmap.createBitmap(w, h, android.graphics.Bitmap.Config.ARGB_8888)
    val canvas = android.graphics.Canvas(bitmap)
    val sunrise = view.today[1].start
    val maghrib = view.today[4].start
    val daytime = view.now >= sunrise && view.now < maghrib
    val (from, to) = if (daytime) sunrise to maghrib else view.milestones.maghrib to view.milestones.sunrise
    val f = ((view.now - from) / (to - from)).toFloat().coerceIn(0f, 1f)
    val pad = h * .14f
    val base = h * .86f
    val lift = base - h * .16f
    fun at(x: Float) = android.graphics.PointF(pad + x * (w - 2 * pad), base - kotlin.math.sin(x * Math.PI).toFloat() * lift)
    fun argb(c: Color, a: Float = c.alpha) = android.graphics.Color.argb((a * 255).toInt(), (c.red * 255).toInt(), (c.green * 255).toInt(), (c.blue * 255).toInt())
    val paint = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply { strokeCap = android.graphics.Paint.Cap.ROUND; style = android.graphics.Paint.Style.STROKE }
    /* The horizon. */
    paint.color = argb(ink, .22f); paint.strokeWidth = h * .018f
    canvas.drawLine(0f, base, w.toFloat(), base, paint)
    /* The whole way, dotted. */
    paint.color = argb(ink, .3f); paint.strokeWidth = h * .022f
    paint.pathEffect = android.graphics.DashPathEffect(floatArrayOf(1f, h * .07f), 0f)
    val whole = android.graphics.Path().apply { (0..80).forEach { i -> val p = at(i / 80f); if (i == 0) moveTo(p.x, p.y) else lineTo(p.x, p.y) } }
    canvas.drawPath(whole, paint)
    paint.pathEffect = null
    /* As far as the day has come, in brush: a stroke that swells and tapers. */
    val steps = kotlin.math.max(2, (f * 80).toInt())
    val warm = if (daytime) Color(0xFFE3A13A) else Color(0xFFF1E3B9)
    for (i in 1..steps) {
        val a = at(f * (i - 1) / steps); val b = at(f * i / steps)
        val t = i / steps.toFloat()
        paint.color = argb(warm, .95f)
        paint.strokeWidth = h * (.02f + .028f * kotlin.math.sin(t * Math.PI).toFloat())
        canvas.drawLine(a.x, a.y, b.x, b.y, paint)
    }
    /* The sun, or a crescent by night. */
    val body = at(f)
    val r = h * .1f
    val fill = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG)
    if (daytime) {
        fill.color = argb(Color(0xFFEEB04A), .28f); canvas.drawCircle(body.x, body.y, r * 2.1f, fill)
        fill.color = argb(Color(0xFFEEB04A)); canvas.drawCircle(body.x, body.y, r, fill)
    } else {
        fill.color = argb(Color(0xFFF1E3B9), .14f); canvas.drawCircle(body.x, body.y, r * 2f, fill)
        val moon = android.graphics.Path().apply {
            addCircle(body.x, body.y, r, android.graphics.Path.Direction.CW)
            op(android.graphics.Path().apply { addCircle(body.x + r * .5f, body.y - r * .3f, r * .85f, android.graphics.Path.Direction.CW) }, android.graphics.Path.Op.DIFFERENCE)
        }
        fill.color = argb(Color(0xFFF1E3B9)); canvas.drawPath(moon, fill)
    }
    /* The open prayer's start, marked. */
    fill.color = argb(accent)
    listOf(view.today[2], view.today[3]).filter { daytime }.forEach { p ->
        val x = ((p.start - from) / (to - from)).toFloat().coerceIn(0f, 1f)
        val m = at(x)
        canvas.drawCircle(m.x, m.y, h * .035f, fill)
    }
    return bitmap
}

@Composable
private fun Sky(scene: WidgetScene, view: ScheduleView, modifier: GlanceModifier, w: Int = 420, h: Int = 150) {
    val context = LocalContext.current
    val appearance by PrayerWidgets.appearance.collectAsState()
    val (accent, ink) = scene.colours.paint(nightFor(context, appearance))
    Image(ImageProvider(skyBitmap(view, accent, ink, w, h)), contentDescription = null, modifier = modifier)
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


/** The countdown, as the screen says it: the prayer's name large, how long beneath it in the accent. */
@Composable
private fun Countdown(scene: WidgetScene, view: ScheduleView, big: Int, small: Int) {
    val c = scene.colours
    val s = scene.options.scale
    val (what, howLong) = Presentation.titleParts(view, scene.options.mode)
    Text(what, maxLines = 1, style = TextStyle(color = c.ink, fontSize = (big * s).sp, fontWeight = FontWeight.Bold, fontFamily = c.display))
    Text(howLong, maxLines = 1, style = TextStyle(color = if (c.dot) c.muted else c.accent, fontSize = (small * s).sp, fontWeight = FontWeight.Medium, fontFamily = c.face))
}

/** A quiet line: the place, and what else the day holds. */
@Composable
private fun Small(text: String, scene: WidgetScene, modifier: GlanceModifier = GlanceModifier) {
    Text(text, maxLines = 1, style = TextStyle(color = scene.colours.muted, fontSize = (11 * scene.options.scale).sp), modifier = modifier)
}

/** Small: the countdown over the day's sky, with the open prayer beneath it. */
class NextPrayerWidget : PrayerWidget() {
    override val sizeMode = SizeMode.Responsive(setOf(DpSize(110.dp, 48.dp), DpSize(110.dp, 110.dp), DpSize(200.dp, 110.dp)))

    @Composable override fun Draw(scene: WidgetScene) {
        val size = LocalSize.current
        Frame(scene) {
            val view = scene.view ?: return@Frame Empty(scene)
            if (size.height < 90.dp) {
                Column(GlanceModifier.fillMaxSize(), verticalAlignment = Alignment.CenterVertically) { Countdown(scene, view, 18, 13) }
                return@Frame
            }
            Small(scene.mine?.place?.name ?: "", scene)
            Spacer(GlanceModifier.defaultWeight())
            Countdown(scene, view, 28, 15)
            Spacer(GlanceModifier.height(6.dp))
            Sky(scene, view, GlanceModifier.fillMaxWidth().height(38.dp), 420, 110)
        }
    }
}

/** Medium and large: the countdown and the day's sky, then the five prayers side by side. */
class TodayPrayerWidget : PrayerWidget() {
    override val sizeMode = SizeMode.Responsive(setOf(DpSize(180.dp, 110.dp), DpSize(250.dp, 150.dp), DpSize(250.dp, 220.dp), DpSize(320.dp, 260.dp)))

    @Composable override fun Draw(scene: WidgetScene) {
        val size = LocalSize.current
        Frame(scene, vertical = 14) {
            val view = scene.view ?: return@Frame Empty(scene)
            val tight = size.height < 140.dp
            val tall = size.height >= 210.dp
            Row(GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.Bottom) {
                Column(GlanceModifier.defaultWeight()) {
                    if (!tight) Small(scene.mine?.place?.name ?: "", scene)
                    Countdown(scene, view, if (tight) 20 else 26, if (tight) 13 else 15)
                }
                if (size.width >= 230.dp) Sky(scene, view, GlanceModifier.width(if (tight) 96.dp else 120.dp).height(if (tight) 40.dp else 50.dp), 360, 150)
            }
            Spacer(GlanceModifier.height(if (tight) 6.dp else 12.dp))
            Strip(scene, view, iqama = scene.options.iqama && !tight && view.today.any { it.iqama != null })
            if (tall) {
                Spacer(GlanceModifier.height(10.dp))
                val m = view.milestones
                val clock = { at: kotlin.time.Instant -> Presentation.clock(ScheduleBuilder.time(at, view.timezone), scene.h24).removeSuffix(" AM").removeSuffix(" PM") }
                val bits = buildList {
                    if (view.jumua.isNotEmpty()) add("Jumu'a ${view.jumua.joinToString(" · ") { Presentation.clock(it, scene.h24).removeSuffix(" AM").removeSuffix(" PM") }}")
                    if (scene.options.night) { add("Midnight ${clock(m.midnight)}"); add("Last third ${clock(m.lastThird)}") }
                }
                if (bits.isNotEmpty()) Small(bits.joinToString("  ·  "), scene, GlanceModifier.fillMaxWidth().padding(horizontal = 4.dp))
            } else if (view.jumua.isNotEmpty() && !tight) {
                Spacer(GlanceModifier.height(6.dp))
                Small("Jumu'a ${view.jumua.joinToString(" · ") { Presentation.clock(it, scene.h24) }}", scene, GlanceModifier.padding(start = 4.dp))
            }
        }
    }

    /** The five side by side: name, adhan, iqama. The open one sits on a plate; the next is inked; the past ones fade. */
    @Composable private fun Strip(scene: WidgetScene, view: ScheduleView, iqama: Boolean) {
        val c = scene.colours
        val s = scene.options.scale
        Row(GlanceModifier.fillMaxWidth()) {
            Presentation.displayPrayers(view).forEach { prayer ->
                val current = prayer.id == view.current?.id
                val next = prayer.id == view.next?.id
                val past = prayer.end?.let { it <= view.now } ?: false
                val ink = when { current || next -> c.ink; past -> c.faint; else -> c.ink }
                var cell = GlanceModifier.defaultWeight().padding(vertical = 6.dp)
                if (current && !c.dot) cell = GlanceModifier.defaultWeight().background(c.tint).cornerRadius(12.dp).padding(vertical = 6.dp)
                Column(cell, horizontalAlignment = Alignment.CenterHorizontally) {
                    Text((if (current && c.dot) "● " else "") + prayer.name, maxLines = 1,
                        style = TextStyle(color = if (next || current) c.accent else if (past) c.faint else c.muted, fontSize = (11 * s).sp, fontWeight = if (next || current) FontWeight.Bold else FontWeight.Medium, textAlign = TextAlign.Center))
                    Text(Presentation.clock(prayer.time, scene.h24).removeSuffix(" AM").removeSuffix(" PM"), maxLines = 1,
                        style = TextStyle(color = ink, fontSize = (17 * s).sp, fontWeight = if (next || current) FontWeight.Bold else FontWeight.Medium, fontFamily = c.face, textAlign = TextAlign.Center))
                    if (iqama) Text(prayer.iqamaAfter?.let { "+$it" } ?: prayer.iqama?.let { Presentation.clock(it, scene.h24).removeSuffix(" AM").removeSuffix(" PM") } ?: " ", maxLines = 1,
                        style = TextStyle(color = c.faint, fontSize = (11 * s).sp, textAlign = TextAlign.Center))
                }
            }
        }
    }
}

/** A single line for narrow spaces: the countdown, then (where there's room) the rest of the day's times. */
class StripPrayerWidget : PrayerWidget() {
    override val sizeMode = SizeMode.Responsive(setOf(DpSize(150.dp, 40.dp), DpSize(280.dp, 40.dp), DpSize(380.dp, 40.dp)))

    @Composable override fun Draw(scene: WidgetScene) {
        val size = LocalSize.current
        Frame(scene, vertical = 4) {
            val view = scene.view ?: return@Frame Empty(scene)
            val c = scene.colours
            val s = scene.options.scale
            val (what, howLong) = Presentation.titleParts(view, scene.options.mode)
            Row(GlanceModifier.fillMaxSize(), verticalAlignment = Alignment.CenterVertically) {
                Text(what, maxLines = 1, style = TextStyle(color = c.ink, fontSize = (16 * s).sp, fontWeight = FontWeight.Bold, fontFamily = c.display))
                Spacer(GlanceModifier.width(8.dp))
                Text(howLong, maxLines = 1, style = TextStyle(color = if (c.dot) c.muted else c.accent, fontSize = (13 * s).sp, fontWeight = FontWeight.Medium))
                if (size.width >= 280.dp) {
                    Spacer(GlanceModifier.defaultWeight())
                    val ahead = Presentation.displayPrayers(view).filter { (it.end?.let { end -> end > view.now } ?: true) && it.id != view.next?.id }
                    ahead.take(if (size.width >= 380.dp) 3 else 2).forEach { p ->
                        Text("${p.name} ${Presentation.clock(p.time, scene.h24).removeSuffix(" AM").removeSuffix(" PM")}", maxLines = 1,
                            style = TextStyle(color = c.muted, fontSize = (12 * s).sp, fontFamily = c.face), modifier = GlanceModifier.padding(start = 12.dp))
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

