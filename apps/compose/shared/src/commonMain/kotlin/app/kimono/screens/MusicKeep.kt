package app.kimono.screens

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import kotlinx.coroutines.launch
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.kimono.data.Music
import app.kimono.data.QueueSource
import app.kimono.data.Track
import app.kimono.music.MusicPlayer
import app.kimono.music.SongKeep
import app.kimono.music.megabytes
import app.kimono.ui.IconButton
import app.kimono.ui.KimonoTopBar
import app.kimono.ui.Surface
import app.kimono.ui.clickable
import app.kimono.ui.kimonoIcon

/* ── 蔵 Downloads: where each song stands, and the storehouse they're kept in ── */

/** Where [key] stands on this phone, kept up to date. */
@Composable
fun rememberKeep(player: MusicPlayer, key: String): SongKeep? {
    val d = player.downloads
    val kept = d.kept.collectAsState().value
    val now = d.now.collectAsState().value
    val waiting = d.waiting.collectAsState().value
    val failed = d.failed.collectAsState().value
    return when {
        kept.containsKey(key) -> SongKeep.Kept
        now?.first == key -> SongKeep.Getting(now.second)
        waiting.any { it.key == key } -> SongKeep.Waiting
        else -> failed[key]?.let { SongKeep.Failed(it.why) }
    }
}

/**
 * A song's mark beside its name: the arrow home when it's here, a ring
 * inking itself round as it arrives, a dotted ring while it waits its turn,
 * and a red one when it didn't come.
 */
@Composable
fun KeepMark(state: SongKeep?, size: Dp = 14.dp) {
    val primary = MaterialTheme.colorScheme.primary
    val quiet = MaterialTheme.colorScheme.onSurfaceVariant
    val error = MaterialTheme.colorScheme.error
    when (state) {
        null -> {}
        SongKeep.Kept -> MusicGlyph("downloaded", primary, size)
        is SongKeep.Getting -> {
            val shown by animateFloatAsState(state.progress.coerceAtLeast(.04f), tween(300), label = "keep")
            Canvas(Modifier.size(size)) {
                val w = this.size.width * .16f
                val box = Size(this.size.width - w, this.size.height - w)
                val at = Offset(w / 2, w / 2)
                drawArc(primary.copy(alpha = .2f), 0f, 360f, false, at, box, style = Stroke(w))
                drawArc(primary, -90f, 360f * shown, false, at, box, style = Stroke(w, cap = StrokeCap.Round))
            }
        }
        SongKeep.Waiting -> {
            val turn by rememberInfiniteTransition(label = "wait").animateFloat(0f, 360f, infiniteRepeatable(tween(6000, easing = LinearEasing)), label = "turn")
            Canvas(Modifier.size(size).rotate(turn)) {
                val w = this.size.width * .14f
                drawCircle(quiet, radius = (this.size.width - w) / 2, style = Stroke(w, cap = StrokeCap.Round, pathEffect = PathEffect.dashPathEffect(floatArrayOf(w * 1.2f, w * 2.2f))))
            }
        }
        is SongKeep.Failed -> Box(Modifier.size(size).clip(CircleShape).background(error), contentAlignment = Alignment.Center) {
            Text("!", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onError, fontWeight = FontWeight.Bold)
        }
    }
}

/** What a song's menu says about downloading it, and what choosing that does. */
fun keepChoice(player: MusicPlayer, state: SongKeep?, track: Track): Triple<String, String, () -> Unit> = when (state) {
    SongKeep.Kept -> Triple("Remove download", "trash") { player.downloads.remove(listOf(track)) }
    is SongKeep.Getting -> Triple("Stop downloading · ${(state.progress * 100).toInt()}%", "close") { player.downloads.cancel(listOf(track)) }
    SongKeep.Waiting -> Triple("Stop downloading", "close") { player.downloads.cancel(listOf(track)) }
    is SongKeep.Failed -> Triple("Try downloading again", "restart") { player.downloads.retry(listOf(track.key)) }
    null -> Triple("Download", "download") { player.downloads.download(listOf(track)) }
}

