@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterial3ExpressiveApi::class, androidx.compose.ui.ExperimentalComposeUiApi::class, androidx.compose.animation.ExperimentalSharedTransitionApi::class)

package app.kimono.screens

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.kimono.data.Lyrics
import app.kimono.data.Music
import app.kimono.data.SongStatus
import app.kimono.music.MusicParty
import app.kimono.music.MusicPlayer
import app.kimono.ui.IconButton
import app.kimono.ui.Portrait
import app.kimono.ui.Seal
import app.kimono.ui.SealTone
import app.kimono.ui.Surface
import app.kimono.ui.bottomChrome
import app.kimono.ui.clickable
import app.kimono.ui.kimonoIcon
import kotlinx.coroutines.launch
import kotlin.math.abs

/** "Finding it", "Fetching 40%": a song on its way for the first time. */
private fun arrivingText(s: SongStatus) = when (s.stage) {
    "finding" -> "Finding it…"
    "fetching" -> "Getting it ready · ${((s.fraction ?: 0.0) * 100).toInt()}%"
    else -> "Starting…"
}

/* ── The bar ────────────────────────────────────────────────────────────── */

/**
 * What stays at the foot of Music while you browse: the record turning, the
 * song, play and next. Tap opens the song in full; swipe it sideways to skip,
 * up to open it, and down to put the player away.
 */
