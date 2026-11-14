package app.kimono.watch.ui

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.dp
import app.kimono.watch.theme.Night

/** The flat paper wash behind whatever the D-pad or keyboard is on. */
val FocusWash = androidx.compose.ui.graphics.Color(0x38F4E9E1)

/**
 * Clickable with the demo's feel: presses in to 97%, and when reached by
 * keyboard or D-pad (focus-visible) sits on a paper wash with the blush
 * outline, so focus reads as a backdrop rather than a size change.
 * Pass [source] to read focus yourself (a filled button changes its fill
 * instead, with outline = false).
 */
fun Modifier.clickableScale(onClick: () -> Unit, focusScale: Float = 1f, outline: Boolean = true, source: MutableInteractionSource? = null): Modifier = composed {
    val source = source ?: remember { MutableInteractionSource() }
    val pressed by source.collectIsPressedAsState()
    val focused by source.collectIsFocusedAsState()
    val scale by animateFloatAsState(if (pressed) 0.97f else if (focused) focusScale else 1f, spring(dampingRatio = 0.55f, stiffness = 500f), label = "press")
    this
        .graphicsLayer { scaleX = scale; scaleY = scale }
        .drawWithContent {
            val show = focused && outline
            val pad = 3.dp.toPx()
            val at = androidx.compose.ui.geometry.Offset(-pad, -pad)
            val box = androidx.compose.ui.geometry.Size(size.width + pad * 2, size.height + pad * 2)
            if (show) drawRoundRect(FocusWash, topLeft = at, size = box, cornerRadius = CornerRadius(8.dp.toPx()))
            drawContent()
            if (show) drawRoundRect(Night.blush, topLeft = at, size = box, cornerRadius = CornerRadius(8.dp.toPx()), style = Stroke(2.dp.toPx()))
        }
        .clickable(interactionSource = source, indication = null, onClick = onClick)
}

/** [clickableScale] on a rounded shape: the focus outline stays outside the clip. */
fun Modifier.clickableScaleClipped(shape: androidx.compose.ui.graphics.Shape, onClick: () -> Unit, focusScale: Float = 1f, outline: Boolean = true): Modifier =
    this.clickableScale(onClick, focusScale, outline).then(Modifier.clip(shape))
