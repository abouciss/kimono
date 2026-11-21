package app.kimono.android

import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
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
import androidx.glance.layout.ContentScale
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
    /** A look from [app.kimono.prayer.Looks.widget]: "sky" (the sky at this hour), "system" (the phone's own Material You colours), "tonal", "kimono", a preset, or "clear". */
    val theme: String = "sky",
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
            theme = prefs[WidgetKeys.theme]?.takeIf { id -> app.kimono.prayer.Looks.widget.any { it.id == id } } ?: "sky",
            accent = if (prefs[WidgetKeys.accent] == "prayer") "prayer" else "system",
            opacity = prefs[WidgetKeys.opacity] ?: 1f,
            text = prefs[WidgetKeys.text] ?: "m",
        )
    }
}

/* ── Colours: the sky at this hour, or a look's own paper ── */

/**
 * Everything a widget is painted and written in, for one minute: the sky (two
 * stops and a glow on the horizon), what's written on it, the land along the
 * bottom with what's written there, and the plate the open prayer sits on.
 */
class Palette(
    val top: Color,
    val low: Color,
    val glow: Color? = null,
    val glowLeft: Boolean = false,
    val ink: Color,
    val muted: Color,
    val accent: Color,
    val far: Color,
    val land: Color,
    val onLand: Color,
    val onLandMuted: Color,
    val plate: Color,
    val onPlate: Color,
    /** A flat sun in this colour; null paints the warm one. */
    val sun: Color? = null,
    val trail: Color,
    /** How bright the stars are; 0 by day. */
    val stars: Float = 0f,
    val clouds: Boolean = false,
    val lamps: Boolean = false,
    /** Nothing's monospace numerals. */
    val mono: Boolean = false,
) {
    val face: FontFamily? get() = if (mono) FontFamily.Monospace else null
}

private typealias Tone = app.kimono.prayer.LookTone

private val plainDay = app.kimono.prayer.Looks.plainDay
private val plainNight = app.kimono.prayer.Looks.plainNight
/* Kimono's own: its paper and plum ink, with Times' teal. */
private val kimonoDay = Tone(Color(0xFFFFF8F4), Color(0xFF4E2B37), Color(0xFF7A5E68), Color(0xFF2F5D62), Color(0xFFDCE7E5), Color(0xFF1C3D40))
private val kimonoNight = Tone(Color(0xFF231A1D), Color(0xFFF2E1CA), Color(0xFFBFA9A4), Color(0xFF9CC9CD), Color(0xFF2E4A4D), Color(0xFFD3ECEE))

private val SAND = Color(0xFFF1E3B9)

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

/** Nothing OS's dark widget: system_neutral1_900 under pure white, the land a step lighter (neutral1 800). */
private fun nothingDark(context: Context): Tone? {
    if (Build.VERSION.SDK_INT < 31) return null
    val r = android.R.color::class.java
    fun c(name: String) = system(context, r.getField(name).getInt(null))
    return Tone(c("system_neutral1_900"), Color.White, Color.White.copy(alpha = .6f), Color.White, c("system_neutral1_800"), Color.White)
}

private enum class Phase { Night, Dawn, Day, Gold, Dusk }

private fun phaseOf(view: ScheduleView?): Phase {
    view ?: return Phase.Day
    val t = view.today
    return when {
        view.now < t[0].start -> Phase.Night
        view.now < t[1].start -> Phase.Dawn
        view.now < t[3].start -> Phase.Day
        view.now < t[4].start -> Phase.Gold
        view.now < t[5].start -> Phase.Dusk
        else -> Phase.Night
    }
}

