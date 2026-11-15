@file:OptIn(ExperimentalForeignApi::class)

package app.kimono.ios

import app.kimono.music.MusicAudio
import app.kimono.music.MusicAudioEvents
import app.kimono.music.NowPlayingInfo
import kotlinx.cinterop.ExperimentalForeignApi
import platform.AVFAudio.AVAudioSession
import platform.AVFAudio.AVAudioSessionCategoryPlayback
import platform.AVFoundation.AVPlayer
import platform.AVFoundation.AVPlayerItem
import platform.AVFoundation.AVPlayerItemDidPlayToEndTimeNotification
import platform.AVFoundation.AVPlayerItemFailedToPlayToEndTimeNotification
import platform.AVFoundation.AVPlayerItemStatusFailed
import platform.AVFoundation.AVPlayerItemStatusReadyToPlay
import platform.AVFoundation.AVPlayerTimeControlStatusPlaying
import platform.AVFoundation.AVPlayerTimeControlStatusWaitingToPlayAtSpecifiedRate
import platform.AVFoundation.AVURLAsset
import platform.AVFoundation.currentItem
import platform.AVFoundation.currentTime
import platform.AVFoundation.duration
import platform.AVFoundation.pause
import platform.AVFoundation.play
import platform.AVFoundation.rate
import platform.AVFoundation.replaceCurrentItemWithPlayerItem
import platform.AVFoundation.seekToTime
import platform.AVFAudio.setActive
import platform.AVFoundation.setRate
import platform.AVFoundation.timeControlStatus
import platform.CoreMedia.CMTimeGetSeconds
import platform.CoreMedia.CMTimeMakeWithSeconds
import platform.Foundation.NSData
import platform.Foundation.NSNotificationCenter
import platform.Foundation.NSOperationQueue
import platform.Foundation.NSTimer
import platform.Foundation.NSURL
import platform.Foundation.dataWithContentsOfURL
import platform.MediaPlayer.MPChangePlaybackPositionCommandEvent
import platform.MediaPlayer.MPMediaItemArtwork
import platform.MediaPlayer.MPMediaItemPropertyAlbumTitle
import platform.MediaPlayer.MPMediaItemPropertyArtist
import platform.MediaPlayer.MPMediaItemPropertyArtwork
import platform.MediaPlayer.MPMediaItemPropertyPlaybackDuration
import platform.MediaPlayer.MPMediaItemPropertyTitle
import platform.MediaPlayer.MPNowPlayingInfoCenter
import platform.MediaPlayer.MPNowPlayingInfoPropertyElapsedPlaybackTime
import platform.MediaPlayer.MPNowPlayingInfoPropertyPlaybackRate
import platform.MediaPlayer.MPRemoteCommandCenter
import platform.MediaPlayer.MPRemoteCommandHandlerStatusSuccess
import platform.UIKit.UIImage
import platform.darwin.DISPATCH_QUEUE_PRIORITY_DEFAULT
import platform.darwin.dispatch_async
import platform.darwin.dispatch_get_global_queue
import platform.darwin.dispatch_get_main_queue
import platform.darwin.NSObjectProtocol

/*
 * 音 Music on the iPhone: AVPlayer for the audio, the playback audio session
 * so it plays on locked and in the background, and Now Playing for the lock
 * screen, Control Center, AirPods and CarPlay's controls.
 */
class IosMusicAudio : MusicAudio {
    override var events: MusicAudioEvents? = null
    private val player = AVPlayer()
    private var item: AVPlayerItem? = null
    private var ready = false
    private var wantPlay = false
    private var startAt = 0.0
    private var rate = 1f
    private var info: NowPlayingInfo? = null
    private var art: MPMediaItemArtwork? = null
    private var artFor: String? = null
    private var observers = listOf<NSObjectProtocol>()
    private var timer: NSTimer? = null
    private var lastPlaying = false
    private var lastBuffering = false
    private var commandsSet = false
    /* Some streams (HE-AAC signalled implicitly) read at twice their real length: their clock is scaled back to the song's. */
    private var scale = 1.0
    private fun raw(seconds: Double) = CMTimeMakeWithSeconds(seconds * scale, 600)

    private fun session() {
        val s = AVAudioSession.sharedInstance()
        s.setCategory(AVAudioSessionCategoryPlayback, null)
        s.setActive(true, null)
        if (!commandsSet) {
            commandsSet = true
            val c = MPRemoteCommandCenter.sharedCommandCenter()
            c.playCommand.addTargetWithHandler { events?.remote("play", 0.0); MPRemoteCommandHandlerStatusSuccess }
            c.pauseCommand.addTargetWithHandler { events?.remote("pause", 0.0); MPRemoteCommandHandlerStatusSuccess }
            c.togglePlayPauseCommand.addTargetWithHandler { events?.remote("toggle", 0.0); MPRemoteCommandHandlerStatusSuccess }
            c.nextTrackCommand.addTargetWithHandler { events?.remote("next", 0.0); MPRemoteCommandHandlerStatusSuccess }
            c.previousTrackCommand.addTargetWithHandler { events?.remote("prev", 0.0); MPRemoteCommandHandlerStatusSuccess }
            c.changePlaybackPositionCommand.addTargetWithHandler { e -> (e as? MPChangePlaybackPositionCommandEvent)?.let { events?.remote("seek", it.positionTime) }; MPRemoteCommandHandlerStatusSuccess }
        }
    }

