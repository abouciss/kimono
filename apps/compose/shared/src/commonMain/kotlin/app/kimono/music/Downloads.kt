package app.kimono.music

import app.kimono.data.KimonoProblem
import app.kimono.data.Music
import app.kimono.data.OFFLINE
import app.kimono.data.Platform
import app.kimono.data.Track
import io.ktor.client.request.header
import io.ktor.client.statement.bodyAsChannel
import io.ktor.http.isSuccess
import io.ktor.http.encodeURLQueryComponent
import io.ktor.utils.io.readAvailable
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.io.buffered
import kotlinx.io.files.Path
import kotlinx.io.files.SystemFileSystem
import kotlinx.io.readString
import kotlinx.io.writeString
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/** Where one song stands on this phone. */
sealed interface SongKeep {
    data object Kept : SongKeep
    data class Getting(val progress: Float) : SongKeep
    data object Waiting : SongKeep
    data class Failed(val why: String) : SongKeep
}

/**
 * 蔵 Songs kept on the phone, to play with no connection. A download is the
 * server's own file as it is (AAC, about 1 MB a minute): nothing is converted
 * here, so it costs no more than streaming it once. One at a time, carrying on
 * from where a cut-short one stopped (the stream answers byte ranges). What's
 * still to come is kept too, so a download asked for survives the app closing;
 * one that fails waits to be tried again, and is, once the connection's back.
 */
class MusicDownloads(private val music: Music, private val platform: Platform, private val scope: CoroutineScope) {
    @Serializable data class Kept(val track: Track, val file: String, val size: Long, val at: Long)
    @Serializable private data class Index(val songs: List<Kept> = emptyList(), val waiting: List<Track> = emptyList())
    data class Failed(val track: Track, val why: String)

    private val json = Json { ignoreUnknownKeys = true }
    private val folder by lazy { Path(platform.keepDir(), "music") }
    private val indexFile by lazy { Path(folder, "downloads.json") }
    private val lock = Mutex()

    private val _kept = MutableStateFlow<Map<String, Kept>>(emptyMap())
    /** Every song on the phone, by key. */
    val kept: StateFlow<Map<String, Kept>> = _kept
    private val _waiting = MutableStateFlow<List<Track>>(emptyList())
    /** Songs still to come, in the order they'll arrive (the one arriving first). */
    val waiting: StateFlow<List<Track>> = _waiting
    private val _now = MutableStateFlow<Pair<String, Float>?>(null)
    /** The song arriving now, and how far (0 to 1). */
    val now: StateFlow<Pair<String, Float>?> = _now
    private val _failed = MutableStateFlow<Map<String, Failed>>(emptyMap())
    /** Songs that didn't arrive, and why. */
    val failed: StateFlow<Map<String, Failed>> = _failed
    private var worker: Job? = null
    private var loaded = false

    /*
     * 聴 Every song played is kept too, apart from the downloads: the same file,
     * fetched once it starts, so the next time it starts at once from the phone.
     * Up to 100 GB, the longest unplayed going first, and always leaving room on the phone.
     */
    @Serializable private data class Played(val songs: List<Kept> = emptyList())
    private val playedFolder by lazy { Path(folder, "played") }
    private val playedFile by lazy { Path(folder, "played.json") }
    private val _played = MutableStateFlow<Map<String, Kept>>(emptyMap())
    /** Songs kept from playing them, by key. */
    val played: StateFlow<Map<String, Kept>> = _played
    val playedBytes get() = _played.value.values.sumOf { it.size }
    private val toKeep = MutableStateFlow<List<Track>>(emptyList())
    private var keeper: Job? = null

    init {
        scope.launch(Dispatchers.Default) {
            runCatching {
                if (SystemFileSystem.exists(indexFile)) {
                    val index = json.decodeFromString<Index>(SystemFileSystem.source(indexFile).buffered().use { it.readString() })
                    _kept.value = index.songs.filter { SystemFileSystem.exists(Path(it.file)) }.associateBy { it.track.key }
                    val still = index.waiting.filter { !_kept.value.containsKey(it.key) }
                    _waiting.value = (still + _waiting.value).distinctBy { it.key }
                }
            }
            runCatching {
                if (SystemFileSystem.exists(playedFile)) {
                    val index = json.decodeFromString<Played>(SystemFileSystem.source(playedFile).buffered().use { it.readString() })
                    _played.value = index.songs.filter { SystemFileSystem.exists(Path(it.file)) }.associateBy { it.track.key } + _played.value
                }
            }
            loaded = true
            if (_waiting.value.isNotEmpty()) run()
            if (toKeep.value.isNotEmpty()) keepOn()
        }
    }