/**
 * An album's or playlist's download button: the arrow inside a ring that
 * fills as its songs arrive, solid once they're all here. Tap to download
 * the rest, to stop, or (all here) to take them off.
 */
@Composable
fun CollectionKeep(player: MusicPlayer, tracks: List<Track>) {
    val d = player.downloads
    val kept = d.kept.collectAsState().value
    val waiting = d.waiting.collectAsState().value
    val now = d.now.collectAsState().value
    val failed = d.failed.collectAsState().value
    val keys = remember(tracks) { tracks.map { it.key }.toSet() }
    val here = keys.count { kept.containsKey(it) }
    val coming = waiting.count { it.key in keys }
    val partial = if (now != null && now.first in keys) now.second else 0f
    val all = tracks.isNotEmpty() && here == keys.size
    val lost = keys.count { it in failed }
    val primary = MaterialTheme.colorScheme.primary
    val track = MaterialTheme.colorScheme.outlineVariant
    val shown by animateFloatAsState(if (keys.isEmpty()) 0f else (here + partial) / keys.size, tween(400), label = "crate")
    IconButton(onClick = {
        when {
            all -> d.remove(tracks)
            coming > 0 -> d.cancel(tracks)
            lost > 0 && here + lost == keys.size -> d.retry(keys.filter { it in failed })
            else -> d.download(tracks)
        }
    }) {
        Box(Modifier.size(36.dp), contentAlignment = Alignment.Center) {
            if (all) Box(Modifier.size(34.dp).clip(CircleShape).background(primary), contentAlignment = Alignment.Center) { MusicGlyph("downloaded", MaterialTheme.colorScheme.onPrimary, 18.dp) }
            else {
                if (coming > 0 || here > 0) Canvas(Modifier.size(34.dp)) {
                    val w = 2.5.dp.toPx()
                    val box = Size(size.width - w, size.height - w)
                    drawArc(track, 0f, 360f, false, Offset(w / 2, w / 2), box, style = Stroke(w))
                    drawArc(primary, -90f, 360f * shown, false, Offset(w / 2, w / 2), box, style = Stroke(w, cap = StrokeCap.Round))
                }
                MusicGlyph(if (coming > 0) "pause" else "downloaded", if (lost > 0 && coming == 0) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface, if (coming > 0) 14.dp else 20.dp, filled = false)
            }
        }
    }
}

