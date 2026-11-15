@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterial3ExpressiveApi::class)

package app.kimono.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.kimono.data.AlbumPage
import app.kimono.data.ArtistPage
import app.kimono.data.FriendOnSong
import app.kimono.data.KimonoProblem
import app.kimono.data.Lyrics
import app.kimono.data.Music
import app.kimono.data.PartyNow
import app.kimono.data.PlaylistPage
import app.kimono.data.QueueSource
import app.kimono.data.Track
import app.kimono.data.TrackPage
import app.kimono.music.MusicParty
import app.kimono.music.MusicPlayer
import app.kimono.ui.IconButton
import app.kimono.ui.InkMenuItem
import app.kimono.ui.InkSheet
import app.kimono.ui.KimonoTopBar
import app.kimono.ui.Portrait
import app.kimono.ui.Seal
import app.kimono.ui.SealTone
import app.kimono.ui.kimonoIcon
import kotlinx.coroutines.launch

/** A page's head: its art large, its name, what it is, and its marks. */
@Composable
private fun Head(art: @Composable () -> Unit, kicker: String, title: String, meta: String, marks: (@Composable () -> Unit)? = null) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        art()
        Text(kicker, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(top = 16.dp))
        Text(title, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center, maxLines = 3, overflow = TextOverflow.Ellipsis)
        if (meta.isNotBlank()) Text(meta, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 4.dp))
        marks?.invoke()
    }
}

@Composable
private fun <T> loaded(key: Any, known: T?, load: suspend () -> T): Triple<T?, String?, () -> Unit> {
    var value by remember(key) { mutableStateOf(known) }
    var problem by remember(key) { mutableStateOf<String?>(null) }
    var tries by remember(key) { mutableIntStateOf(0) }
    LaunchedEffect(key, tries) { runCatching { load() }.onSuccess { value = it; problem = null }.onFailure { if (value == null) problem = it.message ?: "Music couldn't load." } }
    return Triple(value, problem, { tries++ })
}

/* ── Artist ─────────────────────────────────────────────────────────────── */

@Composable
fun MusicArtistScreen(player: MusicPlayer, id: String, go: MusicGo, back: () -> Unit) {
    val key = Music.keyOf(id)
    val (page, problem, retry) = loaded(key, player.music.known<ArtistPage>("artist?key=dz%3A$id")) { player.music.artist(key) }
    Scaffold(containerColor = MaterialTheme.colorScheme.surface, topBar = { KimonoTopBar("", onBack = back) }) { pad ->
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(top = pad.calculateTopPadding(), bottom = 24.dp)) {
            val p = page
            if (p == null) { item { if (problem != null) MusicProblem(problem, retry) else MusicLoading() }; return@LazyColumn }
            item {
                LaunchedEffect(p.rating) { if (p.rating != null && player.ratingOf("artist", key) == null) player.ratings["artist:$key"] = p.rating }
                Head({ Cover(p.artist.picture, 200.dp, round = true) }, p.artist.tags.take(3).joinToString(" · ").ifBlank { "Artist" }, p.artist.name,
                    if (p.artist.fans > 0) "${app.kimono.data.Books.count(p.artist.fans.toInt())} fans" else "") { RateMarks(player, "artist", key, modifier = Modifier.padding(top = 4.dp)) }
            }
            item { PlayAll(player, p.top, QueueSource("artist", key, p.artist.name), Modifier.padding(vertical = 12.dp)) }
            item { Text("Popular", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp)) }
            itemsIndexed(p.top.take(10), key = { _, t -> "t" + t.key }) { i, t -> SongRow(player, t, { player.play(p.top, i, QueueSource("artist", key, p.artist.name)) }, go, number = i + 1) }
            val albums = p.albums.filter { it.kind == "album" || it.kind == "compile" }
            val singles = p.albums.filter { it.kind == "single" || it.kind == "ep" }
            if (albums.isNotEmpty()) item { Shelf("Albums") { items(albums, key = { it.key }) { AlbumTile(player, it, go) } } }
            if (singles.isNotEmpty()) item { Shelf("Singles and EPs") { items(singles, key = { it.key }) { AlbumTile(player, it, go, 128.dp) } } }
            if (p.related.isNotEmpty()) item { Shelf("Fans also like") { items(p.related, key = { it.key }) { ArtistTile(it, go, 104.dp) } } }
        }
    }
}