    /** The song's file here, when it's been downloaded. */
    fun fileOf(key: String): String? = _kept.value[key]?.file ?: _played.value[key]?.file
    /** Whether [key] plays from the phone: downloaded, or kept from playing it. */
    fun here(key: String) = fileOf(key) != null
    fun has(key: String) = _kept.value.containsKey(key)
    /** Whether every one of [tracks] is here. */
    fun hasAll(tracks: List<Track>) = tracks.isNotEmpty() && tracks.all { has(it.key) }
    val bytes get() = _kept.value.values.sumOf { it.size }

    /** Where [key] stands: here, arriving, waiting its turn, failed, or null (not asked for). */
    fun stateOf(key: String): SongKeep? = when {
        has(key) -> SongKeep.Kept
        _now.value?.first == key -> SongKeep.Getting(_now.value!!.second)
        _waiting.value.any { it.key == key } -> SongKeep.Waiting
        else -> _failed.value[key]?.let { SongKeep.Failed(it.why) }
    }

    fun download(tracks: List<Track>) {
        val fresh = tracks.filter { !has(it.key) && _waiting.value.none { w -> w.key == it.key } }.distinctBy { it.key }
        if (fresh.isEmpty()) return
        _failed.value = _failed.value - fresh.map { it.key }.toSet()
        _waiting.value = _waiting.value + fresh
        persist()
        run()
    }

    /** Stops [tracks] arriving: the waiting ones, and the one on its way. */
    fun cancel(tracks: List<Track>) {
        val keys = tracks.map { it.key }.toSet()
        _waiting.value = _waiting.value.filter { it.key !in keys }
        _failed.value = _failed.value - keys
        if (_now.value?.first in keys) { worker?.cancel(); worker = null; _now.value = null; run() }
        persist()
    }

    /** Tries the failed ones again (all of them, or [keys]). */
    fun retry(keys: Collection<String> = _failed.value.keys) {
        val again = _failed.value.filterKeys { it in keys }.values.map { it.track }
        if (again.isEmpty()) return
        _failed.value = _failed.value - keys.toSet()
        _waiting.value = (_waiting.value + again).distinctBy { it.key }
        persist()
        run()
    }

    fun remove(tracks: List<Track>) {
        val keys = tracks.map { it.key }.toSet()
        cancel(tracks)
        scope.launch(Dispatchers.Default) {
            lock.withLock {
                for (k in keys) _kept.value[k]?.let { runCatching { SystemFileSystem.delete(Path(it.file)) } }
                _kept.value = _kept.value - keys
                save()
            }
        }
    }

    /** Every song off the phone, and nothing more to come. */
    fun removeAll() = remove(_kept.value.values.map { it.track } + _waiting.value + _failed.value.values.map { it.track })

    /** A song's just been played: kept, if it isn't yet, or marked as heard now. */
    fun keepPlayed(track: Track) {
        val key = track.key
        _played.value[key]?.let { p ->
            _played.value = _played.value + (key to p.copy(at = nowMillis()))
            scope.launch(Dispatchers.Default) { lock.withLock { savePlayed() } }
            return
        }
        if (has(key) || _waiting.value.any { it.key == key } || toKeep.value.any { it.key == key }) return
        toKeep.value = toKeep.value + track
        keepOn()
    }

    /** Every played song off the phone (downloads stay). */
    fun clearPlayed() {
        toKeep.value = emptyList()
        keeper?.cancel(); keeper = null
        scope.launch(Dispatchers.Default) {
            lock.withLock {
                for (p in _played.value.values) runCatching { SystemFileSystem.delete(Path(p.file)) }
                _played.value = emptyMap()
                savePlayed()
            }
        }
    }

    private fun keepOn() {
        if (keeper?.isActive == true || !loaded) return
        keeper = scope.launch {
            while (true) {
                val next = toKeep.value.firstOrNull() ?: break
                /* A moment first, so the song's own start comes before the copy. */
                delay(4_000)
                val free = platform.freeBytes()
                if (free != null && free < LEAVE_FREE + 50_000_000 && _played.value.isEmpty()) { toKeep.value = emptyList(); break }
                val got = if (has(next.key) || _played.value.containsKey(next.key)) null
                    else try { withContext(Dispatchers.Default) { fetch(next, playedFolder, shown = false) } } catch (c: CancellationException) { throw c } catch (_: Throwable) { null }
                lock.withLock {
                    toKeep.value = toKeep.value.filter { it.key != next.key }
                    if (got != null) { _played.value = _played.value + (next.key to got); roomForPlayed(); savePlayed() }
                }
            }
        }
    }