/** The sky is the sky: pale blue by day, honey towards Maghrib, plum at dusk and dawn, deep at night. */
private fun skyPalette(phase: Phase): Palette = when (phase) {
    Phase.Day -> Palette(
        top = Color(0xFF86B6D6), low = Color(0xFFDCEBE8), ink = Color(0xFF13262C), muted = Color(0xB313262C), accent = Color(0xFF1E5A73),
        far = Color(0xFFA9C7C6), land = Color(0xFF2C4747), onLand = Color(0xFFF4F0E4), onLandMuted = Color(0xB3F4F0E4),
        plate = Color(0xFFF4F0E4), onPlate = Color(0xFF13262C), trail = Color(0xFFE3A13A), clouds = true,
    )
    Phase.Gold -> Palette(
        top = Color(0xFFE2BC86), low = Color(0xFFF8E9CB), glow = Color(0x99F2A65E), ink = Color(0xFF2F2414), muted = Color(0xB32F2414), accent = Color(0xFF8A4518),
        far = Color(0xFFD2B282), land = Color(0xFF4D3A22), onLand = Color(0xFFFFF3DC), onLandMuted = Color(0xB3FFF3DC),
        plate = Color(0xFFFFF3DC), onPlate = Color(0xFF2F2414), trail = Color(0xFFE3A13A), clouds = true,
    )
    Phase.Dusk -> Palette(
        top = Color(0xFF1E1633), low = Color(0xFF9A4A62), glow = Color(0xB3F2A65E), glowLeft = true, ink = Color(0xFFF6E9D6), muted = Color(0xB3F6E9D6), accent = Color(0xFFF6C98E),
        far = Color(0xFF3A2440), land = Color(0xFF0F0A14), onLand = Color(0xFFF6E9D6), onLandMuted = Color(0xA6F6E9D6),
        plate = Color(0xFFF6D7A8), onPlate = Color(0xFF1E1633), trail = SAND, stars = .45f, lamps = true,
    )
    Phase.Dawn -> Palette(
        top = Color(0xFF1C1A36), low = Color(0xFF7C5070), glow = Color(0x99F2A65E), ink = Color(0xFFF6E9D6), muted = Color(0xB3F6E9D6), accent = Color(0xFFF6C98E),
        far = Color(0xFF30263F), land = Color(0xFF0D0A16), onLand = Color(0xFFF6E9D6), onLandMuted = Color(0xA6F6E9D6),
        plate = Color(0xFFF6D7A8), onPlate = Color(0xFF1C1A36), trail = SAND, stars = .45f, lamps = true,
    )
    Phase.Night -> Palette(
        top = Color(0xFF08121C), low = Color(0xFF1A3142), ink = Color(0xFFF3EAD2), muted = Color(0xA6F3EAD2), accent = SAND,
        far = Color(0xFF12222E), land = Color(0xFF050B10), onLand = Color(0xFFF3EAD2), onLandMuted = Color(0xA6F3EAD2),
        plate = SAND, onPlate = Color(0xFF08121C), trail = SAND, stars = 1f, lamps = true,
    )
}

fun widgetPalette(context: Context, options: WidgetOptions, view: ScheduleView?, night: Boolean): Palette {
    if (options.theme == app.kimono.prayer.Looks.SKY) return skyPalette(phaseOf(view))
    val look = app.kimono.prayer.Looks.of(options.theme)
    val preset = look?.day
    val (day, dark) = when {
        preset != null -> preset to (look.night ?: preset)
        options.theme == "kimono" -> kimonoDay to kimonoNight
        options.theme == "tonal" -> youTones(context, tonal = true) ?: (plainDay to plainNight)
        else -> youTones(context, tonal = false) ?: (plainDay to plainNight)
    }
    /* The phone's own looks take the accent asked for; a preset and Kimono bring their own. */
    val own = options.theme == "system" || options.theme == "clear"
    val (accentDay, accentDark) = when {
        !own -> day to dark
        options.accent == "prayer" -> plainDay to plainNight
        else -> youTones(context, tonal = false) ?: (plainDay to plainNight)
    }
    /* Mono is Nothing's own dark widget: the phone's neutral1 900 (what Nothing OS paints its widgets with), all in white. */
    val mono = if (options.theme == "mono") nothingDark(context) else null
    val t = mono ?: if (night) dark else day
    val a = mono ?: if (night) accentDark else accentDay
    val clear = options.theme == "clear"
    val ground = if (clear) Color.Transparent else t.ground
    val land = if (clear) t.ground.copy(alpha = .62f) else a.chip
    return Palette(
        top = ground, low = ground, ink = t.ink, muted = t.muted, accent = a.accent,
        far = if (clear) Color.Transparent else lerp(t.ground, a.chip, .45f), land = land,
        onLand = if (clear) t.ink else a.onChip, onLandMuted = (if (clear) t.ink else a.onChip).copy(alpha = .68f),
        plate = a.accent, onPlate = t.ground.copy(alpha = 1f), sun = a.accent, trail = a.accent, mono = look?.dotted == true,
    )
}

