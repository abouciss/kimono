package app.kimono.ui

import androidx.compose.foundation.text.contextmenu.builder.item
import androidx.compose.foundation.text.contextmenu.data.TextContextMenuItem
import androidx.compose.foundation.text.contextmenu.data.TextContextMenuKeys
import androidx.compose.foundation.text.contextmenu.modifier.appendTextContextMenuComponents
import androidx.compose.foundation.text.contextmenu.modifier.filterTextContextMenuComponents
import androidx.compose.ui.Modifier

private object ReplyKey

/* Android's text menu never asks LocalTextToolbar, so Reply joins its items; Copy is kept as the menu builds to take the words with. */
actual fun Modifier.replyInTextMenu(onReply: (copy: () -> Unit) -> Unit): Modifier {
    var copy: TextContextMenuItem? = null
    return this
        .filterTextContextMenuComponents { if (it.key == TextContextMenuKeys.CopyKey && it is TextContextMenuItem) copy = it; true }
        .appendTextContextMenuComponents {
            item(ReplyKey, "Reply") {
                val session = this
                copy?.let { c -> onReply { c.onClick(session) } }
                close()
            }
        }
}
