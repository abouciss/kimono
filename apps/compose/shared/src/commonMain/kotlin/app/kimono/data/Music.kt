package app.kimono.data

import io.ktor.client.statement.bodyAsChannel
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpMethod
import io.ktor.http.contentType
import io.ktor.http.encodeURLPathPart
import io.ktor.http.encodeURLQueryComponent
import io.ktor.http.isSuccess
import io.ktor.client.request.header
import io.ktor.client.request.setBody
import io.ktor.utils.io.readUTF8Line
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.add

/* ── What /api/v1/music answers with (apps/portal/src/lib/music) ── */

@Serializable data class ArtistRef(val key: String, val name: String)
@Serializable data class AlbumRef(val key: String, val title: String, val cover: String? = null)

@Serializable
data class Track(
    val key: String, val title: String, val artists: List<ArtistRef> = emptyList(), val album: AlbumRef? = null,
    val duration: Double = 0.0, val isrc: String? = null, val explicit: Boolean = false, val rank: Long = 0, val playedAt: String? = null,
) {
    val byline get() = artists.map { it.name }.distinct().joinToString(", ")
    val cover get() = album?.cover
}

@Serializable
data class Album(
    val key: String, val title: String, val artist: ArtistRef? = null, val cover: String? = null, val year: Int? = null,
    val kind: String = "album", val genres: List<String> = emptyList(), val tracks: List<Track> = emptyList(),
)

@Serializable data class Artist(val key: String, val name: String, val picture: String? = null, val fans: Long = 0, val tags: List<String> = emptyList())
@Serializable data class Playlist(val id: String, val name: String, val count: Int = 0, val covers: List<String> = emptyList(), val updatedAt: String = "")
@Serializable data class TrackRow(val id: String, val title: String, val items: List<Track> = emptyList())
@Serializable data class Genre(val id: Int, val name: String, val picture: String? = null)
@Serializable data class LyricLine(val at: Double, val line: String)
@Serializable data class Lyrics(val synced: List<LyricLine>? = null, val plain: String? = null, val instrumental: Boolean = false)
@Serializable data class MusicPerson(val username: String, val name: String = "", val picture: String? = null)

@Serializable
data class MusicHome(
    val greeting: String = "new", val jumpBack: List<Track> = emptyList(), val mixes: List<TrackRow> = emptyList(), val artists: List<Artist> = emptyList(),
    val charts: TrackRow? = null, val albums: List<Album> = emptyList(), val playlists: List<Playlist> = emptyList(), val genres: List<Genre> = emptyList(),
)

@Serializable
data class MusicMe(
    val plays: Int = 0, val minutes: Int = 0, val tags: List<String> = emptyList(), val artists: List<Artist> = emptyList(),
    val onRepeat: List<Track> = emptyList(), val recent: List<Track> = emptyList(), val playlists: List<Playlist> = emptyList(), val liked: Int = 0,
)

@Serializable data class ArtistPage(val artist: Artist, val top: List<Track> = emptyList(), val albums: List<Album> = emptyList(), val related: List<Artist> = emptyList(), val rating: String? = null)
@Serializable data class AlbumPage(val album: Album, val rating: String? = null)
@Serializable data class TrackPage(val track: Track, val rating: String? = null)
@Serializable
data class PlaylistPage(
    val id: String, val name: String, val updatedAt: String = "", val tracks: List<Track> = emptyList(), val owner: MusicPerson? = null, val mine: Boolean = true,
    /** Public, private or shared, once the web's playlists have them. */
    val visibility: String? = null,
)
@Serializable data class SearchResults(val tracks: List<Track> = emptyList(), val albums: List<Album> = emptyList(), val artists: List<Artist> = emptyList())
@Serializable data class SongStatus(val stage: String, val fraction: Double? = null)
@Serializable data class QueueSource(val kind: String, val id: String, val title: String)
@Serializable
data class SavedQueue(
    val tracks: List<Track> = emptyList(), val index: Int = 0, val position: Double = 0.0, val shuffle: Boolean = false,
    val repeat: String = "off", val source: QueueSource? = null, val playing: Boolean = false, val updatedAt: String = "",
)
@Serializable data class RatedItem(val kind: String, val key: String, val rating: String, val title: String = "", val subtitle: String = "", val picture: String? = null)
@Serializable data class FriendListening(val username: String, val name: String = "", val picture: String? = null, val track: Track, val at: String = "", val live: Boolean = false)
@Serializable data class FriendOnSong(val username: String, val name: String = "", val picture: String? = null, val loved: Boolean = false, val playedAt: String? = null)

