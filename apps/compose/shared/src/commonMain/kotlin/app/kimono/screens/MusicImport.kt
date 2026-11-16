package app.kimono.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.kimono.data.ImportAccount
import app.kimono.data.ImportMine
import app.kimono.data.ImportStep
import app.kimono.music.MusicPlayer
import app.kimono.ui.InkDialog
import app.kimono.ui.InkLoader
import app.kimono.ui.Seal
import app.kimono.ui.SealTone
import app.kimono.ui.clickable
import app.kimono.ui.kimonoIcon
import coil3.compose.AsyncImage
import kotlinx.coroutines.launch

private val serviceNames = mapOf("spotify" to "Spotify", "apple" to "Apple Music", "youtube" to "YouTube")
private val playlistLink = Regex("spotify\\.com|spotify:|music\\.apple\\.com|youtube\\.com|youtu\\.be")

/** The "Bring one in" tile beside New playlist on Music's You page. */
@Composable
internal fun BringInTile(onClick: () -> Unit) {
    Column(Modifier.width(148.dp).clickable(onClick = onClick)) {
        Box(Modifier.size(136.dp).clip(RoundedCornerShape(10.dp)).background(MaterialTheme.colorScheme.surfaceContainerHigh), contentAlignment = Alignment.Center) {
            Icon(kimonoIcon("download"), null, Modifier.size(34.dp), tint = MaterialTheme.colorScheme.primary)
        }
        Text("Bring one in", style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(top = 8.dp))
        Text("Spotify, Apple Music, YouTube", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/**
 * A playlist from Spotify, Apple Music or YouTube made one here, as on the
 * web: paste its link, or pick one of your own from a service you've
 * connected. The server reads it and finds each song, saying how it goes.
 */
@Composable
internal fun BringInDialog(player: MusicPlayer, onClose: () -> Unit, open: (String) -> Unit) {
    val scope = rememberCoroutineScope()
    var url by remember { mutableStateOf("") }
    var accounts by remember { mutableStateOf<List<ImportAccount>>(emptyList()) }
    /* Picking from one service: its name, and its playlists once they've come. */
    var picking by remember { mutableStateOf<String?>(null) }
    var mine by remember { mutableStateOf<List<ImportMine>?>(null) }
    var step by remember { mutableStateOf<ImportStep?>(null) }
    var name by remember { mutableStateOf("") }
    LaunchedEffect(Unit) { runCatching { accounts = player.music.importAccounts() } }
    LaunchedEffect(picking) {
        val s = picking ?: return@LaunchedEffect
        mine = null
        runCatching { player.music.importPlaylistsOf(s) }.onSuccess { mine = it }.onFailure { step = ImportStep("error", error = it.message ?: "${serviceNames[s]} didn't answer."); picking = null }
    }
    val busy = step?.stage == "read" || step?.stage == "match"
    fun start(link: String?, service: String?, playlist: String?) {
        if (busy) return
        step = ImportStep("read"); name = ""
        scope.launch {
            var ended = false
            runCatching {
                player.music.importPlaylist(link, service, playlist) { s ->
                    if (s.stage == "read") name = s.name
                    if (s.stage == "done" || s.stage == "error") ended = true
                    step = s
                }
            }.onFailure { step = ImportStep("error", error = it.message ?: "That playlist couldn't be brought in."); ended = true }
            if (!ended) step = ImportStep("error", error = "The import stopped partway. Try again.")
        }
    }
    val s = step
    InkDialog(
        title = if (picking != null && s == null) "Your ${serviceNames[picking]} playlists" else "Bring a playlist in", onDismiss = onClose, icon = "download",
        actions = {
            when {
                s?.stage == "done" -> { Seal("Close", onClose, tone = SealTone.Quiet, compact = true); Seal("Open it", { onClose(); s.playlist?.let { open(MusicRoutes.playlist(it.id)) } }, compact = true) }
                busy -> Seal("Hide", onClose, tone = SealTone.Quiet, compact = true)
                picking != null -> Seal("Back", { picking = null }, tone = SealTone.Quiet, compact = true)
                else -> { Seal("Cancel", onClose, tone = SealTone.Quiet, compact = true); Seal("Bring it in", { start(url.trim(), null, null) }, compact = true, enabled = playlistLink.containsMatchIn(url)) }
            }
        },
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            when {
                s != null && s.stage != "error" -> Progress(s, name)
                picking != null -> {
                    val list = mine
                    if (list == null) Box(Modifier.fillMaxWidth().height(120.dp), contentAlignment = Alignment.Center) { InkLoader() }
                    else if (list.isEmpty()) Text("No playlists there yet.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    else LazyColumn(Modifier.heightIn(max = 380.dp)) {
                        items(list, key = { it.id }) { p ->
                            Row(
                                Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).clickable { val svc = picking; picking = null; start(null, svc, p.id) }.padding(6.dp),
                                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
                            ) {
                                Box(Modifier.size(48.dp).clip(RoundedCornerShape(8.dp)).background(MaterialTheme.colorScheme.surfaceContainerHigh)) {
                                    p.cover?.let { AsyncImage(it, null, contentScale = ContentScale.Crop, modifier = Modifier.size(48.dp)) }
                                }
                                Column(Modifier.weight(1f)) {
                                    Text(p.name, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    p.count?.let { Text(if (it == 1) "1 song" else "$it songs", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                                }
                            }
                        }
                    }
                }
                else -> {
                    OutlinedTextField(
                        url, { url = it }, Modifier.fillMaxWidth(), singleLine = true, shape = RoundedCornerShape(16.dp),
                        placeholder = { Text("Paste a playlist link") },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go),
                        keyboardActions = KeyboardActions(onGo = { if (playlistLink.containsMatchIn(url)) start(url.trim(), null, null) }),
                    )
                    s?.error?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.error) }
                    /* Your own, from a service you've connected (connecting happens on the web). */
                    accounts.filter { it.connected }.forEach { a ->
                        Row(
                            Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(MaterialTheme.colorScheme.surfaceContainerHigh).clickable { step = null; picking = a.service }.padding(horizontal = 14.dp, vertical = 12.dp),
                            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            Icon(kimonoIcon("music"), null, Modifier.size(20.dp), tint = MaterialTheme.colorScheme.primary)
                            Text("Your ${serviceNames[a.service] ?: a.service} playlists", style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
                            Icon(kimonoIcon("chevron"), null, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
        }
    }
}

/** How an import is going: reading, then finding each song, then how many were found. */
@Composable
private fun Progress(s: ImportStep, name: String) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        when (s.stage) {
            "read" -> {
                Text("Reading the playlist…", style = MaterialTheme.typography.bodyLarge)
                Box(Modifier.fillMaxWidth().height(80.dp), contentAlignment = Alignment.Center) { InkLoader() }
            }
            "match" -> {
                if (name.isNotBlank()) Text(name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text("Finding songs · ${s.done} of ${s.total}", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Box(Modifier.fillMaxWidth().height(6.dp).clip(RoundedCornerShape(3.dp)).background(MaterialTheme.colorScheme.surfaceContainerHighest)) {
                    Box(Modifier.fillMaxHeight().fillMaxWidth(if (s.total > 0) (s.done.toFloat() / s.total).coerceIn(0f, 1f) else 0f).clip(RoundedCornerShape(3.dp)).background(MaterialTheme.colorScheme.primary))
                }
            }
            "done" -> {
                Text(s.playlist?.name ?: name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Text(if (s.found == s.total) "All ${s.total} songs found" else "Found ${s.found} of ${s.total} songs", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (s.missed.isNotEmpty()) Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text("Not found", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp))
                    s.missed.take(6).forEach { m -> Text("${m.title}${if (m.artists.isNotEmpty()) " · " + m.artists.joinToString(", ") else ""}", style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                    if (s.missed.size > 6) Text("and ${s.missed.size - 6} more", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
}
