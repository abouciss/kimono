@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterial3ExpressiveApi::class)

package app.kimono.screens

import io.ktor.http.encodeURLPathPart

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.kimono.data.Album
import app.kimono.data.Artist
import app.kimono.data.Music
import app.kimono.data.Playlist
import app.kimono.data.QueueSource
import app.kimono.data.Track
import app.kimono.music.MusicPlayer
import app.kimono.ui.IconButton
import app.kimono.ui.InkMenuItem
import app.kimono.ui.InkSheet
import app.kimono.ui.InkTitle
import app.kimono.ui.Surface
import app.kimono.ui.clickable
import app.kimono.ui.combinedClickable
import app.kimono.ui.kimonoIcon
import coil3.compose.AsyncImage
import kotlinx.coroutines.launch
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

/** Where a Music screen goes: a route in the app's nav. */
typealias MusicGo = (String) -> Unit

object MusicRoutes {
    fun artist(key: String) = "music/artist/${Music.idOf(key)}"
    fun album(key: String) = "music/album/${Music.idOf(key)}"
    fun song(key: String) = "music/song/${Music.idOf(key)}"
    fun playlist(id: String) = "music/playlist/$id"
    fun party(id: String) = "music/party/$id"
    fun genre(id: Int) = "music/genre/$id"
    fun mix(id: String) = "music/mix/${id.encodeURLPathPart()}"
}

/* ── Art ────────────────────────────────────────────────────────────────── */