/* ── Listen parties (lib/music/party.ts) ── */
@Serializable data class PartyMember(val username: String, val state: String)
@Serializable data class PartyWaiting(val `for`: List<String> = emptyList(), val since: Long = 0)
@Serializable
data class PartyView(
    val id: String, val host: String, val invited: List<String> = emptyList(), val open: Boolean = true, val tracks: List<Track> = emptyList(),
    val index: Int = 0, val playing: Boolean = false, val position: Double = 0.0, val at: Long = 0, val waiting: PartyWaiting? = null,
    val members: List<PartyMember> = emptyList(), val seq: Long = 0, val started: Long = 0, val ended: Boolean = false, val now: Long = 0,
) { val song get() = tracks.getOrNull(index) }
@Serializable data class ChatLine(val id: String, val username: String, val text: String, val at: Long)
@Serializable data class PartyNow(val state: PartyView, val chat: List<ChatLine> = emptyList(), val people: List<MusicPerson> = emptyList())

@Serializable private data class Wrap<T>(val tracks: List<T> = emptyList())
@Serializable private data class Playlists(val playlists: List<Playlist> = emptyList())
@Serializable private data class OnePlaylist(val playlist: PlaylistPage)
@Serializable private data class Ratings(val ratings: List<RatedItem> = emptyList())
@Serializable private data class LyricsAnswer(val lyrics: Lyrics? = null)
@Serializable private data class QueueAnswer(val queue: SavedQueue? = null)
@Serializable private data class FriendsAnswer(val friends: List<FriendListening> = emptyList())
@Serializable private data class SongFriends(val friends: List<FriendOnSong> = emptyList())
@Serializable private data class MixAnswer(val mix: TrackRow)
@Serializable private data class Started(val id: String)
@Serializable private data class Clock(val now: Long)
@Serializable data class PartyAnswer(val ok: Boolean = false, val state: PartyView? = null, val error: String? = null, val reason: String? = null)

private val json = Json { ignoreUnknownKeys = true; coerceInputValues = true }

/**
 * 音 Kimono Music: Deezer's catalogue, Last.fm's taste and LRCLIB's lyrics
 * as the Portal serves them, and the audio itself from /stream. The same API
 * the web player uses; the phone only plays what it answers.
 */
class Music(val session: Session) {
    private suspend inline fun <reified T> get(path: String): T = json.decodeFromString(session.fetch("$BASE/$path"))
    inline fun <reified T> known(path: String): T? = session.answers.peek("/api/v1/music/$path")?.let { runCatching { Json { ignoreUnknownKeys = true; coerceInputValues = true }.decodeFromString<T>(it) }.getOrNull() }
    private suspend inline fun <reified T> send(path: String, method: HttpMethod, body: JsonObject): T = json.decodeFromString(session.call("$BASE/$path", method) {
        contentType(ContentType.Application.Json); setBody(body.toString())
    })
    private fun q(s: String) = s.encodeURLQueryComponent()