/* ── The scene, painted ── */

/** Whether the widget draws by night, as Kimono's own light or dark says. */
private fun nightFor(context: Context, appearance: String): Boolean = when (appearance) {
    "dark" -> true
    "light" -> false
    else -> (context.resources.configuration.uiMode and android.content.res.Configuration.UI_MODE_NIGHT_MASK) == android.content.res.Configuration.UI_MODE_NIGHT_YES
}

/** Where the day's arc is drawn, in dp: from [x0] to [x1] along the horizon, rising to [peak] from the top. */
class Arc(val x0: Float, val x1: Float, val peak: Float)

private const val MOSQUE = "M-52 3V-24H-34V-30H-27C-36-52-12-60 0-76C12-60 36-52 27-30H34V-24H46V-57H43V-62H46V-96L51-110L56-96V-62H59V-57H56V3Z"
private const val MOSQUE_LAMPS = "M-5 3V-9C-5-17 5-17 5-9V3ZM-21-6v-6c0-5 6-5 6 0v6ZM15-6v-6c0-5 6-5 6 0v6ZM49-70v-5c0-3 4-3 4 0v5Z"

private fun argb(c: Color) = android.graphics.Color.argb((c.alpha * 255).toInt(), (c.red * 255).toInt(), (c.green * 255).toInt(), (c.blue * 255).toInt())

/**
 * The widget's whole ground, as the Times screen paints its sky but small: the
 * sky from its top to the horizon, stars or a cloud or two, far hills, the
 * day's arc with the sun (or the moon) where we are, then the near land with
 * the mosque standing on it. A widget can't draw shapes of its own, so this is
 * a picture, made again each minute. Sizes are in dp; [k] is pixels per dp.
 */