/** An album's cover; a gilt square with a note when there's none. */
@Composable
fun Cover(src: String?, size: Dp, modifier: Modifier = Modifier, round: Boolean = false, corner: Dp = 10.dp) {
    val shape = if (round) CircleShape else RoundedCornerShape(corner)
    Box(modifier.size(size).clip(shape).background(MaterialTheme.colorScheme.secondaryContainer), contentAlignment = Alignment.Center) {
        if (src != null) AsyncImage(model = src, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
        else MusicGlyph("note", MaterialTheme.colorScheme.onSecondaryContainer, size * .4f)
    }
}

/** A playlist's four covers in a square. */
@Composable
fun Mosaic(covers: List<String>, size: Dp, modifier: Modifier = Modifier) {
    if (covers.size < 4) { Cover(covers.firstOrNull(), size, modifier); return }
    Column(modifier.size(size).clip(RoundedCornerShape(10.dp))) {
        for (row in 0..1) Row(Modifier.weight(1f)) {
            for (col in 0..1) AsyncImage(model = covers[row * 2 + col], contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.weight(1f).fillMaxHeight())
        }
    }
}

/**
 * The record: a vinyl disc with the album's cover as its label, grooves that
 * catch the light, spinning up to 33⅓ while it plays and slowing to rest when
 * it stops. Drag-free; tap does what [onClick] says.
 */
@Composable
fun Vinyl(cover: String?, spinning: Boolean, size: Dp, modifier: Modifier = Modifier, still: Boolean = false) {
    var angle by remember { mutableFloatStateOf(0f) }
    var speed by remember { mutableFloatStateOf(0f) }
    val target = if (spinning && !still) 200f else 0f
    LaunchedEffect(target) {
        var last = withFrameNanos { it }
        while (true) {
            val done = withFrameNanos { now ->
                val dt = ((now - last) / 1e9f).coerceAtMost(.05f)
                last = now
                /* Spins up in under a second, runs down over two, like a platter. */
                speed += (target - speed) * (dt * if (target > speed) 3f else 1.2f)
                if (kotlin.math.abs(target - speed) < .5f) speed = target
                if (speed != 0f) angle = (angle + speed * dt) % 360f
                speed == 0f && target == 0f
            }
            if (done) break
        }
    }
    val groove = Color(0xFF24201C)
    val rim = MaterialTheme.colorScheme.onSurface.copy(alpha = .35f)
    Box(modifier.size(size), contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize().graphicsLayer { rotationZ = angle }) {
            val r = this.size.minDimension / 2
            val c = center
            drawCircle(groove, r, c)
            /* Grooves: fine rings, a little uneven, as pressed. */
            var ring = r * .97f
            var n = 0
            while (ring > r * .38f) {
                drawCircle(Color.White.copy(alpha = if (n % 5 == 0) .16f else .07f), ring, c, style = Stroke(width = 1f))
                ring -= r * (0.018f + (n % 3) * .004f)
                n++
            }
            /* The light across it: two soft wedges opposite, turning with it. */
            for (k in 0..1) {
                drawArc(Brush.sweepGradient(listOf(Color.Transparent, Color.White.copy(alpha = .22f), Color.Transparent), c), startAngle = 20f + k * 180f, sweepAngle = 40f, useCenter = true, topLeft = Offset(c.x - r, c.y - r), size = androidx.compose.ui.geometry.Size(r * 2, r * 2))
            }
            drawCircle(rim, r - 1f, c, style = Stroke(width = 2.5f))
            drawCircle(rim.copy(alpha = .2f), r * .38f, c, style = Stroke(width = 1.5f))
        }
        /* The label: the cover, turning with the record. */
        Box(Modifier.fillMaxSize(.36f).graphicsLayer { rotationZ = angle }.clip(CircleShape).background(MaterialTheme.colorScheme.primaryContainer), contentAlignment = Alignment.Center) {
            if (cover != null) AsyncImage(model = cover, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
        }
        Box(Modifier.size(size * .035f).clip(CircleShape).background(Color(0xFFE9E1D3)))
    }
}

/**
 * The cover, large and square on, with its record sliding out of the sleeve
 * to the right and turning while it plays; tucked back in when it stops.
 */
@Composable
fun Sleeve(cover: String?, spinning: Boolean, side: Dp, modifier: Modifier = Modifier, still: Boolean = false, coverModifier: Modifier = Modifier, onClick: (() -> Unit)? = null) {
    val out by animateFloatAsState(if (spinning) .34f else .22f, spring(dampingRatio = .65f, stiffness = 90f), label = "out")
    /* The cover and its record are one piece, centred together. */
    /* What shows (the cover and the record past it) sits in the middle, gliding as the record slides. */
    val shift = side * ((1.36f - (.97f + out)) / 2f)
    Box(modifier.width(side * 1.36f).height(side), contentAlignment = Alignment.CenterStart) {
        Vinyl(cover, spinning, side * .94f, Modifier.offset(x = shift + side * (.03f + out)), still = still)
        Cover(cover, side, Modifier.offset(x = shift).then(coverModifier).then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier).graphicsLayer { shadowElevation = 18f; shape = RoundedCornerShape(14.dp); clip = true }, corner = 14.dp)
    }
}

/* ── Marks ──────────────────────────────────────────────────────────────── */

private val glyphs = mapOf(
    "pause" to "M8 5v14M16 5v14",
    "play" to "M7 4.5v15l12.5-7.5Z",
    "next" to "M5 5l10 7-10 7ZM18.5 5v14",
    "prev" to "M19 5 9 12l10 7ZM5.5 5v14",
    "shuffle" to "M3 7h3.5c4.5 0 6.5 10 11 10H21M18 14l3 3-3 3M3 17h3.5c1.6 0 2.8-1.3 3.8-3M13.7 10c1-1.7 2.2-3 3.8-3H21M18 4l3 3-3 3",
    "repeat" to "M4 11V9a3 3 0 0 1 3-3h12M16 3l3 3-3 3M20 13v2a3 3 0 0 1-3 3H5M8 21l-3-3 3-3",
    "queue" to "M4 6h11M4 11h11M4 16h7M17 13v7M14.5 17.5 17 20l2.5-2.5",
    "lyrics" to "M5 6h14M5 10.5h10M5 15h14M5 19.5h7",
    "note" to "M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
    "love" to "M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20Z",
    "up" to "M7.5 10.5v9.5H4.5v-9.5h3Zm0 0 3.8-6.6c1.8 0 2.8 1.3 2.4 3L13 10h5a2 2 0 0 1 2 2.4l-1.2 6A2.2 2.2 0 0 1 16.6 20H7.5",
    "together" to "M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM2.5 19c.6-3 2.8-5 5.5-5s4.9 2 5.5 5M13.5 14.6c.8-.4 1.6-.6 2.5-.6 2.7 0 4.9 2 5.5 5",
    "downloaded" to "M12 3v12M7 10.5 12 15.5l5-5M5 20h14",
)