@Composable
fun MusicBar(player: MusicPlayer, hem: Boolean) {
    val t = player.current ?: return
    var drag by remember { mutableFloatStateOf(0f) }
    val shift by animateFloatAsState(drag, spring(dampingRatio = .6f), label = "shift")
    /* Pulled down, the bar follows the finger; far enough and it's put away, music and all. */
    var drop by remember { mutableFloatStateOf(0f) }
    val sink by animateFloatAsState(drop, spring(dampingRatio = .7f), label = "sink")
    Surface(color = MaterialTheme.colorScheme.surfaceContainer, modifier = Modifier.fillMaxWidth().graphicsLayer { translationY = sink; alpha = 1f - (sink / 320f).coerceIn(0f, .8f) }) {
        Column(if (hem) Modifier.bottomChrome() else Modifier) {
            val fraction = if (player.length > 0) (player.position / player.length).toFloat().coerceIn(0f, 1f) else 0f
            LinearWavyProgressIndicator(progress = { fraction }, modifier = Modifier.fillMaxWidth().height(6.dp).padding(horizontal = 12.dp), amplitude = { if (player.playing) 1f else 0f }, wavelength = 28.dp)
            Row(
                Modifier.fillMaxWidth().height(62.dp).clickable(onClickLabel = "Open the song") { player.nowPlayingOpen = true }
                    .pointerInput(Unit) {
                        detectHorizontalDragGestures(onDragEnd = { if (drag < -90) player.next() else if (drag > 90) player.prev(); drag = 0f }, onDragCancel = { drag = 0f }) { _, d -> drag = (drag + d).coerceIn(-160f, 160f) }
                    }
                    .pointerInput(Unit) {
                        detectVerticalDragGestures(onDragEnd = { if (drop > 96f) player.close(); drop = 0f }, onDragCancel = { drop = 0f }) { _, d ->
                            if (d < -12 && drop <= 0f) player.nowPlayingOpen = true else drop = (drop + d).coerceIn(0f, 240f)
                        }
                    }
                    .padding(start = 12.dp, end = 4.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Sleeve(t.cover, player.playing, 46.dp, still = player.reduceMotion)
                Column(Modifier.weight(1f).graphicsLayer { translationX = shift; alpha = 1f - abs(shift) / 300f }) {
                    Text(t.title, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    val sub = player.arriving?.let(::arrivingText) ?: player.party?.let { "Listen party · ${t.byline}" } ?: t.byline
                    Text(sub, style = MaterialTheme.typography.bodySmall, color = if (player.arriving != null) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                Box(Modifier.size(48.dp), contentAlignment = Alignment.Center) {
                    /* Loading: the spinner alone (a tap still pauses), not a play button under it. */
                    if (player.waiting) LoadingIndicator(Modifier.size(44.dp).clip(CircleShape).clickable { player.toggle() }, color = MaterialTheme.colorScheme.primary)
                    else IconButton(onClick = { player.toggle() }) { MusicGlyph(if (player.playing) "pause" else "play", MaterialTheme.colorScheme.onSurface, 26.dp) }
                }
                IconButton(onClick = { player.next() }) { MusicGlyph("next", MaterialTheme.colorScheme.onSurface, 24.dp) }
            }
        }
    }
}

/* ── Now Playing ────────────────────────────────────────────────────────── */

/**
 * The song in full, over everything: the cover (tap it to
 * play or pause), the song's marks, its place, the controls; and under them
 * its lyrics, the queue, and listening together.
 */
@Composable
fun NowPlaying(player: MusicPlayer, go: MusicGo) {
    AnimatedVisibility(player.nowPlayingOpen && player.current != null, enter = slideInVertically(tween(380)) { it } + fadeIn(), exit = slideOutVertically(tween(300)) { it } + fadeOut()) {
        androidx.compose.ui.backhandler.BackHandler(onBack = { player.nowPlayingOpen = false })
        val t = player.current ?: return@AnimatedVisibility
        var panel by remember { mutableStateOf<String?>(null) }
        var menu by remember { mutableStateOf(false) }
        val party = player.party
        LaunchedEffect(party) { if (party != null) panel = "together" }
        /* Swipe it down anywhere to put it away: it follows the finger, and springs back unless pulled far enough. */
        val pull = remember { androidx.compose.animation.core.Animatable(0f) }
        val scope = rememberCoroutineScope()
        Surface(color = MaterialTheme.colorScheme.surface, modifier = Modifier.fillMaxSize().graphicsLayer { translationY = pull.value.coerceAtLeast(0f) }.pointerInput(Unit) {
            detectVerticalDragGestures(
                onDragEnd = { scope.launch { if (pull.value > 220f) { player.nowPlayingOpen = false; pull.snapTo(0f) } else pull.animateTo(0f, spring(dampingRatio = .7f)) } },
                onDragCancel = { scope.launch { pull.animateTo(0f, spring(dampingRatio = .7f)) } },
            ) { change, d -> change.consume(); scope.launch { pull.snapTo((pull.value + d).coerceAtLeast(0f)) } }
        }) {
            Box(Modifier.fillMaxSize()) {
                Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding()) {
                    Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                        IconButton(onClick = { player.nowPlayingOpen = false }) { Icon(kimonoIcon("chevron"), "Close", Modifier.graphicsLayer { rotationZ = 90f }) }
                        Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                            Text(if (party != null) "Listening together" else "Playing from", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Text(if (party != null) "${party.people[party.view?.host]?.name?.substringBefore(' ') ?: party.view?.host ?: ""}'s party" else player.source?.title ?: "Your queue",
                                style = MaterialTheme.typography.labelLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                        IconButton(onClick = { menu = true }) { Icon(kimonoIcon("more"), "More") }
                    }
                    /* Folding and unfolding: the cover glides between the big sleeve and the strip's thumbnail, the rest cross-fades. */
                    var shown by remember { mutableStateOf("lyrics") }
                    LaunchedEffect(panel) { panel?.let { shown = it } }
                    androidx.compose.animation.SharedTransitionLayout(Modifier.weight(1f).fillMaxWidth()) {
                    androidx.compose.animation.AnimatedContent(
                        targetState = panel == null,
                        transitionSpec = { (fadeIn(tween(320, delayMillis = 60)) togetherWith fadeOut(tween(180))).using(androidx.compose.animation.SizeTransform(clip = false)) },
                        label = "fold",
                    ) { full ->
                    val coverShared = Modifier.sharedElement(rememberSharedContentState("np-cover"), this@AnimatedContent, boundsTransform = { _, _ -> spring(dampingRatio = .82f, stiffness = 340f) })
                    val titleShared = Modifier.sharedBounds(rememberSharedContentState("np-title"), this@AnimatedContent, boundsTransform = { _, _ -> spring(dampingRatio = .85f, stiffness = 340f) })
                    Column(Modifier.fillMaxSize()) {
                    if (full) {
                        /* The song in full: its cover, big; tap it to play or pause. */
                        Box(Modifier.fillMaxWidth().weight(1f).padding(horizontal = 24.dp, vertical = 8.dp), contentAlignment = Alignment.Center) {
                            BoxWithConstraints(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                                val side = minOf(maxWidth, maxHeight)
                                Cover(t.cover, side, coverShared.clickable(onClickLabel = if (player.playing) "Pause" else "Play") { player.toggle() }, corner = 16.dp)
                            }
                        }
                        SongTitle(player, t, go, Modifier.padding(horizontal = 24.dp), titleModifier = titleShared)
                        Scrubber(player)
                        Controls(player)
                        Tabs(null, party != null) { panel = it }
                        Spacer(Modifier.height(8.dp))
                    } else {
                        /* A panel open: the player folds into a strip and the panel takes the rest. */
                        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            Cover(t.cover, 56.dp, coverShared.clickable { panel = null }, corner = 8.dp)
                            Column(Modifier.weight(1f).clickable { panel = null }) {
                                Text(t.title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = titleShared)
                                Text(t.byline, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            }
                            IconButton(onClick = { player.prev() }) { MusicGlyph("prev", MaterialTheme.colorScheme.onSurface, 22.dp, filled = true) }
                            Box(Modifier.size(48.dp), contentAlignment = Alignment.Center) {
                                if (player.waiting) LoadingIndicator(Modifier.size(48.dp).clip(CircleShape).clickable { player.toggle() }, color = MaterialTheme.colorScheme.primary)
                                else FilledIconButtonBig(if (player.playing) "pause" else "play", "Play", 48.dp) { player.toggle() }
                            }
                            IconButton(onClick = { player.next() }) { MusicGlyph("next", MaterialTheme.colorScheme.onSurface, 22.dp, filled = true) }
                        }
                        Scrubber(player)
                        Tabs(panel ?: shown, party != null) { panel = if (panel == it) null else it }
                        Box(Modifier.weight(1f).fillMaxWidth()) {
                            /* Kept while it folds away, so the panel leaves with the strip instead of vanishing first. */
                            androidx.compose.animation.Crossfade(panel ?: shown, label = "panel") { which ->
                                when (which) {
                                    "lyrics" -> LyricsPanel(player)
                                    "queue" -> QueuePanel(player)
                                    "together" -> TogetherPanel(player, go)
                                }
                            }
                        }
                    }
                    }
                    }
                    }
                }
                party?.let { Floating(it) }
                player.toast?.let { Toast(it, Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(bottom = 72.dp)) }
            }
        }
        if (menu) SongMenu(player, t, { player.nowPlayingOpen = false; go(it) }) { menu = false }
    }
}

@Composable
private fun SongTitle(player: MusicPlayer, t: app.kimono.data.Track, go: MusicGo, modifier: Modifier, compact: Boolean = false, titleModifier: Modifier = Modifier) {
    Column(modifier) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(t.title, style = if (compact) MaterialTheme.typography.titleLarge else MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = titleModifier)
                Text(t.byline, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.clickable { t.artists.firstOrNull()?.takeIf { it.key.isNotBlank() }?.let { player.nowPlayingOpen = false; go(MusicRoutes.artist(it.key)) } })
            }
        }
        player.arriving?.let { s ->
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 4.dp)) {
                LoadingIndicator(Modifier.size(22.dp), color = MaterialTheme.colorScheme.primary)
                Text(arrivingText(s), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
            }
        }
        var adding by remember { mutableStateOf(false) }
        Row(verticalAlignment = Alignment.CenterVertically) {
            RateMarks(player, "track", t.key, size = if (compact) 22.dp else 26.dp, modifier = Modifier.offset(x = (-12).dp))
            Spacer(Modifier.weight(1f))
            /* Add to playlist, one press from the song. */
            Surface(onClick = { adding = true }, shape = RoundedCornerShape(14.dp), color = MaterialTheme.colorScheme.secondaryContainer) {
                Row(Modifier.padding(horizontal = 14.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Icon(kimonoIcon("plus"), null, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onSecondaryContainer)
                    Text("Add to playlist", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSecondaryContainer)
                }
            }
        }
        if (adding) AddToPlaylist(player, listOf(t)) { adding = false }
    }
}

@Composable
private fun Scrubber(player: MusicPlayer) {
    var dragging by remember { mutableStateOf<Float?>(null) }
    val length = player.length.takeIf { it > 0 } ?: player.current?.duration ?: 0.0
    val at = dragging?.toDouble() ?: player.position
    Column(Modifier.fillMaxWidth().padding(horizontal = 24.dp)) {
        Box(contentAlignment = Alignment.Center) {
            LinearWavyProgressIndicator(progress = { if (length > 0) (at / length).toFloat().coerceIn(0f, 1f) else 0f }, modifier = Modifier.fillMaxWidth().height(10.dp), amplitude = { if (player.playing && dragging == null) 1f else 0f })
            Slider(
                value = at.toFloat().coerceIn(0f, length.toFloat().coerceAtLeast(1f)), onValueChange = { dragging = it }, onValueChangeFinished = { dragging?.let { player.seek(it.toDouble()) }; dragging = null },
                valueRange = 0f..length.toFloat().coerceAtLeast(1f), modifier = Modifier.fillMaxWidth(),
                colors = SliderDefaults.colors(activeTrackColor = Color.Transparent, inactiveTrackColor = Color.Transparent, thumbColor = MaterialTheme.colorScheme.primary),
            )
        }
        Row(Modifier.fillMaxWidth()) {
            Text(Music.clock(at), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.weight(1f))
            Text(Music.clock(length), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun Controls(player: MusicPlayer) {
    val inParty = player.party != null
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceEvenly) {
        Toggle(player.shuffle, enabled = !inParty, onClick = { player.toggleShuffle() }) { MusicGlyph("shuffle", it, 22.dp) }
        IconButton(onClick = { player.prev() }, modifier = Modifier.size(56.dp)) { MusicGlyph("prev", MaterialTheme.colorScheme.onSurface, 30.dp, filled = true) }
        Box(contentAlignment = Alignment.Center) {
            if (player.waiting) LoadingIndicator(Modifier.size(84.dp).clip(CircleShape).clickable { player.toggle() }, color = MaterialTheme.colorScheme.primary)
            else FilledIconButtonBig(if (player.playing) "pause" else "play", "Play", 72.dp) { player.toggle() }
        }
        IconButton(onClick = { player.next() }, modifier = Modifier.size(56.dp)) { MusicGlyph("next", MaterialTheme.colorScheme.onSurface, 30.dp, filled = true) }
        Box(contentAlignment = Alignment.TopEnd) {
            Toggle(player.repeat != "off", enabled = !inParty, onClick = { player.cycleRepeat() }) { MusicGlyph("repeat", it, 22.dp) }
            if (player.repeat == "one") Text("1", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold)
        }
    }
}

/** A pressed stamp when on: a seal with its ring inked, standing on its base when off. */
@Composable
private fun Toggle(on: Boolean, enabled: Boolean = true, onClick: () -> Unit, content: @Composable (Color) -> Unit) {
    val ink = if (on) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurfaceVariant
    Surface(onClick = onClick, enabled = enabled, shape = RoundedCornerShape(if (on) 12.dp else 24.dp), color = if (on) MaterialTheme.colorScheme.primaryContainer else Color.Transparent, modifier = Modifier.size(48.dp).alpha(if (enabled) 1f else .4f)) {
        Box(contentAlignment = Alignment.Center) { content(ink) }
    }
}

@Composable
private fun Tabs(panel: String?, inParty: Boolean, choose: (String) -> Unit) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        for ((id, label, glyph) in listOf(Triple("lyrics", "Lyrics", "lyrics"), Triple("queue", "Queue", "queue"), Triple("together", if (inParty) "Party" else "Together", "together"))) {
            val on = panel == id
            Surface(onClick = { choose(id) }, shape = RoundedCornerShape(if (on) 14.dp else 22.dp), color = if (on) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceContainerHigh, modifier = Modifier.weight(1f).height(44.dp)) {
                Row(horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
                    MusicGlyph(glyph, if (on) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurface, 18.dp)
                    Text(label, style = MaterialTheme.typography.labelLarge, modifier = Modifier.padding(start = 6.dp), color = if (on) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurface)
                }
            }
        }
    }
}

/* ── Lyrics: the line being sung in gold, the rest waiting ────────────── */

@Composable
private fun LyricsPanel(player: MusicPlayer) {
    val key = player.current?.key ?: return
    var lyrics by remember(key) { mutableStateOf<Lyrics?>(null) }
    var looked by remember(key) { mutableStateOf(false) }
    LaunchedEffect(key) { lyrics = runCatching { player.music.lyrics(key) }.getOrNull(); looked = true }
    val l = lyrics
    when {
        !looked -> MusicLoading()
        l == null || (l.synced.isNullOrEmpty() && l.plain.isNullOrBlank()) -> Center(if (l?.instrumental == true) "Instrumental — no words to follow." else "No lyrics for this one.")
        !l.synced.isNullOrEmpty() -> {
            val lines = l.synced
            /* Read from the engine every frame, so the line keeps time with the voice and lands at once after a seek. */
            var playing by remember(key) { mutableDoubleStateOf(player.livePosition()) }
            LaunchedEffect(key) { while (true) { withFrameMillis { playing = player.livePosition() } } }
            /* A touch early, so the line lights as it's sung; only a new line redraws the list. */
            val now by remember(lines) { derivedStateOf { lines.indexOfLast { it.at <= playing + .25 } } }
            val state = rememberLazyListState()
            LaunchedEffect(now) { if (now >= 0) state.animateScrollToItem((now - 2).coerceAtLeast(0)) }
            LazyColumn(state = state, contentPadding = PaddingValues(horizontal = 24.dp, vertical = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                itemsIndexed(lines) { i, line ->
                    val lit by animateFloatAsState(if (i == now) 1f else .32f, tween(300), label = "lit")
                    val grow by animateFloatAsState(if (i == now) 1.06f else 1f, spring(dampingRatio = .5f), label = "grow")
                    Text(line.line.ifBlank { "♪" }, style = MaterialTheme.typography.bodyLarge.copy(fontSize = 25.sp, lineHeight = 32.sp, fontWeight = FontWeight.Bold),
                        color = if (i == now) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
                        modifier = Modifier.alpha(lit).graphicsLayer { scaleX = grow; scaleY = grow; transformOrigin = androidx.compose.ui.graphics.TransformOrigin(0f, .5f) }.clickable { player.seek(line.at) })
                }
            }
        }
        else -> Text(l.plain.orEmpty(), style = MaterialTheme.typography.bodyLarge.copy(fontSize = 20.sp, lineHeight = 30.sp, fontWeight = FontWeight.SemiBold), modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp))
    }
}

@Composable
private fun Center(text: String) = Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
    Text(text, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
}

/* ── The queue ──────────────────────────────────────────────────────────── */

@Composable
private fun QueuePanel(player: MusicPlayer) {
    val list = player.queue
    val at = player.at
    val next = list.drop(at + 1)
    if (next.isEmpty()) { Center("Nothing next — when this ends, songs like it carry on."); return }
    LazyColumn(contentPadding = PaddingValues(vertical = 8.dp)) {
        item { Text("Up next", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(horizontal = 24.dp, vertical = 6.dp)) }
        itemsIndexed(next.take(100), key = { i, t -> "${at + 1 + i}" + t.key }) { i, t ->
            val index = at + 1 + i
            Row(Modifier.fillMaxWidth().clickable { player.jump(index) }.padding(horizontal = 16.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Cover(t.cover, 44.dp, corner = 6.dp)
                Column(Modifier.weight(1f)) {
                    Text(t.title, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyLarge)
                    Text(t.byline, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if (i > 0) IconButton(onClick = { player.move(index, index - 1) }) { Icon(kimonoIcon("chevron"), "Earlier", Modifier.graphicsLayer { rotationZ = -90f }) }
                IconButton(onClick = { player.remove(index) }) { Icon(kimonoIcon("close"), "Take out") }
            }
        }
    }
}

/* ── Listening together ────────────────────────────────────────────────── */

@Composable
private fun TogetherPanel(player: MusicPlayer, go: MusicGo) {
    val scope = rememberCoroutineScope()
    val party = player.party
    if (party == null) {
        var busy by remember { mutableStateOf(false) }
        Column(Modifier.fillMaxSize().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically)) {
            Text("Listen together", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
            Text("Friends hear the same song at the same moment, wherever they are. Anyone in it can play, skip and add songs.", textAlign = TextAlign.Center, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Seal("Start a party", busy = busy, icon = "people", onClick = {
                busy = true
                scope.launch {
                    runCatching { player.music.startParty(player.tracks.drop(player.index).take(200).map { it.key }, 0, player.position) }
                        .onSuccess { id -> MusicParty(id, player, scope).start(); player.share("/music/party/$id") }
                        .onFailure { player.say(it.message ?: "The party didn't start.") }
                    busy = false
                }
            })
        }
        return
    }
    val view = party.view
    var text by remember { mutableStateOf("") }
    LaunchedEffect(Unit) { party.unread = 0 }
    Column(Modifier.fillMaxSize().padding(horizontal = 16.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy((-8).dp)) {
                view?.members?.take(6)?.forEach { m -> val who = party.people[m.username]; Box { Portrait(who?.picture, who?.name, m.username, 32.dp); if (m.state == "loading") LoadingIndicator(Modifier.size(32.dp)) } }
            }
            Text("${view?.members?.size ?: 0} here", style = MaterialTheme.typography.labelLarge, modifier = Modifier.weight(1f))
            IconButton(onClick = { player.share("/music/party/${party.id}") }) { Icon(kimonoIcon("link"), "Send the link") }
            if (view?.host != null && view.host == player.me?.lowercase()) TextButtonSmall("End") { party.end() }
            TextButtonSmall("Leave") { party.leave() }
        }
        Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), horizontalArrangement = Arrangement.SpaceBetween) {
            Music.reactions.forEach { e ->
                Surface(onClick = { party.react(e) }, shape = CircleShape, color = MaterialTheme.colorScheme.surfaceContainerHigh, modifier = Modifier.size(46.dp)) {
                    Box(contentAlignment = Alignment.Center) { Text(e, fontSize = 22.sp) }
                }
            }
        }
        val chatState = rememberLazyListState()
        LaunchedEffect(party.chat.size) { if (party.chat.isNotEmpty()) chatState.animateScrollToItem(party.chat.lastIndex) }
        LazyColumn(Modifier.weight(1f), state = chatState, verticalArrangement = Arrangement.spacedBy(6.dp)) {
            if (party.chat.isEmpty()) item { Text("Say something to everyone here.", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(vertical = 12.dp)) }
            itemsIndexed(party.chat, key = { _, c -> c.id }) { _, c ->
                val who = party.people[c.username]
                Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Portrait(who?.picture, who?.name, c.username, 26.dp)
                    Column {
                        Text(who?.name?.substringBefore(' ')?.ifBlank { null } ?: c.username, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                        Text(c.text, style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }
        }
        Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(text, { text = it.take(500) }, Modifier.weight(1f), singleLine = true, placeholder = { Text("Say something") }, shape = RoundedCornerShape(24.dp))
            IconButton(onClick = { party.say(text); text = "" }, enabled = text.isNotBlank()) { Icon(kimonoIcon("send"), "Send") }
        }
    }
}

/** Reactions rising from the bottom and fading, a little apart. */
@Composable
private fun Floating(party: MusicParty) {
    Box(Modifier.fillMaxSize()) {
        party.floating.forEach { (id, emoji, _) ->
            key(id) {
                val rise = remember { androidx.compose.animation.core.Animatable(0f) }
                LaunchedEffect(Unit) { rise.animateTo(1f, tween(2500)) }
                val x = remember { (id * 37 % 70 + 15).toFloat() / 100f }
                BoxWithConstraints(Modifier.fillMaxSize()) {
                    Text(emoji, fontSize = 34.sp, modifier = Modifier.offset(x = maxWidth * x, y = maxHeight * (0.85f - .6f * rise.value)).alpha(1f - rise.value).graphicsLayer {
                        val s = .6f + rise.value * .8f
                        scaleX = s; scaleY = s; rotationZ = (rise.value - .5f) * 30f
                    })
                }
            }
        }
    }
}

@Composable
fun Toast(text: String, modifier: Modifier = Modifier) {
    Surface(shape = RoundedCornerShape(18.dp), color = MaterialTheme.colorScheme.inverseSurface, modifier = modifier.padding(horizontal = 24.dp)) {
        Text(text, color = MaterialTheme.colorScheme.inverseOnSurface, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(horizontal = 18.dp, vertical = 12.dp))
    }
}
