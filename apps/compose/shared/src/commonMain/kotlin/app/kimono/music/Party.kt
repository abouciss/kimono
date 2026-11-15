package app.kimono.music

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import app.kimono.data.ChatLine
import app.kimono.data.KimonoProblem
import app.kimono.data.MusicPerson
import app.kimono.data.PartyView
import app.kimono.data.QueueSource
import app.kimono.data.Track
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonObjectBuilder
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlin.math.abs
import kotlin.random.Random

/**
 * 共 This phone in a listen party: it listens to the party's changes, says
 * when it has each song ready, and keeps its audio on the shared timeline
 * with Watch Together's maths (lib/watch/together.ts): the clock set
 * NTP-style against the server's, drift under two seconds eased out by the
 * rate (never past ±5%), anything more by jumping.
 */
class MusicParty(val id: String, private val player: MusicPlayer, private val scope: CoroutineScope) {
    private val music = player.music
    val client: String = buildString { repeat(20) { append("abcdefghijklmnopqrstuvwxyz0123456789"[Random.nextInt(36)]) } }

    var view by mutableStateOf<PartyView?>(null); private set
    val chat = mutableStateListOf<ChatLine>()
    val people = mutableStateMapOf<String, MusicPerson>()
    /** Reactions floating up now: (id, emoji, who). */
    val floating = mutableStateListOf<Triple<Long, String, String>>()
    var unread by mutableIntStateOf(0)
    var ended by mutableStateOf(false); private set
    var problem by mutableStateOf<String?>(null)

    private var offset = 0L
    private var correcting = false
    private var reportedKey: String? = null
    private var loadedKey: String? = null
    private var jobs = mutableListOf<Job>()
    private var stopped = false
    private var floatId = 0L

    fun serverNow() = kotlin.time.Clock.System.now().toEpochMilliseconds() + offset

    fun start() {
        player.party?.takeIf { it !== this }?.leave(keepPlaying = false)
        player.party = this
        player.nowPlayingOpen = player.nowPlayingOpen
        jobs += scope.launch {
            measureClock()
            runCatching { music.partyNow(id) }.onSuccess { now ->
                now.people.forEach { people[it.username] = it }
                apply(now.state)
            }.onFailure { problem = it.message; if (it is KimonoProblem) { stop(); ended = true; return@launch } }
            /* The events, reconnecting after a dropped line, until the party ends or we leave. */
            var first = true
            while (!stopped) {
                runCatching {
                    music.partyEvents(id, client) { event, data ->
                        when (event) {
                            "state" -> apply(music.decodeView(data))
                            "chat" -> { val lines = music.decodeChat(data); addChat(lines, fresh = !first); first = false }
                            "react" -> { val (who, emoji) = music.decodeReact(data); float(emoji, who) }
                            "ping" -> { val now = music.decodeNow(data); if (now > 0 && abs(now - serverNow()) > 1500) measureClock() }
                            "ended" -> { ended = true; stop() }
                        }
                    }
                }
                if (stopped) break
                delay(1500)
            }
        }
        jobs += scope.launch { while (!stopped) { keepTime(); delay(1000) } }
    }

    private fun addChat(lines: List<ChatLine>, fresh: Boolean) {
        val known = chat.map { it.id }.toSet()
        val added = lines.filter { it.id !in known }
        chat.addAll(added)
        if (fresh) unread += added.size
        val unknown = added.map { it.username }.filter { it !in people }
        if (unknown.isNotEmpty()) scope.launch { runCatching { music.partyNow(id) }.getOrNull()?.people?.forEach { people[it.username] = it } }
    }

    private fun float(emoji: String, who: String) {
        val mine = ++floatId
        floating.add(Triple(mine, emoji, who))
        scope.launch { delay(2600); floating.removeAll { it.first == mine } }
    }

    /** A few round trips to the server's clock; the steadiest third's median. */
    private suspend fun measureClock() {
        val samples = (0 until 4).mapNotNull { runCatching { music.clock() }.getOrNull() }.filter { it.second >= it.first }
        if (samples.isEmpty()) return
        val best = samples.sortedBy { it.second - it.first }.take(maxOf(1, (samples.size + 2) / 3))
        val offsets = best.map { it.third - (it.first + it.second) / 2.0 }.sorted()
        val mid = offsets.size / 2
        offset = (if (offsets.size % 2 == 1) offsets[mid] else (offsets[mid - 1] + offsets[mid]) / 2).toLong()
    }