/** Music's own marks (play, pause, skip, shuffle…), drawn with the same round brush as Kimono's icons. */
@Composable
fun MusicGlyph(name: String, color: Color = LocalContentColor.current, size: Dp = 24.dp, filled: Boolean = name == "play", modifier: Modifier = Modifier) {
    val path = remember(name) { androidx.compose.ui.graphics.vector.PathParser().parsePathString(glyphs.getValue(name)).toPath() }
    Canvas(modifier.size(size)) {
        val k = this.size.width / 24f
        scale(k, k, pivot = Offset.Zero) {
            if (filled) drawPath(path, color)
            drawPath(path, color, style = Stroke(width = 2f, cap = StrokeCap.Round, join = StrokeJoin.Round))
        }
    }
}

/**
 * Down, up and love: the three marks. Up and love keep a song in your liked
 * songs, so a mark is the save. Pressing one pops it and inks it in.
 */
@Composable
fun RateMarks(player: MusicPlayer, kind: String, key: String, size: Dp = 26.dp, modifier: Modifier = Modifier) {
    val current = player.ratingOf(kind, key)
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(2.dp), verticalAlignment = Alignment.CenterVertically) {
        for (r in listOf("down", "up", "love")) {
            val on = current == r
            val pop by animateFloatAsState(if (on) 1f else 0f, spring(dampingRatio = .35f, stiffness = 520f), label = "pop")
            val tint = if (on) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant
            IconButton(onClick = { player.rate(kind, key, if (on) null else r) }) {
                Box(Modifier.graphicsLayer {
                    val s = 1f + pop * (1f - pop) * .9f
                    scaleX = s; scaleY = s
                    rotationZ = if (r == "down") 180f else 0f
                }) { MusicGlyph(if (r == "love") "love" else "up", tint, size, filled = on) }
            }
        }
    }
}

/** Three bars dancing: this song is the one playing. */
@Composable
fun Bars(color: Color = MaterialTheme.colorScheme.primary, moving: Boolean = true, modifier: Modifier = Modifier) {
    val t = rememberInfiniteTransition(label = "bars")
    val phases = (0..2).map { i ->
        if (moving) t.animateFloat(.25f, 1f, infiniteRepeatable(tween(420 + i * 130, easing = LinearEasing), RepeatMode.Reverse), label = "b$i").value else .4f
    }
    Canvas(modifier.size(16.dp)) {
        val w = size.width / 5
        phases.forEachIndexed { i, h ->
            drawRoundRect(color, topLeft = Offset(i * w * 2, size.height * (1 - h)), size = androidx.compose.ui.geometry.Size(w, size.height * h), cornerRadius = androidx.compose.ui.geometry.CornerRadius(w / 2))
        }
    }
}

/* ── Lists ──────────────────────────────────────────────────────────────── */

