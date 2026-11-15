package app.kimono.music

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableDoubleStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import app.kimono.data.Music
import app.kimono.data.Platform
import app.kimono.data.QueueSource
import app.kimono.data.SongStatus
import app.kimono.data.Track
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * 音 The player: one queue for all of Music, kept while you move between
 * screens and playing on with the phone locked. It plays the queue through,
 * and when it runs out carries on with songs like the last one. Your place is
 * saved, so the web (or another phone) picks up where you left off, and the
 * other way round.
 *
 * What's heard is told to the server when a song ends or you move on: only
 * the seconds actually played count, so seeking to the end isn't a listen.
 * In a listen party ([party]) the party holds the queue and its clock says
 * what plays; the controls act on it instead.
 */
class MusicPlayer(val music: Music, private val platform: Platform, val downloads: MusicDownloads, private val scope: CoroutineScope) : MusicAudioEvents {
    val audio: MusicAudio? = platform.musicAudio

    var tracks by mutableStateOf(emptyList<Track>()); private set
    var index by mutableIntStateOf(0); private set
    var source by mutableStateOf<QueueSource?>(null); private set
    var playing by mutableStateOf(false); private set
    /** Waiting for audio: the first play of a song while the server fetches it, or buffering. */
    var waiting by mutableStateOf(false); private set
    /** A song being got for the first time: how far along. Null once it plays. */
    var arriving by mutableStateOf<SongStatus?>(null); private set
    var shuffle by mutableStateOf(false); private set
    var repeat by mutableStateOf("off"); private set
    /** Seconds into the song, as of the last tick (twice a second). */
    var position by mutableDoubleStateOf(0.0); private set
    var length by mutableDoubleStateOf(0.0); private set
    /** "kind:key" → down, up or love. */
    val ratings = mutableStateMapOf<String, String>()
    var toast by mutableStateOf<String?>(null)
    /** The song in full (the record, its lyrics, the queue). */
    var nowPlayingOpen by mutableStateOf(false)
    var party by mutableStateOf<MusicParty?>(null); internal set
    /** Who's listening (a username), to know whose party is whose. */
    var me: String? = null
    /** No connection: only what's downloaded plays, and the rest is passed over. */
    var offline by mutableStateOf(false)

    /** Whether [track] can play now: always online, and offline only once it's downloaded. */
    fun playable(track: Track) = !offline || downloads.here(track.key)

    /** Says the connection's back (or isn't): what failed to download for want of one is tried again. */
    fun connected(on: Boolean) {
        val was = offline
        offline = !on
        if (on && was) downloads.retry(downloads.failed.value.filterValues { it.why == "No connection" }.keys)
    }

    val queue: List<Track> get() = party?.view?.tracks ?: tracks
    val at: Int get() = party?.view?.index ?: index
    val current: Track? get() = queue.getOrNull(at)

    private var unshuffled: List<Track>? = null
    private var heardKey = ""
    private var heard = 0.0
    private var last = 0.0
    private var failures = 0
    private var loadSeq = 0
    private var restored = false
    private var loadedKey: String? = null
    private var ticker: Job? = null
    private var asking: Job? = null
    private var toastJob: Job? = null

    init { audio?.events = this }

    /** The hour where the phone is, for Home's greeting. */
    fun localHour(): Int {
        val now = kotlin.time.Clock.System.now().toEpochMilliseconds()
        return (((now + platform.utcOffsetMillis(now)) / 3_600_000) % 24).toInt()
    }
    val reduceMotion get() = platform.reduceMotion

    /** Sends a Music address through the phone's share sheet. */
    fun share(path: String) = platform.share(music.webUrl(path))

    fun say(text: String) {
        toast = text
        toastJob?.cancel()
        toastJob = scope.launch { delay(3200); if (toast == text) toast = null }
    }

    /* ── Loading and the clock ──────────────────────────────────────────── */