private fun scene(p: Palette, view: ScheduleView?, wDp: Float, hDp: Float, horizonDp: Float, arc: Arc?, mosqueDp: Float?, k: Float, opacity: Float): android.graphics.Bitmap {
    val w = (wDp * k).toInt().coerceAtLeast(1)
    val h = (hDp * k).toInt().coerceAtLeast(1)
    val bitmap = android.graphics.Bitmap.createBitmap(w, h, android.graphics.Bitmap.Config.ARGB_8888)
    val canvas = android.graphics.Canvas(bitmap)
    val layer = canvas.saveLayerAlpha(null, (opacity.coerceIn(0f, 1f) * 255).toInt())
    val base = horizonDp * k
    val fill = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG)
    val random = kotlin.random.Random(97)
    fun between(a: Float, b: Float) = a + random.nextFloat() * (b - a)

    /* The sky. */
    fill.shader = android.graphics.LinearGradient(0f, 0f, 0f, base, argb(p.top), argb(p.low), android.graphics.Shader.TileMode.CLAMP)
    canvas.drawRect(0f, 0f, w.toFloat(), h.toFloat(), fill)
    fill.shader = null
    p.glow?.let { glow ->
        val gx = if (p.glowLeft) w * .12f else w * .88f
        fill.shader = android.graphics.RadialGradient(gx, base, w * .5f, argb(glow), argb(glow.copy(alpha = 0f)), android.graphics.Shader.TileMode.CLAMP)
        canvas.drawRect(0f, 0f, w.toFloat(), base, fill)
        fill.shader = null
    }
    if (p.stars > 0f) repeat((wDp * horizonDp / 520).toInt()) {
        fill.color = argb(p.ink.copy(alpha = between(.2f, .85f) * p.stars))
        canvas.drawCircle(between(0f, w.toFloat()), between(4 * k, base - 10 * k), between(.5f, 1.3f) * k, fill)
    }
    if (p.clouds) repeat(3) { i ->
        val cx = w * (.18f + i * .32f + between(-.05f, .05f)); val cy = between(10 * k, kotlin.math.max(14 * k, base * .4f))
        val cw = between(28f, 46f) * k
        fill.color = argb(Color.White.copy(alpha = .32f))
        canvas.drawOval(cx - cw, cy - cw * .18f, cx + cw, cy + cw * .18f, fill)
        canvas.drawOval(cx - cw * .5f, cy - cw * .3f, cx + cw * .35f, cy + cw * .1f, fill)
    }

    /* The far hills. */
    fun land(points: List<android.graphics.PointF>) = android.graphics.Path().apply {
        moveTo(points[0].x, points[0].y)
        for (i in 1 until points.size) {
            val a = points[i - 1]; val b = points[i]
            quadTo(a.x, a.y, (a.x + b.x) / 2, (a.y + b.y) / 2)
        }
        lineTo(points.last().x, points.last().y); lineTo(w.toFloat() + 20, h.toFloat() + 20); lineTo(-20f, h.toFloat() + 20); close()
    }
    if (base < h) {
        val n = kotlin.math.max(4, (wDp / 70).toInt())
        fill.color = argb(p.far)
        canvas.drawPath(land((0..n).map { android.graphics.PointF(-20f + (w + 40f) * it / n, base - between(4f, 13f) * k) }), fill)
    }

    /* The day's arc: dotted all the way, brushed as far as now, the sun or the moon on it. */
    if (arc != null && view != null) {
        val sunrise = view.today[1].start
        val maghrib = view.today[4].start
        val daytime = view.now >= sunrise && view.now < maghrib
        val (from, to) = if (daytime) sunrise to maghrib else view.milestones.maghrib to view.milestones.sunrise
        val f = ((view.now - from) / (to - from)).toFloat().coerceIn(0f, 1f)
        val lift = kotlin.math.min(base - arc.peak * k, (arc.x1 - arc.x0) * k * .5f)
        fun at(x: Float) = android.graphics.PointF((arc.x0 + x * (arc.x1 - arc.x0)) * k, base - kotlin.math.sin(x * Math.PI).toFloat() * lift)
        val line = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply { style = android.graphics.Paint.Style.STROKE; strokeCap = android.graphics.Paint.Cap.ROUND }
        line.color = argb(p.ink.copy(alpha = .38f)); line.strokeWidth = 1.6f * k
        line.pathEffect = android.graphics.DashPathEffect(floatArrayOf(.1f, 5.5f * k), 0f)
        canvas.drawPath(android.graphics.Path().apply { (0..90).forEach { i -> val q = at(i / 90f); if (i == 0) moveTo(q.x, q.y) else lineTo(q.x, q.y) } }, line)
        line.pathEffect = null
        line.color = argb(p.trail.copy(alpha = p.trail.alpha * .9f))
        val steps = kotlin.math.max(2, (f * 90).toInt())
        for (i in 1..steps) {
            val a = at(f * (i - 1) / steps); val b = at(f * i / steps)
            line.strokeWidth = (1.1f + 1.3f * kotlin.math.sin(i / steps.toFloat() * Math.PI).toFloat()) * k
            canvas.drawLine(a.x, a.y, b.x, b.y, line)
        }
        val body = at(f)
        val r = 7f * k
        if (daytime) {
            val sun = p.sun
            if (sun == null) {
                fill.color = argb(Color(0x55EEB04A)); canvas.drawCircle(body.x, body.y, r * 2.2f, fill)
                fill.shader = android.graphics.RadialGradient(body.x - r * .3f, body.y - r * .3f, r * 1.4f, intArrayOf(argb(Color(0xFFFBE6A2)), argb(Color(0xFFEEB04A)), argb(Color(0xFFD98328))), null, android.graphics.Shader.TileMode.CLAMP)
                canvas.drawCircle(body.x, body.y, r, fill); fill.shader = null
            } else {
                fill.color = argb(sun.copy(alpha = .22f)); canvas.drawCircle(body.x, body.y, r * 2f, fill)
                fill.color = argb(sun); canvas.drawCircle(body.x, body.y, r, fill)
            }
        } else {
            val moon = p.sun ?: SAND
            fill.color = argb(moon.copy(alpha = .14f)); canvas.drawCircle(body.x, body.y, r * 2.2f, fill)
            fill.color = argb(moon)
            canvas.drawPath(android.graphics.Path().apply {
                addCircle(body.x, body.y, r, android.graphics.Path.Direction.CW)
                op(android.graphics.Path().apply { addCircle(body.x + r * .55f, body.y - r * .35f, r * .88f, android.graphics.Path.Direction.CW) }, android.graphics.Path.Op.DIFFERENCE)
            }, fill)
        }
    }

    /* The near land, and the mosque on it. */
    if (base < h) {
        val n = kotlin.math.max(5, (wDp / 60).toInt())
        fill.color = argb(p.land)
        canvas.drawPath(land((0..n).map { android.graphics.PointF(-20f + (w + 40f) * it / n, base + between(-2.5f, 2.5f) * k) }), fill)
        if (mosqueDp != null) {
            val tall = kotlin.math.min(44f, horizonDp * .42f)
            val s = tall / 113f * k
            canvas.save()
            canvas.translate(mosqueDp * k, base + 3 * k)
            canvas.scale(s, s)
            canvas.drawPath(androidx.core.graphics.PathParser.createPathFromPathData(MOSQUE), fill)
            if (p.lamps) {
                fill.color = argb(Color(0xFFF0B95C))
                canvas.drawPath(androidx.core.graphics.PathParser.createPathFromPathData(MOSQUE_LAMPS), fill)
            }
            canvas.restore()
        }
    }
    canvas.restoreToCount(layer)
    return bitmap
}

