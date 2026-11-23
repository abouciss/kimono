package app.kimono.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import app.kimono.data.Platform
import app.kimono.data.Stream
import app.kimono.theme.Kata

/**
 * A video played in Kimono, full screen on ink like an opened picture: streamed, so it starts at
 * once and seeks. [onOpenElsewhere] hands it to another app, for saving or a file this phone can't play.
 */
@Composable
fun VideoViewer(platform: Platform, name: String, stream: Stream, onOpenElsewhere: (() -> Unit)?, onClose: () -> Unit) {
    var failed by remember(stream.url) { mutableStateOf<String?>(null) }
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(Modifier.fillMaxSize().background(Kata.ink)) {
            Row(Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 8.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(name, color = Kata.lift, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f).padding(start = 8.dp))
                onOpenElsewhere?.let { IconButton(onClick = it) { Icon(kimonoIcon("download"), "Download", tint = Kata.lift) } }
                IconButton(onClick = onClose) { Icon(kimonoIcon("close"), "Close", tint = Kata.lift) }
            }
            Box(Modifier.weight(1f).fillMaxWidth().navigationBarsPadding(), contentAlignment = Alignment.Center) {
                val problem = failed
                if (problem == null) platform.VideoPlayer(stream, Modifier.fillMaxSize()) { failed = it }
                else Column(Modifier.padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(problem, color = Kata.lift, textAlign = TextAlign.Center)
                    onOpenElsewhere?.let { TextButton(onClick = it) { Text("Open in another app", color = Kata.lift) } }
                }
            }
        }
    }
}
