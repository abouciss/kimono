@file:OptIn(ExperimentalMaterial3Api::class)

package app.kimono.screens

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.material3.rememberTooltipState
import androidx.compose.material3.TooltipAnchorPosition
import androidx.compose.material3.TooltipDefaults
import androidx.compose.material3.TooltipBox
import androidx.compose.material3.PlainTooltip
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.drawText
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.kimono.data.KimonoProblem
import app.kimono.data.Platform
import app.kimono.prayer.NightPhase
import app.kimono.prayer.Prayer
import app.kimono.prayer.PrayerDay
import app.kimono.prayer.PrayerMine
import app.kimono.prayer.PrayerPlace
import app.kimono.prayer.Prayers
import app.kimono.prayer.Presentation
import app.kimono.prayer.ScheduleBuilder
import app.kimono.prayer.ScheduleView
import app.kimono.prayer.TitleMode
import app.kimono.ui.HoldMenu
import app.kimono.ui.InkBloom
import app.kimono.ui.InkLoader
import app.kimono.ui.InkSheet
import app.kimono.ui.InkTitle
import app.kimono.ui.MenuChoice
import app.kimono.ui.Problem
import app.kimono.ui.Seal
import app.kimono.ui.SealTone
import app.kimono.ui.Surface
import app.kimono.ui.clickable
import app.kimono.ui.kimonoIcon
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.datetime.LocalDate
import kotlinx.datetime.TimeZone
import kotlin.time.Clock
import kotlin.time.Instant

/*
 * 礼 Kimono Times: the time to the next prayer, written large over the
 * day's sky (the sun's arc from sunrise to Maghrib, the night's below), then
 * today's prayers and the night's milestones, worked out on the phone from
 * the kept timetable so it all goes on without a connection.
 */

private const val TITLE_KEY = "kimono.prayer.title"
private const val IQAMA_KEY = "kimono.times.iqama"

/** Times in Kimono's own look, in its accent, as on the web. (The widgets are where the phone's looks and presets go.) */
@Composable
fun PrayerTheme(@Suppress("UNUSED_PARAMETER") platform: Platform, accent: String, content: @Composable () -> Unit) = app.kimono.ui.AppAccentTheme(accent, content)

/** The clock, turning over at each minute (the countdowns' words change no faster). */
@Composable
private fun minuteNow(): Instant {
    val now by produceState(Clock.System.now()) {
        while (true) {
            val at = Clock.System.now()
            value = at
            delay((Presentation.nextMinute(at) - at).inWholeMilliseconds + 50)
        }
    }
    return now
}

/** Your place and its timetable: what's kept at once, the Portal's answer as it comes. */
@Composable
private fun rememberMine(prayers: Prayers): Triple<PrayerMine?, String?, suspend () -> Unit> {
    val mine by prayers.mine.collectAsState()
    var problem by remember { mutableStateOf<String?>(null) }
    var looked by remember { mutableStateOf(false) }
    suspend fun load() {
        try { prayers.load(); problem = null } catch (p: KimonoProblem) { problem = p.message } finally { looked = true }
    }
    LaunchedEffect(prayers) { prayers.kept(); load() }
    return Triple(mine, problem ?: mine?.problem.takeIf { looked }, ::load)
}

@Composable
fun PrayerScreen(prayers: Prayers, platform: Platform) {
    val (mine, problem, _) = rememberMine(prayers)
    val scope = rememberCoroutineScope()
    var open by remember { mutableStateOf<String?>(null) }
    var mode by remember { mutableStateOf(TitleMode.NextPrayer) }
    var iqama by remember { mutableStateOf(true) }
    LaunchedEffect(Unit) {
        if (platform.readKept(TITLE_KEY) == "left") mode = TitleMode.TimeLeft
        if (platform.readKept(IQAMA_KEY) == "off") iqama = false
    }
    val now = minuteNow()
    val h24 = platform.clock24
    val view = remember(mine?.timetable, now) { mine?.timetable?.let { ScheduleBuilder.build(it, now) } }

    Scaffold(containerColor = MaterialTheme.colorScheme.surface) { pad ->
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(top = pad.calculateTopPadding() + 8.dp, bottom = 40.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            item {
                Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 8.dp, top = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("Times", style = MaterialTheme.typography.displaySmall, color = MaterialTheme.colorScheme.onSurface, modifier = Modifier.weight(1f))
                    Box(Modifier.size(48.dp).clip(CircleShape).clickable(onClickLabel = "Settings") { open = "settings" }, contentAlignment = Alignment.Center) {
                        Glyph(Glyphs.settings, MaterialTheme.colorScheme.onSurfaceVariant, 24.dp)
                    }
                }
            }
            when {
                view != null -> {
                    item { SkyCard(view, mine?.place, mode, h24, onPlace = { open = "place" }) {
                        mode = if (mode == TitleMode.NextPrayer) TitleMode.TimeLeft else TitleMode.NextPrayer
                        scope.launch { platform.keep(TITLE_KEY, if (mode == TitleMode.TimeLeft) "left" else null) }
                    } }
                    item { Problem(problem?.takeIf { it != app.kimono.data.OFFLINE }) }
                    item { PrayerCard(view, h24, iqama) }
                    item { NightTiles(view, h24) }
                }
                mine == null && problem == null -> item { Box(Modifier.fillMaxWidth().padding(64.dp), contentAlignment = Alignment.Center) { InkLoader(size = 48.dp) } }
                mine?.place == null -> item { Unplaced(problem) { open = "place" } }
                else -> item {
                    Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text(problem ?: "No times for today yet.", style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            Seal("Try again", compact = true, onClick = { scope.launch { runCatching { prayers.load() } } })
                            Seal("Change mosque", compact = true, tone = SealTone.Quiet, onClick = { open = "place" })
                        }
                    }
                }
            }
        }
    }
    when (open) {
        "place" -> PlaceSheet(prayers, platform, mine) { open = null }
        "settings" -> SettingsSheet(platform, mode, iqama, onMode = { m -> mode = m; scope.launch { platform.keep(TITLE_KEY, if (m == TitleMode.TimeLeft) "left" else null) } },
            onIqama = { on -> iqama = on; scope.launch { platform.keep(IQAMA_KEY, if (on) null else "off") } }) { open = null }
    }
}