/* ── The three widgets ── */

/** What a widget needs to draw, whether placed or shown as a preview. */
class WidgetScene(val mine: PrayerMine?, val view: ScheduleView?, val options: WidgetOptions, val palette: Palette, val h24: Boolean)

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
            Draw(WidgetScene(mine, view, options, widgetPalette(ctx, options, view, nightFor(ctx, appearance)), android.text.format.DateFormat.is24HourFormat(ctx)))
        }
    }

    @Composable abstract fun Draw(scene: WidgetScene)
}

private fun short(hhmm: String, h24: Boolean) = Presentation.clock(hhmm, h24).removeSuffix(" AM").removeSuffix(" PM")

/** The countdown: the prayer's name large, how long beneath it in the accent. */
@Composable
private fun Countdown(scene: WidgetScene, view: ScheduleView, big: Int, small: Int) {
    val p = scene.palette
    val s = scene.options.scale
    val (what, howLong) = Presentation.titleParts(view, scene.options.mode)
    Text(what, maxLines = 1, style = TextStyle(color = ColorProvider(p.ink), fontSize = (big * s).sp, fontWeight = FontWeight.Medium, fontFamily = p.face))
    if (howLong.isNotEmpty()) Text(howLong, maxLines = 1, style = TextStyle(color = ColorProvider(p.accent), fontSize = (small * s).sp, fontWeight = FontWeight.Medium, fontFamily = p.face))
}

