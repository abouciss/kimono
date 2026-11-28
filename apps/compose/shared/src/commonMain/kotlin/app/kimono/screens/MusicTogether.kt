package app.kimono.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.kimono.data.FriendPerson
import app.kimono.data.Friends
import app.kimono.data.attempt
import app.kimono.music.MusicPlayer
import app.kimono.ui.InkDialog
import app.kimono.ui.InkLoader
import app.kimono.ui.Portrait
import app.kimono.ui.Seal
import app.kimono.ui.clickable

/*
 * 共 Listening together with someone in particular: the server could always ask friends along
 * (a party's `invite`), but the app only handed out a link. These pick who, and ask them.
 */

/**
 * Starts a listen party and joins it: from [keys] (a friend's song, say) or else from your queue as it
 * stands, asking [invite] along. Answers the party's id, or null once [say] has told why it didn't start.
 */
suspend fun startParty(player: MusicPlayer, invite: List<String>, keys: List<String>? = null): String? {
    val from = keys ?: player.tracks.drop(player.index).take(200).map { it.key }
    if (from.isEmpty()) { player.say("Play something first, then listen together."); return null }
    return attempt { player.music.startParty(from, 0, if (keys == null) player.position else 0.0, invite) }
        .onSuccess { id -> player.joinParty(id); player.nowPlayingOpen = true }
        .onFailure { player.say(if (it.message == app.kimono.data.OFFLINE) "No connection, so the party can't start." else it.message ?: "The party didn't start.") }
        .getOrNull()
}

/**
 * Your friends, to tick who to ask along. [already] are in or asked, and aren't offered again.
 * [action] names the button ("Start the party", "Invite"); [allowNone] lets it go with nobody ticked.
 */
@Composable
fun InviteFriendsDialog(player: MusicPlayer, already: Set<String>, action: String, allowNone: Boolean, onDismiss: () -> Unit, onDone: (List<String>) -> Unit) {
    var friends by remember { mutableStateOf<List<FriendPerson>?>(null) }
    var problem by remember { mutableStateOf<String?>(null) }
    val picked = remember { mutableStateListOf<String>() }
    LaunchedEffect(Unit) {
        attempt { Friends(player.music.session).list().friends }
            .onSuccess { list -> friends = list.filter { it.username.lowercase() !in already }.sortedBy { (it.name.ifBlank { it.username }).lowercase() } }
            .onFailure { problem = if (it.message == app.kimono.data.OFFLINE) "No connection, so your friends can't be listed." else it.message ?: "Your friends didn't load." }
    }
    InkDialog(
        title = "Listen together",
        onDismiss = onDismiss,
        icon = "people",
        actions = {
            TextButton(onClick = onDismiss) { Text("Cancel") }
            Seal(if (picked.isEmpty() || !allowNone) action else "$action (${picked.size})", onClick = { onDone(picked.toList()) }, enabled = allowNone || picked.isNotEmpty(), compact = true)
        },
    ) {
        Text("Friends you ask hear the same song at the same moment, wherever they are.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        val list = friends
        when {
            problem != null -> Text(problem!!, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(vertical = 12.dp))
            list == null -> Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) { InkLoader() }
            list.isEmpty() -> Text(if (already.isEmpty()) "Add friends in Kimono to listen together." else "Every friend is already here or asked.",
                color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(vertical = 12.dp))
            else -> LazyColumn(Modifier.fillMaxWidth().heightIn(max = 360.dp)) {
                items(list, key = { it.username }) { f ->
                    val on = f.username in picked
                    Row(
                        Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).clickable { if (on) picked.remove(f.username) else picked.add(f.username) }.padding(horizontal = 4.dp, vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Portrait(f.picture, f.name, f.username, 40.dp)
                        Column(Modifier.weight(1f)) {
                            Text(f.name.ifBlank { f.username }, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text("@${f.username}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
                        }
                        Checkbox(checked = on, onCheckedChange = { if (it) picked.add(f.username) else picked.remove(f.username) })
                    }
                }
            }
        }
    }
}