/* ── Album ──────────────────────────────────────────────────────────────── */

@Composable
fun MusicAlbumScreen(player: MusicPlayer, id: String, go: MusicGo, back: () -> Unit) {
    val key = Music.keyOf(id)
    val (page, problem, retry) = loaded(key, player.music.known<AlbumPage>("album?key=dz%3A$id")) { player.music.album(key) }
    var adding by remember { mutableStateOf(false) }
    Scaffold(containerColor = MaterialTheme.colorScheme.surface, topBar = { KimonoTopBar("", onBack = back) }) { pad ->
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(top = pad.calculateTopPadding(), bottom = 24.dp)) {
            val p = page
            if (p == null) { item { if (problem != null) MusicProblem(problem, retry) else MusicLoading() }; return@LazyColumn }
            val a = p.album
            val src = QueueSource("album", key, a.title)
            val here = player.source?.id == key && player.playing
            item {
                LaunchedEffect(p.rating) { if (p.rating != null && player.ratingOf("album", key) == null) player.ratings["album:$key"] = p.rating }
                Head({
                    /* The record slides out of its sleeve while the album plays. */
                    Box(Modifier.width(280.dp).height(220.dp)) {
                        val out by androidx.compose.animation.core.animateDpAsState(if (here) 70.dp else 20.dp, androidx.compose.animation.core.spring(dampingRatio = .6f, stiffness = 120f), label = "out")
                        Vinyl(a.cover, here, 206.dp, Modifier.align(Alignment.CenterStart).offset(x = out + 10.dp))
                        Cover(a.cover, 214.dp, Modifier.align(Alignment.CenterStart))
                    }
                }, listOf(a.kind.replaceFirstChar { it.uppercase() }.replace("Compile", "Compilation"), a.year?.toString()).filterNotNull().joinToString(" · "), a.title, a.artist?.name.orEmpty()) {
                    RateMarks(player, "album", key, modifier = Modifier.padding(top = 4.dp))
                }
            }
            item {
                PlayAll(player, a.tracks, src, Modifier.padding(vertical = 12.dp)) {
                    IconButton(onClick = { adding = true }) { Icon(kimonoIcon("plus"), "Add to playlist") }
                }
            }
            itemsIndexed(a.tracks, key = { _, t -> t.key }) { i, t -> SongRow(player, t, { player.play(a.tracks, i, src) }, go, number = i + 1, art = false) }
            a.artist?.let { ar -> item { Seal("More by ${ar.name}", { go(MusicRoutes.artist(ar.key)) }, tone = SealTone.Quiet, compact = true, modifier = Modifier.padding(20.dp)) } }
        }
    }
    if (adding) page?.album?.tracks?.let { AddToPlaylist(player, it) { adding = false } }
}

/* ── Song ───────────────────────────────────────────────────────────────── */