    /** Over 100 GB, or the phone running short: the songs played longest ago go. */
    private fun roomForPlayed() {
        var total = playedBytes
        var free = platform.freeBytes()
        val gone = mutableSetOf<String>()
        for (p in _played.value.values.sortedBy { it.at }) {
            if (total <= PLAYED_CAP && (free == null || free >= LEAVE_FREE)) break
            runCatching { SystemFileSystem.delete(Path(p.file)) }
            total -= p.size; free = free?.plus(p.size); gone += p.track.key
        }
        if (gone.isNotEmpty()) _played.value = _played.value - gone
    }

    private fun savePlayed() {
        runCatching {
            SystemFileSystem.createDirectories(folder)
            SystemFileSystem.sink(playedFile).buffered().use { it.writeString(json.encodeToString(Played.serializer(), Played(_played.value.values.sortedByDescending { k -> k.at }))) }
        }
    }

    private fun run() {
        if (worker?.isActive == true || !loaded) return
        worker = scope.launch {
            while (true) {
                val next = _waiting.value.firstOrNull() ?: break
                _now.value = next.key to 0f
                val got = try {
                    Result.success(withContext(Dispatchers.Default) { fetchWithRetries(next) })
                } catch (c: CancellationException) { throw c } catch (e: Throwable) { Result.failure(e) }
                lock.withLock {
                    _now.value = null
                    _waiting.value = _waiting.value.filter { it.key != next.key }
                    got.onSuccess { _kept.value = _kept.value + (next.key to it) }
                    got.onFailure { e ->
                        val why = if (e is KimonoProblem && e.message == OFFLINE) "No connection" else e.message ?: "Didn't download"
                        _failed.value = _failed.value + (next.key to Failed(next, why))
                    }
                    save()
                }
                /* No connection: the rest would fail the same way. Hold them as failed, to try again when it's back. */
                if (got.exceptionOrNull()?.let { it is KimonoProblem && it.message == OFFLINE } == true) {
                    lock.withLock {
                        _failed.value = _failed.value + _waiting.value.associate { it.key to Failed(it, "No connection") }
                        _waiting.value = emptyList()
                        save()
                    }
                }
            }
        }
    }

    private suspend fun fetchWithRetries(track: Track): Kept {
        /* Already here from playing it: moved over, not fetched again. */
        _played.value[track.key]?.let { p ->
            SystemFileSystem.createDirectories(folder)
            val target = Path(folder, Path(p.file).name)
            if (runCatching { SystemFileSystem.atomicMove(Path(p.file), target) }.isSuccess) {
                lock.withLock { _played.value = _played.value - track.key; savePlayed() }
                return Kept(track, target.toString(), p.size, nowMillis())
            }
        }
        var tries = 0
        while (true) {
            try { return fetch(track, folder, shown = true) } catch (p: KimonoProblem) {
                if (p.message != OFFLINE || ++tries >= 4) throw p
                delay(1_500L shl tries)
            }
        }
    }

    private suspend fun fetch(track: Track, folder: Path, shown: Boolean): Kept {
        SystemFileSystem.createDirectories(folder)
        val name = track.key.replace(Regex("[^A-Za-z0-9]"), "_") + ".m4a"
        val target = Path(folder, name)
        val partial = Path(folder, ".$name.part")
        val have = SystemFileSystem.metadataOrNull(partial)?.size ?: 0L
        var total = 0L
        try {
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
                        if (shown && total > 0) _now.value = track.key to (received.toFloat() / total).coerceIn(0f, 1f)
                    }
                }
                if (length > 0 && received < total) throw KimonoProblem(OFFLINE)
                total = received
            }
        } catch (p: KimonoProblem) { throw p } catch (c: CancellationException) { throw c } catch (_: Exception) { throw KimonoProblem(OFFLINE) }
        SystemFileSystem.atomicMove(partial, target)
        return Kept(track, target.toString(), total, nowMillis())
    }

    private fun persist() { scope.launch(Dispatchers.Default) { lock.withLock { save() } } }

    private fun save() {
        runCatching {
            SystemFileSystem.createDirectories(folder)
            val index = Index(_kept.value.values.sortedByDescending { k -> k.at }, _waiting.value + _failed.value.values.map { it.track })
            SystemFileSystem.sink(indexFile).buffered().use { it.writeString(json.encodeToString(Index.serializer(), index)) }
        }
    }
}

private const val PLAYED_CAP = 100_000_000_000L
/** What's always left free on the phone for everything else. */
private const val LEAVE_FREE = 2_000_000_000L
private fun nowMillis() = kotlin.time.Clock.System.now().toEpochMilliseconds()

/** "120 MB", "1.2 GB". */
fun megabytes(bytes: Long): String = when {
    bytes >= 1_000_000_000 -> "${(bytes / 100_000_000) / 10.0} GB"
    bytes >= 1_000_000 -> "${bytes / 1_000_000} MB"
    else -> "${bytes / 1000} KB"
}
