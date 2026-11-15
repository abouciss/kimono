package app.kimono.data

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

/** Where one book stands on this phone. */
sealed interface BookState {
    data object Kept : BookState
    /** On its way: how far (0 to 1), and what's happening, while the server readies it. */
    data class Getting(val progress: Float, val note: String) : BookState
    data object Waiting : BookState
    data class Failed(val why: String) : BookState
}

/**
 * 蔵 Books kept on the phone, to read with no connection. Not just a file:
 * an EPUB comes whole, every chapter and picture the reader asks for, so it
 * opens in Kimono's own reader on a plane as it does at home. A book that's
 * only a PDF comes as the PDF. One book at a time; what's still to come is
 * kept, so a download survives the app closing. Your place, saved while
 * offline, is held here and sent when the connection's back.
 */
class BookKeep(private val books: Books, private val platform: Platform, private val scope: CoroutineScope) {
    @Serializable data class Kept(val book: Book, val file: BookFile, val size: Long, val at: Long, val pdf: String? = null, val place: Double = 0.0)
    @Serializable private data class Index(val books: List<Kept> = emptyList(), val waiting: List<Book> = emptyList(), val places: Map<String, Double> = emptyMap(), val wants: Map<String, String> = emptyMap())
    data class Failed(val book: Book, val why: String)

    private val json = Json { ignoreUnknownKeys = true }
    private val root by lazy { Path(platform.keepDir(), "books") }
    private val indexFile by lazy { Path(root, "downloads.json") }
    private val lock = Mutex()

    private val _kept = MutableStateFlow<Map<String, Kept>>(emptyMap())
    val kept: StateFlow<Map<String, Kept>> = _kept
    private val _waiting = MutableStateFlow<List<Book>>(emptyList())
    val waiting: StateFlow<List<Book>> = _waiting
    private val _now = MutableStateFlow<Triple<String, Float, String>?>(null)
    /** The book on its way now: its key, how far, and what's happening. */
    val now: StateFlow<Triple<String, Float, String>?> = _now
    private val _failed = MutableStateFlow<Map<String, Failed>>(emptyMap())
    val failed: StateFlow<Map<String, Failed>> = _failed
    /** Places saved while offline, to send. */
    private var places = mapOf<String, Double>()
    /** The copy asked for, where it was: "epub" or "pdf". */
    private var wants = mapOf<String, String>()
    private var worker: Job? = null
    private var swapping = setOf<String>()
    private var loaded = false

    init {
        books.keptDir = root.toString()
        books.keep = this
        scope.launch(Dispatchers.Default) {
            runCatching {
                if (SystemFileSystem.exists(indexFile)) {
                    val index = json.decodeFromString<Index>(SystemFileSystem.source(indexFile).buffered().use { it.readString() })
                    _kept.value = index.books.associateBy { it.book.key }
                    _waiting.value = (index.waiting.filter { !_kept.value.containsKey(it.key) } + _waiting.value).distinctBy { it.key }
                    places = index.places
                    wants = index.wants
                }
            }
            loaded = true
            run()
        }
    }

    fun has(key: String) = _kept.value.containsKey(key)
    val bytes get() = _kept.value.values.sumOf { it.size }
    /** Where you'd got to in a downloaded book, as this phone last knew it. */
    fun placeOf(key: String): Double? = places[key] ?: _kept.value[key]?.place?.takeIf { it > 0 }

    /** Downloads [book]: the EPUB for Kimono's reader, or with [format] "pdf" the PDF. Asking for the other copy of one that's here swaps it. */
    fun download(book: Book, format: String? = null) {
        if (format != null) wants = wants + (book.key to format)
        val here = _kept.value[book.key]
        if (here != null && format != null && here.file.format != format) {
            /* The other copy: the new one arrives, then the old one goes. */
            swapping = swapping + book.key
        } else if (has(book.key)) return
        if (_waiting.value.any { it.key == book.key }) return
        _failed.value = _failed.value - book.key
        _waiting.value = _waiting.value + book
        persist(); run()
    }

    fun cancel(keys: Collection<String>) {
        val set = keys.toSet()
        _waiting.value = _waiting.value.filter { it.key !in set }
        _failed.value = _failed.value - set
        if (_now.value?.first in set) { worker?.cancel(); worker = null; _now.value = null; run() }
        persist()
    }

    fun retry(keys: Collection<String> = _failed.value.keys) {
        val again = _failed.value.filterKeys { it in keys }.values.map { it.book }
        if (again.isEmpty()) return
        _failed.value = _failed.value - keys.toSet()
        _waiting.value = (_waiting.value + again).distinctBy { it.key }
        persist(); run()
    }

    fun remove(keys: Collection<String>) {
        cancel(keys)
        scope.launch(Dispatchers.Default) {
            lock.withLock {
                for (k in keys) _kept.value[k]?.let { drop(it) }
                wants = wants - keys.toSet()
                _kept.value = _kept.value - keys.toSet()
                save()
            }
        }
    }

    fun removeAll() = remove(_kept.value.keys + _waiting.value.map { it.key } + _failed.value.keys)

    /** The connection's back: what failed for want of one is tried again, and places saved meanwhile are sent. */
    fun connected() {
        retry(_failed.value.filterValues { it.why == "No connection" }.keys)
        val pending = places
        if (pending.isEmpty()) return
        scope.launch {
            for ((key, fraction) in pending) runCatching { books.progress(key, fraction) }.onSuccess { places = places - key }
            persist()
        }
    }

