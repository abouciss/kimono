package app.kimono.android

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaMetadata
import android.media.MediaPlayer
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import app.kimono.music.MusicAudio
import app.kimono.music.MusicAudioEvents
import app.kimono.music.NowPlayingInfo

/*
 * 音 Music on Android with what the phone already has: MediaPlayer for the
 * audio, a MediaSession for the lock screen, the notification, headphones and
 * the car, and a media-playback service so it plays on with the app closed.
 * No player library: the app stays small.
 */
class AndroidMusicAudio(private val context: Context) : MusicAudio {
    override var events: MusicAudioEvents? = null
    private val main = Handler(Looper.getMainLooper())
    private var player: MediaPlayer? = null
    private var prepared = false
    private var wantPlay = false
    private var startAt = 0.0
    private var rate = 1f
    private var info: NowPlayingInfo? = null
    private var art: Bitmap? = null
    private var artFor: String? = null
    private val audioManager = context.getSystemService(AudioManager::class.java)
    private val attributes = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build()
    private val focus = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN).setAudioAttributes(attributes).setOnAudioFocusChangeListener { change ->
        when (change) {
            AudioManager.AUDIOFOCUS_LOSS, AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> { if (isPlaying) { pause(); resumeOnGain = change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT } }
            AudioManager.AUDIOFOCUS_GAIN -> { if (resumeOnGain) play(); resumeOnGain = false }
        }
    }.build()
    private var resumeOnGain = false
    /* Some streams (HE-AAC signalled implicitly) read at twice their real length: their clock is scaled back to the song's. */
    private var scale = 1.0

    val session: MediaSession by lazy {
        MediaSession(context, "Kimono Music").apply {
            setCallback(object : MediaSession.Callback() {
                override fun onPlay() { events?.remote("play", 0.0) }
                override fun onPause() { events?.remote("pause", 0.0) }
                override fun onSkipToNext() { events?.remote("next", 0.0) }
                override fun onSkipToPrevious() { events?.remote("prev", 0.0) }
                override fun onSeekTo(pos: Long) { events?.remote("seek", pos / 1000.0) }
                override fun onStop() { events?.remote("pause", 0.0) }
            })
            setSessionActivity(PendingIntent.getActivity(context, 0, Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE))
        }
    }

    /* Headphones out: the music stops rather than coming out of the speaker. */
    private val noisy = object : BroadcastReceiver() { override fun onReceive(c: Context, i: Intent) { if (isPlaying) events?.remote("pause", 0.0) } }
    private var noisyOn = false

    override fun load(url: String, headers: Map<String, String>, at: Double, play: Boolean, info: NowPlayingInfo) {
        player?.release()
        prepared = false
        scale = 1.0
        wantPlay = play
        startAt = at
        this.info = info
        val made = MediaPlayer()
        player = made
        made.setAudioAttributes(attributes)
        made.setWakeMode(context, android.os.PowerManager.PARTIAL_WAKE_LOCK)
        made.setOnPreparedListener { p ->
            if (p !== player) return@setOnPreparedListener
            prepared = true
            val real = info?.duration ?: 0.0
            val got = p.duration / 1000.0
            scale = if (real > 0 && got / real in 1.8..2.2) 2.0 else 1.0
            if (startAt > 0.5) p.seekTo((startAt * scale * 1000).toLong(), MediaPlayer.SEEK_CLOSEST)
            events?.ready()
            if (wantPlay) play() else publish()
        }
        made.setOnCompletionListener { p -> if (p === player) { publish(); events?.ended() } }
        made.setOnErrorListener { p, _, _ -> if (p === player) { prepared = false; publish(); events?.failed() }; true }
        made.setOnInfoListener { p, what, _ ->
            if (p === player) when (what) {
                MediaPlayer.MEDIA_INFO_BUFFERING_START -> events?.changed(true, true)
                MediaPlayer.MEDIA_INFO_BUFFERING_END -> events?.changed(isPlaying, false)
            }
            false
        }
        try {
            if (url.startsWith("file://")) made.setDataSource(url.removePrefix("file://"))
            else made.setDataSource(context, Uri.parse(url), headers)
            made.prepareAsync()
        } catch (_: Exception) { main.post { events?.failed() } }
        show(info)
        if (play) events?.changed(false, true)
    }

    override fun play() {
        val p = player ?: return
        wantPlay = true
        if (!prepared) { events?.changed(false, true); return }
        if (audioManager.requestAudioFocus(focus) != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) return
        if (!noisyOn) { context.registerReceiver(noisy, IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY)); noisyOn = true }
        p.start()
        if (rate != 1f) runCatching { p.playbackParams = p.playbackParams.setSpeed(rate) }
        session.isActive = true
        events?.changed(true, false)
        publish()
        MusicService.start(context)
    }

    override fun pause() {
        wantPlay = false
        val p = player ?: return
        if (prepared && p.isPlaying) p.pause()
        events?.changed(false, false)
        publish()
    }

    override fun seek(seconds: Double) {
        val p = player ?: return
        if (!prepared) { startAt = seconds; return }
        p.seekTo((seconds * scale * 1000).toLong(), MediaPlayer.SEEK_CLOSEST)
        publish()
    }

    override fun setRate(rate: Float) {
        if (rate == this.rate) return
        this.rate = rate
        val p = player ?: return
        /* Setting a speed on a paused MediaPlayer starts it: only while it plays. */
        if (prepared && p.isPlaying) runCatching { p.playbackParams = p.playbackParams.setSpeed(rate) }
    }

    override fun stop() {
        player?.release(); player = null; prepared = false; wantPlay = false
        audioManager.abandonAudioFocusRequest(focus)
        if (noisyOn) { runCatching { context.unregisterReceiver(noisy) }; noisyOn = false }
        session.isActive = false
        MusicService.stop(context)
    }

    override val position: Double get() = player?.takeIf { prepared }?.let { runCatching { it.currentPosition / 1000.0 / scale }.getOrNull() } ?: startAt
    override val duration: Double get() = player?.takeIf { prepared }?.let { runCatching { it.duration / 1000.0 / scale }.getOrNull() }?.takeIf { it > 0 } ?: 0.0
    override val isPlaying: Boolean get() = prepared && runCatching { player?.isPlaying == true }.getOrDefault(false)
    override val isReady: Boolean get() = prepared

    override fun show(info: NowPlayingInfo) {
        this.info = info
        if (info.artwork != artFor) {
            artFor = info.artwork
            art = null
            val address = info.artwork
            if (address != null) Thread {
                val bitmap = runCatching { java.net.URL(address).openStream().use { BitmapFactory.decodeStream(it) } }.getOrNull()
                main.post { if (artFor == address) { art = bitmap; publish() } }
            }.start()
        }
        publish()
    }

    /** Tells the session and the notification what's on now. */
    private fun publish() {
        val i = info ?: return
        val length = (duration.takeIf { it > 0 } ?: i.duration)
        session.setMetadata(MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE, i.title)
            .putString(MediaMetadata.METADATA_KEY_ARTIST, i.artist)
            .putString(MediaMetadata.METADATA_KEY_ALBUM, i.album)
            .putLong(MediaMetadata.METADATA_KEY_DURATION, (length * 1000).toLong())
            .apply { art?.let { putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, it) } }
            .build())
        val playing = isPlaying || (wantPlay && !prepared)
        session.setPlaybackState(PlaybackState.Builder()
            .setActions(PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE or PlaybackState.ACTION_PLAY_PAUSE or PlaybackState.ACTION_SEEK_TO or PlaybackState.ACTION_SKIP_TO_NEXT or PlaybackState.ACTION_SKIP_TO_PREVIOUS)
            .setState(if (!prepared && wantPlay) PlaybackState.STATE_BUFFERING else if (playing) PlaybackState.STATE_PLAYING else PlaybackState.STATE_PAUSED, (position * 1000).toLong(), if (playing) rate else 0f)
            .build())
        MusicService.refresh(context, this, playing)
    }

    fun notification(playing: Boolean): Notification {
        val i = info
        fun action(icon: Int, label: String, what: String) = Notification.Action.Builder(
            android.graphics.drawable.Icon.createWithResource(context, icon), label,
            PendingIntent.getService(context, what.hashCode(), Intent(context, MusicService::class.java).setAction(what), PendingIntent.FLAG_IMMUTABLE),
        ).build()
        return Notification.Builder(context, MusicService.CHANNEL)
            .setSmallIcon(R.drawable.ic_branch)
            .setContentTitle(i?.title ?: "Kimono Music")
            .setContentText(i?.artist.orEmpty())
            .setLargeIcon(art)
            .setOngoing(playing)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setContentIntent(session.controller.sessionActivity)
            .addAction(action(android.R.drawable.ic_media_previous, "Previous", MusicService.PREV))
            .addAction(if (playing) action(android.R.drawable.ic_media_pause, "Pause", MusicService.TOGGLE) else action(android.R.drawable.ic_media_play, "Play", MusicService.TOGGLE))
            .addAction(action(android.R.drawable.ic_media_next, "Next", MusicService.NEXT))
            .setStyle(Notification.MediaStyle().setMediaSession(session.sessionToken).setShowActionsInCompactView(0, 1, 2))
            .build()
    }
}