/** A song in a list: tap plays from here, hold (or …) for its menu. */
@Composable
fun SongRow(player: MusicPlayer, track: Track, onPlay: () -> Unit, go: MusicGo, number: Int? = null, art: Boolean = true) {
    var menu by remember { mutableStateOf(false) }
    val now = player.current?.key == track.key
    val keep = rememberKeep(player, track.key)
    /* Offline, a song that isn't here can't play: it stands back. */
    val reachable = !player.offline || keep == app.kimono.music.SongKeep.Kept
    Row(
        Modifier.fillMaxWidth().graphicsLayer { alpha = if (reachable) 1f else .42f }.combinedClickable(onClick = onPlay, onLongClick = { menu = true }).padding(horizontal = 16.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (number != null) Box(Modifier.width(24.dp), contentAlignment = Alignment.Center) {
            if (now) Bars(moving = player.playing) else Text("$number", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (art) Box { Cover(track.cover, 48.dp, corner = 8.dp); if (now && number == null) Box(Modifier.size(48.dp).clip(RoundedCornerShape(8.dp)).background(Color.Black.copy(alpha = .35f)), contentAlignment = Alignment.Center) { Bars(Color.White, player.playing) } }
        Column(Modifier.weight(1f)) {
            Text(track.title, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis, color = if (now) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface, fontWeight = if (now) FontWeight.SemiBold else null)
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                if (track.explicit) Text("E", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.surface, modifier = Modifier.clip(RoundedCornerShape(3.dp)).background(MaterialTheme.colorScheme.onSurfaceVariant).padding(horizontal = 4.dp))
                KeepMark(keep)
                Text(track.byline, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        val rating = player.ratingOf("track", track.key)
        if (rating == "love") MusicGlyph("love", MaterialTheme.colorScheme.primary, 16.dp, filled = true)
        Text(Music.clock(track.duration), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        IconButton(onClick = { menu = true }, modifier = Modifier.size(36.dp)) { Icon(kimonoIcon("more"), "More", Modifier.size(20.dp)) }
    }
    if (menu) SongMenu(player, track, go) { menu = false }
}

/** A row of things to look at, sideways. */
@Composable
fun Shelf(title: String, more: (() -> Unit)? = null, content: LazyListScope.() -> Unit) {
    Column(Modifier.padding(top = 24.dp)) {
        Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
            if (more != null) TextButtonSmall("See all", more)
        }
        LazyRow(contentPadding = PaddingValues(horizontal = 16.dp, vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(14.dp), content = content)
    }
}

@Composable
fun TextButtonSmall(label: String, onClick: () -> Unit) {
    app.kimono.ui.TextButton(onClick = onClick) { Text(label, style = MaterialTheme.typography.labelLarge) }
}

/**
 * A record in its sleeve: the cover, with the disc peeking out of the top
 * and sliding further out when it's the one playing.
 */
@Composable
fun SleeveTile(title: String, caption: String, cover: String?, playing: Boolean, width: Dp = 148.dp, covers: List<String> = emptyList(), round: Boolean = false, onClick: () -> Unit) {
    /* Only the one playing shows its record, sliding out of the sleeve; the rest are just their covers. */
    val out by animateFloatAsState(if (playing) .42f else 0f, spring(dampingRatio = .6f, stiffness = 200f), label = "out")
    Column(Modifier.width(width).clickable(onClick = onClick)) {
        Box(Modifier.width(width).height(width * (1f + .0f)), contentAlignment = Alignment.BottomStart) {
            if (!round && out > .01f) Vinyl(cover, spinning = playing, size = width * .88f, modifier = Modifier.align(Alignment.CenterStart).offset(x = width * (.02f + out * .45f)))
            if (covers.size >= 4) Mosaic(covers, width * .92f, Modifier.align(Alignment.CenterStart).graphicsLayer { shadowElevation = 6f; shape = RoundedCornerShape(10.dp); clip = true })
            else Cover(cover, if (round) width else width * .92f, Modifier.align(Alignment.CenterStart).graphicsLayer { shadowElevation = if (round) 0f else 6f; shape = if (round) CircleShape else RoundedCornerShape(10.dp); clip = true }, round = round)
        }
        Text(title, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 8.dp))
        if (caption.isNotBlank()) Text(caption, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
fun AlbumTile(player: MusicPlayer, album: Album, go: MusicGo, width: Dp = 148.dp) =
    SleeveTile(album.title, listOfNotNull(album.artist?.name, album.year?.toString()).joinToString(" · "), album.cover, player.current?.album?.key == album.key && player.playing, width) { go(MusicRoutes.album(album.key)) }

@Composable
fun ArtistTile(artist: Artist, go: MusicGo, width: Dp = 120.dp) {
    Column(Modifier.width(width).clickable { go(MusicRoutes.artist(artist.key)) }, horizontalAlignment = Alignment.CenterHorizontally) {
        Cover(artist.picture, width, round = true)
        Text(artist.name, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 8.dp))
    }
}

@Composable
fun PlaylistTile(player: MusicPlayer, pl: Playlist, go: MusicGo, width: Dp = 148.dp) =
    SleeveTile(pl.name, when {
        pl.invited -> "Asked by ${pl.owner ?: "a friend"}"
        pl.owner != null -> "By ${pl.owner}"
        pl.shared > 0 -> "Shared · ${songs(pl.count)}"
        pl.public -> "Public · ${songs(pl.count)}"
        else -> songs(pl.count)
    }, pl.covers.firstOrNull(), player.source?.kind == "playlist" && player.source?.id == pl.id && player.playing, width, covers = pl.covers) { go(MusicRoutes.playlist(pl.id)) }

/* ── A song's menu ──────────────────────────────────────────────────────── */

/** What you can do with a song, in groups: your marks, what to do, where to go. */
@Composable
fun SongMenu(player: MusicPlayer, track: Track, go: MusicGo, onDismiss: () -> Unit) {
    var adding by remember { mutableStateOf(false) }
    val (keepLabel, keepIcon, keepDo) = keepChoice(player, rememberKeep(player, track.key), track)
    InkSheet(onDismissRequest = onDismiss, seed = "song:${track.key}") {
        Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            Cover(track.cover, 56.dp)
            Column(Modifier.weight(1f)) {
                Text(track.title, style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text(track.byline, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
            }
        }
        RateMarks(player, "track", track.key, modifier = Modifier.padding(horizontal = 12.dp))
        HorizontalDivider(Modifier.padding(vertical = 6.dp), color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = .5f))
        InkMenuItem("Play next", { player.playNext(listOf(track)); onDismiss() }, icon = "play")
        InkMenuItem("Add to queue", { player.addToQueue(listOf(track)); onDismiss() }, icon = "plus")
        InkMenuItem("Add to playlist", { adding = true }, icon = "list")
        InkMenuItem(keepLabel, { keepDo(); onDismiss() }, icon = keepIcon)
        HorizontalDivider(Modifier.padding(vertical = 6.dp), color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = .5f))
        InkMenuItem("Go to song", { onDismiss(); go(MusicRoutes.song(track.key)) }, icon = "go")
        /* A YouTube song's channel and thumbnail have no pages (blank keys). */
        track.artists.firstOrNull()?.takeIf { it.key.isNotBlank() }?.let { a -> InkMenuItem("Go to ${a.name}", { onDismiss(); go(MusicRoutes.artist(a.key)) }, icon = "person") }
        track.album?.takeIf { it.key.isNotBlank() }?.let { al -> InkMenuItem("Go to album", { onDismiss(); go(MusicRoutes.album(al.key)) }, icon = "book") }
        InkMenuItem("Share", { onDismiss(); player.share("/music/song/${Music.idOf(track.key)}") }, icon = "share")
        Spacer(Modifier.height(8.dp))
    }
    if (adding) AddToPlaylist(player, listOf(track)) { adding = false; onDismiss() }
}

/** Your playlists to put songs in, and a new one. */
@Composable
fun AddToPlaylist(player: MusicPlayer, tracks: List<Track>, onDone: () -> Unit) {
    val scope = rememberCoroutineScope()
    var lists by remember { mutableStateOf<List<Playlist>?>(null) }
    var naming by remember { mutableStateOf(false) }
    var name by remember { mutableStateOf("") }
    /* Only ones you can add to: yours, and ones you've joined (not ones you're only asked onto). */
    LaunchedEffect(Unit) { lists = app.kimono.data.attempt { player.music.playlists() }.getOrDefault(emptyList()).filter { !it.invited } }
    InkSheet(onDismissRequest = onDone, seed = "add") {
        InkTitle("Add to playlist", modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp))
        if (naming) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(name, { name = it.take(100) }, Modifier.weight(1f), singleLine = true, placeholder = { Text("Name it") }, shape = RoundedCornerShape(16.dp))
                app.kimono.ui.Seal("Make", compact = true, enabled = name.isNotBlank(), onClick = {
                    scope.launch {
                        app.kimono.data.attempt { player.music.createPlaylist(name.trim(), tracks.map { it.key }) }
                            .onSuccess { player.say("Made “${it.name}”") }.onFailure { player.say(it.message ?: "That playlist wasn't made.") }
                        onDone()
                    }
                })
            }
        } else InkMenuItem("New playlist", { naming = true }, icon = "plus")
        when (val l = lists) {
            null -> Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) { app.kimono.ui.InkLoader(size = 36.dp) }
            else -> l.forEach { pl ->
                Row(Modifier.fillMaxWidth().clickable {
                    scope.launch {
                        app.kimono.data.attempt { player.music.addToPlaylist(pl.id, tracks.map { it.key }) }
                            .onSuccess { player.say("Added to “${pl.name}”") }.onFailure { player.say(it.message ?: "That didn't save.") }
                        onDone()
                    }
                }.padding(horizontal = 20.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    Mosaic(pl.covers, 44.dp)
                    Column(Modifier.weight(1f)) {
                        Text(pl.name, style = MaterialTheme.typography.bodyLarge, maxLines = 1)
                        Text("${pl.count} songs", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
        Spacer(Modifier.height(12.dp))
    }
}

/** Play and shuffle, and download, for a whole album or playlist. */
@Composable
fun PlayAll(player: MusicPlayer, tracks: List<Track>, source: QueueSource, modifier: Modifier = Modifier, download: Boolean = true, extra: @Composable RowScope.() -> Unit = {}) {
    val playingThis = player.source?.kind == source.kind && player.source?.id == source.id
    Row(modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        FilledIconButtonBig(if (playingThis && player.playing) "pause" else "play", "Play") {
            if (playingThis) player.toggle() else player.play(tracks, 0, source, shuffled = false)
        }
        IconButton(onClick = { player.play(tracks, (tracks.indices).random(), source, shuffled = true) }) { MusicGlyph("shuffle", MaterialTheme.colorScheme.onSurface) }
        if (download) CollectionKeep(player, tracks)
        extra()
        Spacer(Modifier.weight(1f))
        Text(listOf(if (tracks.size == 1) "1 song" else "${tracks.size} songs", Music.length(tracks)).joinToString(" · "), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/** The big round play: pressed, it squares off (M3 Expressive's shape morph). */
@Composable
fun FilledIconButtonBig(glyph: String, label: String, size: Dp = 56.dp, onClick: () -> Unit) {
    app.kimono.ui.FilledIconButton(onClick = onClick, shapes = IconButtonDefaults.shapes(), modifier = Modifier.size(size)) {
        MusicGlyph(glyph, MaterialTheme.colorScheme.onPrimary, size * .45f, filled = true)
    }
}

/** A loader in the middle of a Music screen. */
@Composable
fun MusicLoading() = Box(Modifier.fillMaxWidth().padding(64.dp), contentAlignment = Alignment.Center) { app.kimono.ui.InkLoader(size = 48.dp) }

/** A problem in the middle of a Music screen, with Try again. */
@Composable
fun MusicProblem(text: String, retry: () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(text, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        app.kimono.ui.Seal("Try again", onClick = retry, tone = app.kimono.ui.SealTone.Quiet, compact = true)
    }
}

/** Point on a circle, for drawing. */
internal fun around(c: Offset, r: Float, degrees: Float) = Offset(c.x + r * cos(degrees * PI.toFloat() / 180f), c.y + r * sin(degrees * PI.toFloat() / 180f))

internal fun songs(n: Int) = if (n == 1) "1 song" else "$n songs"