    /** Loads [track] and plays it unless told not to. Party loads go through here too. */
    internal fun load(track: Track, autoplay: Boolean, at: Double = 0.0) {
        val engine = audio ?: run { say("This phone can't play music."); return }
        report()
        heardKey = track.key; heard = 0.0; last = at
        loadedKey = track.key
        position = at; length = track.duration
        val seq = ++loadSeq
        val local = downloads.fileOf(track.key)
        waiting = autoplay
        arriving = null
        scope.launch {
            val headers = if (local != null) emptyMap() else runCatching { mapOf("Authorization" to "Bearer ${music.session.bearer()}") }.getOrElse { emptyMap() }
            if (seq != loadSeq) return@launch
            engine.load(if (local != null) "file://$local" else music.streamUrl(track.key), headers, at, autoplay, infoOf(track))
        }
        if (local == null && autoplay) watchArrival(track.key, seq)
        downloads.keepPlayed(track)
        startTicker()
    }

    private fun infoOf(t: Track) = NowPlayingInfo(t.title, t.byline, t.album?.title.orEmpty(), t.cover, t.duration, canSkip = true)

    /* The first play of a song can take a few seconds while the server fetches it: say how far along. */
    private fun watchArrival(key: String, seq: Int) {
        asking?.cancel()
        asking = scope.launch {
            delay(900)
            while (seq == loadSeq && !playing) {
                val s = runCatching { music.status(key) }.getOrNull()
                if (seq != loadSeq || playing) break
                arriving = s?.takeIf { it.stage != "ready" }
                delay(800)
            }
            arriving = null
        }
    }

    private fun startTicker() {
        if (ticker?.isActive == true) return
        ticker = scope.launch {
            var saved = 0
            while (true) {
                val engine = audio ?: break
                val now = engine.position
                val step = now - last
                if (engine.isPlaying && step > 0 && step < 1.5) heard += step
                last = now
                position = now
                /* Deezer's length is the song's; a stream still arriving can be misjudged by the player. */
                length = current?.duration?.takeIf { it > 0 } ?: engine.duration.takeIf { it > 0 } ?: length
                if (engine.isPlaying && ++saved >= 30) { saved = 0; save() }
                delay(500)
            }
        }
    }

    /** Tells the server what was heard of the song now ending, if it was really listened to. */
    private fun report() {
        val key = heardKey
        val seconds = heard
        heardKey = ""; heard = 0.0
        if (key.isNotEmpty() && seconds >= 1 && party == null) scope.launch { music.played(key, seconds.toInt()) }
    }

    /* ── What the audio says ────────────────────────────────────────────── */

    override fun changed(playing: Boolean, buffering: Boolean) {
        val was = this.playing
        this.playing = playing
        waiting = buffering
        if (playing && !buffering) { failures = 0; arriving = null }
        if (was != playing && party == null) save()
    }

    override fun ready() { party?.loaded() }

    override fun ended() {
        if (party != null) return
        scope.launch { advance(false) }
    }

    override fun failed() {
        waiting = false
        arriving = null
        if (party != null) { say("That song won't play here; the party carries on."); return }
        failures++
        val song = current
        scope.launch {
            /* Not here and no answer: the phone's offline. Downloaded songs play on, the rest are passed over. */
            if (song != null && !downloads.here(song.key) && runCatching { music.status(song.key) }.exceptionOrNull()?.message == app.kimono.data.OFFLINE) {
                offline = true
                if (tracks.drop(index + 1).any { downloads.here(it.key) }) { say("Offline · playing your downloads"); failures = 0; advance(true) }
                else { audio?.pause(); say("Offline · only downloaded songs play") }
                return@launch
            }
            say(song?.let { "“${it.title}” won't play right now." } ?: "That won't play right now.")
            /* One song failing moves on; several in a row is the server, and waits for you. */
            if (failures < 3) { delay(1200); advance(true) }
        }
    }

    override fun remote(command: String, value: Double) {
        when (command) {
            "play" -> if (!playing) toggle()
            "pause" -> if (playing) toggle()
            "toggle" -> toggle()
            "next" -> next()
            "prev" -> prev()
            "seek" -> seek(value)
        }
    }