/** Music's Downloads: what's on the phone and the room it takes, what's on its way, and what didn't come. */
@Composable
fun MusicDownloadsScreen(player: MusicPlayer, free: Long?, go: MusicGo, back: () -> Unit) {
    val d = player.downloads
    val kept = d.kept.collectAsState().value
    val waiting = d.waiting.collectAsState().value
    val now = d.now.collectAsState().value
    val failed = d.failed.collectAsState().value
    val resumes = d.resumes.collectAsState().value
    var clearing by remember { mutableStateOf(false) }
    var order by remember { mutableStateOf("recent") }
    val tracks = remember(kept, order) {
        val all = kept.values.sortedByDescending { it.at }.map { it.track }
        when (order) {
            "artist" -> all.sortedWith(compareBy<Track> { it.byline.lowercase() }.thenBy { it.album?.title.orEmpty() })
            "title" -> all.sortedBy { it.title.lowercase() }
            else -> all
        }
    }
    val source = QueueSource("downloads", "downloads", "Downloads")
    Scaffold(containerColor = MaterialTheme.colorScheme.surface, topBar = { KimonoTopBar("Downloads", onBack = back) }) { pad ->
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(top = pad.calculateTopPadding(), bottom = 32.dp)) {
            item(key = "store") { Storehouse(tracks, kept.values.sumOf { it.size }, free, player.offline) }
            if (tracks.isNotEmpty()) item(key = "play") { PlayAll(player, tracks, source, Modifier.padding(top = 4.dp, bottom = 4.dp), download = false) }

            /* ── On its way ── */
            val coming = waiting
            if (coming.isNotEmpty()) {
                item(key = "coming-head") {
                    KeepHead(if (coming.size == 1) "Arriving" else "Arriving · ${coming.size}", "Stop all") { d.cancel(coming) }
                }
                /* A short wait between songs is the usual pace; only a long rest is worth a word. */
                val minutes = resumes?.let { (it - kotlin.time.Clock.System.now().toEpochMilliseconds() + 59_999) / 60_000 } ?: 0
                if (minutes > 1) item(key = "coming-rest") {
                    Text("Carrying on in about $minutes min", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(start = 20.dp, bottom = 6.dp))
                }
                items(coming.take(6), key = { "c" + it.key }) { t ->
                    val p = now?.takeIf { it.first == t.key }?.second
                    KeepLine(t, if (p != null) SongKeep.Getting(p) else SongKeep.Waiting, when { p == null -> "Waiting its turn"; p <= 0f -> "Getting ready"; else -> "${(p * 100).toInt()}%" }) {
                        IconButton(onClick = { d.cancel(listOf(t)) }, modifier = Modifier.size(40.dp)) { Icon(kimonoIcon("close"), "Stop downloading ${t.title}", Modifier.size(18.dp)) }
                    }
                }
                if (coming.size > 6) item(key = "coming-more") {
                    Text("and ${coming.size - 6} more", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(start = 76.dp, top = 2.dp, bottom = 8.dp))
                }
            }

            /* ── Didn't come ── */
            if (failed.isNotEmpty()) {
                item(key = "lost-head") { KeepHead("Didn't download · ${failed.size}", "Try again") { d.retry() } }
                items(failed.values.toList(), key = { "f" + it.track.key }) { f ->
                    KeepLine(f.track, SongKeep.Failed(f.why), f.why) {
                        IconButton(onClick = { d.retry(listOf(f.track.key)) }, modifier = Modifier.size(40.dp)) { Icon(kimonoIcon("restart"), "Try ${f.track.title} again", Modifier.size(18.dp)) }
                        IconButton(onClick = { d.cancel(listOf(f.track)) }, modifier = Modifier.size(40.dp)) { Icon(kimonoIcon("close"), "Forget ${f.track.title}", Modifier.size(18.dp)) }
                    }
                }
            }

            /* ── Here ── */
            if (tracks.isNotEmpty()) {
                item(key = "here-head") {
                    Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 12.dp, top = 18.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text("On this phone", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                        listOf("recent" to "Recent", "artist" to "Artist", "title" to "A–Z").forEach { (k, label) ->
                            val on = order == k
                            Text(label, style = MaterialTheme.typography.labelLarge, fontWeight = if (on) FontWeight.SemiBold else null,
                                color = if (on) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.clip(RoundedCornerShape(10.dp)).clickable { order = k }.padding(horizontal = 8.dp, vertical = 6.dp))
                        }
                    }
                }
                itemsIndexed(tracks, key = { _, t -> "k" + t.key }) { i, t -> SongRow(player, t, { player.play(tracks, i, source) }, go) }
                item(key = "clear") {
                    Text("Remove all downloads", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.error,
                        modifier = Modifier.padding(start = 12.dp, top = 20.dp).clip(RoundedCornerShape(12.dp)).clickable { clearing = true }.padding(horizontal = 8.dp, vertical = 10.dp))
                }
            }
            /* Smart downloads: songs you play kept too, so they start at once next time. */
            item(key = "smart") {
                val smart = d.smart.collectAsState().value
                val played = d.played.collectAsState().value
                Row(Modifier.fillMaxWidth().clickable { d.setSmart(!smart) }.padding(start = 20.dp, end = 16.dp, top = 14.dp, bottom = 14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Column(Modifier.weight(1f)) {
                        Text("Smart downloads", style = MaterialTheme.typography.bodyLarge)
                        Text(if (smart && played.isNotEmpty()) "Songs you play · ${megabytes(played.values.sumOf { it.size })} of 10 GB" else "Keeps songs you play, up to 10 GB",
                            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Switch(
                        checked = smart, onCheckedChange = { d.setSmart(it) },
                        colors = SwitchDefaults.colors(checkedTrackColor = MaterialTheme.colorScheme.primary, checkedThumbColor = MaterialTheme.colorScheme.surfaceContainerLow, uncheckedTrackColor = MaterialTheme.colorScheme.surfaceContainerHigh, uncheckedThumbColor = MaterialTheme.colorScheme.outline, uncheckedBorderColor = MaterialTheme.colorScheme.outline),
                    )
                }
            }
            if (tracks.isEmpty() && coming.isEmpty() && failed.isEmpty()) item(key = "empty") {
                Text("Download a song, album or playlist from its menu, and it plays here with no connection.",
                    style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 24.dp, vertical = 12.dp))
            }
        }
    }
    if (clearing) app.kimono.ui.InkDialog("Remove all downloads?", onDismiss = { clearing = false }, icon = "trash", actions = {
        app.kimono.ui.Seal("Keep them", { clearing = false }, tone = app.kimono.ui.SealTone.Quiet, compact = true)
        app.kimono.ui.Seal("Remove", { d.removeAll(); clearing = false }, tone = app.kimono.ui.SealTone.Danger, compact = true)
    }) {
        Text("${songs(kept.size)} · ${megabytes(kept.values.sumOf { it.size })} come off this phone. They stay in Music to stream.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/**
 * The storehouse: the latest sleeves fanned in their crate, how much they
 * hold, and a band of the phone's room with Music's share inked in.
 */
@Composable
private fun Storehouse(tracks: List<Track>, bytes: Long, free: Long?, offline: Boolean) {
    Surface(shape = RoundedCornerShape(28.dp), color = MaterialTheme.colorScheme.surfaceContainer, modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
        Column(Modifier.padding(18.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(18.dp)) {
                Crate(tracks.mapNotNull { it.cover }.distinct().take(3))
                Column(Modifier.weight(1f)) {
                    if (offline) Text("Offline · these play", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
                    Text(if (bytes > 0) megabytes(bytes) else "Empty", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
                    Text(if (tracks.isEmpty()) "Nothing kept yet" else "${songs(tracks.size)} · ${Music.length(tracks)}", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            if (free != null && free > 0) {
                val share = (bytes.toFloat() / (bytes + free)).coerceIn(0f, 1f)
                val primary = MaterialTheme.colorScheme.primary
                val ground = MaterialTheme.colorScheme.surfaceContainerHighest
                Canvas(Modifier.padding(top = 16.dp).fillMaxWidth().height(8.dp)) {
                    drawRoundRect(ground, cornerRadius = androidx.compose.ui.geometry.CornerRadius(size.height / 2))
                    if (bytes > 0) drawRoundRect(primary, size = Size((size.width * share).coerceAtLeast(size.height), size.height), cornerRadius = androidx.compose.ui.geometry.CornerRadius(size.height / 2))
                }
                Text("${megabytes(free)} free on this phone", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 6.dp))
            }
        }
    }
}

/** Up to three sleeves leaning in a crate. */
@Composable
private fun Crate(covers: List<String>) {
    Box(Modifier.size(width = 96.dp, height = 84.dp)) {
        val tilt = listOf(-9f, 0f, 8f)
        if (covers.isEmpty()) Box(Modifier.align(Alignment.BottomCenter).size(64.dp).clip(RoundedCornerShape(10.dp)).background(MaterialTheme.colorScheme.surfaceContainerHighest), contentAlignment = Alignment.Center) {
            MusicGlyph("downloaded", MaterialTheme.colorScheme.onSurfaceVariant, 26.dp)
        }
        covers.forEachIndexed { i, c ->
            Cover(c, 62.dp, Modifier.align(Alignment.BottomStart).offset(x = (6 + i * 14).dp, y = (-6).dp).rotate(tilt[i]), corner = 8.dp)
        }
        Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(20.dp).clip(RoundedCornerShape(bottomStart = 10.dp, bottomEnd = 10.dp, topStart = 3.dp, topEnd = 3.dp)).background(MaterialTheme.colorScheme.secondaryContainer))
    }
}

@Composable
private fun KeepHead(title: String, action: String, onAction: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 12.dp, top = 18.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
        Text(action, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary,
            modifier = Modifier.clip(RoundedCornerShape(10.dp)).clickable(onClick = onAction).padding(horizontal = 8.dp, vertical = 6.dp))
    }
}

/** A song on its way (or that didn't come): its sleeve, its state, and what to do. */
@Composable
private fun KeepLine(track: Track, state: SongKeep, note: String, actions: @Composable RowScope.() -> Unit) {
    Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 8.dp, top = 6.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Cover(track.cover, 48.dp, corner = 8.dp)
        Column(Modifier.weight(1f)) {
            Text(track.title, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                KeepMark(state)
                Text(note, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    color = if (state is SongKeep.Failed) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (state is SongKeep.Getting) app.kimono.ui.InkProgress(progress = { state.progress }, modifier = Modifier.padding(top = 4.dp).fillMaxWidth())
        }
        actions()
    }
}

/**
 * Music with no connection: a deck of what's downloaded, ready to play, in
 * place of shelves that wouldn't.
 */
@Composable
fun OfflineDeck(player: MusicPlayer, go: MusicGo, retry: suspend () -> Unit) {
    /* Try again asks at once, and says it's asking; the player also keeps looking by itself (MusicPlayer.recheck). */
    var trying by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val kept = player.downloads.kept.collectAsState().value
    val tracks = remember(kept) { kept.values.sortedByDescending { it.at }.map { it.track } }
    val source = QueueSource("downloads", "downloads", "Downloads")
    Column {
    Surface(shape = RoundedCornerShape(28.dp), color = MaterialTheme.colorScheme.secondaryContainer, modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp)) {
        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Box(Modifier.size(10.dp).clip(CircleShape).background(MaterialTheme.colorScheme.onSecondaryContainer.copy(alpha = .45f)))
                Text("No connection", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSecondaryContainer, modifier = Modifier.weight(1f))
                Text(if (trying) "Trying…" else "Try again", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSecondaryContainer,
                    modifier = Modifier.clip(RoundedCornerShape(10.dp)).clickable(enabled = !trying) { trying = true; scope.launch { try { retry() } finally { trying = false } } }.padding(horizontal = 8.dp, vertical = 6.dp))
            }
            Text(if (tracks.isEmpty()) "Songs you download play here with none." else "${songs(tracks.size)} downloaded · ${Music.length(tracks)} to play",
                style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSecondaryContainer.copy(alpha = .8f))
            if (tracks.isNotEmpty()) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilledIconButtonBig("play", "Play your downloads", 48.dp) { player.play(tracks, 0, source, shuffled = false) }
                IconButton(onClick = { player.play(tracks, tracks.indices.random(), source, shuffled = true) }) { MusicGlyph("shuffle", MaterialTheme.colorScheme.onSecondaryContainer) }
                Spacer(Modifier.weight(1f))
                Text("All downloads", style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSecondaryContainer,
                    modifier = Modifier.clip(RoundedCornerShape(10.dp)).clickable { go("music/downloads") }.padding(horizontal = 8.dp, vertical = 6.dp))
            }
        }
    }
    if (tracks.isNotEmpty()) Shelf("Downloaded") {
        items(tracks.take(20), key = { "off" + it.key }) { t ->
            SleeveTile(t.title, t.byline, t.cover, player.current?.key == t.key && player.playing) { player.play(tracks, tracks.indexOf(t), source) }
        }
    }
    }
}
