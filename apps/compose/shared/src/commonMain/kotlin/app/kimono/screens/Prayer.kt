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
import app.kimono.theme.plumInk
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

/** Prayer in the phone's own colours where it has them (Material You), as its widgets are; else in its accent. */
@OptIn(androidx.compose.material3.ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun PrayerTheme(platform: Platform, accent: String, content: @Composable () -> Unit) {
    val scheme = platform.dynamicColors(app.kimono.theme.LocalNight.current) ?: return app.kimono.ui.AppAccentTheme(accent, content)
    androidx.compose.material3.MaterialExpressiveTheme(colorScheme = scheme, typography = MaterialTheme.typography, shapes = MaterialTheme.shapes, motionScheme = androidx.compose.material3.MotionScheme.expressive()) {
        androidx.compose.runtime.CompositionLocalProvider(app.kimono.ui.LocalInkTint provides scheme.primary, content = content)
    }
}

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
    var choosing by remember { mutableStateOf(false) }
    var mode by remember { mutableStateOf(TitleMode.NextPrayer) }
    LaunchedEffect(Unit) { if (platform.readKept(TITLE_KEY) == "left") mode = TitleMode.TimeLeft }
    val now = minuteNow()
    val h24 = platform.clock24
    val view = remember(mine?.timetable, now) { mine?.timetable?.let { ScheduleBuilder.build(it, now) } }

    Scaffold(containerColor = MaterialTheme.colorScheme.surface) { pad ->
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(top = pad.calculateTopPadding() + 8.dp, bottom = 40.dp)) {
            item {
                Column(Modifier.padding(horizontal = 20.dp)) {
                    Text("Times", style = MaterialTheme.typography.displaySmall, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 12.dp, bottom = 10.dp))
                    PlaceLine(mine?.place, onClick = { choosing = true })
                }
            }
            when {
                view != null -> {
                    item {
                        Hero(view, mode, h24) {
                            mode = if (mode == TitleMode.NextPrayer) TitleMode.TimeLeft else TitleMode.NextPrayer
                            scope.launch { platform.keep(TITLE_KEY, if (mode == TitleMode.TimeLeft) "left" else null) }
                        }
                    }
                    item { Problem(problem?.takeIf { it != app.kimono.data.OFFLINE }) }
                    item { Heading("Today") }
                    item { PrayerRows(view, h24) }
                    item { Heading("Night & sunrise") }
                    item { NightRows(view, h24) }
                }
                mine == null && problem == null -> item { Box(Modifier.fillMaxWidth().padding(64.dp), contentAlignment = Alignment.Center) { InkLoader(size = 48.dp) } }
                mine?.place == null -> item { Unplaced(problem) { choosing = true } }
                else -> item {
                    Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text(problem ?: "No times for today yet.", style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Seal("Try again", compact = true, tone = SealTone.Quiet, onClick = { scope.launch { runCatching { prayers.load() } } })
                    }
                }
            }
        }
    }
    if (choosing) PlaceSheet(prayers, platform, mine) { choosing = false }
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

@Composable
private fun PlaceLine(place: PrayerPlace?, onClick: () -> Unit) {
    Surface(onClick = onClick, shape = RoundedCornerShape(20.dp), color = MaterialTheme.colorScheme.surfaceContainer) {
        Row(Modifier.padding(start = 14.dp, end = 10.dp, top = 10.dp, bottom = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Icon(kimonoIcon("lk-pin"), null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(18.dp))
            Column(Modifier.weight(1f, fill = false)) {
                Text(place?.name ?: "Choose your place", style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                place?.detail?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis) }
            }
            Icon(kimonoIcon("down"), "Change", tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(18.dp))
        }
    }
}

@Composable
private fun Heading(text: String) {
    Text(text, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(start = 24.dp, top = 24.dp, bottom = 8.dp))
}

/** The countdown, written over the day's sky; a tap switches what it counts. */
@Composable
private fun Hero(view: ScheduleView, mode: TitleMode, h24: Boolean, toggle: () -> Unit) {
    val (what, howLong) = Presentation.titleParts(view, mode)
    Column(
        Modifier.fillMaxWidth().padding(top = 16.dp).clickable(onClickLabel = "Switch countdown", onClick = toggle),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Sky(view, Modifier.fillMaxWidth().height(150.dp).padding(horizontal = 20.dp))
        Text(what, style = MaterialTheme.typography.displayMedium, color = plumInk, maxLines = 1, modifier = Modifier.padding(top = 4.dp))
        Text(howLong, style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.primary, maxLines = 1)
        val date = view.date
        val dateText = "${date.dayOfWeek.name.lowercase().replaceFirstChar(Char::uppercase)}, ${date.day} ${date.month.name.lowercase().replaceFirstChar(Char::uppercase)}"
        Text(listOf(dateText, Presentation.nextSummary(view, h24)).filter { it.isNotEmpty() }.joinToString(" · "),
            style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 12.dp))
    }
}