    suspend fun home(): MusicHome = get("home")
    suspend fun me(): MusicMe = get("me")
    suspend fun friends(): List<FriendListening> = get<FriendsAnswer>("friends").friends
    suspend fun search(text: String): SearchResults = json.decodeFromString(session.call("$BASE/search?q=${q(text.trim())}"))
    suspend fun artist(key: String): ArtistPage = get("artist?key=${q(key)}")
    suspend fun album(key: String): AlbumPage = get("album?key=${q(key)}")
    suspend fun track(key: String): TrackPage = get("track?key=${q(key)}")
    suspend fun mix(id: String): TrackRow = get<MixAnswer>("mix?id=${q(id)}").mix
    suspend fun lyrics(key: String): Lyrics? = get<LyricsAnswer>("lyrics?key=${q(key)}").lyrics
    suspend fun status(key: String): SongStatus = json.decodeFromString(session.call("$BASE/status?key=${q(key)}"))
    suspend fun songFriends(key: String): List<FriendOnSong> = get<SongFriends>("song-friends?key=${q(key)}").friends
    suspend fun radio(seed: String, skip: List<String>): List<Track> = json.decodeFromString<Wrap<Track>>(session.call("$BASE/radio?seed=${q(seed)}&skip=${q(skip.takeLast(200).joinToString(","))}")).tracks
    suspend fun liked(): List<Track> = get<Wrap<Track>>("liked").tracks
    suspend fun history(): List<Track> = get<Wrap<Track>>("history").tracks
    suspend fun ratings(): List<RatedItem> = json.decodeFromString<Ratings>(session.call("$BASE/ratings")).ratings
    suspend fun ready(keys: List<String>) { runCatching { send<JsonObject>("ready", HttpMethod.Post, buildJsonObject { putJsonArray("keys") { keys.forEach { add(it) } } }) } }
    suspend fun played(key: String, seconds: Int) { runCatching { send<JsonObject>("play", HttpMethod.Post, buildJsonObject { put("key", key); put("seconds", seconds) }) } }
    /** "track", "album" or "artist"; "down", "up", "love" or null. */
    suspend fun rate(kind: String, key: String, rating: String?) {
        send<JsonObject>("rating", HttpMethod.Put, buildJsonObject { put("kind", kind); put("key", key); if (rating == null) put("rating", JsonNull) else put("rating", rating) })
    }
    suspend fun queue(): SavedQueue? = json.decodeFromString<QueueAnswer>(session.call("$BASE/queue")).queue
    suspend fun saveQueue(keys: List<String>, index: Int, position: Double, shuffle: Boolean, repeat: String, source: QueueSource?, playing: Boolean, at: Long) {
        runCatching {
            send<JsonObject>("queue", HttpMethod.Put, buildJsonObject {
                putJsonArray("keys") { keys.forEach { add(it) } }
                put("index", index); put("position", position); put("shuffle", shuffle); put("repeat", repeat); put("playing", playing); put("at", at)
                if (source == null) put("source", JsonNull) else put("source", buildJsonObject { put("kind", source.kind); put("id", source.id); put("title", source.title) })
            })
        }
    }
    suspend fun playlists(): List<Playlist> = get<Playlists>("playlists").playlists
    suspend fun playlist(id: String): PlaylistPage = get<OnePlaylist>("playlists/${id.encodeURLPathPart()}").playlist
    fun knownPlaylist(id: String): PlaylistPage? = known<OnePlaylist>("playlists/${id.encodeURLPathPart()}")?.playlist
    suspend fun createPlaylist(name: String, keys: List<String> = emptyList()): PlaylistPage =
        send<OnePlaylist>("playlists", HttpMethod.Post, buildJsonObject { put("name", name); putJsonArray("keys") { keys.forEach { add(it) } } }).playlist
    suspend fun renamePlaylist(id: String, name: String): PlaylistPage = send<OnePlaylist>("playlists/${id.encodeURLPathPart()}", HttpMethod.Patch, buildJsonObject { put("name", name) }).playlist
    suspend fun setPlaylist(id: String, keys: List<String>): PlaylistPage = send<OnePlaylist>("playlists/${id.encodeURLPathPart()}", HttpMethod.Patch, buildJsonObject { putJsonArray("keys") { keys.forEach { add(it) } } }).playlist
    suspend fun addToPlaylist(id: String, keys: List<String>): PlaylistPage = send<OnePlaylist>("playlists/${id.encodeURLPathPart()}", HttpMethod.Patch, buildJsonObject { putJsonArray("add") { keys.forEach { add(it) } } }).playlist
    suspend fun deletePlaylist(id: String) { session.call("$BASE/playlists/${id.encodeURLPathPart()}", HttpMethod.Delete) }
    /** Sets who sees a playlist ("public", "private"), where the Portal has it; false where it doesn't yet. */
    suspend fun setVisibility(id: String, visibility: String): Boolean = runCatching {
        send<OnePlaylist>("playlists/${id.encodeURLPathPart()}", HttpMethod.Patch, buildJsonObject { put("visibility", visibility) }); true
    }.getOrDefault(false)

    /** The song's audio on this Kimono: AAC in MP4, with byte ranges. */
    fun streamUrl(key: String) = "${session.server.orEmpty()}$BASE/stream?key=${q(key)}"
    fun webUrl(path: String) = "${session.server.orEmpty()}$path"