    /* ── Controls ───────────────────────────────────────────────────────── */

    fun play(list: List<Track>, start: Int = 0, from: QueueSource? = null, shuffled: Boolean? = null) {
        if (list.isEmpty()) return
        party?.let { p -> p.replace(list.drop(start.coerceIn(0, list.lastIndex))); return }
        failures = 0
        unshuffled = null
        if (shuffled != null) shuffle = shuffled
        var order = list
        var i = start.coerceIn(0, list.lastIndex)
        if (!playable(list[i])) {
            val kept = (list.indices.drop(i) + list.indices.take(i)).firstOrNull { playable(list[it]) }
            if (kept == null) { say("Offline · download songs to play them with no connection"); return }
            i = kept
        }
        if (shuffle) {
            unshuffled = list
            order = listOf(list[i]) + list.filterIndexed { n, _ -> n != i }.shuffled()
            i = 0
        }
        tracks = order; index = i; source = from
        load(order[i], true)
        upcoming()
        save()
    }

    /** The next two get ready on the server now, so they start the moment this one ends. */
    private fun upcoming() {
        val next = tracks.drop(index + 1).take(2).map { it.key }.filter { !downloads.here(it) }
        if (next.isNotEmpty()) scope.launch { music.ready(next) }
    }

    fun toggle() {
        party?.let { it.toggle(); return }
        val engine = audio ?: return
        val t = current ?: return
        if (engine.isPlaying) engine.pause()
        else if (loadedKey != t.key) load(t, true, position)
        else { waiting = !engine.isReady; engine.play() }
    }

    fun next() { party?.let { it.next(); return }; scope.launch { advance(true) } }

    fun prev() {
        party?.let { it.prev(); return }
        if (position > 3 || index == 0) { seek(0.0); return }
        index -= 1
        load(tracks[index], true)
        save()
    }

    fun seek(seconds: Double) {
        party?.let { it.seek(seconds); return }
        val t = current ?: return
        if (loadedKey != t.key) { position = seconds; return }
        audio?.seek(seconds)
        position = seconds; last = seconds
    }

    fun jump(to: Int) {
        party?.let { it.jump(to); return }
        if (to !in tracks.indices) return
        index = to
        load(tracks[to], true)
        upcoming(); save()
    }

    fun playNext(list: List<Track>) {
        party?.let { it.add(list, "next"); return }
        if (tracks.isEmpty()) { play(list); return }
        tracks = tracks.take(index + 1) + list + tracks.drop(index + 1)
        say(if (list.size == 1) "Playing next" else "${list.size} songs play next")
        save()
    }

    fun addToQueue(list: List<Track>) {
        party?.let { it.add(list, "end"); return }
        if (tracks.isEmpty()) { play(list); return }
        tracks = tracks + list
        say(if (list.size == 1) "Added to the queue" else "${list.size} songs added to the queue")
        save()
    }

    fun remove(at: Int) {
        party?.let { it.remove(at); return }
        if (at !in tracks.indices || at == index) return
        tracks = tracks.filterIndexed { i, _ -> i != at }
        if (at < index) index -= 1
        save()
    }

    fun move(from: Int, to: Int) {
        party?.let { it.move(from, to); return }
        if (from !in tracks.indices || to !in tracks.indices || from == to) return
        val list = tracks.toMutableList()
        val t = list.removeAt(from)
        list.add(to, t)
        index = when {
            from == index -> to
            from < index && to >= index -> index - 1
            from > index && to <= index -> index + 1
            else -> index
        }
        tracks = list
        save()
    }

    fun toggleShuffle() {
        val on = !shuffle
        shuffle = on
        val now = current
        if (on) {
            unshuffled = tracks
            val rest = tracks.filterIndexed { i, _ -> i > index }.shuffled()
            tracks = tracks.take(index + 1) + rest
        } else unshuffled?.let { original ->
            tracks = original
            index = now?.let { c -> original.indexOfFirst { it.key == c.key }.takeIf { it >= 0 } } ?: 0
            unshuffled = null
        }
        save()
    }