@Composable
fun MusicSongScreen(player: MusicPlayer, id: String, go: MusicGo, back: () -> Unit) {
    val key = Music.keyOf(id)
    val (page, problem, retry) = loaded(key, player.music.known<TrackPage>("track?key=dz%3A$id")) { player.music.track(key) }
    var lyrics by remember(key) { mutableStateOf<Lyrics?>(null) }
    var friends by remember(key) { mutableStateOf<List<FriendOnSong>>(emptyList()) }
    var more by remember(key) { mutableStateOf<List<Track>>(emptyList()) }
    var menu by remember { mutableStateOf(false) }
    LaunchedEffect(key) { lyrics = runCatching { player.music.lyrics(key) }.getOrNull() }
    LaunchedEffect(key) { friends = runCatching { player.music.songFriends(key) }.getOrDefault(emptyList()) }
    LaunchedEffect(page?.track?.album?.key) { page?.track?.album?.key?.let { more = runCatching { player.music.album(it).album.tracks }.getOrDefault(emptyList()) } }
    Scaffold(containerColor = MaterialTheme.colorScheme.surface, topBar = {
        KimonoTopBar("", onBack = back) { IconButton(onClick = { player.share("/music/song/$id") }) { Icon(kimonoIcon("share"), "Share") } }
    }) { pad ->
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(top = pad.calculateTopPadding(), bottom = 24.dp)) {
            val p = page
            if (p == null) { item { if (problem != null) MusicProblem(problem, retry) else MusicLoading() }; return@LazyColumn }
            val t = p.track
            val now = player.current?.key == t.key
            item {
                LaunchedEffect(p.rating) { if (p.rating != null && player.ratingOf("track", key) == null) player.ratings["track:$key"] = p.rating }
                Head({ Vinyl(t.cover, now && player.playing, 240.dp) }, "Song · ${Music.clock(t.duration)}", t.title, t.byline) {
                    RateMarks(player, "track", key, modifier = Modifier.padding(top = 4.dp))
                }
            }
            item {
                Row(Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp, Alignment.CenterHorizontally), verticalAlignment = Alignment.CenterVertically) {
                    FilledIconButtonBig(if (now && player.playing) "pause" else "play", "Play") { if (now) player.toggle() else player.play(listOf(t), 0, QueueSource("song", key, t.title)) }
                    IconButton(onClick = { menu = true }) { Icon(kimonoIcon("more"), "More") }
                }
            }
            if (friends.isNotEmpty()) item {
                Row(Modifier.padding(horizontal = 20.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(horizontalArrangement = Arrangement.spacedBy((-8).dp)) { friends.take(4).forEach { Portrait(it.picture, it.name, it.username, 28.dp) } }
                    val loved = friends.filter { it.loved }
                    Text(when {
                        loved.isNotEmpty() -> "${loved.first().name.substringBefore(' ')}${if (loved.size > 1) " and ${loved.size - 1} more" else ""} love this"
                        else -> "${friends.first().name.substringBefore(' ')}${if (friends.size > 1) " and ${friends.size - 1} more" else ""} played this"
                    }, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            lyrics?.let { l ->
                val lines = l.synced?.map { it.line }?.filter { it.isNotBlank() } ?: l.plain?.lines()
                if (!lines.isNullOrEmpty()) item {
                    Surface(shape = RoundedCornerShape(24.dp), color = MaterialTheme.colorScheme.primaryContainer, modifier = Modifier.fillMaxWidth().padding(16.dp)) {
                        Column(Modifier.padding(20.dp)) {
                            Text("Lyrics", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onPrimaryContainer)
                            Text(lines.take(12).joinToString("\n"), style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onPrimaryContainer, modifier = Modifier.padding(top = 8.dp))
                            if (lines.size > 12) Text("…", color = MaterialTheme.colorScheme.onPrimaryContainer)
                        }
                    }
                }
            }
            val rest = more.filter { it.key != t.key }
            if (rest.isNotEmpty()) {
                item { Text("From ${t.album?.title ?: "the album"}", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp)) }
                itemsIndexed(rest.take(8), key = { _, x -> "m" + x.key }) { i, x -> SongRow(player, x, { player.play(rest, i, QueueSource("album", t.album?.key ?: "", t.album?.title ?: "")) }, go) }
            }
        }
    }
    if (menu) page?.track?.let { SongMenu(player, it, go) { menu = false } }
}

/* ── Playlist ───────────────────────────────────────────────────────────── */

@Composable
fun MusicPlaylistScreen(player: MusicPlayer, id: String, go: MusicGo, back: () -> Unit) {
    val scope = rememberCoroutineScope()
    var page by remember(id) { mutableStateOf(player.music.knownPlaylist(id)) }
    var problem by remember(id) { mutableStateOf<String?>(null) }
    var tries by remember { mutableIntStateOf(0) }
    var menu by remember { mutableStateOf(false) }
    var renaming by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf(false) }
    var rowMenu by remember { mutableStateOf<Int?>(null) }
    LaunchedEffect(id, tries) { runCatching { player.music.playlist(id) }.onSuccess { page = it; problem = null }.onFailure { if (page == null) problem = it.message } }
    fun change(work: suspend () -> PlaylistPage) = scope.launch { runCatching { work() }.onSuccess { page = it }.onFailure { player.say(it.message ?: "That didn't save.") } }
    Scaffold(containerColor = MaterialTheme.colorScheme.surface, topBar = {
        KimonoTopBar("", onBack = back) {
            IconButton(onClick = { player.share("/music/playlist/$id") }) { Icon(kimonoIcon("share"), "Share") }
            if (page?.mine == true) IconButton(onClick = { menu = true }) { Icon(kimonoIcon("more"), "More") }
        }
    }) { pad ->
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(top = pad.calculateTopPadding(), bottom = 24.dp)) {
            val p = page
            if (p == null) { item { if (problem != null) MusicProblem(problem!!) { tries++ } else MusicLoading() }; return@LazyColumn }
            val src = QueueSource("playlist", id, p.name)
            item {
                Head({ Mosaic(p.tracks.mapNotNull { it.cover }.distinct().take(4), 220.dp) }, listOfNotNull("Playlist", p.visibility?.replaceFirstChar { it.uppercase() }).joinToString(" · "), p.name,
                    if (p.mine) "" else "By ${p.owner?.name ?: p.owner?.username.orEmpty()}")
            }
            item { PlayAll(player, p.tracks, src, Modifier.padding(vertical = 12.dp)) }
            if (p.tracks.isEmpty()) item { Text("Add songs from their menu: Add to playlist.", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(24.dp)) }
            itemsIndexed(p.tracks, key = { i, t -> "$i" + t.key }) { i, t -> SongRow(player, t, { player.play(p.tracks, i, src) }, go) }
            if (p.mine && p.tracks.isNotEmpty()) item { Seal("Arrange songs", { rowMenu = -1 }, tone = SealTone.Quiet, compact = true, modifier = Modifier.padding(20.dp)) }
        }
    }
    val p = page
    if (rowMenu == -1 && p != null) ArrangeSheet(p, onMove = { from, to -> change { player.music.setPlaylist(id, p.tracks.map { it.key }.toMutableList().apply { add(to, removeAt(from)) }) } }, onRemove = { i -> change { player.music.setPlaylist(id, p.tracks.filterIndexed { n, _ -> n != i }.map { it.key }) } }) { rowMenu = null }
    if (menu && p != null) InkSheet(onDismissRequest = { menu = false }) {
        InkMenuItem("Rename", { menu = false; renaming = true }, icon = "edit")
        if (p.visibility != null) {
            val public = p.visibility == "public"
            InkMenuItem(if (public) "Make it private" else "Make it public", { menu = false; scope.launch { if (player.music.setVisibility(id, if (public) "private" else "public")) tries++ else player.say("That didn't save.") } }, icon = "lock")
        }
        InkMenuItem("Delete playlist", { menu = false; deleting = true }, icon = "trash", danger = true)
    }
    if (renaming && p != null) {
        var name by remember { mutableStateOf(p.name) }
        app.kimono.ui.InkDialog("Rename", onDismiss = { renaming = false }, actions = {
            Seal("Cancel", { renaming = false }, tone = SealTone.Quiet, compact = true)
            Seal("Save", { renaming = false; change { player.music.renamePlaylist(id, name.trim()) } }, compact = true, enabled = name.isNotBlank())
        }) { OutlinedTextField(name, { name = it.take(100) }, Modifier.fillMaxWidth(), singleLine = true, shape = RoundedCornerShape(16.dp)) }
    }
    if (deleting && p != null) app.kimono.ui.InkConfirm(
        title = "Delete “${p.name}”?", text = "The songs stay in Music; only the playlist goes.", action = "Delete", danger = true, icon = "trash",
        onDismiss = { deleting = false }, onConfirm = { deleting = false; scope.launch { runCatching { player.music.deletePlaylist(id) }.onSuccess { back() }.onFailure { player.say(it.message ?: "It wasn't deleted.") } } },
    )
}