    /* ── Listen parties ── */
    suspend fun startParty(keys: List<String>, index: Int, position: Double, invite: List<String> = emptyList()): String =
        json.decodeFromString<Started>(session.call("$BASE/party", HttpMethod.Post) {
            contentType(ContentType.Application.Json)
            setBody(buildJsonObject { putJsonArray("keys") { keys.forEach { add(it) } }; put("index", index); put("position", position); putJsonArray("invite") { invite.forEach { add(it) } } }.toString())
        }).id
    suspend fun partyNow(id: String): PartyNow = json.decodeFromString(session.call("$BASE/party/${id.encodeURLPathPart()}"))
    suspend fun partyAct(id: String, body: JsonObject): Pair<Int, PartyAnswer> = session.respond("$BASE/party/${id.encodeURLPathPart()}", HttpMethod.Post, {
        contentType(ContentType.Application.Json); setBody(body.toString())
    }) { response -> response.status.value to (runCatching { json.decodeFromString<PartyAnswer>(response.bodyAsText()) }.getOrNull() ?: PartyAnswer()) }
    /** The server's clock, with when it was asked and answered here, for setting this phone's by. */
    suspend fun clock(): Triple<Long, Long, Long> {
        val sent = kotlin.time.Clock.System.now().toEpochMilliseconds()
        val server = json.decodeFromString<Clock>(session.call("$BASE/clock")).now
        return Triple(sent, kotlin.time.Clock.System.now().toEpochMilliseconds(), server)
    }

    /** Listens to a party's server-sent events until it ends or the call is cancelled: (event, data). */
    suspend fun partyEvents(id: String, client: String, each: suspend (String, String) -> Unit) {
        session.respond("$BASE/party/${id.encodeURLPathPart()}?client=$client", long = true, configure = { header("Accept", "text/event-stream") }) { response ->
            if (!response.status.isSuccess()) throw session.problemOf(response, "This listen party has ended.")
            val channel = response.bodyAsChannel()
            var event = "message"
            val data = StringBuilder()
            while (true) {
                val line = channel.readUTF8Line() ?: break
                when {
                    line.isEmpty() -> { if (data.isNotEmpty()) each(event, data.toString()); event = "message"; data.clear() }
                    line.startsWith("event:") -> event = line.removePrefix("event:").trim()
                    line.startsWith("data:") -> { if (data.isNotEmpty()) data.append('\n'); data.append(line.removePrefix("data:").trimStart()) }
                }
            }
        }
    }

    fun decodeView(text: String): PartyView = json.decodeFromString(text)
    fun decodeChat(text: String): List<ChatLine> = json.decodeFromString<ChatWrap>(text).lines
    fun decodeReact(text: String): Pair<String, String> = json.decodeFromString<ReactWrap>(text).let { it.username to it.emoji }
    fun decodeNow(text: String): Long = runCatching { json.decodeFromString<Clock>(text).now }.getOrDefault(0)
    @Serializable private data class ChatWrap(val lines: List<ChatLine> = emptyList())
    @Serializable private data class ReactWrap(val username: String = "", val emoji: String = "")

    companion object {
        const val APP_ID = "kimono-music"
        /** Gilt: Music sets its gold itself (music.css), warm and metallic rather than bright. */
        const val GOLD = "#946c25"
        private const val BASE = "/api/v1/music"
        val reactions = listOf("❤️", "🔥", "😂", "😮", "🕺", "👏")
        /** Deezer's number in a path (/music/artist/27), and back. */
        fun idOf(key: String) = key.removePrefix("dz:")
        fun keyOf(id: String) = if (id.startsWith("dz:")) id else "dz:$id"
        fun clock(seconds: Double): String {
            val total = if (seconds.isFinite() && seconds > 0) seconds.toInt() else 0
            val h = total / 3600; val m = (total / 60) % 60; val s = total % 60
            return if (h > 0) "$h:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}" else "$m:${s.toString().padStart(2, '0')}"
        }
        fun length(tracks: List<Track>): String {
            val total = tracks.sumOf { it.duration }.toInt()
            val h = total / 3600; val m = ((total % 3600) + 30) / 60
            return if (h > 0) "$h hr $m min" else "$m min"
        }
    }
}