/** The coming days, as a timetable. */
@Composable
fun PrayerDaysScreen(prayers: Prayers, platform: Platform) {
    val (mine, problem, _) = rememberMine(prayers)
    val now = minuteNow()
    val h24 = platform.clock24
    val table = mine?.timetable
    val today = remember(table, now) { table?.let { ScheduleBuilder.build(it, now)?.date } }
    val days = table?.days.orEmpty().filter { today == null || it.date >= today.toString() }
    Scaffold(containerColor = MaterialTheme.colorScheme.surface) { pad ->
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(top = pad.calculateTopPadding() + 8.dp, bottom = 40.dp)) {
            item {
                Column(Modifier.padding(horizontal = 20.dp)) {
                    Text("Days", style = MaterialTheme.typography.displaySmall, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 12.dp, bottom = 4.dp))
                    mine?.place?.let { Text(it.name, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                }
            }
            if (days.isNotEmpty()) item {
                Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 20.dp, top = 20.dp, bottom = 6.dp)) {
                    Spacer(Modifier.weight(1.3f))
                    listOf("Fajr", "Sunrise", "Dhuhr", "Asr", "Maghrib", "Isha").forEach {
                        Text(it.take(if (it == "Sunrise") 3 else 4), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.End, modifier = Modifier.weight(1f))
                    }
                }
            }
            items(days, key = { it.date }) { day -> DayRow(day, today = day.date == today?.toString(), h24) }
            if (table == null) item {
                if (problem == null && mine == null) Box(Modifier.fillMaxWidth().padding(64.dp), contentAlignment = Alignment.Center) { InkLoader(size = 48.dp) }
                else Text(problem ?: "Choose your place on Today first.", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(20.dp))
            }
        }
    }
}

@Composable
private fun DayRow(day: PrayerDay, today: Boolean, h24: Boolean) {
    val date = runCatching { LocalDate.parse(day.date) }.getOrNull()
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 12.dp).clip(RoundedCornerShape(16.dp))
            .background(if (today) MaterialTheme.colorScheme.primary.copy(alpha = .08f) else Color.Transparent)
            .padding(horizontal = 8.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1.3f)) {
            Text(date?.let { "${it.dayOfWeek.name.take(3).lowercase().replaceFirstChar(Char::uppercase)} ${it.day}" } ?: day.date,
                style = MaterialTheme.typography.bodyMedium, fontWeight = if (today) FontWeight.Bold else FontWeight.Normal,
                color = if (today) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface)
            if (day.jumua.isNotEmpty() && date?.dayOfWeek == kotlinx.datetime.DayOfWeek.FRIDAY) Text("Jumu'a ${day.jumua.first().let { Presentation.clock(it, h24) }}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        day.times.forEachIndexed { index, t ->
            Text(Presentation.clock(t, h24).removeSuffix(" AM").removeSuffix(" PM"), style = MaterialTheme.typography.bodySmall.copy(fontFeatureSettings = "tnum"),
                color = if (index == 1) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
                textAlign = TextAlign.End, modifier = Modifier.weight(1f))
        }
    }
}

/* ───── line icons, the website's own ───── */

private object Glyphs {
    const val Fajr = "M4 18h16M7 18a5 5 0 0 1 10 0M12 9V6M5.6 11.6l1.6 1.6M18.4 11.6l-1.6 1.6M9.5 4.5 12 2l2.5 2.5"
    const val Dhuhr = "M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10ZM12 2v2M12 20v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2 12h2M20 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"
    const val Asr = "M12 9a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 4v2M5.6 6.6 7 8M18.4 6.6 17 8M3 13h2M19 13h2M5 21h14"
    const val Maghrib = "M4 18h16M7 18a5 5 0 0 1 10 0M12 2v5M9.5 4.5 12 7l2.5-2.5M5.6 11.6l1.6 1.6M18.4 11.6l-1.6 1.6"
    const val Isha = "M15 4a8 8 0 1 0 5 13 6.5 6.5 0 1 1-5-13ZM19 3v3M17.5 4.5h3"
    const val midnight = "M15 4a8 8 0 1 0 5 13 6.5 6.5 0 1 1-5-13Z"
    const val lastThird = "M12 3a9 9 0 1 0 9 9M12 3v9l7.8 4.5M17 3v3M15.5 4.5h3M20.5 7v2M19.5 8h2"
    const val sunrise = "M3 18h18M7 18a5 5 0 0 1 10 0M12 10V7M5.6 12.6 7 14M18.4 12.6 17 14M5 21h14"
    const val dome = "M4 20h16M6 20v-6h12v6M8 14c-1.2-4 2-6 4-9 2 3 5.2 5 4 9M12 5V3"
    const val settings = "M4 7h9M17 7h3M4 12h3M11 12h9M4 17h7M15 17h5M15 5v4M9 10v4M13 15v4"
    const val down = "m7 10 5 5 5-5"
    fun of(name: String) = when (name) { "Fajr" -> Fajr; "Dhuhr" -> Dhuhr; "Asr" -> Asr; "Maghrib" -> Maghrib; else -> Isha }
}