/** Your playlist's songs in order: nudge one up or down, or take it out. */
@Composable
private fun ArrangeSheet(p: PlaylistPage, onMove: (Int, Int) -> Unit, onRemove: (Int) -> Unit, onDone: () -> Unit) {
    InkSheet(onDismissRequest = onDone, seed = "arrange") {
        app.kimono.ui.InkTitle("Arrange", modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp))
        LazyColumn(Modifier.heightIn(max = 520.dp)) {
            itemsIndexed(p.tracks, key = { i, t -> "$i" + t.key }) { i, t ->
                Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Cover(t.cover, 40.dp, corner = 6.dp)
                    Text(t.title, Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    IconButton(onClick = { if (i > 0) onMove(i, i - 1) }, enabled = i > 0) { Icon(kimonoIcon("chevron"), "Up", Modifier.graphicsRotate(-90f)) }
                    IconButton(onClick = { if (i < p.tracks.lastIndex) onMove(i, i + 1) }, enabled = i < p.tracks.lastIndex) { Icon(kimonoIcon("chevron"), "Down", Modifier.graphicsRotate(90f)) }
                    IconButton(onClick = { onRemove(i) }) { Icon(kimonoIcon("close"), "Take out") }
                }
            }
        }
    }
}

private fun Modifier.graphicsRotate(deg: Float) = this.rotate(deg)

