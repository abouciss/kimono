@file:androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)

package app.kimono.android

import android.graphics.Color
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.Tracks
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.ResolvingDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.PlayerView
import app.kimono.data.Stream
import kotlinx.coroutines.runBlocking
import java.io.IOException

/**
 * A Kimono video in Media3's ExoPlayer, read straight from the server with ranges: it starts once
 * a few seconds have arrived and a seek asks only for that spot. Each read carries a fresh sign-in,
 * so a long film outlives the token it started with. Pauses when the app leaves the screen.
 */
@Composable
fun KimonoVideo(stream: Stream, modifier: Modifier, onFailed: (String) -> Unit) {
    val context = LocalContext.current
    val failed = rememberUpdatedState(onFailed)
    val player = remember(stream.url) {
        val http = DefaultHttpDataSource.Factory().setUserAgent("Kimono").setAllowCrossProtocolRedirects(true)
            .setConnectTimeoutMs(20_000).setReadTimeoutMs(30_000)
        /* Reads run on the player's loader thread, so waiting for a token here holds nothing up. */
        val signed = ResolvingDataSource.Factory(http) { spec ->
            val token = try { runBlocking { stream.token() } } catch (e: Exception) { throw IOException("Signed out", e) }
            spec.withAdditionalHeaders(mapOf("Authorization" to "Bearer $token"))
        }
        ExoPlayer.Builder(context)
            .setMediaSourceFactory(DefaultMediaSourceFactory(signed))
            .setAudioAttributes(AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(), true)
            .setHandleAudioBecomingNoisy(true)
            .setSeekBackIncrementMs(10_000).setSeekForwardIncrementMs(10_000)
            .build().apply {
                setMediaItem(MediaItem.fromUri(stream.url))
                prepare()
                playWhenReady = true
            }
    }
    DisposableEffect(player) {
        val listener = object : Player.Listener {
            override fun onPlayerError(error: PlaybackException) = failed.value(sayingOf(error))
            /* A picture the phone can't decode plays as sound over black: say so instead. */
            override fun onTracksChanged(tracks: Tracks) {
                val pictures = tracks.groups.filter { it.type == C.TRACK_TYPE_VIDEO }
                if (pictures.isNotEmpty() && pictures.none { it.isSupported }) {
                    player.stop()
                    failed.value("This phone can't play this video's picture.")
                }
            }
        }
        player.addListener(listener)
        onDispose { player.removeListener(listener); player.release() }
    }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lifecycle, player) {
        val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_STOP) player.pause() }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }
    AndroidView(
        modifier = modifier,
        factory = { PlayerView(it).apply {
            setBackgroundColor(Color.BLACK)
            setShutterBackgroundColor(Color.TRANSPARENT)
            setShowBuffering(PlayerView.SHOW_BUFFERING_WHEN_PLAYING)
            setShowNextButton(false); setShowPreviousButton(false)
            controllerAutoShow = true
            keepScreenOn = true
            this.player = player
        } },
        update = { it.player = player },
        onRelease = { it.player = null },
    )
}

private fun sayingOf(error: PlaybackException): String = when (error.errorCode) {
    PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED,
    PlaybackException.ERROR_CODE_DECODING_FORMAT_EXCEEDS_CAPABILITIES,
    PlaybackException.ERROR_CODE_DECODER_INIT_FAILED,
    PlaybackException.ERROR_CODE_DECODER_QUERY_FAILED,
    /* A decoder that claims the format and then chokes on it. */
    PlaybackException.ERROR_CODE_DECODING_FAILED,
    PlaybackException.ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED,
    PlaybackException.ERROR_CODE_PARSING_CONTAINER_MALFORMED,
    PlaybackException.ERROR_CODE_PARSING_MANIFEST_UNSUPPORTED -> "This phone can't play this video."
    PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED,
    PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT -> "The video stopped loading. Check your connection."
    PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS,
    PlaybackException.ERROR_CODE_IO_FILE_NOT_FOUND -> "That video couldn't be opened."
    else -> "That video couldn't be played."
}