/**
 * The day's sky in ink: the horizon, the sun's arc over it from sunrise to
 * Maghrib with Dhuhr at its height and Asr on its way down, the night's arc
 * under it to the next Fajr, and where we are now on one or the other: the
 * sun by day, the crescent by night.
 */
@Composable
private fun Sky(view: ScheduleView, modifier: Modifier) {
    val today = view.today
    val sunrise = today[1].start
    val maghrib = today[4].start
    val nightEnd = view.milestones.sunrise.takeIf { view.now >= maghrib || view.now < sunrise } ?: view.night.end
    val day = view.now in sunrise..<maghrib
    /* Where on its arc: 0 at the left, 1 at the right. */
    fun along(from: Instant, to: Instant, at: Instant) = ((at - from) / (to - from)).toFloat().coerceIn(0f, 1f)
    val nightFrom = if (view.now < sunrise) view.night.start else maghrib
    val target = if (day) along(sunrise, maghrib, view.now) else along(nightFrom, if (view.now < sunrise) sunrise else nightEnd, view.now)
    val t by animateFloatAsState(target, tween(900))
    val ink = plumInk
    val accent = MaterialTheme.colorScheme.primary
    val soft = MaterialTheme.colorScheme.outlineVariant
    val paper = MaterialTheme.colorScheme.surface
    val marks = listOf(today[2], today[3]).map { along(sunrise, maghrib, it.start) }
    Canvas(modifier) {
        val w = size.width
        val pad = 20.dp.toPx()
        val horizon = size.height * .66f
        val rise = horizon - pad
        val dip = size.height - horizon - pad * .6f
        val inset = 16.dp.toPx()
        fun x(f: Float) = inset + (w - 2 * inset) * f
        fun up(f: Float) = Offset(x(f), horizon - rise * kotlin.math.sin(f * kotlin.math.PI).toFloat())
        fun down(f: Float) = Offset(x(f), horizon + dip * kotlin.math.sin(f * kotlin.math.PI).toFloat())
        fun arc(point: (Float) -> Offset) = Path().apply { (0..48).forEach { i -> val p = point(i / 48f); if (i == 0) moveTo(p.x, p.y) else lineTo(p.x, p.y) } }
        drawPath(arc(::down), soft, style = Stroke(2.dp.toPx(), cap = StrokeCap.Round, pathEffect = PathEffect.dashPathEffect(floatArrayOf(2.dp.toPx(), 7.dp.toPx()))))
        drawPath(arc(::up), soft, style = Stroke(2.dp.toPx(), cap = StrokeCap.Round))
        /* The part of today's arc already travelled, inked. */
        if (day) drawPath(Path().apply { (0..48).forEach { i -> val p = up(i / 48f * t); if (i == 0) moveTo(p.x, p.y) else lineTo(p.x, p.y) } }, accent.copy(alpha = .55f), style = Stroke(3.dp.toPx(), cap = StrokeCap.Round))
        drawLine(ink.copy(alpha = .5f), Offset(0f, horizon), Offset(w, horizon), 1.5.dp.toPx(), StrokeCap.Round)
        marks.forEach { f -> val p = up(f); drawCircle(paper, 5.dp.toPx(), p); drawCircle(ink.copy(alpha = .55f), 5.dp.toPx(), p, style = Stroke(1.5.dp.toPx())) }
        val at = if (day) up(t) else down(t)
        if (day) {
            drawCircle(accent.copy(alpha = .18f), 18.dp.toPx(), at)
            drawCircle(accent, 10.dp.toPx(), at)
        } else crescent(at, 11.dp.toPx(), accent, paper)
    }
}

private fun DrawScope.crescent(at: Offset, r: Float, ink: Color, paper: Color) {
    drawCircle(ink.copy(alpha = .16f), r * 1.7f, at)
    drawCircle(ink, r, at)
    drawCircle(paper, r * .82f, at + Offset(r * .45f, -r * .25f))
}

/** A prayer's little sky: the sun at its height over a horizon, the crescent for Fajr and Isha. */
@Composable
private fun PrayerMark(name: String, colour: Color) {
    val paper = MaterialTheme.colorScheme.surface
    Canvas(Modifier.size(22.dp)) {
        val s = size.width
        when (name) {
            "Fajr", "Isha" -> crescent(Offset(s * .48f, s * .5f), s * .3f, colour, paper)
            else -> {
                val height = when (name) { "Dhuhr" -> .28f; "Asr" -> .5f; else -> .74f }
                drawLine(colour.copy(alpha = .6f), Offset(s * .08f, s * .82f), Offset(s * .92f, s * .82f), s * .08f, StrokeCap.Round)
                drawCircle(colour, s * .19f, Offset(s * .5f, s * height))
            }
        }
    }
}

