package app.kimono.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathOperation
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import app.kimono.data.PickedPhoto
import coil3.compose.AsyncImage
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * Kimono's own cropper: the photo under a frame of [aspect] (1 for a
 * picture, 3 for a banner), round when [round]. Drag to move it, pinch or
 * slide to zoom; it always covers the frame. Use answers the cut in the
 * photo's own pixels, for Platform.cropPhoto to draw afresh.
 */
@Composable
fun PhotoCropDialog(photo: PickedPhoto, aspect: Float, round: Boolean, title: String, busy: Boolean, onDismiss: () -> Unit, onUse: (x: Int, y: Int, w: Int, h: Int) -> Unit) {
    var zoom by remember(photo) { mutableStateOf(1f) }
    var off by remember(photo) { mutableStateOf(Offset.Zero) }
    /* The frame's size in pixels, as last laid out: what Use cuts against. */
    val frame = remember { floatArrayOf(1f, 1f) }
    fun scaleFor(z: Float) = max(frame[0] / photo.width, frame[1] / photo.height) * z
    fun clamp(o: Offset, z: Float): Offset {
        val s = scaleFor(z)
        val mx = ((photo.width * s - frame[0]) / 2).coerceAtLeast(0f)
        val my = ((photo.height * s - frame[1]) / 2).coerceAtLeast(0f)
        return Offset(o.x.coerceIn(-mx, mx), o.y.coerceIn(-my, my))
    }
    InkDialog(title = title, onDismiss = onDismiss, icon = "camera", actions = {
        Seal("Cancel", compact = true, tone = SealTone.Quiet, enabled = !busy, onClick = onDismiss)
        Seal("Use this", compact = true, busy = busy, onClick = {
            val s = scaleFor(zoom)
            val left = (photo.width * s / 2 - off.x - frame[0] / 2) / s
            val top = (photo.height * s / 2 - off.y - frame[1] / 2) / s
            onUse(left.roundToInt().coerceAtLeast(0), top.roundToInt().coerceAtLeast(0), (frame[0] / s).roundToInt(), (frame[1] / s).roundToInt())
        })
    }) {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            BoxWithConstraints(Modifier.fillMaxWidth()) {
                val density = LocalDensity.current
                val fw = constraints.maxWidth.toFloat()
                val fh = fw / aspect
                frame[0] = fw; frame[1] = fh
                val s = scaleFor(zoom)
                Box(
                    Modifier.width(with(density) { fw.toDp() }).height(with(density) { fh.toDp() }).clip(RoundedCornerShape(if (round) 20.dp else 14.dp)).background(Color.Black)
                        .pointerInput(photo) {
                            detectTransformGestures { _, pan, gesture, _ ->
                                val z = (zoom * gesture).coerceIn(1f, 4f)
                                zoom = z
                                off = clamp(off + pan, z)
                            }
                        },
                    contentAlignment = Alignment.Center,
                ) {
                    AsyncImage(
                        photo.bytes, null, contentScale = ContentScale.FillBounds,
                        modifier = Modifier.requiredSize(with(density) { (photo.width * s).toDp() }, with(density) { (photo.height * s).toDp() }).graphicsLayer { translationX = off.x; translationY = off.y },
                    )
                    Canvas(Modifier.fillMaxSize()) {
                        if (round) {
                            /* Outside the circle is dimmed: what stays lit is what's kept. */
                            val r = size.minDimension / 2 - 4.dp.toPx()
                            val outside = Path().apply { op(Path().apply { addRect(Rect(Offset.Zero, size)) }, Path().apply { addOval(Rect(center, r)) }, PathOperation.Difference) }
                            drawPath(outside, Color(0xCC0E0A08))
                            drawCircle(Color.White.copy(alpha = .8f), r, style = Stroke(2.dp.toPx()))
                        } else {
                            /* Thirds, faintly, to place it by. */
                            val line = Color.White.copy(alpha = .4f)
                            for (i in 1..2) {
                                drawLine(line, Offset(size.width * i / 3, 0f), Offset(size.width * i / 3, size.height), 1f)
                                drawLine(line, Offset(0f, size.height * i / 3), Offset(size.width, size.height * i / 3), 1f)
                            }
                        }
                    }
                }
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Icon(kimonoIcon("search"), null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(18.dp))
                Slider(
                    zoom, { z -> zoom = z; off = clamp(off, z) }, valueRange = 1f..4f, modifier = Modifier.weight(1f),
                    colors = SliderDefaults.colors(thumbColor = MaterialTheme.colorScheme.primary, activeTrackColor = MaterialTheme.colorScheme.primary),
                )
            }
            Text("Drag to move · pinch to zoom", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.align(Alignment.CenterHorizontally))
        }
    }
}