private val parsedGlyphs = mutableMapOf<String, Path>()
private fun glyphPath(d: String): Path = parsedGlyphs.getOrPut(d) { androidx.compose.ui.graphics.vector.PathParser().parsePathString(d).toPath() }

/** A line icon drawn on a 24-unit box. */
@Composable
private fun Glyph(d: String, colour: Color, size: androidx.compose.ui.unit.Dp, weight: Float = 1.7f) {
    Canvas(Modifier.size(size)) {
        val s = this.size.width / 24f
        withTransform({ scale(s, s, pivot = Offset.Zero) }) {
            drawPath(glyphPath(d), colour, style = Stroke(weight, cap = StrokeCap.Round, join = androidx.compose.ui.graphics.StrokeJoin.Round))
        }
    }
}

/* ───── the sky ───── */

private enum class SkyPhase { Night, Dawn, Day, Gold, Dusk }

private fun skyPhase(view: ScheduleView): SkyPhase {
    val (fajr, sunrise) = view.today[0] to view.today[1]
    val now = view.now
    return when {
        now < fajr.start -> SkyPhase.Night
        now < sunrise.start -> SkyPhase.Dawn
        now < view.today[3].start -> SkyPhase.Day
        now < view.today[4].start -> SkyPhase.Gold
        now < view.today[5].start -> SkyPhase.Dusk
        else -> SkyPhase.Night
    }
}

/** The sky is the sky whatever the look: pale by day, warm towards Maghrib, plum at dusk and dawn, deep at night. */
private class SkyColours(val sky: Color, val ink: Color, val shade: Color, val cloud: Color) {
    val far get() = app.kimono.ui.mix(shade, sky, .8f)
    val near get() = app.kimono.ui.mix(shade, sky, .24f)
    val mosque get() = app.kimono.ui.mix(shade, sky, .08f)
}

private fun skyColours(phase: SkyPhase, night: Boolean) = when (phase) {
    SkyPhase.Day -> if (night) SkyColours(Color(0xFF2A4D55), Color(0xFFF3ECDC), Color(0xFF0A181C), Color(0xFF9FC0C2)) else SkyColours(Color(0xFFD5E6E3), Color(0xFF1D2B2C), Color(0xFF2C4747), Color.White)
    SkyPhase.Gold -> if (night) SkyColours(Color(0xFF5C4630), Color(0xFFF6ECD8), Color(0xFF150E08), Color(0xFFC9A877)) else SkyColours(Color(0xFFF2DFB8), Color(0xFF2F2414), Color(0xFF4D3A22), Color(0xFFFFF6E2))
    SkyPhase.Dusk -> SkyColours(Color(0xFF412D47), Color(0xFFF6E9D6), Color(0xFF0D070F), Color.White)
    SkyPhase.Dawn -> SkyColours(Color(0xFF3C3554), Color(0xFFF6E9D6), Color(0xFF0B0914), Color.White)
    SkyPhase.Night -> SkyColours(Color(0xFF0F1F28), Color(0xFFF3EAD2), Color(0xFF03080B), Color.White)
}

private val SAND = Color(0xFFF1E3B9)
private val SUN_INK = Color(0xFFE3A13A)
private const val MOSQUE = "M-52 3V-24H-34V-30H-27C-36-52-12-60 0-76C12-60 36-52 27-30H34V-24H46V-57H43V-62H46V-96L51-110L56-96V-62H59V-57H56V3Z"
private const val MOSQUE_FINIAL = "M0-76V-89M-3-92a4 4 0 1 0 6 0 3 3 0 1 1-6 0Z"
private const val MOSQUE_LAMPS = "M-5 3V-9C-5-17 5-17 5-9V3ZM-21-6v-6c0-5 6-5 6 0v6ZM15-6v-6c0-5 6-5 6 0v6ZM49-70v-5c0-3 4-3 4 0v5Z"

/** The Islamic date turns over at Maghrib, as the web shows it. */
private fun dateLine(view: ScheduleView): String {
    val d = view.date
    return "${d.dayOfWeek.name.lowercase().replaceFirstChar(Char::uppercase)} ${d.day} ${d.month.name.lowercase().replaceFirstChar(Char::uppercase)}"
}

/**
 * The day's sky, painted: the place to change it, the date, the countdown in
 * Mincho, and under it the scene (the sun's arc from sunrise to Maghrib by day,
 * the moon's from Maghrib to sunrise by night), the land, and the mosque on it.
 * Tapping the countdown switches what it counts; dragging over the sky reads
 * the time anywhere along the arc.
 */