    fun cycleRepeat() { repeat = when (repeat) { "off" -> "all"; "all" -> "one"; else -> "off" }; save() }

    private suspend fun advance(byUser: Boolean) {
        val list = tracks
        val i = index
        if (repeat == "one" && !byUser) { list.getOrNull(i)?.let { load(it, true) }; return }
        if (offline) {
            /* Offline: on to the next song that's here, round again on repeat. */
            val ahead = (i + 1 until list.size).firstOrNull { playable(list[it]) }
                ?: if (repeat == "all") (0..i).firstOrNull { playable(list[it]) } else null
            if (ahead == null) { audio?.pause(); say("That's all your downloads in this queue"); return }
            index = ahead; load(list[ahead], true); save(); return
        }
        if (i + 1 < list.size) { index = i + 1; load(list[i + 1], true); upcoming(); save(); return }
        if (repeat == "all" && list.isNotEmpty()) { index = 0; load(list[0], true); save(); return }
        /* The end of the queue: carry on with songs like the last one. */
        val lastSong = list.getOrNull(i) ?: return
        val more = runCatching { music.radio(lastSong.key, list.map { it.key }) }.getOrNull()
        if (more.isNullOrEmpty()) { audio?.pause(); if (more == null) say("Nothing more to play right now."); return }
        tracks = list + more
        source = QueueSource("radio", lastSong.key, "Like ${lastSong.title}")
        index = i + 1
        load(tracks[index], true)
        upcoming(); save()
    }

    /** Takes over a queue without stopping what's playing: what leaving a party leaves you with. */
    internal fun adopt(list: List<Track>, at: Int, from: QueueSource?) {
        tracks = list; index = at.coerceIn(0, (list.size - 1).coerceAtLeast(0)); source = from
        save()
    }

    /* ── Ratings: the marks are the save (liked keeps up and love) ─────── */

    fun ratingOf(kind: String, key: String): String? = ratings["$kind:$key"]

    fun rate(kind: String, key: String, rating: String?) {
        val was = ratings["$kind:$key"]
        if (rating == null) ratings.remove("$kind:$key") else ratings["$kind:$key"] = rating
        scope.launch {
            runCatching { music.rate(kind, key, rating) }.onFailure {
                if (was == null) ratings.remove("$kind:$key") else ratings["$kind:$key"] = was
                say("That rating didn't save.")
            }
        }
        if (kind == "track" && rating != null && rating != "down" && was == null) say("Saved to your liked songs")
    }

    /* ── Your place, on every device ────────────────────────────────────── */

    /** Picks up the queue as you left it anywhere, ready but not playing. */
    fun restore() {
        if (restored) return
        restored = true
        scope.launch {
            runCatching { music.ratings() }.getOrNull()?.let { all -> ratings.clear(); all.forEach { ratings["${it.kind}:${it.key}"] = it.rating } }
        }
        scope.launch {
            val q = runCatching { music.queue() }.getOrNull() ?: return@launch
            if (q.tracks.isEmpty() || tracks.isNotEmpty()) return@launch
            tracks = q.tracks; index = q.index.coerceIn(0, q.tracks.lastIndex); source = q.source; shuffle = q.shuffle; repeat = q.repeat
            position = q.position; length = q.tracks[index].duration
        }
    }

    fun save() {
        if (!restored || party != null) return
        val list = tracks
        if (list.isEmpty()) return
        val from = (index - 50).coerceAtLeast(0)
        val keys = list.drop(from).take(500).map { it.key }
        val at = kotlin.time.Clock.System.now().toEpochMilliseconds()
        val pos = audio?.position ?: position
        val on = audio?.isPlaying == true
        scope.launch { music.saveQueue(keys, index - from, pos, shuffle, repeat, source, on, at) }
    }

    /** Signing out or leaving: stops and lets the system's controls go. */
    fun stop() {
        report(); save()
        party?.leave(keepPlaying = false)
        audio?.stop()
        ticker?.cancel(); ticker = null
        loadedKey = null
        playing = false
    }
}
