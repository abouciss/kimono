package app.kimono.screens

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.GenericShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.PathOperation
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.layout
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import io.ktor.http.encodeURLQueryComponent
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.kimono.data.Book
import app.kimono.data.FriendPerson
import app.kimono.data.MusicExtras
import app.kimono.data.ProfileLink
import app.kimono.data.ProfileSection
import app.kimono.data.BooksExtras
import app.kimono.data.Widget
import app.kimono.theme.Kata
import app.kimono.ui.Portrait
import app.kimono.ui.clickable
import app.kimono.ui.kimonoIcon
import app.kimono.ui.nowMs
import app.kimono.ui.zoneOffsetMinutes
import coil3.compose.AsyncImage
import coil3.compose.SubcomposeAsyncImage
import kotlinx.coroutines.delay
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlin.math.sin

/*
 * 庭 A profile's widgets, each a drawn thing you could pick up: the record
 * turning while they listen, the book on the go in 3D, a little television
 * switched on to the show, a cinema ticket, an ink clock keeping their time,
 * a note under tape, spines on a shelf. The website's are the reference
 * (apps/portal/src/app/(shell)/account/friends/widgets.tsx); the only
 * gradients are the objects' own (grooves, glass, a spine's curve).
 */

/** Everything a board draws from: who it is, what they do, and what you can open from it. */
class BoardData(
    val person: FriendPerson,
    val sections: List<ProfileSection>,
    val links: List<ProfileLink>,
    val friends: List<FriendPerson>,
    val music: MusicExtras?,
    val books: BooksExtras?,
    val color: Color,
    /** Your own profile, not seen as a friend: friend requests waiting, and whether friends see your friends. */
    val own: OwnBoard? = null,
    val server: String? = null,
)

class OwnBoard(val asking: Int, val kept: Boolean)

/** Where a widget's taps go. */
class BoardActions(
    val openBook: (String) -> Unit = {},
    /** A page on this Kimono ("/watch?t=…", "/music/song/…"). */
    val openWeb: (String) -> Unit = {},
    val openUrl: (String) -> Unit = {},
    val openPerson: (String) -> Unit = {},
    val openFriends: () -> Unit = {},
    val editLinks: (() -> Unit)? = null,
)

/** Whether things on the board hold still (reduced motion, or a preview in the gallery). */
val LocalStill = staticCompositionLocalOf { false }

internal fun FriendPerson.firstName() = name.ifBlank { username }.substringBefore(' ')
internal fun BoardData.item(app: String, kind: String) = sections.firstOrNull { it.app == app && it.kind == kind }?.items?.firstOrNull()
internal fun BoardData.items(app: String, kind: String) = sections.firstOrNull { it.app == app && it.kind == kind }?.items.orEmpty()
/** A cover kept by its path on this Kimono (Watch's posters) is fetched from it. */
internal fun BoardData.pic(url: String?): String? = url?.takeIf { it.isNotBlank() }?.let { if (it.startsWith("/") && server != null) server.trimEnd('/') + it else it }
/** Music's covers come in one size: ask for a sharper one. */
internal fun sharp(url: String?) = url?.replace(Regex("/(\\d{2,4})x\\1-"), "/500x500-")
private fun songPath(key: String) = "/music/song/${key.removePrefix("dz:")}"
private fun albumPath(key: String) = "/music/album/${key.removePrefix("dz:")}"
private fun watchPath(id: String) = "/watch?t=${id.encodeURLQueryComponent()}"
private fun plays(n: Int) = if (n == 1) "1 play" else "$n plays"

private val Mincho @Composable get() = MaterialTheme.typography.headlineSmall.fontFamily

/* ── The pieces every widget is made of ───────────────────────────────── */

/** A widget's card: a tonal sheet, rounded as M3 rounds its containers. */
@Composable
internal fun Card(modifier: Modifier = Modifier, color: Color = MaterialTheme.colorScheme.surfaceContainerLow, onClick: (() -> Unit)? = null, content: @Composable () -> Unit) {
    Box(
        modifier.fillMaxSize().clip(RoundedCornerShape(28.dp)).background(color)
            .then(if (onClick != null && !LocalArranging.current) Modifier.clickable(onClick = onClick) else Modifier),
    ) { content() }
}

@Composable
internal fun Kicker(text: String, color: Color = LocalBoardColor.current, live: Boolean = false) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        if (live) LiveDot()
        Text(text, style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Bold), color = color, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** Live things are moss, breathing. */
@Composable
internal fun LiveDot() {
    val still = LocalStill.current
    val pulse = if (still) null else rememberInfiniteTransition(label = "live").animateFloat(1f, .35f, infiniteRepeatable(tween(900), RepeatMode.Reverse), label = "pulse")
    Box(Modifier.size(8.dp).graphicsLayer { alpha = pulse?.value ?: 1f }.clip(CircleShape).background(Kata.moss))
}

@Composable
internal fun Title(text: String, big: Boolean = false, color: Color = MaterialTheme.colorScheme.onSurface, lines: Int = 2, align: TextAlign? = null) {
    Text(text, style = (if (big) MaterialTheme.typography.headlineSmall else MaterialTheme.typography.titleLarge).copy(fontFamily = Mincho, fontSize = if (big) 22.sp else 17.sp, lineHeight = if (big) 27.sp else 21.sp), color = color, maxLines = lines, overflow = TextOverflow.Ellipsis, textAlign = align)
}

@Composable
internal fun Sub(text: String, color: Color = MaterialTheme.colorScheme.onSurfaceVariant, align: TextAlign? = null) {
    Text(text, style = MaterialTheme.typography.bodyMedium, color = color, maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = align)
}

@Composable
internal fun Empty(icon: String, text: String) {
    Column(Modifier.fillMaxSize().padding(14.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterVertically)) {
        Icon(kimonoIcon(icon), null, tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = .6f), modifier = Modifier.size(26.dp))
        Text(text, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
    }
}

/** A widget's object and its words: side by side when wide, stacked when small or large. */
@Composable
internal fun Laid(size: String, art: @Composable () -> Unit, words: (@Composable ColumnScope.() -> Unit)?) {
    if (size == "m") Row(Modifier.fillMaxSize().padding(14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        art()
        if (words != null) Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp), content = words)
    } else Column(Modifier.fillMaxSize().padding(14.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp, Alignment.CenterVertically)) {
        art()
        if (words != null && size != "s") Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(2.dp), content = words)
    }
}

/** A number that counts up to itself when it arrives. */
@Composable
internal fun CountUp(to: Double, decimals: Int = 0, style: androidx.compose.ui.text.TextStyle, color: Color) {
    val still = LocalStill.current
    val shown = remember(to) { Animatable(if (still) to.toFloat() else 0f) }
    LaunchedEffect(to) { if (!still) shown.animateTo(to.toFloat(), tween(900, easing = { 1 - (1 - it).pow(3) })) }
    val v = shown.value
    Text(if (decimals == 0) v.roundToInt().toString() else ((v * 10).roundToInt() / 10.0).toString(), style = style, color = color, maxLines = 1)
}

/** Whether the board is being arranged: then a widget is something to move, not to open. */
val LocalArranging = staticCompositionLocalOf { false }

/** Each widget's colour: the profile's own. */
val LocalBoardColor = staticCompositionLocalOf { Kata.suo }

/* ── Every widget ─────────────────────────────────────────────────────── */

@Composable
fun WidgetView(w: Widget, d: BoardData, act: BoardActions) {
    when (w.kind) {
        "listening" -> Turntable(w, d, act)
        "song", "album" -> Favourite(w, d, act)
        "reading" -> Reading(w, d, act)
        "watching" -> Watching(w, d, act)
        "artists" -> Artists(w, d, act)
        "stats" -> Stats(w, d)
        "note" -> Note(w)
        "status" -> Status(w)
        "clock" -> Clock(w, d)
        "links" -> Links(w, d, act)
        "friends" -> FriendsWidget(w, d, act)
        "book" -> FavouriteBook(w, act)
        "show" -> FavouriteShow(w, d, act)
        "playlist" -> PlaylistWidget(w, d, act)
        "loved" -> Loved(w, d, act)
        "onrepeat" -> OnRepeatWidget(w, d, act)
        "review" -> Review(w, d, act)
        "bookshelf" -> Bookshelf(w, d, act)
        "yearbooks" -> YearInBooks(w, d)
        "watched" -> Watched(w, d, act)
        "countdown" -> Countdown(w)
        "quote" -> Quote(w)
        else -> Card { Empty("more", "") }
    }
}