/* ── A listen party, by its link ───────────────────────────────────────── */

@Composable
fun MusicPartyScreen(player: MusicPlayer, id: String, go: MusicGo, back: () -> Unit) {
    val scope = rememberCoroutineScope()
    val mine = player.party?.takeIf { it.id == id }
    var peek by remember(id) { mutableStateOf<PartyNow?>(null) }
    var problem by remember(id) { mutableStateOf<String?>(null) }
    LaunchedEffect(id) { runCatching { player.music.partyNow(id) }.onSuccess { peek = it }.onFailure { problem = it.message ?: "This listen party has ended." } }
    Scaffold(containerColor = MaterialTheme.colorScheme.surface, topBar = { KimonoTopBar("Listen party", onBack = back) }) { pad ->
        Column(Modifier.fillMaxSize().padding(top = pad.calculateTopPadding()).padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
            val view = mine?.view ?: peek?.state
            when {
                problem != null && mine == null -> Text(problem!!, style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center)
                view == null -> MusicLoading()
                else -> {
                    val song = view.song
                    val host = (mine?.people?.get(view.host) ?: peek?.people?.firstOrNull { it.username == view.host })
                    Vinyl(song?.cover, view.playing, 220.dp)
                    Text("${host?.name?.substringBefore(' ') ?: view.host}'s party", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
                    Text(song?.title ?: "Listening together", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
                    song?.let { Text(it.byline, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    Row(horizontalArrangement = Arrangement.spacedBy((-8).dp)) {
                        view.members.take(6).forEach { m -> val who = mine?.people?.get(m.username) ?: peek?.people?.firstOrNull { it.username == m.username }; Portrait(who?.picture, who?.name, m.username, 34.dp) }
                    }
                    Text(if (view.members.size == 1) "1 here" else "${view.members.size} here", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Spacer(Modifier.height(8.dp))
                    if (mine != null) Seal("Open the party", { player.nowPlayingOpen = true }, icon = "people")
                    else Seal("Join", { MusicParty(id, player, scope).start(); player.nowPlayingOpen = true }, icon = "people")
                }
            }
        }
    }
}

