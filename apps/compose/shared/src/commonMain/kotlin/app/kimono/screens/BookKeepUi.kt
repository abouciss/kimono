package app.kimono.screens

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.kimono.data.Book
import app.kimono.data.BookKeep
import app.kimono.data.BookState
import app.kimono.data.Books
import app.kimono.data.Platform
import app.kimono.music.SongKeep
import app.kimono.music.megabytes
import app.kimono.ui.IconButton
import app.kimono.ui.KimonoTopBar
import app.kimono.ui.Surface
import app.kimono.ui.clickable
import app.kimono.ui.kimonoIcon

/* ── 蔵 Books on this phone: the whole book, to read with no connection ── */

/** Where [key] stands on this phone, kept up to date. */
@Composable
fun rememberBookState(keep: BookKeep?, key: String): BookState? {
    keep ?: return null
    val kept = keep.kept.collectAsState().value
    val now = keep.now.collectAsState().value
    val waiting = keep.waiting.collectAsState().value
    val failed = keep.failed.collectAsState().value
    return when {
        now?.first == key -> BookState.Getting(now.second, now.third)
        waiting.any { it.key == key } -> BookState.Waiting
        kept.containsKey(key) -> BookState.Kept
        else -> failed[key]?.let { BookState.Failed(it.why) }
    }
}

/** The same small marks as a song's: here, arriving, waiting, didn't come. */
@Composable
fun BookKeepMark(state: BookState?, size: androidx.compose.ui.unit.Dp = 14.dp) = KeepMark(when (state) {
    null -> null
    BookState.Kept -> SongKeep.Kept
    is BookState.Getting -> SongKeep.Getting(state.progress)
    BookState.Waiting -> SongKeep.Waiting
    is BookState.Failed -> SongKeep.Failed(state.why)
}, size)

/** The books on this phone, by key: what a tile on a shelf looks at to wear its mark. */
val LocalKeptBooks = staticCompositionLocalOf<BookKeep?> { null }

/**
 * A book's download, under Read in its sheet: a ribbon that says where it
 * stands and does the one thing that makes sense next.
 */
