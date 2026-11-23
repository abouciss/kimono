package app.kimono.ui

import androidx.compose.ui.Modifier

/**
 * Puts Reply in the system's own menu for selected text where the system draws
 * that menu itself (Android), and does nothing where Kimono draws its own (iOS).
 * [onReply] gets the menu's Copy, to take the selected words with.
 */
expect fun Modifier.replyInTextMenu(onReply: (copy: () -> Unit) -> Unit): Modifier
