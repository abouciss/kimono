package app.kimono.ui

import androidx.compose.ui.Modifier

/* iOS asks LocalTextToolbar, which AnswerSelection fills with Copy and Reply. */
actual fun Modifier.replyInTextMenu(onReply: (copy: () -> Unit) -> Unit): Modifier = this
