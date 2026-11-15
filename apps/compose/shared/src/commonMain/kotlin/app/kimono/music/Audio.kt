package app.kimono.music

/**
 * 音 The phone's own audio player, as Music drives it: one song at a time,
 * playing on with the screen off, shown in the system's media controls (the
 * lock screen, the notification, Control Center, headphones and car). Android
 * implements it with MediaPlayer and a media session, the iPhone with
 * AVPlayer and Now Playing.
 */
interface MusicAudio {
    /** Loads [url] (with [headers]; a local file needs none) and starts at [at] seconds, playing or not. */
    fun load(url: String, headers: Map<String, String>, at: Double, play: Boolean, info: NowPlayingInfo)
    fun play()
    fun pause()
    fun seek(seconds: Double)
    /** Playback speed, for keeping to a listen party's timeline (within ±5%). */
    fun setRate(rate: Float)
    /** Stops and lets go of the song and the system's controls. */
    fun stop()
    /** Seconds into the song now. */
    val position: Double
    /** How long the song is, once known; 0 before. */
    val duration: Double
    val isPlaying: Boolean
    /** Whether it has enough to play from (loaded far enough to start). */
    val isReady: Boolean
    /** What the system's controls show: called when the song, its art, or playing changes. */
    fun show(info: NowPlayingInfo)
    var events: MusicAudioEvents?
}

class NowPlayingInfo(val title: String, val artist: String, val album: String, val artwork: String?, val duration: Double, val canSkip: Boolean = true)

interface MusicAudioEvents {
    /** Playing, paused or waiting for audio. */
    fun changed(playing: Boolean, buffering: Boolean)
    fun ready()
    fun ended()
    fun failed()
    /** From the system's controls: "play", "pause", "toggle", "next", "prev", "seek" (with [value] seconds). */
    fun remote(command: String, value: Double)
}