@Composable
fun BookKeepRibbon(keep: BookKeep, book: Book, formats: Set<String>, modifier: Modifier = Modifier) {
    val state = rememberBookState(keep, book.key)
    val kept = keep.kept.collectAsState().value[book.key]
    val (title, detail) = when (state) {
        BookState.Kept -> "On this phone" to listOfNotNull(kept?.file?.format?.uppercase(), kept?.size?.let { megabytes(it) }, "reads with no connection").joinToString(" · ")
        is BookState.Getting -> "Downloading · ${(state.progress * 100).toInt()}%" to state.note
        BookState.Waiting -> "Waiting its turn" to "After the book downloading now"
        is BookState.Failed -> "Didn't download" to state.why
        null -> "Download to read offline" to (if ("epub" in formats || formats.isEmpty()) "The whole book, in Kimono's reader" else "The PDF, for the phone's viewer")
    }
    Surface(
        onClick = {
            when (state) {
                null -> keep.download(book)
                is BookState.Failed -> keep.retry(listOf(book.key))
                else -> {}
            }
        },
        shape = RoundedCornerShape(20.dp),
        color = if (state == BookState.Kept) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surfaceContainerHigh,
        modifier = modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(start = 14.dp, end = 6.dp, top = 10.dp, bottom = 10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Box(Modifier.size(36.dp), contentAlignment = Alignment.Center) {
                    when (state) {
                        BookState.Kept -> Box(Modifier.size(34.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primary), contentAlignment = Alignment.Center) { MusicGlyph("downloaded", MaterialTheme.colorScheme.onPrimary, 18.dp) }
                        null -> MusicGlyph("downloaded", MaterialTheme.colorScheme.primary, 22.dp)
                        else -> BookKeepMark(state, 26.dp)
                    }
                }
                Column(Modifier.weight(1f)) {
                    Text(title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold,
                        color = if (state is BookState.Failed) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface)
                    Text(detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                when (state) {
                    BookState.Kept -> IconButton(onClick = { keep.remove(listOf(book.key)) }) { Icon(kimonoIcon("trash"), "Remove download", Modifier.size(20.dp)) }
                    is BookState.Getting, BookState.Waiting -> IconButton(onClick = { keep.cancel(listOf(book.key)) }) { Icon(kimonoIcon("close"), "Stop downloading", Modifier.size(20.dp)) }
                    is BookState.Failed -> IconButton(onClick = { keep.retry(listOf(book.key)) }) { Icon(kimonoIcon("restart"), "Try again", Modifier.size(20.dp)) }
                    null -> {}
                }
            }
            if (state is BookState.Getting) app.kimono.ui.InkProgress(progress = { state.progress }, modifier = Modifier.padding(start = 48.dp, end = 12.dp, top = 6.dp).fillMaxWidth())
            /* The PDF is always there to have instead, and the other way round. */
            val other = when {
                state == BookState.Kept && kept?.file?.format == "epub" && "pdf" in formats -> "pdf"
                state == BookState.Kept && kept?.file?.format == "pdf" && "epub" in formats -> "epub"
                state == null && "pdf" in formats && "epub" in formats -> "pdf"
                state == null && "pdf" in formats -> null
                else -> null
            }
            if (other != null) Text(
                when { state == null -> "Download the PDF instead"; other == "pdf" -> "Keep the PDF instead"; else -> "Keep the EPUB instead" },
                style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.primary,
                modifier = Modifier.padding(start = 40.dp, top = 2.dp).clip(RoundedCornerShape(10.dp)).clickable { keep.download(book, other) }.padding(horizontal = 8.dp, vertical = 6.dp),
            )
        }
    }
}

/** Opens a downloaded book: an EPUB in Kimono's reader, a PDF in the phone's viewer. */
@Composable
fun KeptReader(books: Books, platform: Platform, kept: BookKeep.Kept?, onClose: () -> Unit) {
    kept ?: return
    val keep = books.keep
    if (kept.pdf != null) { LaunchedEffect(kept) { platform.openFile(kept.pdf, "application/pdf"); onClose() }; return }
    BookReader(books, platform, kept.book.key, kept.book.title, kept.file, startAt = keep?.placeOf(kept.book.key) ?: kept.place, onClose = onClose) {}
}

/** Books' Downloads: the books on the phone and the room they take, what's on its way, and what didn't come. */
@Composable
fun BooksDownloadsScreen(books: Books, platform: Platform, back: () -> Unit) {
    val keep = books.keep ?: return
    val kept = keep.kept.collectAsState().value
    val waiting = keep.waiting.collectAsState().value
    val now = keep.now.collectAsState().value
    val failed = keep.failed.collectAsState().value
    val free = remember { platform.freeBytes() }
    var reading by remember { mutableStateOf<BookKeep.Kept?>(null) }
    var clearing by remember { mutableStateOf(false) }
    val list = kept.values.sortedByDescending { it.at }
    val bytes = list.sumOf { it.size }
    Scaffold(containerColor = MaterialTheme.colorScheme.surface, topBar = { KimonoTopBar("Downloads", onBack = back) }) { pad ->
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(top = pad.calculateTopPadding(), bottom = 32.dp)) {
            item(key = "store") {
                Surface(shape = RoundedCornerShape(28.dp), color = MaterialTheme.colorScheme.surfaceContainer, modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
                    Column(Modifier.padding(18.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(18.dp)) {
                            /* The books leaning together on a little shelf. */
                            Box(Modifier.size(width = 104.dp, height = 96.dp)) {
                                list.take(3).forEachIndexed { i, k ->
                                    Box(Modifier.align(Alignment.BottomStart).offset(x = (i * 26).dp, y = (-8).dp).rotate(listOf(-6f, 0f, 5f)[i])) { Book3D(k.book, 50.dp, still = false) }
                                }
                                if (list.isEmpty()) Box(Modifier.align(Alignment.Center).size(56.dp).clip(RoundedCornerShape(10.dp)).background(MaterialTheme.colorScheme.surfaceContainerHighest), contentAlignment = Alignment.Center) {
                                    Icon(kimonoIcon("book"), null, Modifier.size(26.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                                Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(8.dp).clip(RoundedCornerShape(4.dp)).background(MaterialTheme.colorScheme.secondaryContainer))
                            }
                            Column(Modifier.weight(1f)) {
                                Text(if (bytes > 0) megabytes(bytes) else "Empty", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
                                Text(if (list.isEmpty()) "Nothing kept yet" else if (list.size == 1) "1 book to read offline" else "${list.size} books to read offline",
                                    style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                        if (free != null && free > 0) {
                            val share = (bytes.toFloat() / (bytes + free)).coerceIn(0f, 1f)
                            val primary = MaterialTheme.colorScheme.primary
                            val ground = MaterialTheme.colorScheme.surfaceContainerHighest
                            Canvas(Modifier.padding(top = 16.dp).fillMaxWidth().height(8.dp)) {
                                drawRoundRect(ground, cornerRadius = CornerRadius(size.height / 2))
                                if (bytes > 0) drawRoundRect(primary, size = Size((size.width * share).coerceAtLeast(size.height), size.height), cornerRadius = CornerRadius(size.height / 2))
                            }
                            Text("${megabytes(free)} free on this phone", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 6.dp))
                        }
                    }
                }
            }
            if (waiting.isNotEmpty()) {
                item(key = "coming") { KeepHeading(if (waiting.size == 1) "Arriving" else "Arriving · ${waiting.size}", "Stop all") { keep.cancel(waiting.map { it.key }) } }
                items(waiting, key = { "c" + it.key }) { b ->
                    val n = now?.takeIf { it.first == b.key }
                    BookLine(b, if (n != null) BookState.Getting(n.second, n.third) else BookState.Waiting,
                        if (n != null) "${n.third} · ${(n.second * 100).toInt()}%" else "Waiting its turn") {
                        IconButton(onClick = { keep.cancel(listOf(b.key)) }, modifier = Modifier.size(40.dp)) { Icon(kimonoIcon("close"), "Stop downloading ${b.title}", Modifier.size(18.dp)) }
                    }
                }
            }
            if (failed.isNotEmpty()) {
                item(key = "lost") { KeepHeading("Didn't download · ${failed.size}", "Try again") { keep.retry() } }
                items(failed.values.toList(), key = { "f" + it.book.key }) { f ->
                    BookLine(f.book, BookState.Failed(f.why), f.why) {
                        IconButton(onClick = { keep.retry(listOf(f.book.key)) }, modifier = Modifier.size(40.dp)) { Icon(kimonoIcon("restart"), "Try ${f.book.title} again", Modifier.size(18.dp)) }
                        IconButton(onClick = { keep.cancel(listOf(f.book.key)) }, modifier = Modifier.size(40.dp)) { Icon(kimonoIcon("close"), "Forget ${f.book.title}", Modifier.size(18.dp)) }
                    }
                }
            }
            if (list.isNotEmpty()) {
                item(key = "here") { Text("On this phone", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(start = 20.dp, top = 18.dp, bottom = 4.dp)) }
                items(list, key = { "k" + it.book.key }) { k ->
                    val place = keep.placeOf(k.book.key) ?: 0.0
                    Row(Modifier.fillMaxWidth().clickable { reading = k }.padding(start = 20.dp, end = 8.dp, top = 10.dp, bottom = 10.dp),
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                        Book3D(k.book, 52.dp, progress = place.takeIf { it > 0 })
                        Column(Modifier.weight(1f)) {
                            Text(k.book.title, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            if (k.book.author.isNotBlank()) Text(k.book.author, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(top = 4.dp)) {
                                BookKeepMark(BookState.Kept, 12.dp)
                                Text(listOfNotNull(k.file.format.uppercase(), megabytes(k.size), if (place > 0) "${(place * 100).toInt()}% read" else null).joinToString(" · "),
                                    style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                        Text("Read", style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.clip(RoundedCornerShape(12.dp)).clickable { reading = k }.padding(horizontal = 10.dp, vertical = 8.dp))
                        IconButton(onClick = { keep.remove(listOf(k.book.key)) }, modifier = Modifier.size(40.dp)) { Icon(kimonoIcon("trash"), "Remove ${k.book.title}", Modifier.size(18.dp)) }
                    }
                }
                item(key = "clear") {
                    Text("Remove all downloads", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.error,
                        modifier = Modifier.padding(start = 12.dp, top = 20.dp).clip(RoundedCornerShape(12.dp)).clickable { clearing = true }.padding(horizontal = 8.dp, vertical = 10.dp))
                }
            }
            if (list.isEmpty() && waiting.isEmpty() && failed.isEmpty()) item(key = "empty") {
                Text("Download a book from its page, and the whole of it reads here with no connection.",
                    style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 24.dp, vertical = 12.dp))
            }
        }
    }
    if (clearing) app.kimono.ui.InkDialog("Remove all downloads?", onDismiss = { clearing = false }, icon = "trash", actions = {
        app.kimono.ui.Seal("Keep them", { clearing = false }, tone = app.kimono.ui.SealTone.Quiet, compact = true)
        app.kimono.ui.Seal("Remove", { keep.removeAll(); clearing = false }, tone = app.kimono.ui.SealTone.Danger, compact = true)
    }) {
        Text("${if (list.size == 1) "1 book" else "${list.size} books"} · ${megabytes(bytes)} come off this phone. Your places and shelf stay.",
            style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    KeptReader(books, platform, reading) { reading = null }
}

@Composable
private fun KeepHeading(title: String, action: String, onAction: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 12.dp, top = 18.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
        Text(action, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary,
            modifier = Modifier.clip(RoundedCornerShape(10.dp)).clickable(onClick = onAction).padding(horizontal = 8.dp, vertical = 6.dp))
    }
}

@Composable
private fun BookLine(book: Book, state: BookState, note: String, actions: @Composable RowScope.() -> Unit) {
    Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 8.dp, top = 8.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        Book3D(book, 44.dp)
        Column(Modifier.weight(1f)) {
            Text(book.title, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                BookKeepMark(state)
                Text(note, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    color = if (state is BookState.Failed) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (state is BookState.Getting) app.kimono.ui.InkProgress(progress = { state.progress }, modifier = Modifier.padding(top = 4.dp).fillMaxWidth())
        }
        actions()
    }
}

/**
 * Books' home with no connection: what's on the phone, ready to read, in
 * place of shelves that wouldn't open.
 */
@Composable
fun OfflineBooks(books: Books, platform: Platform, retry: () -> Unit, openDownloads: () -> Unit) {
    val keep = books.keep ?: return
    val kept = keep.kept.collectAsState().value.values.sortedByDescending { it.at }
    var reading by remember { mutableStateOf<BookKeep.Kept?>(null) }
    Surface(shape = RoundedCornerShape(28.dp), color = MaterialTheme.colorScheme.secondaryContainer, modifier = Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 20.dp)) {
        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Box(Modifier.size(10.dp).clip(CircleShape).background(MaterialTheme.colorScheme.onSecondaryContainer.copy(alpha = .45f)))
                Text("No connection", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSecondaryContainer, modifier = Modifier.weight(1f))
                Text("Try again", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSecondaryContainer,
                    modifier = Modifier.clip(RoundedCornerShape(10.dp)).clickable(onClick = retry).padding(horizontal = 8.dp, vertical = 6.dp))
            }
            Text(if (kept.isEmpty()) "Books you download read here with none." else if (kept.size == 1) "1 book on this phone to read" else "${kept.size} books on this phone to read",
                style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSecondaryContainer.copy(alpha = .8f))
            if (kept.isNotEmpty()) Text("All downloads", style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSecondaryContainer,
                modifier = Modifier.clip(RoundedCornerShape(10.dp)).clickable(onClick = openDownloads).padding(vertical = 6.dp))
        }
    }
    if (kept.isNotEmpty()) LazyRow(contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 18.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        items(kept, key = { "off" + it.book.key }) { k ->
            val place = keep.placeOf(k.book.key)
            Column(Modifier.width(112.dp)) {
                Book3D(k.book, 104.dp, progress = place) { reading = k }
                Text(k.book.title, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 12.dp))
                Text(place?.let { "${(it * 100).toInt()}% · read on" } ?: "Read", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary, maxLines = 1)
            }
        }
    }
    KeptReader(books, platform, reading) { reading = null }
}

/** "On this phone" on Books' home: what's downloaded, a tap from reading. */
@Composable
fun KeptShelf(books: Books, platform: Platform, openDownloads: () -> Unit) {
    val keep = books.keep ?: return
    val kept = keep.kept.collectAsState().value.values.sortedByDescending { it.at }
    if (kept.isEmpty()) return
    var reading by remember { mutableStateOf<BookKeep.Kept?>(null) }
    Column(Modifier.padding(top = 28.dp)) {
        Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("On this phone", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
            Text("See all", style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.primary,
                modifier = Modifier.clip(RoundedCornerShape(10.dp)).clickable(onClick = openDownloads).padding(horizontal = 8.dp, vertical = 6.dp))
        }
        LazyRow(contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 18.dp, bottom = 4.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            items(kept, key = { "kept" + it.book.key }) { k ->
                val place = keep.placeOf(k.book.key)
                Column(Modifier.width(112.dp)) {
                    Book3D(k.book, 104.dp, progress = place) { reading = k }
                    Text(k.book.title, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 12.dp))
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        BookKeepMark(BookState.Kept, 12.dp)
                        Text(listOfNotNull(k.file.format.uppercase(), megabytes(k.size)).joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
                    }
                }
            }
        }
    }
    KeptReader(books, platform, reading) { reading = null }
}