    override fun load(url: String, headers: Map<String, String>, at: Double, play: Boolean, info: NowPlayingInfo) {
        session()
        observers.forEach { NSNotificationCenter.defaultCenter.removeObserver(it) }
        val address = NSURL.URLWithString(url) ?: run { events?.failed(); return }
        val asset = AVURLAsset.URLAssetWithURL(address, mapOf<Any?, Any?>("AVURLAssetHTTPHeaderFieldsKey" to headers))
        val made = AVPlayerItem.playerItemWithAsset(asset)
        item = made
        ready = false
        scale = 1.0
        wantPlay = play
        startAt = at
        player.replaceCurrentItemWithPlayerItem(made)
        val center = NSNotificationCenter.defaultCenter
        observers = listOf(
            center.addObserverForName(AVPlayerItemDidPlayToEndTimeNotification, made, NSOperationQueue.mainQueue) { _ -> if (item === made) { wantPlay = false; publish(); events?.ended() } },
            center.addObserverForName(AVPlayerItemFailedToPlayToEndTimeNotification, made, NSOperationQueue.mainQueue) { _ -> if (item === made) events?.failed() },
        )
        show(info)
        if (play) events?.changed(false, true)
        watch()
    }

    /* AVPlayer says how it is through KVO; a quarter-second look is simpler and plenty. */
    private fun watch() {
        if (timer != null) return
        timer = NSTimer.scheduledTimerWithTimeInterval(0.25, true) { _ ->
            val current = item ?: return@scheduledTimerWithTimeInterval
            if (!ready && current.status == AVPlayerItemStatusReadyToPlay) {
                ready = true
                val real = info?.duration ?: 0.0
                val got = CMTimeGetSeconds(current.duration)
                scale = if (real > 0 && got.isFinite() && got / real in 1.8..2.2) 2.0 else 1.0
                if (startAt > 0.5) player.seekToTime(raw(startAt))
                events?.ready()
                if (wantPlay) play() else publish()
            }
            if (current.status == AVPlayerItemStatusFailed && item === current) { item = null; ready = false; events?.failed() }
            val playing = player.timeControlStatus == AVPlayerTimeControlStatusPlaying
            val buffering = wantPlay && (player.timeControlStatus == AVPlayerTimeControlStatusWaitingToPlayAtSpecifiedRate || !ready)
            if (playing != lastPlaying || buffering != lastBuffering) {
                lastPlaying = playing; lastBuffering = buffering
                events?.changed(playing || buffering, buffering)
                publish()
            }
        }
    }

    override fun play() {
        wantPlay = true
        if (!ready) { events?.changed(false, true); return }
        session()
        player.play()
        if (rate != 1f) player.setRate(rate)
        publish()
    }

    override fun pause() {
        wantPlay = false
        player.pause()
        events?.changed(false, false)
        publish()
    }

    override fun seek(seconds: Double) {
        if (!ready) { startAt = seconds; return }
        player.seekToTime(raw(seconds))
        publish()
    }

    override fun setRate(rate: Float) {
        if (rate == this.rate) return
        this.rate = rate
        if (player.rate > 0f) player.setRate(rate)
    }

    override fun stop() {
        player.pause()
        player.replaceCurrentItemWithPlayerItem(null)
        item = null; ready = false; wantPlay = false
        timer?.invalidate(); timer = null
        MPNowPlayingInfoCenter.defaultCenter().nowPlayingInfo = null
    }

    override val position: Double get() = if (ready) (CMTimeGetSeconds(player.currentTime()).takeIf { it.isFinite() } ?: 0.0) / scale else startAt
    override val duration: Double get() = item?.let { CMTimeGetSeconds(it.duration).takeIf { d -> d.isFinite() && d > 0 } }?.div(scale) ?: 0.0
    override val isPlaying: Boolean get() = player.timeControlStatus == AVPlayerTimeControlStatusPlaying
    override val isReady: Boolean get() = ready

    override fun show(info: NowPlayingInfo) {
        this.info = info
        if (info.artwork != artFor) {
            artFor = info.artwork
            art = null
            val address = info.artwork?.let { NSURL.URLWithString(it) }
            if (address != null) dispatch_async(dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT.toLong(), 0u)) {
                val image = NSData.dataWithContentsOfURL(address)?.let { UIImage.imageWithData(it) }
                dispatch_async(dispatch_get_main_queue()) {
                    if (artFor == info.artwork && image != null) {
                        art = MPMediaItemArtwork(boundsSize = image.size, requestHandler = { _ -> image })
                        publish()
                    }
                }
            }
        }
        publish()
    }

    private fun publish() {
        val i = info ?: return
        val now = mutableMapOf<Any?, Any?>(
            MPMediaItemPropertyTitle to i.title,
            MPMediaItemPropertyArtist to i.artist,
            MPMediaItemPropertyAlbumTitle to i.album,
            MPMediaItemPropertyPlaybackDuration to (duration.takeIf { it > 0 } ?: i.duration),
            MPNowPlayingInfoPropertyElapsedPlaybackTime to position,
            MPNowPlayingInfoPropertyPlaybackRate to (if (isPlaying) rate.toDouble() else 0.0),
        )
        art?.let { now[MPMediaItemPropertyArtwork] = it }
        MPNowPlayingInfoCenter.defaultCenter().nowPlayingInfo = now
    }
}