@Composable
private fun PrayerRows(view: ScheduleView, h24: Boolean) {
    Column(Modifier.padding(horizontal = 12.dp)) {
        Presentation.displayPrayers(view).forEach { prayer ->
            PrayerRow(prayer, view, h24)
            if (prayer.name == "Dhuhr" && view.jumua.isNotEmpty()) {
                Row(Modifier.fillMaxWidth().padding(start = 48.dp, end = 12.dp, bottom = 6.dp)) {
                    Text("Jumu'a", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
                    Text(view.jumua.joinToString(" · ") { Presentation.clock(it, h24) }, style = MaterialTheme.typography.bodySmall.copy(fontFeatureSettings = "tnum"), color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
}

@Composable
private fun PrayerRow(prayer: Prayer, view: ScheduleView, h24: Boolean) {
    val current = prayer.id == view.current?.id
    val next = prayer.id == view.next?.id
    val past = prayer.end?.let { it <= view.now } ?: false
    val strong = MaterialTheme.colorScheme.onSurface
    val dim = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = .7f)
    val ink = if (past) dim else strong
    val accent = MaterialTheme.colorScheme.primary
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp))
            .background(if (current) accent.copy(alpha = .1f) else Color.Transparent)
            .heightIn(min = 56.dp).padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        PrayerMark(prayer.name, if (current) accent else if (past) dim else MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Text(prayer.name, style = MaterialTheme.typography.bodyLarge, fontWeight = if (current || next) FontWeight.Bold else FontWeight.Normal, color = ink)
            if (current) Text(Presentation.currentDetail(prayer, view, h24), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        when {
            next -> Surface(shape = RoundedCornerShape(10.dp), color = MaterialTheme.colorScheme.secondaryContainer) {
                Text(Presentation.prayerDetail(prayer, view, h24), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSecondaryContainer, modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp))
            }
            !current -> Text(Presentation.prayerDetail(prayer, view, h24), style = MaterialTheme.typography.bodySmall, color = dim)
        }
        Spacer(Modifier.width(12.dp))
        Column(horizontalAlignment = Alignment.End) {
            Text(Presentation.clock(prayer.time, h24), style = MaterialTheme.typography.titleMedium.copy(fontFeatureSettings = "tnum"), color = ink)
            prayer.iqama?.let { at ->
                val style = MaterialTheme.typography.labelSmall.copy(fontFeatureSettings = "tnum")
                val after = prayer.iqamaAfter
                if (after == null) Text(Presentation.clock(at, h24), style = style, color = dim)
                /* Set as minutes after the adhan: "+10", and the time itself on a long press. */
                else TooltipBox(
                    positionProvider = TooltipDefaults.rememberTooltipPositionProvider(TooltipAnchorPosition.Above),
                    tooltip = { PlainTooltip { Text("Iqama at ${Presentation.clock(at, h24)}") } },
                    state = rememberTooltipState(),
                ) { Text("+$after", style = style, color = dim, modifier = Modifier.semantics { contentDescription = "Iqama at ${Presentation.clock(at, h24)}" }) }
            }
        }
    }
}

@Composable
private fun NightRows(view: ScheduleView, h24: Boolean) {
    val m = view.milestones
    Column(Modifier.padding(horizontal = 24.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        listOf(Triple("Islamic midnight", m.midnight, NightPhase.Midnight), Triple("Last third", m.lastThird, NightPhase.LastThird), Triple("Sunrise", m.sunrise, NightPhase.Sunrise)).forEach { (title, at, phase) ->
            val selected = m.phase == phase
            val detail = Presentation.milestoneDetail(phase, at, view)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(title, style = MaterialTheme.typography.bodyMedium, fontWeight = if (selected) FontWeight.Bold else FontWeight.Normal,
                    color = if (selected) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
                detail?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(end = 12.dp)) }
                Text(Presentation.clock(ScheduleBuilder.time(at, view.timezone), h24), style = MaterialTheme.typography.bodyMedium.copy(fontFeatureSettings = "tnum"),
                    fontWeight = if (selected) FontWeight.Bold else FontWeight.Normal, color = if (selected) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun Unplaced(problem: String?, choose: () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 40.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
        InkBloom(Prayers.APP_ID, Prayers.ACCENT, "crescent", 96.dp)
        Text("Where do you pray?", style = MaterialTheme.typography.headlineSmall, color = plumInk)
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