    /** A newer state from the party: the right song, at the right place, playing or not. */
    private fun apply(next: PartyView) {
        if (stopped) return
        val held = view
        if (held != null && next.seq < held.seq) return
        view = next
        next.members.forEach { m -> if (m.username !in people) people[m.username] = MusicPerson(m.username) }
        val song = next.song ?: run { player.audio?.pause(); return }
        if (loadedKey != song.key) {
            loadedKey = song.key
            reportedKey = null
            player.load(song, autoplay = false, at = 0.0)
            send { put("type", "status"); put("state", "loading"); put("key", song.key) }
        }
        keepTime()
    }

    /** The audio says it can play: tell the party this phone has the song. */
    internal fun loaded() {
        val song = view?.song ?: return
        if (loadedKey == song.key && reportedKey != song.key) {
            reportedKey = song.key
            send { put("type", "status"); put("state", "ready"); put("key", song.key) }
        }
    }

    private fun keepTime() {
        val v = view ?: return
        val audio = player.audio ?: return
        if (stopped || v.song == null) return
        if (v.waiting != null || !v.playing) {
            if (audio.isPlaying) audio.pause()
            if (v.waiting == null && audio.isReady && abs(audio.position - v.position) > 0.5) audio.seek(v.position)
            return
        }
        val want = v.position + (serverNow() - v.at) / 1000.0
        if (want < 0) {
            /* It starts a moment from now, for everyone at once. */
            if (audio.isPlaying) audio.pause()
            scope.launch { delay((-want * 1000).toLong()); if (view === v) { audio.seek(0.0); audio.play() } }
            return
        }
        if (!audio.isReady) return
        val drift = audio.position - want
        when {
            abs(drift) > 2 -> { audio.seek(want); correcting = false; audio.setRate(1f) }
            abs(drift) < (if (correcting) 0.04 else 0.15) -> { if (correcting) audio.setRate(1f); correcting = false }
            else -> { correcting = true; audio.setRate((1 - (drift * 0.2).coerceIn(-0.05, 0.05)).toFloat()) }
        }
        if (!audio.isPlaying) audio.play()
    }

    private fun send(fill: JsonObjectBuilder.() -> Unit) {
        val body = buildJsonObject { put("client", client); put("seq", view?.seq ?: 0); fill() }
        scope.launch { post(body) }
    }

    private suspend fun post(body: JsonObject): Boolean {
        val (status, answer) = runCatching { music.partyAct(id, body) }.getOrElse { problem = "The party didn't hear that."; return false }
        answer.state?.let { if (!stopped) apply(it) }
        if (status == 409 && answer.reason == "stale") return false
        if (status >= 300 && answer.error != null) player.say(answer.error)
        return status < 300
    }

    /* ── What anyone in the party can do ──────────────────────────────── */
    fun toggle() = send { put("type", if (view?.playing == true || view?.waiting != null) "pause" else "play") }
    fun next() = send { put("type", "next") }
    fun prev() = send { put("type", "prev") }
    fun seek(seconds: Double) = send { put("type", "seek"); put("position", seconds) }
    fun jump(index: Int) = send { put("type", "jump"); put("index", index) }
    fun remove(index: Int) = send { put("type", "remove"); put("index", index) }
    fun move(from: Int, to: Int) = send { put("type", "move"); put("from", from); put("to", to) }
    fun add(tracks: List<Track>, where: String) {
        send { put("type", "add"); put("where", where); putJsonArray("keys") { tracks.forEach { add(it.key) } } }
        player.say(if (where == "next") "Playing next for everyone" else "Added to the party's queue")
    }
    fun replace(tracks: List<Track>) = send { put("type", "replace"); putJsonArray("keys") { tracks.forEach { add(it.key) } } }
    fun react(emoji: String) { float(emoji, ""); send { put("type", "react"); put("emoji", emoji) } }
    fun say(text: String) { if (text.isNotBlank()) send { put("type", "chat"); put("text", text.trim().take(500)) } }
    fun invite(usernames: List<String>) = send { put("type", "invite"); putJsonArray("usernames") { usernames.forEach { add(it) } } }

    /** Leaves the party, keeping its queue (and the song playing) when [keepPlaying]. */
    fun leave(keepPlaying: Boolean = true) {
        if (stopped) return
        val v = view
        scope.launch { post(buildJsonObject { put("client", client); put("type", "leave") }) }
        stop()
        if (keepPlaying && v != null) player.adopt(v.tracks, v.index, QueueSource("party", id, "Listen party"))
        else player.audio?.pause()
    }

    fun end() {
        scope.launch { post(buildJsonObject { put("client", client); put("type", "end") }) }
        leave(keepPlaying = true)
    }

    private fun stop() {
        stopped = true
        player.audio?.setRate(1f)
        jobs.forEach { it.cancel() }
        if (player.party === this) player.party = null
    }
}
