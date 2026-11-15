package app.kimono.music

import app.kimono.data.Music
import app.kimono.data.Platform
import app.kimono.data.Track
import io.ktor.client.request.header
import io.ktor.client.statement.bodyAsChannel
import io.ktor.http.isSuccess
import io.ktor.http.encodeURLQueryComponent
import io.ktor.utils.io.readAvailable
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.io.buffered
import kotlinx.io.files.Path
import kotlinx.io.files.SystemFileSystem
import kotlinx.io.readString
import kotlinx.io.writeString
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * 蔵 Songs kept on the phone, to play with no connection. A download is the
 * server's own file as it is (AAC, about 1 MB a minute): nothing is converted
 * here, so it costs no more than streaming it once. One at a time, carrying on
 * from where a cut-short one stopped (the stream answers byte ranges).
 */
class MusicDownloads(private val music: Music, private val platform: Platform, private val scope: CoroutineScope) {
    @Serializable data class Kept(val track: Track, val file: String, val size: Long, val at: Long)
    @Serializable private data class Index(val songs: List<Kept> = emptyList())

    private val json = Json { ignoreUnknownKeys = true }
    private val folder by lazy { Path(platform.keepDir(), "music") }
    private val indexFile by lazy { Path(folder, "downloads.json") }
    private val lock = Mutex()

    private val _kept = MutableStateFlow<Map<String, Kept>>(emptyMap())
    /** Every song on the phone, by key. */
    val kept: StateFlow<Map<String, Kept>> = _kept
    private val _getting = MutableStateFlow<Map<String, Float>>(emptyMap())
    /** Songs on their way, and how far (0 to 1). */
    val getting: StateFlow<Map<String, Float>> = _getting
    private val waiting = ArrayDeque<Track>()
    private var running = false

    init {
        scope.launch(Dispatchers.Default) {
            runCatching {
                if (SystemFileSystem.exists(indexFile)) {
                    val index = json.decodeFromString<Index>(SystemFileSystem.source(indexFile).buffered().use { it.readString() })
                    _kept.value = index.songs.filter { SystemFileSystem.exists(Path(it.file)) }.associateBy { it.track.key }
                }
            }
        }
    }

    /** The song's file here, when it's been downloaded. */
    fun fileOf(key: String): String? = _kept.value[key]?.file
    fun has(key: String) = _kept.value.containsKey(key)
    /** Whether every one of [tracks] is here. */
    fun hasAll(tracks: List<Track>) = tracks.isNotEmpty() && tracks.all { has(it.key) }
    val bytes get() = _kept.value.values.sumOf { it.size }

    fun download(tracks: List<Track>) {
        val fresh = tracks.filter { !has(it.key) && it.key !in _getting.value && waiting.none { w -> w.key == it.key } }
        if (fresh.isEmpty()) return
        waiting.addAll(fresh)
        _getting.value = _getting.value + fresh.associate { it.key to 0f }
        if (!running) run()
    }

    fun remove(tracks: List<Track>) {
        val keys = tracks.map { it.key }.toSet()
        waiting.removeAll { it.key in keys }
        _getting.value = _getting.value - keys
        scope.launch(Dispatchers.Default) {
            lock.withLock {
                for (k in keys) _kept.value[k]?.let { runCatching { SystemFileSystem.delete(Path(it.file)) } }
                _kept.value = _kept.value - keys
                save()
            }
        }
    }

    private fun run() {
        running = true
        scope.launch {
            while (true) {
                val next = waiting.removeFirstOrNull() ?: break
                val got = runCatching { kotlinx.coroutines.withContext(Dispatchers.Default) { fetch(next) } }.getOrNull()
                lock.withLock {
                    _getting.value = _getting.value - next.key
                    if (got != null) { _kept.value = _kept.value + (next.key to got); save() }
                }
            }
            running = false
        }
    }

    private suspend fun fetch(track: Track): Kept {
        SystemFileSystem.createDirectories(folder)
        val name = track.key.replace(Regex("[^A-Za-z0-9]"), "_") + ".m4a"
        val target = Path(folder, name)
        val partial = Path(folder, ".$name.part")
        val have = SystemFileSystem.metadataOrNull(partial)?.size ?: 0L
        var total = 0L
        music.session.respond("/api/v1/music/stream?key=${track.key.encodeURLQueryComponent()}", configure = {
            if (have > 0) header("Range", "bytes=$have-")
        }, long = true) { response ->
            val append = response.status.value == 206
            if (!append && !response.status.isSuccess()) throw music.session.problemOf(response, "That song couldn't be downloaded.")
            val length = response.headers["content-length"]?.toLongOrNull() ?: 0L
            var received = if (append) have else 0L
            total = received + length
            val channel = response.bodyAsChannel()
            val buffer = ByteArray(64 * 1024)
            SystemFileSystem.sink(partial, append = append).buffered().use { sink ->
                while (true) {
                    val read = channel.readAvailable(buffer)
                    if (read < 0) break
                    if (read == 0) { if (channel.isClosedForRead) break else continue }
                    sink.write(buffer, 0, read)
                    received += read
                    if (total > 0) _getting.value = _getting.value + (track.key to (received.toFloat() / total).coerceIn(0f, 1f))
                }
            }
            total = received
        }
        SystemFileSystem.atomicMove(partial, target)
        return Kept(track, target.toString(), total, kotlin.time.Clock.System.now().toEpochMilliseconds())
    }

    private fun save() {
        runCatching {
            SystemFileSystem.createDirectories(folder)
            SystemFileSystem.sink(indexFile).buffered().use { it.writeString(json.encodeToString(Index.serializer(), Index(_kept.value.values.sortedByDescending { k -> k.at }))) }
        }
    }
}

/** "120 MB", "1.2 GB". */
fun megabytes(bytes: Long): String = when {
    bytes >= 1_000_000_000 -> "${(bytes / 100_000_000) / 10.0} GB"
    bytes >= 1_000_000 -> "${bytes / 1_000_000} MB"
    else -> "${bytes / 1000} KB"
}