@Composable
private fun Place(scene: WidgetScene) {
    Text(scene.mine?.place?.name ?: "", maxLines = 1, style = TextStyle(color = ColorProvider(scene.palette.muted), fontSize = (11.5f * scene.options.scale).sp, fontWeight = FontWeight.Medium))
}

/** Small: the countdown in the sky, the prayer it counts to written on the land. */
class NextPrayerWidget : PrayerWidget() {
    override val sizeMode: SizeMode = SizeMode.Exact

    @Composable override fun Draw(scene: WidgetScene) {
        val size = LocalSize.current
        val w = size.width.value; val h = size.height.value
        val view = scene.view
        val p = scene.palette
        val s = scene.options.scale
        if (view == null) return Painted(scene, h, null, null) { Empty(scene) }
        if (h < 70) return Painted(scene, h, null, null) {
            Column(GlanceModifier.fillMaxSize().padding(horizontal = 14.dp), verticalAlignment = Alignment.CenterVertically) { Countdown(scene, view, 17, 12) }
        }
        /* One row tall: the countdown beside the mosque on a sliver of land. */
        if (h < 140) return Painted(scene, h - 14f, null, w * .78f) {
            Column(GlanceModifier.fillMaxSize().padding(start = 14.dp, end = 14.dp, bottom = 10.dp), verticalAlignment = Alignment.CenterVertically) { Countdown(scene, view, 21, 13) }
        }
        val band = 30f
        val horizon = h - band
        Painted(scene, horizon, Arc(14f, w - 14f, kotlin.math.max(86f, horizon * .4f)), w * .5f) {
            Column(GlanceModifier.fillMaxSize()) {
                Column(GlanceModifier.defaultWeight().fillMaxWidth().padding(start = 14.dp, top = 12.dp, end = 14.dp)) {
                    Place(scene)
                    Countdown(scene, view, 24, 14)
                }
                /* The one the countdown names: Sunrise, say, though it's not a prayer. */
                val named = Presentation.titleParts(view, scene.options.mode).first
                val prayer = (listOfNotNull(view.current, view.next) + view.today).firstOrNull { it.name == named }
                Row(GlanceModifier.fillMaxWidth().height(band.dp).padding(horizontal = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                    if (prayer != null) {
                        Text("${prayer.name} ${Presentation.clock(prayer.time, scene.h24)}", maxLines = 1,
                            style = TextStyle(color = ColorProvider(p.onLand), fontSize = (12.5f * s).sp, fontWeight = FontWeight.Medium, fontFamily = p.face))
                        val iqama = prayer.iqamaAfter?.let { "+$it" } ?: prayer.iqama?.let { short(it, scene.h24) }
                        if (iqama != null && scene.options.iqama && w >= 150) {
                            Spacer(GlanceModifier.defaultWeight())
                            Text("Iqama $iqama", maxLines = 1, style = TextStyle(color = ColorProvider(p.onLandMuted), fontSize = (11.5f * s).sp, fontFamily = p.face))
                        }
                    }
                }
            }
        }
    }
}

/** Medium and large: the countdown in the sky, the day's arc beside it, the five prayers along the land. */
class TodayPrayerWidget : PrayerWidget() {
    override val sizeMode: SizeMode = SizeMode.Exact