/* ── The record ───────────────────────────────────────────────────────── */

@Composable
private fun Turntable(w: Widget, d: BoardData, act: BoardActions) {
    val l = d.music?.listening
    Card(onClick = l?.let { { act.openWeb(songPath(it.track.key)) } }) {
        BoxWithConstraints(Modifier.fillMaxSize()) {
            val disc = when (w.size) { "s" -> min(maxWidth.value, maxHeight.value) * .78f; "m" -> maxHeight.value - 28f; else -> min(maxWidth.value * .74f, maxHeight.value * .66f) }.dp
            Laid(w.size, { Record(d.pic(sharp(l?.track?.album?.cover)), l?.live == true, disc) }, if (l == null) ({ Sub("Nothing played yet", align = TextAlign.Center) }) else ({
                Kicker(if (l.live) "Listening now" else "Last listened · ${ago(l.at)}", live = l.live)
                Title(l.track.title, big = w.size == "l" || w.size == "xl", align = if (w.size == "m") null else TextAlign.Center)
                Sub(l.track.by, align = if (w.size == "m") null else TextAlign.Center)
                if (w.size == "xl") l.track.album?.let { Sub(it.title, align = TextAlign.Center) }
            }))
        }
    }
}

/**
 * The record itself: grooves in the dark, the album for its label, a light
 * that stays put while it turns. Playing, it spins up and keeps turning;
 * stopped, it slows and comes to rest.
 */
@Composable
internal fun Record(cover: String?, live: Boolean, size: Dp, label: Color = LocalBoardColor.current) {
    val still = LocalStill.current
    val angle = remember { Animatable(0f) }
    LaunchedEffect(live, still) {
        if (still) return@LaunchedEffect
        if (live) {
            angle.animateTo(angle.value + 360f, tween(1200, easing = { it * it }))
            while (true) angle.animateTo(angle.value + 360f, tween(1800, easing = LinearEasing))
        } else angle.animateTo(angle.value + 540f, tween(2400, easing = { 1 - (1 - it).pow(3) }))
    }
    Box(Modifier.size(size).shadow(18.dp, CircleShape, ambientColor = Color.Black, spotColor = Color.Black), contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize()) {
            val r = this.size.minDimension / 2
            drawCircle(Color(0xFF0D0B09), r)
            /* The grooves: rings close together, a shade apart. */
            var g = r * .34f
            var odd = false
            while (g < r * .97f) { drawCircle(if (odd) Color(0xFF1D1915) else Color(0xFF120F0C), g, style = Stroke(1.3f)); g += 2.6f; odd = !odd }
            drawCircle(Color(0xFF2B251F), r - 1f, style = Stroke(2f))
            /* The light on the grooves: two soft spokes that don't turn. */
            drawCircle(Brush.sweepGradient(listOf(Color.Transparent, Color.White.copy(alpha = .16f), Color.Transparent, Color.Transparent, Color.White.copy(alpha = .1f), Color.Transparent, Color.Transparent), center), r)
        }
        Box(Modifier.size(size * .36f).graphicsLayer { rotationZ = angle.value }.clip(CircleShape).background(label).border(2.dp, Color.Black.copy(alpha = .45f), CircleShape)) {
            if (cover != null) AsyncImage(cover, null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
            /* A mark on the label, so the turning shows even without a cover. */
            Box(Modifier.align(Alignment.TopCenter).padding(top = size * .03f).size(size * .03f).clip(CircleShape).background(Color.White.copy(alpha = .55f)))
        }
        Box(Modifier.size(size * .05f).clip(CircleShape).background(Color(0xFFDDD6CA)))
    }
}

/* ── Favourites: a song's cover; an album's sleeve with its record peeking out ── */

@Composable
private fun Favourite(w: Widget, d: BoardData, act: BoardActions) {
    val c = w.config.orEmpty()
    val album = w.kind == "album"
    val times = if (!album) c["key"]?.let { d.music?.counts?.get(it) } ?: 0 else 0
    Card(onClick = c["key"]?.let { k -> { act.openWeb(if (album) albumPath(k) else songPath(k)) } }) {
        BoxWithConstraints(Modifier.fillMaxSize()) {
            val art = when (w.size) { "s" -> min(maxWidth.value, maxHeight.value) * .7f; "m" -> maxHeight.value - 28f; else -> min(maxWidth.value * .62f, maxHeight.value * .6f) }.dp
            Laid(w.size, {
                Box(Modifier.width(if (album) art * 1.18f else art).height(art), contentAlignment = Alignment.CenterStart) {
                    if (album) Box(Modifier.offset(x = art * .2f).size(art * .94f)) { Record(null, false, art * .94f) }
                    Cover(d.pic(sharp(c["cover"])), art, if (album) 4.dp else 16.dp, "music")
                }
            }) {
                Kicker(if (album) "Favourite album" else "Favourite song")
                Title(c["title"].orEmpty(), big = w.size != "m", align = if (w.size == "m") null else TextAlign.Center)
                c["subtitle"]?.takeIf { it.isNotBlank() }?.let { Sub(it, align = if (w.size == "m") null else TextAlign.Center) }
                if (times > 0) Row(Modifier.padding(top = 6.dp), verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                    CountUp(times.toDouble(), style = MaterialTheme.typography.headlineSmall.copy(fontFamily = Mincho), color = LocalBoardColor.current)
                    Text(if (times == 1) "play" else "plays", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(bottom = 3.dp))
                }
            }
        }
    }
}