    /** A place saved with the server: noted against the downloaded copy. */
    fun placed(key: String, fraction: Double) {
        if (places.containsKey(key)) places = places - key
        _kept.value[key]?.let { _kept.value = _kept.value + (key to it.copy(place = fraction)) }
        persist()
    }

    /** A place saved with no connection: held, to send later. */
    fun later(key: String, fraction: Double) {
        places = places + (key to fraction)
        _kept.value[key]?.let { _kept.value = _kept.value + (key to it.copy(place = fraction)) }
        persist()
    }

    private fun run() {
        if (worker?.isActive == true || !loaded) return
        worker = scope.launch {
            while (true) {
                val next = _waiting.value.firstOrNull() ?: break
                _now.value = Triple(next.key, 0f, "Getting it ready")
                val got = try { Result.success(withContext(Dispatchers.Default) { fetch(next) }) }
                    catch (c: CancellationException) { throw c } catch (e: Throwable) { Result.failure(e) }
                val offline = got.exceptionOrNull()?.let { it is KimonoProblem && it.message == OFFLINE } == true
                lock.withLock {
                    _now.value = null
                    _waiting.value = _waiting.value.filter { it.key != next.key }
                    got.onSuccess { fresh ->
                        _kept.value[next.key]?.takeIf { next.key in swapping }?.let { old -> scope.launch(Dispatchers.Default) { drop(old) } }
                        swapping = swapping - next.key
                        _kept.value = _kept.value + (next.key to fresh.copy(place = _kept.value[next.key]?.place ?: fresh.place))
                    }
                    got.onFailure { e -> _failed.value = _failed.value + (next.key to Failed(next, if (offline) "No connection" else e.message ?: "Didn't download")) }
                    /* No connection: the rest would fail too. Hold them, to try again when it's back. */
                    if (offline) { _failed.value = _failed.value + _waiting.value.associate { it.key to Failed(it, "No connection") }; _waiting.value = emptyList() }
                    save()
                }
            }
        }
    }

    private fun note(key: String, progress: Float, text: String) { _now.value = Triple(key, progress.coerceIn(0f, 1f), text) }

    private suspend fun fetch(book: Book): Kept {
        val choice = books.filesAndPreference(book.key)
        val usable = choice.files.filter { it.readable }
        /* Kimono's own reader whenever there's an EPUB (one being made from the PDF counts), unless you've said you'd rather the PDF. */
        val epub = usable.firstOrNull { it.format == "epub" } ?: choice.files.firstOrNull { it.format == "epub" && it.preparing }
        val pdf = usable.firstOrNull { it.format == "pdf" }
        val want = wants[book.key] ?: choice.prefers
        val file = (if (want == "pdf") pdf ?: epub else epub ?: pdf) ?: throw KimonoProblem("Kimono has no copy of this book yet")
        /* The server fetches its copy (or makes the EPUB) first: say how far that's got. */
        var tries = 0
        while (true) {
            val s = try { books.fetchStatus(file) } catch (p: KimonoProblem) {
                if (p.message != OFFLINE || ++tries > 3) throw p
                delay(2_000L shl tries); continue
            }
            if (s.ready) break
            val size = s.size
            when {
                s.preparing -> note(book.key, ((s.progress ?: 0.0) * .5).toFloat(), "Making the EPUB")
                size != null && size > 0 -> note(book.key, s.got.toFloat() / size * .3f, "Getting it ready")
                else -> note(book.key, 0f, "Getting it ready")
            }
            delay(1_000)
        }
        val at = kotlin.time.Clock.System.now().toEpochMilliseconds()
        if (file.format != "epub") {
            note(book.key, .3f, "Downloading")
            val path = books.download(file, platform.keepDir()) { got -> file.size?.takeIf { it > 0 }?.let { note(book.key, .3f + .7f * got / it, "Downloading") } }
            return Kept(book, file, SystemFileSystem.metadataOrNull(Path(path))?.size ?: (file.size ?: 0), at, pdf = path, place = startPlace(book.key))
        }
        /* The whole book, part by part, as the reader will ask for it. */
        val cache = platform.cacheDir()
        var total = 0L
        val parts = app.kimono.screens.epubAllParts { path -> books.epubPart(file.address, path, cache, keep = true).also { total += it.size } }
        parts.forEachIndexed { i, path ->
            note(book.key, .3f + .7f * i / parts.size, "Chapter by chapter")
            if (i >= 2) total += books.epubPart(file.address, path, cache, keep = true).size
        }
        return Kept(book, file, total, at, place = startPlace(book.key))
    }

    private fun drop(gone: Kept) {
        gone.pdf?.let { runCatching { SystemFileSystem.delete(Path(it)) } }
        books.keptParts(gone.file.address)?.let { deleteTree(Path(it)) }
    }

    /* Where you'd got to: as saved offline here, else as your shelf has it. */
    private fun startPlace(key: String): Double = places[key] ?: books.knownBook(key)?.shelf?.takeIf { it.state == "reading" }?.fraction ?: 0.0

    private fun deleteTree(path: Path) {
        runCatching {
            if (SystemFileSystem.metadataOrNull(path)?.isDirectory == true) SystemFileSystem.list(path).forEach { deleteTree(it) }
            SystemFileSystem.delete(path, mustExist = false)
        }
    }

    private fun persist() { scope.launch(Dispatchers.Default) { lock.withLock { save() } } }

    private fun save() {
        runCatching {
            SystemFileSystem.createDirectories(root)
            val index = Index(_kept.value.values.sortedByDescending { it.at }, _waiting.value + _failed.value.values.map { it.book }, places, wants)
            SystemFileSystem.sink(indexFile).buffered().use { it.writeString(json.encodeToString(Index.serializer(), index)) }
        }
    }
}