    @Composable override fun Draw(scene: WidgetScene) {
        val size = LocalSize.current
        val w = size.width.value; val h = size.height.value
        val view = scene.view ?: return Painted(scene, h, null, null) { Empty(scene) }
        val s = scene.options.scale
        val tight = h < 140
        val iqama = scene.options.iqama && !tight && view.today.any { it.iqama != null }
        val footer = if (h >= 210) footer(scene, view) else null
        val band = (if (tight) 44f else if (iqama) 58f else 46f) * s.coerceAtMost(1.1f) + (if (footer != null) 30f else 0f) + 8f
        val horizon = h - band
        val wide = w >= 230
        Painted(scene, horizon, if (wide) Arc(w * .44f, w - 14f, kotlin.math.max(14f, horizon * .2f)) else null, if (wide) w * .63f else null) {
            Column(GlanceModifier.fillMaxSize()) {
                Column(GlanceModifier.defaultWeight().fillMaxWidth().padding(start = 16.dp, top = if (tight) 10.dp else 14.dp, end = 16.dp)) {
                    if (!tight) Place(scene)
                    Countdown(scene, view, if (tight) 20 else 26, if (tight) 13 else 15)
                }
                Column(GlanceModifier.fillMaxWidth().height(band.dp).padding(start = 8.dp, end = 8.dp, top = 8.dp, bottom = 6.dp)) {
                    Strip(scene, view, iqama)
                    if (footer != null) Text(footer, maxLines = 1, modifier = GlanceModifier.fillMaxWidth().padding(top = 6.dp),
                        style = TextStyle(color = ColorProvider(scene.palette.onLandMuted), fontSize = (11 * s).sp, textAlign = TextAlign.Center, fontFamily = scene.palette.face))
                }
            }
        }
    }

    private fun footer(scene: WidgetScene, view: ScheduleView): String? {
        val m = view.milestones
        val clock = { at: kotlin.time.Instant -> short(ScheduleBuilder.time(at, view.timezone), scene.h24) }
        val bits = buildList {
            if (view.jumua.isNotEmpty()) add("Jumu'a ${view.jumua.joinToString(" · ") { short(it, scene.h24) }}")
            if (scene.options.night) { add("Midnight ${clock(m.midnight)}"); add("Last third ${clock(m.lastThird)}") }
        }
        return bits.takeIf { it.isNotEmpty() }?.joinToString("   ·   ")
    }

    /** The five side by side on the land: name, adhan, iqama. The open one sits on a plate; the past ones fade. */
    @Composable private fun Strip(scene: WidgetScene, view: ScheduleView, iqama: Boolean) {
        val p = scene.palette
        val s = scene.options.scale
        val prayers = Presentation.displayPrayers(view)
        val lit = prayers.firstOrNull { it.id == view.current?.id } ?: prayers.firstOrNull { it.id == view.next?.id }
        Row(GlanceModifier.fillMaxWidth()) {
            prayers.forEach { prayer ->
                val on = prayer.id == lit?.id
                val past = !on && (prayer.end?.let { it <= view.now } ?: false)
                val ink = when { on -> p.onPlate; past -> p.onLand.copy(alpha = p.onLand.alpha * .45f); else -> p.onLand }
                val soft = when { on -> p.onPlate.copy(alpha = .72f); past -> p.onLand.copy(alpha = p.onLand.alpha * .4f); else -> p.onLandMuted }
                /* Every cell has a background, clear unless it's the open one: a widget keeps the last one it was given. */
                val cell = GlanceModifier.defaultWeight().background(ColorProvider(if (on) p.plate else Color.Transparent)).cornerRadius(14.dp)
                Column(cell.padding(vertical = 4.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(prayer.name, maxLines = 1, style = TextStyle(color = ColorProvider(soft), fontSize = (10.5f * s).sp, fontWeight = FontWeight.Medium, textAlign = TextAlign.Center))
                    Text(short(prayer.time, scene.h24), maxLines = 1,
                        style = TextStyle(color = ColorProvider(ink), fontSize = (16 * s).sp, fontWeight = if (on) FontWeight.Bold else FontWeight.Medium, fontFamily = p.face, textAlign = TextAlign.Center))
                    if (iqama) Text(prayer.iqamaAfter?.let { "+$it" } ?: prayer.iqama?.let { short(it, scene.h24) } ?: " ", maxLines = 1,
                        style = TextStyle(color = ColorProvider(soft), fontSize = (10.5f * s).sp, fontFamily = p.face, textAlign = TextAlign.Center))
                }
            }
        }
    }
}

/** A single line for narrow spaces: the countdown, then (where there's room) the rest of the day's times. */
class StripPrayerWidget : PrayerWidget() {
    override val sizeMode: SizeMode = SizeMode.Exact