@Composable
private fun SkyCard(view: ScheduleView, place: PrayerPlace?, mode: TitleMode, h24: Boolean, onPlace: () -> Unit, toggle: () -> Unit) {
    val phase = skyPhase(view)
    val c = skyColours(phase, app.kimono.theme.LocalNight.current)
    val sky by androidx.compose.animation.animateColorAsState(c.sky, tween(1600))
    val ink by androidx.compose.animation.animateColorAsState(c.ink, tween(1600))
    val line = Presentation.panelTitle(view, mode)
    val open = view.current
    val under = when {
        mode == TitleMode.TimeLeft && open?.end != null -> Presentation.panelTitle(view, TitleMode.NextPrayer)
        open?.end != null -> "${open.name} · until ${Presentation.clock(ScheduleBuilder.time(open.end, view.timezone), h24)}"
        else -> ""
    }
    Column(Modifier.padding(horizontal = 12.dp).fillMaxWidth().clip(RoundedCornerShape(28.dp)).background(sky)) {
        Column(Modifier.padding(start = 20.dp, end = 20.dp, top = 20.dp)) {
            if (place != null) Row(
                Modifier.clip(RoundedCornerShape(12.dp)).background(ink.copy(alpha = .1f)).clickable(onClickLabel = "Change mosque", onClick = onPlace)
                    .padding(start = 14.dp, end = 8.dp).height(40.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Text(place.name, style = MaterialTheme.typography.titleSmall, color = ink, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                Glyph(Glyphs.down, ink, 20.dp, 2f)
            }
            Text(dateLine(view), style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, color = ink.copy(alpha = .72f), modifier = Modifier.padding(top = 14.dp))
            Column(Modifier.clickable(onClickLabel = "Switch countdown", onClick = toggle)) {
                Text(line, style = MaterialTheme.typography.displayMedium.copy(fontFeatureSettings = "tnum"), color = ink, modifier = Modifier.padding(top = 6.dp))
                if (under.isNotEmpty()) Text(under, style = MaterialTheme.typography.bodyLarge, color = ink.copy(alpha = .78f), modifier = Modifier.padding(top = 8.dp))
            }
        }
        Scene(view, phase, c, h24, Modifier.fillMaxWidth().height(250.dp))
    }
}

private fun quadLand(points: List<Offset>, bottom: Float): Path = Path().apply {
    moveTo(points.first().x, bottom); lineTo(points.first().x, points.first().y)
    for (i in 1 until points.size - 1) {
        val p = points[i]; val q = points[i + 1]
        quadraticTo(p.x, p.y, (p.x + q.x) / 2, (p.y + q.y) / 2)
    }
    lineTo(points.last().x, points.last().y); lineTo(points.last().x, bottom); close()
}

@Composable
private fun Scene(view: ScheduleView, phase: SkyPhase, c: SkyColours, h24: Boolean, modifier: Modifier) {
    val t = view.today
    val m = view.milestones
    val sunrise = t[1].start
    val maghrib = t[4].start
    val daytime = view.now >= sunrise && view.now < maghrib
    val (from, to) = if (daytime) sunrise to maghrib else m.maghrib to m.sunrise
    fun along(at: Instant) = ((at - from) / (to - from)).toFloat().coerceIn(0f, 1f)
    val f by animateFloatAsState(along(view.now), tween(900))
    val measurer = androidx.compose.ui.text.rememberTextMeasurer()
    val label = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold)
    var scrub by remember { mutableStateOf<Float?>(null) }
    val marks = if (daytime) listOf(t[2], t[3]).map { Triple(it.name, it.start, it.id == view.current?.id) }
    else listOf(
        Triple("Isha", m.isha, view.now >= m.isha && view.now < m.midnight),
        Triple("Midnight", m.midnight, m.phase == NightPhase.LastThird),
        Triple("Last third", m.lastThird, view.now >= m.lastThird && view.now < m.fajr),
        Triple("Fajr", m.fajr, view.now >= m.fajr && view.now < m.sunrise),
    )
    val moonAge = remember(view.now) { ((((view.now.toEpochMilliseconds() - 947182440000L) / 86_400_000.0 / 29.530588853) % 1) + 1) % 1 }
    val mosque = remember { glyphPath(MOSQUE) }
    val finial = remember { glyphPath(MOSQUE_FINIAL) }
    val lamps = remember { glyphPath(MOSQUE_LAMPS) }
    val lampLit = phase != SkyPhase.Day && phase != SkyPhase.Gold
    Canvas(modifier.pointerInput(from, to) {
        detectHorizontalDragGestures(onDragEnd = { scrub = null }, onDragCancel = { scrub = null }) { change, _ ->
            val pad = 30.dp.toPx()
            scrub = ((change.position.x - pad) / (size.width - 2 * pad)).coerceIn(0f, 1f)
        }
    }) {
        val w = size.width; val h = size.height
        val pad = 30.dp.toPx()
        val base = h - 50.dp.toPx()
        val lift = kotlin.math.max(64.dp.toPx(), kotlin.math.min(base - 30.dp.toPx(), (w - 2 * pad) * .5f)) * (if (daytime) 1f else .88f)
        fun arc(x: Float) = Offset(pad + x * (w - 2 * pad), base - kotlin.math.sin(x * kotlin.math.PI).toFloat() * lift)
        val random = app.kimono.ui.InkRandom(if (daytime) 41 else 97)
        fun between(a: Float, b: Float) = random.between(a, b)
        /* Stars by night, washed clouds by day. */
        if (daytime) {
            listOf(.16f, .5f, .86f).forEach { x ->
                val cx = w * (x + between(-.05f, .05f)); val cy = between(14.dp.toPx(), kotlin.math.max(24.dp.toPx(), base * .34f)); val s = between(.8f, 1.35f)
                withTransform({ translate(cx, cy); scale(s * 2.8f, s * .8f, pivot = Offset.Zero) }) {
                    drawPath(app.kimono.ui.inkBlot(random, 0f, 0f, 20.dp.toPx() / 2.8f), c.cloud.copy(alpha = .5f))
                }
            }
        } else {
            val dim = if (phase == SkyPhase.Dusk || phase == SkyPhase.Dawn) .45f else 1f
            repeat((w / 11.dp.toPx()).toInt()) {
                drawCircle(c.ink.copy(alpha = between(.25f, .9f) * dim), between(.5f, 1.5f) * density, Offset(between(0f, w), between(6.dp.toPx(), base - 20.dp.toPx())))
            }
        }
        /* The horizon glows where the sun has just gone, or is about to come. */
        val glowX = when (phase) { SkyPhase.Dusk -> pad; SkyPhase.Dawn, SkyPhase.Gold -> w - pad; else -> null }
        if (glowX != null) drawOval(androidx.compose.ui.graphics.Brush.radialGradient(listOf(Color(0x9EF2A65E), Color(0x33D9788A), Color(0x00D9788A)), center = Offset(glowX, base), radius = w * .36f),
            topLeft = Offset(glowX - w * .36f, base - (base - 40.dp.toPx()) * .5f), size = androidx.compose.ui.geometry.Size(w * .72f, (base - 40.dp.toPx())))
        /* The far hills. */
        val farCount = kotlin.math.max(4, (w / 120.dp.toPx()).toInt())
        val far = (0..farCount).map { i -> Offset(-24f + (w + 48f) * i / farCount, base - between(8.dp.toPx(), kotlin.math.min(40.dp.toPx(), base * .14f))) }
        drawPath(quadLand(far, h + 24f), c.far)
        /* The path, dotted, and the brush as far as the day has come. */
        val dots = Path().apply { (0..120).forEach { i -> val p = arc(i / 120f); if (i == 0) moveTo(p.x, p.y) else lineTo(p.x, p.y) } }
        drawPath(dots, c.ink.copy(alpha = .34f), style = Stroke(2.dp.toPx(), cap = StrokeCap.Round, pathEffect = PathEffect.dashPathEffect(floatArrayOf(1f, 8.dp.toPx()))))
        if (f > 0f) {
            val reached = Path().apply { val n = kotlin.math.max(2, (f * 120).toInt()); (0..n).forEach { i -> val p = arc(f * i / n); if (i == 0) moveTo(p.x, p.y) else lineTo(p.x, p.y) } }
            drawPath(app.kimono.ui.inkBrush(reached, app.kimono.ui.InkRandom(7), 3.dp.toPx(), closed = false, lift = 130.dp.toPx()..220.dp.toPx(), gap = 5.dp.toPx()..9.dp.toPx(), swell = .26f, wander = .14f), if (daytime) SUN_INK else SAND)
        }
        /* Each prayer, or each of the night's hours, marked on the path. */
        marks.forEachIndexed { i, (name, at, on) ->
            val p = arc(along(at))
            drawCircle(if (on) c.ink else c.sky, (if (on) 6 else 5).dp.toPx(), p)
            drawCircle(c.ink.copy(alpha = if (on) 1f else .62f), (if (on) 6 else 5).dp.toPx(), p, style = Stroke(2.dp.toPx()))
            val text = measurer.measure(name, label.copy(color = c.ink.copy(alpha = if (on) 1f else .74f), fontWeight = if (on) FontWeight.Bold else FontWeight.SemiBold))
            val below = !daytime && i % 2 == 1
            drawText(text, topLeft = Offset((p.x - text.size.width / 2).coerceIn(4f, w - text.size.width - 4f), if (below) p.y + 10.dp.toPx() else p.y - 12.dp.toPx() - text.size.height))
        }
        /* The sun, or tonight's moon. */
        val body = arc(f)
        if (daytime) {
            drawCircle(Color(0x42EEB04A), 34.dp.toPx(), body)
            drawCircle(androidx.compose.ui.graphics.Brush.radialGradient(listOf(Color(0xFFFBE6A2), Color(0xFFEEB04A), Color(0xFFD98328)), center = body + Offset(-4.dp.toPx(), -4.dp.toPx()), radius = 21.dp.toPx()), 15.dp.toPx(), body)
        } else {
            val r = 14.dp.toPx()
            drawCircle(SAND.copy(alpha = .1f), 30.dp.toPx(), body)
            drawCircle(app.kimono.ui.mix(c.sky, SAND, .16f), r, body)
            val k = kotlin.math.min(.8, kotlin.math.cos(2 * kotlin.math.PI * moonAge)).toFloat()
            val rx = kotlin.math.abs(k) * r
            val lit = Path().apply {
                moveTo(0f, -r)
                arcTo(androidx.compose.ui.geometry.Rect(-r, -r, r, r), -90f, 180f, false)
                arcTo(androidx.compose.ui.geometry.Rect(-rx, -r, rx, r), 90f, if (k > 0) -180f else 180f, false)
                close()
            }
            withTransform({ translate(body.x, body.y); if (moonAge > .5) scale(-1f, 1f, pivot = Offset.Zero) }) { drawPath(lit, SAND) }
        }
        /* The near land, its ridge in brush, and the mosque on it. */
        val nearCount = kotlin.math.max(5, (w / 100.dp.toPx()).toInt())
        val nearPts = (0..nearCount).map { i -> Offset(-24f + (w + 48f) * i / nearCount, base - between(-3.dp.toPx(), 3.dp.toPx())) }
        drawPath(quadLand(nearPts, h + 24f), c.near)
        val ridge = Path().apply { nearPts.forEachIndexed { i, p -> if (i == 0) moveTo(p.x, p.y) else lineTo(p.x, p.y) } }
        drawPath(app.kimono.ui.inkBrush(ridge, app.kimono.ui.InkRandom(5), 2.2.dp.toPx(), closed = false, lift = 140.dp.toPx()..260.dp.toPx(), gap = 6.dp.toPx()..12.dp.toPx()), c.shade.copy(alpha = .55f))
        val ms = .62f * density
        val mosqueAt = Offset(w * .66f, base + 2.dp.toPx())
        withTransform({ translate(mosqueAt.x, mosqueAt.y); scale(ms, ms, pivot = Offset.Zero) }) {
            drawPath(mosque, c.mosque)
            drawPath(finial, c.mosque, style = Stroke(2f))
            drawPath(lamps, if (lampLit) Color(0xFFF0B95C) else app.kimono.ui.mix(c.shade, c.sky, .55f))
        }
        /* Where the arc starts and ends. */
        val edge = label.copy(color = c.ink.copy(alpha = .74f))
        val left = measurer.measure("${if (daytime) "Sunrise" else "Maghrib"} ${Presentation.clock(ScheduleBuilder.time(from, view.timezone), h24)}", edge)
        val right = measurer.measure("${if (daytime) "Maghrib" else "Sunrise"} ${Presentation.clock(ScheduleBuilder.time(to, view.timezone), h24)}", edge)
        drawText(left, topLeft = Offset(pad, base + 14.dp.toPx()))
        drawText(right, topLeft = Offset(w - pad - right.size.width, base + 14.dp.toPx()))
        /* Reading the time along the arc, under a finger. */
        scrub?.let { x ->
            val p = arc(x)
            drawLine(c.ink.copy(alpha = .5f), p + Offset(0f, 6.dp.toPx()), Offset(p.x, base), 1.5.dp.toPx(), StrokeCap.Round)
            drawCircle(c.ink, 4.5.dp.toPx(), p)
            val at = from + (to - from) * x.toDouble()
            val text = measurer.measure(Presentation.clock(ScheduleBuilder.time(at, view.timezone), h24), label.copy(color = c.ink, fontWeight = FontWeight.Bold))
            drawText(text, topLeft = Offset((p.x - text.size.width / 2).coerceIn(4f, w - text.size.width - 4f), kotlin.math.max(4f, p.y - 14.dp.toPx() - text.size.height)))
        }
    }
}

/* ───── today's prayers ───── */

/* Each prayer's puddle takes the colour of its sky. */
private val tints = mapOf("Fajr" to Color(0xFF7D74B3), "Dhuhr" to Color(0xFFD9A441), "Asr" to Color(0xFFDD8A45), "Maghrib" to Color(0xFFB8506B))

@Composable
private fun PrayerCard(view: ScheduleView, h24: Boolean, iqama: Boolean) {
    val later = Presentation.nextSummary(view, h24)
    Column(Modifier.padding(horizontal = 12.dp).fillMaxWidth().clip(RoundedCornerShape(28.dp)).background(MaterialTheme.colorScheme.surfaceContainer).padding(8.dp)) {
        Presentation.displayPrayers(view).forEach { PrayerRow(it, view, h24, iqama) }
        if (view.jumua.isNotEmpty()) {
            Box(Modifier.fillMaxWidth().padding(horizontal = 6.dp).height(1.dp).background(MaterialTheme.colorScheme.outlineVariant))
            Row(Modifier.fillMaxWidth().heightIn(min = 64.dp).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                app.kimono.ui.InkBlot("jumua", tint = MaterialTheme.colorScheme.primary, size = 44.dp) { Glyph(Glyphs.dome, app.kimono.ui.InkPlum, 22.dp) }
                Text("Jumu'a", style = MaterialTheme.typography.headlineSmall, color = MaterialTheme.colorScheme.onSurface, modifier = Modifier.weight(1f))
                view.jumua.forEach { Text(Presentation.clock(it, h24), style = MaterialTheme.typography.titleLarge.copy(fontFeatureSettings = "tnum"), color = MaterialTheme.colorScheme.onSurface) }
            }
        }
        if (later.isNotEmpty()) Text(later, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(10.dp))
    }
}

/** A plate the countdown is stamped on: squared, inked in the accent. */
@Composable
private fun Plate(text: String) {
    Text(text, style = MaterialTheme.typography.labelMedium.copy(fontFeatureSettings = "tnum"), fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onPrimary,
        modifier = Modifier.clip(RoundedCornerShape(8.dp)).background(MaterialTheme.colorScheme.primary).padding(horizontal = 9.dp, vertical = 3.dp))
}

@Composable
private fun PrayerRow(prayer: Prayer, view: ScheduleView, h24: Boolean, iqama: Boolean) {
    val current = prayer.id == view.current?.id
    val next = prayer.id == view.next?.id
    val past = prayer.end?.let { it <= view.now } ?: false
    val accent = MaterialTheme.colorScheme.primary
    val words = if (current) Presentation.currentDetail(prayer, view, h24, iqama) else Presentation.prayerDetail(prayer, view, h24)
    val ring = remember(prayer.id) { app.kimono.ui.InkRandom(app.kimono.ui.inkSeed(prayer.id)) }
    Row(
        Modifier.fillMaxWidth().alpha(if (past && !current) .48f else 1f).clip(RoundedCornerShape(20.dp))
            .background(if (current) accent.copy(alpha = .12f) else Color.Transparent)
            .drawWithContent {
                drawContent()
                /* The open prayer is ringed in brush, as the web inks its card. */
                if (current) {
                    val inset = 2.dp.toPx()
                    val outline = Path().apply { addRoundRect(androidx.compose.ui.geometry.RoundRect(inset, inset, size.width - inset, size.height - inset, androidx.compose.ui.geometry.CornerRadius(18.dp.toPx()))) }
                    drawPath(app.kimono.ui.inkBrush(outline, app.kimono.ui.InkRandom(ring.hashCode()), 2.2.dp.toPx(), closed = true, lift = 90.dp.toPx()..200.dp.toPx(), gap = 4.dp.toPx()..10.dp.toPx()), accent)
                }
            }
            .heightIn(min = 76.dp).padding(start = 12.dp, end = 16.dp, top = 10.dp, bottom = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        app.kimono.ui.InkBlot(prayer.name, tint = tints[prayer.name] ?: accent, size = 44.dp) { Glyph(Glyphs.of(prayer.name), app.kimono.ui.InkPlum, 22.dp) }
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(prayer.name, style = MaterialTheme.typography.headlineSmall, color = MaterialTheme.colorScheme.onSurface)
            when {
                next -> Plate(words)
                words.isNotEmpty() -> Text(words, style = MaterialTheme.typography.bodyMedium, fontWeight = if (current) FontWeight.SemiBold else FontWeight.Normal, color = if (current) accent else MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        Column(horizontalAlignment = Alignment.End) {
            Text(Presentation.clock(prayer.time, h24), style = MaterialTheme.typography.headlineMedium.copy(fontFeatureSettings = "tnum"), color = MaterialTheme.colorScheme.onSurface)
            val at = prayer.iqama
            if (iqama && at != null) {
                val style = MaterialTheme.typography.labelMedium.copy(fontFeatureSettings = "tnum")
                val dim = MaterialTheme.colorScheme.onSurfaceVariant
                val after = prayer.iqamaAfter
                if (after == null) Text("Iqama ${Presentation.clock(at, h24)}", style = style, color = dim)
                /* Set as minutes after the adhan: "+10", and the time itself on a long press. */
                else TooltipBox(
                    positionProvider = TooltipDefaults.rememberTooltipPositionProvider(TooltipAnchorPosition.Above),
                    tooltip = { PlainTooltip { Text("Iqama at ${Presentation.clock(at, h24)}") } },
                    state = rememberTooltipState(),
                ) { Text("Iqama +$after", style = style, color = dim, modifier = Modifier.semantics { contentDescription = "Iqama at ${Presentation.clock(at, h24)}" }) }
            }
        }
    }
}

/* ───── night & sunrise ───── */

@Composable
private fun NightTiles(view: ScheduleView, h24: Boolean) {
    val m = view.milestones
    Column(Modifier.padding(horizontal = 12.dp)) {
        Text("Night & sunrise", style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(start = 8.dp, bottom = 10.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf(Triple("Islamic midnight", m.midnight, NightPhase.Midnight), Triple("Last third", m.lastThird, NightPhase.LastThird), Triple("Sunrise", m.sunrise, NightPhase.Sunrise)).forEach { (name, at, phase) ->
                val on = m.phase == phase
                val ink = if (on) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant
                Column(
                    Modifier.weight(1f).clip(RoundedCornerShape(24.dp))
                        .background(if (on) MaterialTheme.colorScheme.primary.copy(alpha = .12f) else MaterialTheme.colorScheme.surfaceContainer)
                        .padding(start = 14.dp, end = 10.dp, top = 14.dp, bottom = 16.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    Glyph(when (phase) { NightPhase.Midnight -> Glyphs.midnight; NightPhase.LastThird -> Glyphs.lastThird; else -> Glyphs.sunrise }, ink, 22.dp)
                    Text(name, style = MaterialTheme.typography.labelLarge, color = ink, minLines = 2, modifier = Modifier.padding(top = 4.dp))
                    Text(Presentation.clock(ScheduleBuilder.time(at, view.timezone), h24), style = MaterialTheme.typography.titleLarge.copy(fontFeatureSettings = "tnum"), color = MaterialTheme.colorScheme.onSurface)
                    when {
                        on -> Plate("in ${Presentation.remaining(at, view.now)}")
                        m.active && at <= view.now -> Text("Passed", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
    }
}

/* ───── settings ───── */

@Composable
private fun SettingsSheet(platform: Platform, mode: TitleMode, iqama: Boolean, onMode: (TitleMode) -> Unit, onIqama: (Boolean) -> Unit, done: () -> Unit) {
    val scope = rememberCoroutineScope()
    InkSheet(onDismissRequest = done, seed = "times-settings") {
        Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(bottom = 24.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            InkTitle("Settings", "gear")
            SettingRow("Counts") {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    listOf(TitleMode.NextPrayer to "Next prayer", TitleMode.TimeLeft to "Time left").forEach { (m, label) -> Pick(label, mode == m) { onMode(m) } }
                }
            }
            SettingRow("Iqama times") {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) { Pick("Show", iqama) { onIqama(true) }; Pick("Hide", !iqama) { onIqama(false) } }
            }
        }
    }
}

@Composable
private fun SettingRow(name: String, content: @Composable () -> Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(name, style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onSurface, modifier = Modifier.weight(1f))
        content()
    }
}

/** Two plates side by side; the chosen one is inked. */
@Composable
private fun Pick(label: String, on: Boolean, onClick: () -> Unit) {
    Text(label, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold,
        color = if (on) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.clip(RoundedCornerShape(10.dp)).background(if (on) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceContainerHighest)
            .clickable(onClick = onClick).padding(horizontal = 14.dp, vertical = 10.dp))
}


@Composable
private fun Unplaced(problem: String?, choose: () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 40.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
        InkBloom(Prayers.APP_ID, Prayers.ACCENT, "crescent", 96.dp)
        Text("Where do you pray?", style = MaterialTheme.typography.headlineSmall, color = MaterialTheme.colorScheme.onSurface)
        Problem(problem)
        Seal("Choose your place", onClick = choose)
    }
}

/** Changing your place: a mosque by name or link, where you are, or one you had before. */
@Composable
private fun PlaceSheet(prayers: Prayers, platform: Platform, mine: PrayerMine?, done: () -> Unit) {
    val scope = rememberCoroutineScope()
    var query by remember { mutableStateOf("") }
    var found by remember { mutableStateOf<List<PrayerPlace>?>(null) }
    var looking by remember { mutableStateOf(false) }
    var locating by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }
    var picking by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(query) {
        val q = query.trim()
        if (q.length < 2) { if (!locating) found = null; return@LaunchedEffect }
        delay(400)
        looking = true
        try { found = prayers.search(q); problem = null } catch (p: KimonoProblem) { problem = p.message }
        looking = false
    }
    fun pick(place: PrayerPlace) {
        picking = place.id
        scope.launch {
            try { prayers.choose(place.id); done() } catch (p: KimonoProblem) { problem = p.message }
            picking = null
        }
    }
    InkSheet(onDismissRequest = done, seed = "prayer-place") {
        Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(bottom = 20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            InkTitle("Your place", "lk-pin")
            Surface(shape = RoundedCornerShape(28.dp), color = MaterialTheme.colorScheme.surfaceContainerHigh, modifier = Modifier.fillMaxWidth().height(56.dp)) {
                Row(Modifier.padding(horizontal = 18.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(kimonoIcon("search"), null, Modifier.size(20.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                    BasicTextField(query, { query = it }, singleLine = true, cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                        textStyle = TextStyle(color = MaterialTheme.colorScheme.onSurface, fontSize = 17.sp),
                        modifier = Modifier.weight(1f).padding(horizontal = 12.dp),
                        decorationBox = { inner -> Box { if (query.isEmpty()) Text("Mosque name or link", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 17.sp); inner() } })
                    if (looking) InkLoader(size = 26.dp)
                }
            }
            Seal("Use where I am", icon = "lk-pin", tone = SealTone.Quiet, busy = locating, modifier = Modifier.fillMaxWidth(), onClick = {
                locating = true
                problem = null
                scope.launch {
                    try {
                        val at = platform.whereAmI()
                        if (at == null) problem = "Your phone didn't say where you are."
                        else { query = ""; found = prayers.near(at.lat, at.lon, TimeZone.currentSystemDefault().id) }
                    } catch (p: KimonoProblem) { problem = p.message }
                    locating = false
                }
            })
            Problem(problem)
            val list = found
            if (list != null) {
                if (list.isEmpty() && !looking) Text("Not added here yet. Paste its Mawaqit or MasjidBox link.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                PlaceList(list, mine?.place?.id, picking, ::pick)
                if (list.isNotEmpty()) Text("Mosques from © OpenStreetMap", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            } else if (mine?.recent.orEmpty().isNotEmpty()) {
                Text("Recent", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(top = 4.dp))
                PlaceList(mine!!.recent, mine.place?.id, picking, ::pick, forget = { place -> scope.launch { try { prayers.forget(place.id) } catch (p: KimonoProblem) { problem = p.message } } })
            }
        }
    }
}

@Composable
private fun PlaceList(places: List<PrayerPlace>, chosen: String?, picking: String?, pick: (PrayerPlace) -> Unit, forget: ((PrayerPlace) -> Unit)? = null) {
    Column(Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        places.forEach { place ->
            HoldMenu(if (forget != null && place.id != chosen) listOf(MenuChoice("Forget", danger = true) { forget(place) }) else emptyList(), onClick = { pick(place) },
                modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp))) {
                Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Box(Modifier.size(36.dp).clip(CircleShape).background(MaterialTheme.colorScheme.secondaryContainer), contentAlignment = Alignment.Center) {
                        Icon(kimonoIcon(if (place.kind == "calculated") "globe" else "lk-pin"), null, tint = MaterialTheme.colorScheme.onSecondaryContainer, modifier = Modifier.size(18.dp))
                    }
                    Column(Modifier.weight(1f)) {
                        Text(place.name, style = MaterialTheme.typography.bodyLarge, fontWeight = if (place.id == chosen) FontWeight.Bold else FontWeight.Normal, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        place.detail?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                    }
                    when {
                        picking == place.id -> InkLoader(size = 24.dp)
                        place.id == chosen -> Icon(kimonoIcon("check"), null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(20.dp))
                    }
                }
            }
        }
    }
}