/** A cover with a shadow under it, or the app's mark when there's none. */
@Composable
internal fun Cover(url: String?, size: Dp, corner: Dp, icon: String, modifier: Modifier = Modifier, height: Dp = size) {
    Box(
        modifier.width(size).height(height).shadow(10.dp, RoundedCornerShape(corner)).clip(RoundedCornerShape(corner)).background(MaterialTheme.colorScheme.surfaceContainerHigh),
        contentAlignment = Alignment.Center,
    ) {
        if (url != null) AsyncImage(url, null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
        else Icon(kimonoIcon(icon), null, tint = LocalBoardColor.current, modifier = Modifier.size(size * .3f))
    }
}

/* ── Reading: the book on the go, in 3D ───────────────────────────────── */

private fun book3d(key: String, title: String, author: String?, cover: String?) = Book(key = key, title = title, authors = author?.takeIf { it.isNotBlank() }?.let { listOf(it) } ?: emptyList(), cover = cover)

@Composable
private fun bookWidth(size: String, w: Float, h: Float): Dp = when (size) {
    "s" -> min(w * .46f, h * .5f)
    "m" -> min(w * .26f, (h - 28f) / 1.55f)
    else -> min(w * .4f, h * .38f)
}.dp

@Composable
private fun Reading(w: Widget, d: BoardData, act: BoardActions) {
    val b = d.item("books", "reading")
    if (b == null) return Card { Empty("book", "Not reading anything right now") }
    val author = b.subtitle?.substringBefore(" · ")?.trim()
    Card(onClick = { act.openBook(b.itemId) }) {
        BoxWithConstraints(Modifier.fillMaxSize()) {
            Laid(w.size, { Book3D(book3d(b.itemId, b.title, author, d.pic(b.cover)), bookWidth(w.size, maxWidth.value, maxHeight.value), still = true) }) {
                Kicker("Reading")
                Title(b.title, big = w.size != "m", align = if (w.size == "m") null else TextAlign.Center)
                author?.let { Sub(it, align = if (w.size == "m") null else TextAlign.Center) }
                b.progress?.takeIf { it > 0 }?.let { Progress(it.toFloat()) }
            }
        }
    }
}

@Composable
internal fun Progress(f: Float, track: Color = MaterialTheme.colorScheme.onSurface.copy(alpha = .14f), fill: Color = LocalBoardColor.current) {
    Row(Modifier.fillMaxWidth().padding(top = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Box(Modifier.weight(1f).height(4.dp).clip(RoundedCornerShape(2.dp)).background(track)) {
            Box(Modifier.fillMaxHeight().fillMaxWidth(f.coerceIn(0f, 1f)).clip(RoundedCornerShape(2.dp)).background(fill))
        }
        Text("${(f * 100).roundToInt()}%", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/* ── Watching: a little television, switched on to the show ──────────── */

@Composable
private fun Watching(w: Widget, d: BoardData, act: BoardActions) {
    val t = d.item("watch", "watching")
    Card(onClick = t?.let { { act.openWeb(it.href ?: watchPath(it.itemId)) } }) {
        BoxWithConstraints(Modifier.fillMaxSize()) {
            val tv = when (w.size) { "s" -> min(maxWidth.value * .84f, maxHeight.value * 1.05f); "m" -> min(maxWidth.value * .46f, (maxHeight.value - 28f) * 1.25f); else -> min(maxWidth.value * .86f, maxHeight.value * .82f) }.dp
            Laid(w.size, { Television(d.pic(t?.cover), t?.subtitle, t?.progress?.toFloat(), tv) }, if (t == null) ({ Sub("Nothing on right now", align = TextAlign.Center) }) else ({
                Kicker("Watching", live = true)
                Title(t.title, big = w.size != "m", align = if (w.size == "m") null else TextAlign.Center)
                t.subtitle?.let { Sub(it, align = if (w.size == "m") null else TextAlign.Center) }
            }))
        }
    }
}

private val Walnut = Color(0xFF6B4A35)

/**
 * A wooden set with its rabbit ears: the poster on a curved screen behind
 * scanlines and glass, what's on in green on the screen, two knobs and a
 * light on its side. It switches on as it arrives: a bright line opening
 * into the picture.
 */
@Composable
internal fun Television(cover: String?, label: String?, progress: Float?, width: Dp) {
    val still = LocalStill.current
    val on = remember(cover) { Animatable(if (still || cover == null) 1f else 0f) }
    LaunchedEffect(cover) { if (!still && cover != null) { delay(150); on.animateTo(1f, tween(900, easing = { t -> if (t < .45f) 0.02f * t / .45f else .02f + (1 - .02f) * (1 - (1 - (t - .45f) / .55f).pow(3)) })) } }
    Column(Modifier.width(width), horizontalAlignment = Alignment.CenterHorizontally) {
        /* The ears, on their little base. */
        Canvas(Modifier.width(width * .5f).height(width * .17f)) {
            val base = Offset(size.width / 2, size.height)
            val ink = Color(0xFF6F6259)
            listOf(-32f, 28f).forEach { deg ->
                val rad = (deg - 90) * PI.toFloat() / 180
                val tip = Offset(base.x + cos(rad) * size.height * 1.05f, base.y + sin(rad) * size.height * 1.05f)
                drawLine(ink, base, tip, 2.dp.toPx(), StrokeCap.Round)
                drawCircle(ink, 3.dp.toPx(), tip)
            }
            drawRoundRect(Color(0xFF4B3F39), Offset(base.x - 8.dp.toPx(), base.y - 5.dp.toPx()), Size(16.dp.toPx(), 6.dp.toPx()), CornerRadius(6.dp.toPx(), 6.dp.toPx()))
        }
        Row(
            Modifier.fillMaxWidth().shadow(10.dp, RoundedCornerShape(width * .12f)).clip(RoundedCornerShape(width * .12f)).background(Walnut)
                .drawWithContent {
                    drawContent()
                    drawRoundRect(Color(0xFF7D583F), cornerRadius = CornerRadius(size.width * .12f), style = Stroke(2.dp.toPx()))
                    drawLine(Color(0xFF573B2A), Offset(size.width * .1f, size.height - 2.dp.toPx()), Offset(size.width * .9f, size.height - 2.dp.toPx()), 4.dp.toPx())
                }
                .padding(width * .065f),
            horizontalArrangement = Arrangement.spacedBy(width * .05f), verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.weight(1f).aspectRatio(4f / 3f).clip(RoundedCornerShape(percent = 18)).background(Color(0xFF121513))) {
                if (cover != null) AsyncImage(cover, null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize().graphicsLayer { scaleY = on.value; alpha = .4f + .6f * on.value })
                /* Scanlines, the glass over them, and the dark round its edge. */
                Canvas(Modifier.fillMaxSize()) {
                    var y = 0f
                    while (y < size.height) { drawLine(Color.Black.copy(alpha = .22f), Offset(0f, y), Offset(size.width, y), 1f); y += 3f }
                    drawRect(Brush.radialGradient(listOf(Color.White.copy(alpha = .18f), Color.Transparent), Offset(size.width * .3f, size.height * .2f), size.width * .6f))
                    drawRect(Brush.radialGradient(listOf(Color.Transparent, Color.Black.copy(alpha = .55f)), center, size.maxDimension * .75f))
                    if (on.value < .3f && cover != null) drawRect(Color.White.copy(alpha = (1 - on.value / .3f) * .9f), Offset(0f, size.height / 2 - 1.5f), Size(size.width, 3f))
                }
                if (label != null) Text("▶ $label", style = MaterialTheme.typography.labelSmall.copy(fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold, fontSize = if (width > 200.dp) 13.sp else 9.sp, shadow = androidx.compose.ui.graphics.Shadow(Color(0xCC96FF82), blurRadius = 8f)),
                    color = Color(0xFFC8FFB8), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(start = 8.dp, top = 6.dp, end = 8.dp))
                if (progress != null && progress > 0) Box(Modifier.align(Alignment.BottomCenter).padding(horizontal = 8.dp, vertical = 6.dp).fillMaxWidth().height(3.dp).clip(RoundedCornerShape(2.dp)).background(Color.White.copy(alpha = .25f))) {
                    Box(Modifier.fillMaxHeight().fillMaxWidth(progress.coerceIn(0f, 1f)).background(Color(0xFFC8FFB8)))
                }
            }
            Column(Modifier.width(width * .12f), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(width * .04f)) {
                repeat(2) { Box(Modifier.fillMaxWidth().aspectRatio(1f).clip(CircleShape).background(Color(0xFFE2DBCF)).border(width * .015f, Color(0xFFBDB4A7), CircleShape)) }
                Box(Modifier.size(width * .04f).clip(CircleShape).background(if (cover != null) Color(0xFF8FD16A) else Color(0xFF4A3122)))
            }
        }
    }
}

/* ── Their favourite film or show: a cinema ticket ────────────────────── */

/** A ticket's outline: rounded, with a notch either side of the tear line at [tear]. */
private fun ticketShape(tear: Float, notch: Float, corner: Float) = GenericShape { size, _ ->
    val body = Path().apply { addRoundRect(RoundRect(0f, 0f, size.width, size.height, CornerRadius(corner))) }
    val holes = Path().apply {
        addOval(androidx.compose.ui.geometry.Rect(Offset(size.width * tear, 0f), notch))
        addOval(androidx.compose.ui.geometry.Rect(Offset(size.width * tear, size.height), notch))
    }
    addPath(Path.combine(PathOperation.Difference, body, holes))
}

@Composable
private fun FavouriteShow(w: Widget, d: BoardData, act: BoardActions) {
    val c = w.config.orEmpty()
    val small = w.size == "s"
    val number = ((c["key"].orEmpty().length * 7919) % 100000).toString().padStart(5, '0')
    val tilt by rememberInfiniteTransition(label = "ticket").animateFloat(-1.2f, 1.2f, infiniteRepeatable(tween(4200, easing = FastOutSlowInEasing), RepeatMode.Reverse), label = "tilt")
    val still = LocalStill.current
    Box(Modifier.fillMaxSize().clickable { c["key"]?.let { act.openWeb(watchPath(it)) } }.padding(10.dp), contentAlignment = Alignment.Center) {
        val shape = if (small) RoundedCornerShape(12.dp) else ticketShape(.34f, 26f, 30f)
        val paper = Color(0xFFF3E3C7)
        Box(Modifier.fillMaxSize().graphicsLayer { rotationZ = if (still) -1f else tilt }.shadow(12.dp, shape).clip(shape).background(paper)) {
            if (small) Column(Modifier.fillMaxSize()) {
                Box(Modifier.fillMaxWidth().weight(.58f).background(Kata.suo)) { d.pic(c["cover"])?.let { AsyncImage(it, null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize()) } }
                Column(Modifier.fillMaxWidth().weight(.42f).padding(horizontal = 10.dp, vertical = 6.dp), verticalArrangement = Arrangement.Center) {
                    Text("ADMIT ONE", style = MaterialTheme.typography.labelSmall.copy(letterSpacing = 1.5.sp, fontWeight = FontWeight.Bold, fontSize = 9.sp), color = Kata.suo)
                    Text(c["title"].orEmpty(), style = MaterialTheme.typography.titleSmall.copy(fontFamily = Mincho), color = Color(0xFF2B1F16), maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
            } else Row(Modifier.fillMaxSize()) {
                Box(Modifier.fillMaxHeight().weight(.34f).background(Kata.suo)) { d.pic(c["cover"])?.let { AsyncImage(it, null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize()) } }
                /* The line to tear along. */
                Canvas(Modifier.fillMaxHeight().width(2.dp).padding(vertical = 14.dp)) {
                    drawLine(Color(0x733A2A1E), Offset(size.width / 2, 0f), Offset(size.width / 2, size.height), 2.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(8f, 6f)))
                }
                Box(Modifier.fillMaxHeight().weight(.66f).padding(horizontal = 14.dp, vertical = 10.dp)) {
                    Column(Modifier.align(Alignment.CenterStart), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text("ADMIT ONE · FAVOURITE", style = MaterialTheme.typography.labelSmall.copy(letterSpacing = 1.6.sp, fontWeight = FontWeight.Bold, fontSize = 9.5.sp), color = Kata.suo, maxLines = 1)
                        Text(c["title"].orEmpty(), style = MaterialTheme.typography.headlineSmall.copy(fontFamily = Mincho, fontSize = if (w.size == "m") 19.sp else 26.sp, lineHeight = if (w.size == "m") 22.sp else 30.sp), color = Color(0xFF2B1F16), maxLines = 3, overflow = TextOverflow.Ellipsis)
                        c["subtitle"]?.takeIf { it.isNotBlank() }?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Color(0xFF6B5442)) }
                    }
                    Text("No. $number", style = MaterialTheme.typography.labelSmall.copy(fontFamily = FontFamily.Monospace, letterSpacing = 1.sp), color = Color(0x803A2A1E), modifier = Modifier.align(Alignment.BottomEnd))
                }
            }
        }
    }
}

/* ── Top artists, with how often each was played ──────────────────────── */

@Composable
private fun Artists(w: Widget, d: BoardData, act: BoardActions) {
    val list = d.music?.artists.orEmpty()
    if (list.isEmpty()) return Card { Empty("people", "Top artists show up after some listening") }
    val n = if (w.size == "m" || w.size == "s") 3 else 6
    Card {
        BoxWithConstraints(Modifier.fillMaxSize().padding(14.dp)) {
            val face = (if (n == 3) min((maxWidth.value - 24) / 3f, maxHeight.value - 62f) else min((maxWidth.value - 24) / 3f, (maxHeight.value - 110f) / 2f)).coerceIn(36f, 96f).dp
            Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterVertically)) {
                Kicker("Top artists this month")
                list.take(n).chunked(3).forEachIndexed { row, three ->
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                        three.forEachIndexed { i, a ->
                            Column(Modifier.weight(1f).clickable { act.openWeb("/music/artist/${a.key.removePrefix("dz:")}") }, horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                Box {
                                    Box(Modifier.size(face).clip(CircleShape).background(MaterialTheme.colorScheme.surfaceContainerHigh), contentAlignment = Alignment.Center) {
                                        val pic = d.pic(sharp(a.picture))
                                        if (pic != null) AsyncImage(pic, a.name, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                                        else Text(a.name.take(1), style = MaterialTheme.typography.headlineSmall.copy(fontFamily = Mincho), color = Kata.plum)
                                    }
                                    Box(Modifier.offset((-2).dp, (-2).dp).size(22.dp).clip(CircleShape).background(MaterialTheme.colorScheme.surfaceContainerLow).padding(2.dp).clip(CircleShape).background(LocalBoardColor.current), contentAlignment = Alignment.Center) {
                                        Text("${row * 3 + i + 1}", style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Bold), color = Color.White)
                                    }
                                }
                                Text(a.name, style = MaterialTheme.typography.labelMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                a.plays?.let { Text(plays(it), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1) }
                            }
                        }
                        repeat(3 - three.size) { Spacer(Modifier.weight(1f)) }
                    }
                }
            }
        }
    }
}

/* ── This month ───────────────────────────────────────────────────────── */

@Composable
private fun Stats(w: Widget, d: BoardData) {
    val year = yearOf(nowMs())
    val read = d.items("books", "read").count { (it.at ?: 0) > 0 && yearOf(it.at!!) == year }
    val hours = ((d.music?.minutes ?: 0) / 6.0).roundToInt() / 10.0
    val facts = listOfNotNull(
        d.music?.plays?.takeIf { it > 0 }?.let { Triple(it.toDouble(), 0, if (it == 1) "song" else "songs") },
        hours.takeIf { it > 0 }?.let { Triple(if (it >= 10) it.roundToInt().toDouble() else it, if (it >= 10) 0 else 1, if (it == 1.0) "hour" else "hours") },
        read.takeIf { it > 0 }?.let { Triple(it.toDouble(), 0, if (it == 1) "book in $year" else "books in $year") },
    )
    if (facts.isEmpty()) return Card { Empty("clock", "A quiet month so far") }
    Card {
        Column(Modifier.fillMaxSize().padding(14.dp), verticalArrangement = Arrangement.SpaceBetween, horizontalAlignment = if (w.size == "s") Alignment.CenterHorizontally else Alignment.Start) {
            Kicker("This month")
            @OptIn(ExperimentalLayoutApi::class)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(18.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                facts.take(if (w.size == "s") 2 else 3).forEach { (n, dec, unit) ->
                    Column {
                        CountUp(n, dec, MaterialTheme.typography.displaySmall.copy(fontFamily = Mincho, fontSize = if (w.size == "s") 28.sp else 34.sp), LocalBoardColor.current)
                        Text(unit, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
    }
}

/* ── A note under tape; a status ──────────────────────────────────────── */

internal val noteTints = linkedMapOf(
    "suo" to Color(0xFFA84D63), "plum" to Color(0xFF4E2B37), "moss" to Color(0xFF5C7150), "ai" to Color(0xFF2E5E8A),
    "kuchiba" to Color(0xFFB8732C), "sakura" to Color(0xFFD77B8C), "sumi" to Color(0xFF3A3634),
)

@Composable
private fun Note(w: Widget) {
    val tint = noteTints[w.config?.get("tint")] ?: Kata.sakura
    val paper = androidx.compose.ui.graphics.lerp(Color(0xFFFBF3E6), tint, .22f)
    val lean = remember(w.id) { if (w.id.hashCode() % 2 == 0) -1.4f else 1.2f }
    Box(Modifier.fillMaxSize().padding(6.dp).rotate(lean)) {
        Box(Modifier.fillMaxSize().padding(top = 8.dp).shadow(8.dp, RoundedCornerShape(6.dp)).clip(RoundedCornerShape(6.dp)).background(paper).padding(16.dp)) {
            Text(w.config?.get("text")?.ifBlank { null } ?: "…", style = MaterialTheme.typography.titleLarge.copy(fontFamily = Mincho, fontSize = if (w.size == "l") 24.sp else 17.sp, lineHeight = if (w.size == "l") 32.sp else 23.sp), color = Color(0xFF2B2421), overflow = TextOverflow.Ellipsis)
        }
        /* The tape. */
        Box(Modifier.align(Alignment.TopCenter).size(64.dp, 20.dp).rotate(-3f).background(androidx.compose.ui.graphics.lerp(Color.White.copy(alpha = .55f), tint, .45f).copy(alpha = .8f)))
    }
}

@Composable
private fun Status(w: Widget) {
    val still = LocalStill.current
    val bob = if (still) null else rememberInfiniteTransition(label = "bob").animateFloat(0f, 1f, infiniteRepeatable(tween(1600, easing = FastOutSlowInEasing), RepeatMode.Reverse), label = "bob")
    Card {
        Column(Modifier.fillMaxSize().padding(14.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterVertically)) {
            Text(w.config?.get("emoji")?.ifBlank { null } ?: "🌸", fontSize = 50.sp, modifier = Modifier.graphicsLayer { translationY = -(bob?.value ?: 0f) * 4.dp.toPx(); rotationZ = (bob?.value ?: 0f) * 4f })
            w.config?.get("text")?.takeIf { it.isNotBlank() }?.let { Text(it, style = MaterialTheme.typography.titleMedium.copy(fontFamily = Mincho), textAlign = TextAlign.Center, maxLines = 3, overflow = TextOverflow.Ellipsis) }
        }
    }
}

/* ── Their time ───────────────────────────────────────────────────────── */

/** How their time sits against yours: "5h ahead of you", "2h 30m behind you", "Same time as you". */
fun apart(zone: String?, now: Long = nowMs()): String {
    val diff = zoneOffsetMinutes(zone, now) - zoneOffsetMinutes(null, now)
    if (diff == 0) return "Same time as you"
    val h = abs(diff) / 60
    val m = abs(diff) % 60
    return "${if (h > 0) "${h}h" else ""}${if (h > 0 && m > 0) " " else ""}${if (m > 0) "${m}m" else ""} ${if (diff > 0) "ahead of" else "behind"} you"
}

@Composable
private fun Clock(w: Widget, d: BoardData) {
    val zone = w.config?.get("zone")?.ifBlank { null }
    var now by remember { mutableStateOf(nowMs()) }
    LaunchedEffect(Unit) { while (true) { delay(1000); now = nowMs() } }
    val local = now + zoneOffsetMinutes(zone, now) * 60_000L
    val dayMs = (local % 86_400_000L + 86_400_000L) % 86_400_000L
    val h = (dayMs / 3_600_000L).toInt()
    val m = ((dayMs / 60_000L) % 60).toInt()
    val s = ((dayMs / 1000L) % 60).toInt()
    val night = h < 6 || h >= 20
    val said = "${if (h % 12 == 0) 12 else h % 12}:${m.toString().padStart(2, '0')} ${if (h < 12) "am" else "pm"}"
    val ink = if (night) Color(0xFFF3ECDF) else MaterialTheme.colorScheme.onSurface
    val bg = if (night) androidx.compose.ui.graphics.lerp(Color(0xFF15130F), Color(0xFF2E5E8A), .3f) else androidx.compose.ui.graphics.lerp(MaterialTheme.colorScheme.surfaceContainerLow, Color(0xFFE8C27A), .18f)
    val accent = LocalBoardColor.current
    val where = zone?.substringAfterLast('/')?.replace('_', ' ')
    Card(color = bg) {
        BoxWithConstraints(Modifier.fillMaxSize()) {
            val face = (if (w.size == "m") maxHeight.value - 40f else min(maxWidth.value, maxHeight.value) * .56f).dp
            Laid(w.size, {
                Canvas(Modifier.size(face)) {
                    val r = size.minDimension / 2 * .88f
                    drawCircle(ink.copy(alpha = .5f), r, style = Stroke(2.5f * size.minDimension / 100))
                    for (i in 0 until 12) rotate(i * 30f) {
                        drawLine(ink.copy(alpha = .6f), Offset(center.x, center.y - r * .9f), Offset(center.x, center.y - r * (if (i % 3 == 0) .72f else .82f)), 2f * size.minDimension / 100, StrokeCap.Round)
                    }
                    rotate((h % 12) * 30f + m / 2f) { drawLine(ink, center, Offset(center.x, center.y - r * .5f), 5f * size.minDimension / 100, StrokeCap.Round) }
                    rotate(m * 6f + s / 10f) { drawLine(accent, center, Offset(center.x, center.y - r * .73f), 3f * size.minDimension / 100, StrokeCap.Round) }
                    rotate(s * 6f) { drawLine(accent, Offset(center.x, center.y + r * .14f), Offset(center.x, center.y - r * .82f), 1.4f * size.minDimension / 100, StrokeCap.Round) }
                    drawCircle(ink, 3f * size.minDimension / 100)
                }
                if (w.size == "s") Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(said, style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.Bold), color = ink)
                    Text(apart(zone, now), style = MaterialTheme.typography.labelSmall, color = ink.copy(alpha = .8f), maxLines = 1)
                }
            }) {
                Kicker("${if (night) "Night" else if (h < 12) "Morning" else if (h < 17) "Afternoon" else "Evening"} for ${d.person.firstName()}", color = if (night) Color(0xFFF2B8C4) else accent)
                Title(said, big = w.size != "m", color = ink, align = if (w.size == "m") null else TextAlign.Center)
                Sub(apart(zone, now) + (where?.let { " · $it" } ?: ""), color = ink.copy(alpha = .8f), align = if (w.size == "m") null else TextAlign.Center)
            }
        }
    }
}

/* ── Links ────────────────────────────────────────────────────────────── */

private val socialHosts = Regex("(^|\\.)(instagram|twitter|x|bsky|threads|mastodon\\.social|tiktok|youtube|youtu\\.be|twitch|github|gitlab|linkedin|facebook|spotify|soundcloud|bandcamp|letterboxd|goodreads|discord|reddit|pinterest|behance|dribbble|vimeo|last\\.fm|steamcommunity)\\.[a-z.]+$")
fun hostOf(url: String): String = runCatching { io.ktor.http.Url(url).host.removePrefix("www.") }.getOrDefault("").takeIf { !url.startsWith("mailto:") }.orEmpty()
fun isSocial(url: String) = socialHosts.containsMatchIn(hostOf(url))

/** What a link is, from where it goes: a mark people recognise without any brand drawn. */
fun linkMark(url: String): String {
    if (url.startsWith("mailto:")) return "send"
    val host = hostOf(url)
    return when {
        Regex("instagram|flickr|vsco|500px|unsplash").containsMatchIn(host) -> "camera"
        Regex("youtube|youtu\\.be|twitch|tiktok|vimeo|letterboxd|imdb").containsMatchIn(host) -> "film"
        Regex("spotify|soundcloud|bandcamp|music\\.apple|last\\.fm|deezer|tidal").containsMatchIn(host) -> "music"
        Regex("github|gitlab|codeberg|bitbucket|stackoverflow").containsMatchIn(host) -> "laptop"
        Regex("goodreads|storygraph|substack|medium").containsMatchIn(host) -> "book"
        Regex("twitter|x\\.com|bsky|mastodon|threads|facebook|linkedin|discord").containsMatchIn(host) -> "people"
        else -> "link"
    }
}

/** A link's own icon, from its site, or a mark when there isn't one. */
@Composable
fun Favicon(url: String, size: Dp, tint: Color = LocalBoardColor.current) {
    val host = hostOf(url)
    val mark = @Composable { Icon(kimonoIcon(linkMark(url)), null, tint = tint, modifier = Modifier.size(size)) }
    if (host.isEmpty()) return mark()
    SubcomposeAsyncImage("https://$host/favicon.ico", null, modifier = Modifier.size(size), contentScale = ContentScale.Fit, loading = { mark() }, error = { mark() })
}

@Composable
private fun Links(w: Widget, d: BoardData, act: BoardActions) {
    val own = d.links.filter { !isSocial(it.url) }
    val list = own.ifEmpty { d.links }
    if (list.isEmpty()) return Card(onClick = act.editLinks) { Empty("link", if (act.editLinks != null) "Add your links" else "No links yet") }
    val n = when (w.size) { "m", "s" -> 2; "l" -> 4; else -> 5 }
    val accent = LocalBoardColor.current
    val still = LocalStill.current
    Card {
        Column(Modifier.fillMaxSize().padding(10.dp), verticalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterVertically)) {
            list.take(n).forEachIndexed { i, l ->
                val featured = i == 0 && list.size > 1 && w.size != "m"
                val arrive = remember { Animatable(if (still) 1f else 0f) }
                LaunchedEffect(Unit) { if (!still) { delay(120L + i * 60L); arrive.animateTo(1f, androidx.compose.animation.core.spring(.6f, 300f)) } }
                Row(
                    Modifier.fillMaxWidth().weight(1f, fill = false).graphicsLayer { alpha = arrive.value; translationY = (1 - arrive.value) * 18.dp.toPx() }
                        .clip(RoundedCornerShape(18.dp)).background(if (featured) accent else MaterialTheme.colorScheme.surfaceContainer)
                        .clickable { act.openUrl(l.url) }.padding(start = 6.dp, end = 12.dp, top = 6.dp, bottom = 6.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Box(Modifier.size(if (featured) 42.dp else 34.dp).clip(RoundedCornerShape(12.dp)).background(Color(0xFFFBF6EF)), contentAlignment = Alignment.Center) { Favicon(l.url, 20.dp) }
                    Column(Modifier.weight(1f)) {
                        Text(l.title, style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.Bold), color = if (featured) Color.White else MaterialTheme.colorScheme.onSurface, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(hostOf(l.url).ifEmpty { l.url.removePrefix("mailto:") }, style = MaterialTheme.typography.labelSmall, color = (if (featured) Color.White else MaterialTheme.colorScheme.onSurface).copy(alpha = .7f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    Icon(kimonoIcon("out"), null, tint = (if (featured) Color.White else MaterialTheme.colorScheme.onSurface).copy(alpha = .6f), modifier = Modifier.size(16.dp))
                }
            }
            act.editLinks?.let { edit ->
                Row(Modifier.clip(RoundedCornerShape(10.dp)).clickable(onClick = edit).padding(horizontal = 8.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Icon(kimonoIcon("brush"), null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(14.dp))
                    Text("Edit links", style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Bold), color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
}

/* ── Friends, always on the board ─────────────────────────────────────── */

@Composable
private fun FriendsWidget(w: Widget, d: BoardData, act: BoardActions) {
    val own = d.own
    val count = d.friends.size
    Card {
        BoxWithConstraints(Modifier.fillMaxSize().padding(14.dp)) {
            val face = 48.dp
            val perRow = ((maxWidth.value + 8) / (face.value + 10)).toInt().coerceAtLeast(1)
            val rows = when (w.size) { "s" -> 1; "m" -> 1; else -> 3 }.coerceAtMost(((maxHeight.value - 72) / (face.value + (if (w.size == "s") 6 else 22))).toInt().coerceAtLeast(1))
            val n = (perRow * rows).let { if (count > it) it - 1 else it }
            Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Kicker(if (count == 1) "1 friend" else if (count > 0) "$count friends" else "Friends")
                    if (own?.kept == true) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(3.dp)) {
                        Icon(kimonoIcon("lock"), null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(12.dp))
                        Text("Only you", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                if (count == 0) Box(Modifier.weight(1f).fillMaxWidth()) { Empty("people", if (own != null) "Your friends show up here" else "No friends to show") }
                else @OptIn(ExperimentalLayoutApi::class) FlowRow(Modifier.weight(1f, fill = false), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    d.friends.take(n).forEach { f ->
                        Column(Modifier.width(face).clickable { act.openPerson(f.username) }, horizontalAlignment = Alignment.CenterHorizontally) {
                            Portrait(f.picture, f.name, f.username, face)
                            if (w.size != "s") Text(f.firstName(), style = MaterialTheme.typography.labelSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                    }
                    if (count > n) Box(Modifier.size(face).clip(CircleShape).border(1.5.dp, LocalBoardColor.current.copy(alpha = .55f), CircleShape).clickable(onClick = act.openFriends), contentAlignment = Alignment.Center) {
                        Text("+${count - n}", style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.Bold), color = LocalBoardColor.current)
                    }
                }
                if (own != null) Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (own.asking > 0) Chip("${own.asking} asking", dot = true, onClick = act.openFriends)
                    Chip(if (count > 0) "All friends" else "Find friends", icon = if (count > 0) null else "search", onClick = act.openFriends)
                }
            }
        }
    }
}

/** A small tag you can press, cut like a folded corner. */
@Composable
internal fun Chip(text: String, icon: String? = null, dot: Boolean = false, onClick: () -> Unit) {
    val accent = LocalBoardColor.current
    Row(
        Modifier.clip(RoundedCornerShape(4.dp, 12.dp, 4.dp, 12.dp)).background(accent.copy(alpha = .12f)).clickable(onClick = onClick).padding(horizontal = 10.dp, vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        if (dot) Box(Modifier.size(7.dp).clip(CircleShape).background(Kata.moss))
        if (icon != null) Icon(kimonoIcon(icon), null, tint = accent, modifier = Modifier.size(14.dp))
        Text(text, style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold), color = accent)
    }
}

/* ── Books: a favourite, a review, the shelf, the year ────────────────── */

@Composable
private fun FavouriteBook(w: Widget, act: BoardActions) {
    val c = w.config.orEmpty()
    Card(onClick = { c["key"]?.let(act.openBook) }) {
        BoxWithConstraints(Modifier.fillMaxSize()) {
            Laid(w.size, { Book3D(book3d(c["key"].orEmpty(), c["title"].orEmpty(), c["subtitle"], c["cover"]?.ifBlank { null }), bookWidth(w.size, maxWidth.value, maxHeight.value), still = true) }) {
                Kicker("Favourite book")
                Title(c["title"].orEmpty(), big = w.size != "m", align = if (w.size == "m") null else TextAlign.Center)
                c["subtitle"]?.takeIf { it.isNotBlank() }?.let { Sub(it, align = if (w.size == "m") null else TextAlign.Center) }
            }
        }
    }
}

@Composable
internal fun RatingTag(rating: String) {
    val (icon, said, tint) = when (rating) { "love" -> Triple("heart", "Loved it", Color(0xFFC2405E)); "up" -> Triple("thumb-up", "Liked it", Kata.moss); else -> Triple("thumb-down", "Not for me", MaterialTheme.colorScheme.onSurfaceVariant) }
    Row(Modifier.padding(top = 4.dp).clip(CircleShape).background(tint.copy(alpha = .14f)).padding(start = 6.dp, end = 9.dp, top = 3.dp, bottom = 3.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
        Icon(kimonoIcon(icon), null, tint = tint, modifier = Modifier.size(14.dp))
        Text(said, style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Bold), color = tint)
    }
}

@Composable
private fun Review(w: Widget, d: BoardData, act: BoardActions) {
    val r = d.books?.reviews?.firstOrNull() ?: return Card { Empty("book", "Reviews you write in Books show here") }
    Card(onClick = { act.openBook(r.key) }) {
        BoxWithConstraints(Modifier.fillMaxSize()) {
            val book = bookWidth("m", maxWidth.value, if (w.size == "m") maxHeight.value else maxHeight.value * .5f)
            val words: @Composable ColumnScope.() -> Unit = {
                Kicker("${d.person.firstName()}’s review")
                Title(r.title, lines = 1)
                if (r.author.isNotBlank()) Sub(r.author)
                r.rating?.let { RatingTag(it) }
                Text("“${r.review}”", style = MaterialTheme.typography.bodyMedium.copy(fontFamily = Mincho, lineHeight = 21.sp), maxLines = if (w.size == "m") 2 else 6, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 6.dp))
            }
            if (w.size == "m") Row(Modifier.fillMaxSize().padding(14.dp), horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) {
                Book3D(book3d(r.key, r.title, r.author, r.cover), book, still = true)
                Column(Modifier.weight(1f), content = words)
            } else Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) {
                    Book3D(book3d(r.key, r.title, r.author, r.cover), book * .8f, still = true)
                    Column(Modifier.weight(1f)) {
                        Kicker("${d.person.firstName()}’s review")
                        Title(r.title)
                        if (r.author.isNotBlank()) Sub(r.author)
                        r.rating?.let { RatingTag(it) }
                    }
                }
                Text("“${r.review}”", style = MaterialTheme.typography.bodyLarge.copy(fontFamily = Mincho, lineHeight = 24.sp), maxLines = 6, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

/** The books they've read, as spines on a plank: heights vary as real books do; a loved one has a heart. */
@Composable
private fun Bookshelf(w: Widget, d: BoardData, act: BoardActions) {
    val read = d.books?.read.orEmpty()
    if (read.isEmpty()) return Card { Empty("book", "Books you finish go on the shelf") }
    val n = when (w.size) { "m", "s" -> 9; "l" -> 11; else -> 13 }
    val still = LocalStill.current
    Card {
        Column(Modifier.fillMaxSize()) {
            Box(Modifier.padding(start = 16.dp, top = 14.dp)) { Kicker(if (read.size == 1) "1 book read" else "${read.size} books read") }
            Row(Modifier.weight(1f).fillMaxWidth().padding(horizontal = 10.dp).padding(top = 8.dp), verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(3.dp)) {
                read.take(n).forEachIndexed { i, b ->
                    var hash = 0L
                    b.key.forEach { hash = (hash * 31 + it.code) and 0xffffffffL }
                    val hue = (hash % 360).toFloat()
                    val tall = .72f + (hash % 28) / 100f
                    val arrive = remember { Animatable(if (still) 1f else 0f) }
                    LaunchedEffect(Unit) { if (!still) { delay(i * 35L); arrive.animateTo(1f, androidx.compose.animation.core.spring(.55f, 260f)) } }
                    Box(
                        Modifier.weight(1f).widthIn(max = 40.dp).fillMaxHeight(tall)
                            .graphicsLayer { alpha = arrive.value; translationY = (1 - arrive.value) * 16.dp.toPx(); rotationZ = (1 - arrive.value) * -6f; transformOrigin = androidx.compose.ui.graphics.TransformOrigin(.5f, 1f) }
                            .clip(RoundedCornerShape(3.dp, 3.dp, 1.dp, 1.dp)).background(Color.hsl(hue, .32f, .38f))
                            .clickable { act.openBook(b.key) },
                        contentAlignment = Alignment.Center,
                    ) {
                        d.pic(b.cover)?.let { AsyncImage(it, null, contentScale = ContentScale.Crop, alignment = Alignment.CenterStart, modifier = Modifier.fillMaxSize()) }
                        /* The spine's curve: dark at its edges, the light along it. */
                        Box(Modifier.fillMaxSize().background(Brush.horizontalGradient(listOf(Color.Black.copy(alpha = .38f), Color.Black.copy(alpha = .08f), Color.Black.copy(alpha = .32f)))))
                        Text(b.title, style = MaterialTheme.typography.labelSmall.copy(fontFamily = Mincho, fontSize = 10.sp, shadow = androidx.compose.ui.graphics.Shadow(Color.Black.copy(alpha = .6f), blurRadius = 4f)), color = Color(0xFFFBF6EF), maxLines = 1, softWrap = false, overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.graphicsLayer { rotationZ = -90f }.requiredWidthFor())
                        if (b.rating == "love") Text("♥", fontSize = 9.sp, color = Color(0xFFFF8FA8), modifier = Modifier.align(Alignment.TopCenter).padding(top = 4.dp))
                    }
                }
            }
            /* The plank. */
            Box(Modifier.fillMaxWidth().height(14.dp).background(Color(0xFF8C6444)).drawWithContent { drawContent(); drawRect(Color(0xFFA37A56), size = Size(size.width, 3.dp.toPx())) })
        }
    }
}

/** A spine's title runs up it, as long as the spine is tall. */
private fun Modifier.requiredWidthFor(): Modifier = this.then(Modifier.layout { measurable, constraints ->
    val p = measurable.measure(androidx.compose.ui.unit.Constraints(maxWidth = (constraints.maxHeight * .9f).toInt().coerceAtLeast(1)))
    layout(constraints.maxWidth.coerceAtLeast(1), constraints.maxHeight.coerceAtLeast(1)) { p.place((constraints.maxWidth - p.width) / 2, (constraints.maxHeight - p.height) / 2) }
})

@Composable
private fun YearInBooks(w: Widget, d: BoardData) {
    val year = yearOf(nowMs())
    val n = d.books?.read.orEmpty().count { yearOf(it.at) == year }
    val goal = w.config?.get("goal")?.toIntOrNull() ?: 0
    val frac = if (goal > 0) min(1f, n / goal.toFloat()) else min(1f, n / 12f)
    val still = LocalStill.current
    val sweep = remember { Animatable(if (still) frac else 0f) }
    LaunchedEffect(frac) { if (!still) sweep.animateTo(frac, tween(1400, easing = FastOutSlowInEasing)) }
    val track = MaterialTheme.colorScheme.surfaceContainerHigh
    Card {
        BoxWithConstraints(Modifier.fillMaxSize()) {
            val ring = (if (w.size == "m") maxHeight.value - 32f else min(maxWidth.value, maxHeight.value) * .74f).dp
            Laid(w.size, {
                Box(Modifier.size(ring), contentAlignment = Alignment.Center) {
                    Canvas(Modifier.fillMaxSize()) {
                        val st = size.minDimension * .09f
                        drawArc(track, 0f, 360f, false, topLeft = Offset(st / 2, st / 2), size = Size(size.width - st, size.height - st), style = Stroke(st))
                        drawArc(Kata.moss, -90f, 360f * sweep.value, false, topLeft = Offset(st / 2, st / 2), size = Size(size.width - st, size.height - st), style = Stroke(st, cap = StrokeCap.Round))
                    }
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        CountUp(n.toDouble(), style = MaterialTheme.typography.displaySmall.copy(fontFamily = Mincho, fontSize = 30.sp), color = Kata.moss)
                        Text(if (goal > 0) "of $goal" else "books", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }) {
                Kicker("$year in books")
                Title(if (goal > 0) (if (n >= goal) "Goal met" else "${goal - n} to go") else if (n == 1) "One book so far" else "$n books so far")
            }
        }
    }
}

/* ── Watch: what they've watched, fanned like a hand of cards ─────────── */

@Composable
private fun Watched(w: Widget, d: BoardData, act: BoardActions) {
    val list = d.items("watch", "watched").filter { it.cover != null }
    if (list.isEmpty()) return Card { Empty("film", "What you watch shows here") }
    val n = when (w.size) { "m", "s" -> 4; "l" -> 5; else -> 7 }
    val shown = list.take(n)
    val still = LocalStill.current
    val spread = remember { Animatable(if (still) 1f else 0f) }
    LaunchedEffect(Unit) { if (!still) spread.animateTo(1f, androidx.compose.animation.core.spring(.6f, 120f)) }
    Card {
        Column(Modifier.fillMaxSize().padding(14.dp)) {
            Kicker("Watched lately")
            BoxWithConstraints(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.BottomCenter) {
                val cardH = maxHeight * .92f
                val cardW = min(cardH.value / 1.5f, maxWidth.value * .34f).dp
                shown.forEachIndexed { i, t ->
                    val k = i - (shown.size - 1) / 2f
                    AsyncImage(d.pic(t.cover), t.title, contentScale = ContentScale.Crop, modifier = Modifier
                        .width(cardW).height(cardW * 1.5f)
                        .graphicsLayer {
                            transformOrigin = androidx.compose.ui.graphics.TransformOrigin(.5f, 1.2f)
                            rotationZ = k * 9f * spread.value
                            translationX = k * cardW.toPx() * .3f * spread.value
                        }
                        .shadow(8.dp, RoundedCornerShape(6.dp)).clip(RoundedCornerShape(6.dp))
                        .clickable { act.openWeb(t.href ?: watchPath(t.itemId)) })
                }
            }
        }
    }
}

/* ── Music: a playlist, loved songs, on repeat ────────────────────────── */

@Composable
private fun PlaylistWidget(w: Widget, d: BoardData, act: BoardActions) {
    val c = w.config.orEmpty()
    Card(onClick = { act.openWeb("/music/playlist/${c["key"].orEmpty().encodeURLQueryComponent()}") }) {
        BoxWithConstraints(Modifier.fillMaxSize()) {
            val art = (if (w.size == "m") maxHeight.value - 28f else min(maxWidth.value * .62f, maxHeight.value * .6f)).dp
            Laid(w.size, {
                Box {
                    Cover(d.pic(c["cover"]), art, 16.dp, "music")
                    Box(Modifier.align(Alignment.BottomEnd).padding(6.dp).size(34.dp).shadow(6.dp, CircleShape).clip(CircleShape).background(LocalBoardColor.current), contentAlignment = Alignment.Center) {
                        Icon(kimonoIcon("play"), null, tint = Color.White, modifier = Modifier.size(16.dp))
                    }
                }
            }) {
                Kicker("Playlist")
                Title(c["title"].orEmpty(), big = w.size != "m", align = if (w.size == "m") null else TextAlign.Center)
                c["subtitle"]?.takeIf { it.isNotBlank() }?.let { Sub(it, align = if (w.size == "m") null else TextAlign.Center) }
            }
        }
    }
}

@Composable
private fun Loved(w: Widget, d: BoardData, act: BoardActions) {
    val list = d.items("music", "loved")
    if (list.isEmpty()) return Card { Empty("heart", "Songs you love show here") }
    val n = if (w.size == "m") 3 else 6
    Card {
        Row(Modifier.fillMaxSize().padding(14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            BoxWithConstraints(Modifier.fillMaxHeight().aspectRatio(.9f), contentAlignment = Alignment.Center) {
                val s = min(maxWidth.value, maxHeight.value).dp * .78f
                list.take(3).reversed().forEachIndexed { r, t ->
                    val i = minOf(3, list.size) - 1 - r
                    Box(Modifier.size(s).graphicsLayer { rotationZ = i * -7f; translationX = -i * 6.dp.toPx(); translationY = i * 3.dp.toPx() }.shadow(6.dp, RoundedCornerShape(8.dp)).clip(RoundedCornerShape(8.dp)).background(MaterialTheme.colorScheme.surfaceContainerHigh)) {
                        d.pic(sharp(t.cover))?.let { AsyncImage(it, null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize()) }
                    }
                }
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Kicker("♥ Loved songs")
                list.take(n).forEach { t ->
                    Text(
                        buildString { append(t.title); t.subtitle?.let { append(" · $it") } },
                        style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.clickable { act.openWeb(songPath(t.itemId)) },
                    )
                }
            }
        }
    }
}

@Composable
private fun OnRepeatWidget(w: Widget, d: BoardData, act: BoardActions) {
    val r = d.music?.onRepeat ?: return Card { Empty("restore", "Play a song twice and it's on repeat") }
    val still = LocalStill.current
    val turn = if (still) null else rememberInfiniteTransition(label = "repeat").animateFloat(0f, -360f, infiniteRepeatable(tween(4000, easing = LinearEasing)), label = "turn")
    Card(onClick = { act.openWeb(songPath(r.track.key)) }) {
        BoxWithConstraints(Modifier.fillMaxSize()) {
            val art = (if (w.size == "m") maxHeight.value - 34f else min(maxWidth.value, maxHeight.value) * .66f).dp
            Laid(w.size, {
                Box(Modifier.padding(top = 6.dp, end = 6.dp)) {
                    Cover(d.pic(sharp(r.track.album?.cover)), art, 16.dp, "music")
                    Box(Modifier.align(Alignment.TopEnd).offset(6.dp, (-6).dp).size(30.dp).graphicsLayer { rotationZ = turn?.value ?: 0f }.clip(CircleShape).background(MaterialTheme.colorScheme.surfaceContainerLow).padding(3.dp).clip(CircleShape).background(LocalBoardColor.current), contentAlignment = Alignment.Center) {
                        Icon(kimonoIcon("restore"), null, tint = Color.White, modifier = Modifier.size(15.dp))
                    }
                }
            }) {
                Kicker("On repeat · ${plays(r.plays)}")
                Title(r.track.title)
                Sub(r.track.by)
            }
        }
    }
}

/* ── A countdown, a quote ─────────────────────────────────────────────── */

@Composable
private fun Countdown(w: Widget) {
    val date = w.config?.get("date").orEmpty()
    val target = epochDayOf(date)
    val today = remember { epochDayNow() }
    val days = if (target == null) 0 else (target - today).toInt()
    val label = w.config?.get("label")?.ifBlank { null } ?: "The day"
    Card {
        Laid(if (w.size == "s") "s" else "m", {
            Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.widthIn(min = 80.dp)) {
                CountUp(maxOf(0, days).toDouble(), style = MaterialTheme.typography.displayMedium.copy(fontFamily = Mincho, fontSize = 44.sp), color = LocalBoardColor.current)
                Text(if (days == 1) "day" else "days", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (w.size == "s") Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Kicker(if (days > 0) "Until" else if (days == 0) "It's today" else "It was")
                Text(label, style = MaterialTheme.typography.titleSmall.copy(fontFamily = Mincho), maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }) {
            Kicker(if (days > 0) "Until" else if (days == 0) "It's today" else "It was")
            Title(label)
            target?.let { Sub(longDate(it)) }
        }
    }
}

@Composable
private fun Quote(w: Widget) {
    val accent = LocalBoardColor.current
    Card(color = androidx.compose.ui.graphics.lerp(MaterialTheme.colorScheme.surfaceContainerLow, accent, .1f)) {
        Box(Modifier.fillMaxSize()) {
            Text("“", style = MaterialTheme.typography.displayLarge.copy(fontFamily = Mincho, fontSize = 110.sp), color = accent.copy(alpha = .22f), modifier = Modifier.offset(10.dp, (-26).dp))
            Column(Modifier.fillMaxSize().padding(horizontal = 22.dp, vertical = 18.dp), verticalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterVertically)) {
                Text(w.config?.get("text").orEmpty(), style = MaterialTheme.typography.titleLarge.copy(fontFamily = Mincho, fontSize = if (w.size == "m") 18.sp else 24.sp, lineHeight = if (w.size == "m") 25.sp else 33.sp), overflow = TextOverflow.Ellipsis)
                w.config?.get("by")?.takeIf { it.isNotBlank() }?.let { Text("— $it", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            }
        }
    }
}

/* ── Days and years, without a calendar library ───────────────────────── */

/** Days since 1970 of a "YYYY-MM-DD" date (proleptic Gregorian), or null. */
internal fun epochDayOf(date: String): Long? {
    val m = Regex("^(\\d{4})-(\\d{2})-(\\d{2})$").find(date) ?: return null
    val (y0, mo, d) = m.destructured.toList().map { it.toInt() }
    val y = if (mo <= 2) y0 - 1 else y0
    val era = floor(y / 400.0).toLong()
    val yoe = y - era * 400
    val doy = (153 * (mo + (if (mo > 2) -3 else 9)) + 2) / 5 + d - 1
    val doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
    return era * 146097 + doe - 719468
}

/** Today, where you are, in days since 1970. */
internal fun epochDayNow(): Long { val now = nowMs(); return floor((now + zoneOffsetMinutes(null, now) * 60_000L) / 86_400_000.0).toLong() }

/** The civil date of a day since 1970: year, month (1-12), day. */
internal fun civil(day: Long): Triple<Int, Int, Int> {
    val z = day + 719468
    val era = floor(z / 146097.0).toLong()
    val doe = z - era * 146097
    val yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365
    val doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
    val mp = (5 * doy + 2) / 153
    val d = (doy - (153 * mp + 2) / 5 + 1).toInt()
    val m = (if (mp < 10) mp + 3 else mp - 9).toInt()
    return Triple((yoe + era * 400 + if (m <= 2) 1 else 0).toInt(), m, d)
}

internal fun yearOf(ms: Long): Int = civil(floor((ms + zoneOffsetMinutes(null, ms) * 60_000L) / 86_400_000.0).toLong()).first

private val months = listOf("January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December")
private val weekdays = listOf("Thursday", "Friday", "Saturday", "Sunday", "Monday", "Tuesday", "Wednesday")
internal fun longDate(day: Long): String { val (_, m, d) = civil(day); return "${weekdays[((day % 7 + 7) % 7).toInt()]} $d ${months[m - 1]}" }

/** How long ago an ISO moment was, in a few words. */
internal fun ago(iso: String): String {
    val at = isoMs(iso) ?: return "a while ago"
    val s = (nowMs() - at) / 1000
    return when {
        s < 3600 -> "${maxOf(1, (s / 60.0).roundToInt())} min ago"
        s < 86400 -> "${(s / 3600.0).roundToInt()} hr ago"
        s < 2 * 86400 -> "yesterday"
        else -> "${(s / 86400.0).roundToInt()} days ago"
    }
}

/** Milliseconds of an ISO moment in UTC ("2026-11-15T09:30:40.431Z"). */
internal fun isoMs(iso: String): Long? {
    val m = Regex("^(\\d{4}-\\d{2}-\\d{2})T(\\d{2}):(\\d{2}):(\\d{2})(?:\\.(\\d+))?Z$").find(iso) ?: return null
    val day = epochDayOf(m.groupValues[1]) ?: return null
    val (h, mi, s) = listOf(2, 3, 4).map { m.groupValues[it].toLong() }
    val ms = m.groupValues[5].take(3).padEnd(3, '0').toLongOrNull() ?: 0
    return ((day * 24 + h) * 60 + mi) * 60_000 + s * 1000 + ms
}