    @Composable override fun Draw(scene: WidgetScene) {
        val size = LocalSize.current
        val h = size.height.value
        Painted(scene, h, null, null) {
            val view = scene.view ?: return@Painted Empty(scene)
            val p = scene.palette
            val s = scene.options.scale
            val (what, howLong) = Presentation.titleParts(view, scene.options.mode)
            Row(GlanceModifier.fillMaxSize().padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(what, maxLines = 1, style = TextStyle(color = ColorProvider(p.ink), fontSize = (16 * s).sp, fontWeight = FontWeight.Medium, fontFamily = p.face))
                Spacer(GlanceModifier.width(8.dp))
                Text(howLong, maxLines = 1, style = TextStyle(color = ColorProvider(p.accent), fontSize = (13 * s).sp, fontWeight = FontWeight.Medium, fontFamily = p.face))
                if (size.width >= 280.dp) {
                    Spacer(GlanceModifier.defaultWeight())
                    val ahead = Presentation.displayPrayers(view).filter { it.start > view.now && it.name != what }
                    ahead.take(if (size.width >= 380.dp) 3 else 2).forEach { q ->
                        Text("${q.name} ${short(q.time, scene.h24)}", maxLines = 1,
                            style = TextStyle(color = ColorProvider(p.muted), fontSize = (12 * s).sp, fontFamily = p.face), modifier = GlanceModifier.padding(start = 12.dp))
                    }
                }
            }
        }
    }
}

/* ── Shared pieces ── */

/** The painted scene behind, opening Times when pressed, with what's written on it in front. */
@Composable
private fun Painted(scene: WidgetScene, horizon: Float, arc: Arc?, mosque: Float?, content: @Composable () -> Unit) {
    val context = LocalContext.current
    val size = LocalSize.current
    val open = Intent(context, MainActivity::class.java).setAction("app.kimono.prayer.OPEN").putExtra(AppUpdates.ROUTE, "prayer")
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    /* Two pixels a dp is sharp enough, and keeps a minute's picture small. */
    val k = kotlin.math.min(context.resources.displayMetrics.density, 2f)
    val picture = scene(scene.palette, scene.view, size.width.value, size.height.value, horizon, arc, mosque, k, scene.options.opacity)
    var modifier = GlanceModifier.fillMaxSize()
    modifier = if (Build.VERSION.SDK_INT >= 31) modifier.cornerRadius(android.R.dimen.system_app_widget_background_radius) else modifier.cornerRadius(20.dp)
    Box(modifier.clickable(actionStartActivity(open))) {
        Image(ImageProvider(picture), contentDescription = null, modifier = GlanceModifier.fillMaxSize(), contentScale = ContentScale.Crop)
        content()
    }
}

@Composable
private fun Empty(scene: WidgetScene) {
    val p = scene.palette
    Row(GlanceModifier.fillMaxSize().padding(horizontal = 14.dp), verticalAlignment = Alignment.CenterVertically) {
        Image(ImageProvider(R.drawable.ic_crescent), null, colorFilter = ColorFilter.tint(ColorProvider(p.accent)), modifier = GlanceModifier.size(18.dp))
        Spacer(GlanceModifier.width(8.dp))
        Text(if (scene.mine?.place == null) "Choose your place in Times" else "Open Times to refresh", maxLines = 2,
            style = TextStyle(color = ColorProvider(p.muted), fontSize = (13 * scene.options.scale).sp))
    }
}
