package app.kimono.prayer

import app.kimono.data.KimonoProblem
import app.kimono.data.Platform
import app.kimono.data.Session
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.HttpMethod
import io.ktor.http.contentType
import io.ktor.http.encodeURLQueryComponent
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/* ── What /api/v1/prayer answers with (apps/portal/src/lib/prayer/model.ts) ── */

/** A mosque, or a position worked out by calculation. */
@Serializable
data class PrayerPlace(val id: String, val kind: String, val name: String, val detail: String? = null, val url: String? = null)

/** One day: `times` is Fajr, Sunrise, Dhuhr, Asr, Maghrib, Isha; `iqama` the congregations of the five. */
@Serializable
data class PrayerDay(val date: String, val times: List<String>, val iqama: List<String?>? = null, val jumua: List<String> = emptyList())

@Serializable
data class Timetable(val place: PrayerPlace, val timezone: String, val days: List<PrayerDay>, val fetchedAt: Long = 0)

@Serializable
data class PrayerMine(val place: PrayerPlace? = null, val timetable: Timetable? = null, val recent: List<PrayerPlace> = emptyList(), val problem: String? = null)

@Serializable private data class Found(val places: List<PrayerPlace> = emptyList())

private val json = Json { ignoreUnknownKeys = true; explicitNulls = false }

/**
 * 礼 Kimono Times on the phone: your place and its timetable, kept on the
 * phone (encrypted, as every kept value is) so the screen and the widgets
 * work offline. [changed] tells the widgets to look again.
 */
class Prayers(private val session: Session, private val platform: Platform) {
    private val _mine = MutableStateFlow<PrayerMine?>(null)
    val mine: StateFlow<PrayerMine?> = _mine

    /** What was kept from last time, if nothing newer is in hand. */
    suspend fun kept(): PrayerMine? = _mine.value ?: readKept(platform)?.also { _mine.value = it }

    suspend fun load(): PrayerMine = settle(session.call(PATH))

    suspend fun choose(id: String): PrayerMine = settle(session.call(PATH, HttpMethod.Put) {
        contentType(ContentType.Application.Json)
        setBody(buildJsonObject { put("id", id) }.toString())
    })

    suspend fun forget(id: String): PrayerMine = settle(session.call("$PATH?id=${id.encodeURLQueryComponent()}", HttpMethod.Delete))

    suspend fun search(q: String): List<PrayerPlace> =
        json.decodeFromString<Found>(session.call("$PATH/search?q=${q.trim().encodeURLQueryComponent()}")).places

    suspend fun near(lat: Double, lon: Double, tz: String): List<PrayerPlace> =
        json.decodeFromString<Found>(session.call("$PATH/search?lat=$lat&lon=$lon&tz=${tz.encodeURLQueryComponent()}")).places

    private suspend fun settle(text: String): PrayerMine {
        val got = runCatching { json.decodeFromString<PrayerMine>(text) }.getOrElse { throw KimonoProblem("Prayer times couldn't be read.") }
        /* A timetable that couldn't be fetched this time keeps the one kept before, for the same place. */
        val keptBefore = _mine.value ?: readKept(platform)
        val merged = if (got.timetable == null && got.place != null && keptBefore?.timetable?.place?.id == got.place.id) got.copy(timetable = keptBefore.timetable) else got
        _mine.value = merged
        platform.keep(KEY, json.encodeToString(PrayerMine.serializer(), merged.copy(problem = null)))
        platform.prayerChanged()
        return merged
    }

    companion object {
        const val APP_ID = "kimono-prayer"
        const val ACCENT = "#2f5d62"
        const val KEY = "kimono.prayer"
        private const val PATH = "/api/v1/prayer"

        /** The kept place and timetable, for the widgets (or anything else that runs without the app). */
        suspend fun readKept(platform: Platform): PrayerMine? =
            platform.readKept(KEY)?.let { runCatching { json.decodeFromString<PrayerMine>(it) }.getOrNull() }

        /** The kept timetable alone, from text as it was kept. */
        fun decode(text: String): PrayerMine? = runCatching { json.decodeFromString<PrayerMine>(text) }.getOrNull()
    }
}