/** Keeps the app alive while music plays, as the notification with its controls. */
class MusicService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val audio = (application as KimonoApplication).platform.musicAudio as? AndroidMusicAudio
        when (intent?.action) {
            TOGGLE -> audio?.events?.remote("toggle", 0.0)
            NEXT -> audio?.events?.remote("next", 0.0)
            PREV -> audio?.events?.remote("prev", 0.0)
        }
        if (audio == null) { stopSelf(); return START_NOT_STICKY }
        val playing = audio.isPlaying
        val n = audio.notification(playing)
        if (Build.VERSION.SDK_INT >= 29) startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK) else startForeground(ID, n)
        if (!playing) stopForeground(STOP_FOREGROUND_DETACH)
        return START_NOT_STICKY
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        val audio = (application as KimonoApplication).platform.musicAudio as? AndroidMusicAudio
        if (audio?.isPlaying != true) stopSelf()
    }

    companion object {
        const val CHANNEL = "music"
        const val ID = 7041
        const val TOGGLE = "app.kimono.music.TOGGLE"
        const val NEXT = "app.kimono.music.NEXT"
        const val PREV = "app.kimono.music.PREV"
        private var running = false

        private fun channel(context: Context) {
            val manager = context.getSystemService(NotificationManager::class.java)
            if (manager.getNotificationChannel(CHANNEL) == null) manager.createNotificationChannel(NotificationChannel(CHANNEL, "Music", NotificationManager.IMPORTANCE_LOW).apply { setShowBadge(false) })
        }

        fun start(context: Context) {
            channel(context)
            running = true
            runCatching { context.startForegroundService(Intent(context, MusicService::class.java)) }
        }

        /** The notification follows the song; paused, it can be swiped away. */
        fun refresh(context: Context, audio: AndroidMusicAudio, playing: Boolean) {
            if (!running) return
            channel(context)
            if (playing) runCatching { context.startForegroundService(Intent(context, MusicService::class.java)) }
            else context.getSystemService(NotificationManager::class.java).notify(ID, audio.notification(false))
        }

        fun stop(context: Context) {
            running = false
            context.stopService(Intent(context, MusicService::class.java))
            context.getSystemService(NotificationManager::class.java).cancel(ID)
        }
    }
}
