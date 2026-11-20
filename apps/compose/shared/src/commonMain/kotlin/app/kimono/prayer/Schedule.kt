package app.kimono.prayer

import kotlinx.datetime.DayOfWeek
import kotlinx.datetime.LocalDate
import kotlinx.datetime.LocalDateTime
import kotlinx.datetime.LocalTime
import kotlinx.datetime.TimeZone
import kotlinx.datetime.atStartOfDayIn
import kotlinx.datetime.plus
import kotlinx.datetime.minus
import kotlinx.datetime.DatePeriod
import kotlinx.datetime.toInstant
import kotlinx.datetime.toLocalDateTime
import kotlin.math.ceil
import kotlin.time.Duration.Companion.days
import kotlin.math.max
import kotlin.time.Duration
import kotlin.time.Instant

/*
 * 礼 Today's prayers, worked out on the phone from the timetable, so the
 * screen and the widgets agree and need no connection. A port of the
 * mawaqit-bar app's ScheduleBuilder and Presentation (mawaqit-gnome/macos):
 * each prayer ends where the next begins, Isha at Islamic midnight (halfway
 * from Maghrib to the next Fajr), and the night is split into its midnight
 * and last third.
 */

/** One prayer (or sunrise) on one day, as instants in the place's own time zone. */
data class Prayer(
    val name: String,
    /** HH:MM on the place's clock. */
    val time: String,
    val start: Instant,
    val isSunrise: Boolean,
    val end: Instant? = null,
    /** -1 for yesterday's, 0 for today's. */
    val dayOffset: Int = 0,
    /** The congregation's time, when the mosque gives one. */
    val iqama: String? = null,
    /** When the congregation is, as an instant (a day later if it's past midnight). */
    val iqamaAt: Instant? = null,
    /** The iqama as the mosque set it, minutes after the adhan ("+10"), when it's set that way. */
    val iqamaAfter: Int? = null,
) {
    val id: String get() = "$name:${start.epochSeconds}"
}

class NightPeriod(val start: Instant, val end: Instant, val midnight: Instant, val lastThird: Instant)

enum class NightPhase { Midnight, LastThird, Sunrise }

/** The night now under way (or tonight's, by day): its midnight, last third, Fajr and the sunrise that closes it. */
class NightMilestones(val midnight: Instant, val lastThird: Instant, val fajr: Instant, val sunrise: Instant, val active: Boolean, val phase: NightPhase?)

class ScheduleView(
    val today: List<Prayer>,
    val next: Prayer?,
    val current: Prayer?,
    val night: NightPeriod,
    val nightActive: Boolean,
    val lastThirdActive: Boolean,
    val milestones: NightMilestones,
    val now: Instant,
    val date: LocalDate,
    val timezone: String,
    /** Jumu'a on a Friday, else empty. */
    val jumua: List<String>,
)

/** What a title counts down to: the next event, or the open prayer's time left. */
enum class TitleMode { NextPrayer, TimeLeft }

object ScheduleBuilder {
    val names = listOf("Fajr", "Sunrise", "Dhuhr", "Asr", "Maghrib", "Isha")

    /** Null when the timetable doesn't cover yesterday, today and tomorrow, or its zone is unknown. */
    fun build(timetable: Timetable, now: Instant): ScheduleView? {
        val zone = runCatching { TimeZone.of(timetable.timezone) }.getOrNull() ?: return null
        val today = now.toLocalDateTime(zone).date
        val dates = listOf(today.minus(DatePeriod(days = 1)), today, today.plus(DatePeriod(days = 1)))
        val byDate = timetable.days.associateBy { it.date }
        val schedules = dates.map { date -> prayers(byDate[date.toString()] ?: return null, date, zone)?.toMutableList() ?: return null }
        val nights = (0..1).map { index ->
            val start = schedules[index][4].start
            val end = schedules[index + 1][0].start
            val duration = end - start
            if (duration <= Duration.ZERO) return null
            NightPeriod(start, end, start + duration / 2, start + duration * 2 / 3)
        }
        for (day in 0..1) {
            for (index in schedules[day].indices) {
                val prayer = schedules[day][index]
                if (prayer.isSunrise) continue
                schedules[day][index] = prayer.copy(end = if (index == 5) nights[day].midnight else schedules[day][index + 1].start, dayOffset = day - 1)
            }
        }
        val todays = schedules[1]
        val next = (todays + schedules[2]).firstOrNull { !it.isSunrise && it.start > now }
        val current = (schedules[0] + schedules[1]).firstOrNull { !it.isSunrise && it.start <= now && now < (it.end ?: it.start) }
        val night = if (now < schedules[1][0].start) nights[0] else nights[1]
        val cycleIndex = if (now < schedules[1][1].start) 0 else 1
        val cycleNight = nights[cycleIndex]
        val sunrise = schedules[cycleIndex + 1][1].start
        val cycleActive = now >= schedules[cycleIndex][5].start && now < sunrise
        val phase = when {
            !cycleActive -> null
            now < cycleNight.midnight -> NightPhase.Midnight
            now < cycleNight.lastThird -> NightPhase.LastThird
            else -> NightPhase.Sunrise
        }
        val day = byDate.getValue(today.toString())
        return ScheduleView(
            today = todays,
            next = next,
            current = current,
            night = night,
            nightActive = night.start <= now && now < night.end,
            lastThirdActive = night.lastThird <= now && now < night.end,
            milestones = NightMilestones(cycleNight.midnight, cycleNight.lastThird, cycleNight.end, sunrise, cycleActive, phase),
            now = now,
            date = today,
            timezone = timetable.timezone,
            jumua = if (today.dayOfWeek == DayOfWeek.FRIDAY) day.jumua else emptyList(),
        )
    }

    /** HH:MM on the place's clock. */
    fun time(instant: Instant, timezone: String): String {
        val zone = runCatching { TimeZone.of(timezone) }.getOrElse { TimeZone.UTC }
        val t = instant.toLocalDateTime(zone)
        return "${t.hour.toString().padStart(2, '0')}:${t.minute.toString().padStart(2, '0')}"
    }

    private fun prayers(day: PrayerDay, date: LocalDate, zone: TimeZone): List<Prayer>? {
        if (day.times.size < 6) return null
        return names.mapIndexed { index, name ->
            val text = day.times[index]
            val (hour, minute) = text.split(":").takeIf { it.size == 2 }?.map { it.toIntOrNull() ?: return null } ?: return null
            if (hour !in 0..23 || minute !in 0..59) return null
            val start = LocalDateTime(date, LocalTime(hour, minute)).toInstant(zone)
            /* The iqama list runs Fajr, Dhuhr, Asr, Maghrib, Isha: no sunrise. */
            val iqama = if (index == 1) null else day.iqama?.getOrNull(if (index == 0) 0 else index - 1)
            val iqamaAfter = if (iqama == null) null else day.iqamaAfter?.getOrNull(if (index == 0) 0 else index - 1)
            val iqamaAt = iqama?.split(":")?.takeIf { it.size == 2 }?.let { (h, m) ->
                val hh = h.toIntOrNull(); val mm = m.toIntOrNull()
                if (hh == null || mm == null || hh !in 0..23 || mm !in 0..59) null
                else LocalDateTime(date, LocalTime(hh, mm)).toInstant(zone).let { if (it < start) it + 1.days else it }
            }
            Prayer(name, text.padStart(5, '0'), start, isSunrise = index == 1, iqama = iqama, iqamaAt = iqamaAt, iqamaAfter = iqamaAfter)
        }
    }

    /** The first instant of the place's next day: when the widgets turn their page. */
    fun nextDay(now: Instant, timezone: String): Instant? {
        val zone = runCatching { TimeZone.of(timezone) }.getOrNull() ?: return null
        return now.toLocalDateTime(zone).date.plus(DatePeriod(days = 1)).atStartOfDayIn(zone)
    }
}

/** How things are said, the same on the screen, the widgets and the menu bar app. */
object Presentation {
    /** Minutes rounded up, at least one: "45min", "1h05min". */
    fun remaining(until: Instant, now: Instant): String {
        val minutes = max(1, ceil((until - now).inWholeMilliseconds / 60_000.0).toInt())
        return if (minutes >= 60) "${minutes / 60}h${(minutes % 60).toString().padStart(2, '0')}min" else "${minutes}min"
    }

    fun prayerDetail(prayer: Prayer, view: ScheduleView, h24: Boolean = true): String {
        if (prayer.id == view.next?.id) return "in ${remaining(prayer.start, view.now)}"
        val end = prayer.end ?: return ""
        val time = clock(ScheduleBuilder.time(end, view.timezone), h24)
        return if (end <= view.now) "Ended $time" else "Ends $time"
    }

    /** Whether the open prayer is still waiting for its congregation. */
    fun beforeIqama(prayer: Prayer, view: ScheduleView): Boolean = prayer.id == view.current?.id && prayer.iqamaAt?.let { it > view.now } == true

    /** "Ends at 22:41 · Islamic midnight", for the prayer that's open; "Iqama in 8min" while the congregation is still ahead. */
    fun currentDetail(prayer: Prayer, view: ScheduleView, h24: Boolean = true, iqama: Boolean = true): String {
        if (iqama && beforeIqama(prayer, view)) return "Iqama in ${remaining(prayer.iqamaAt!!, view.now)}"
        val end = prayer.end ?: return ""
        return "Ends at ${clock(ScheduleBuilder.time(end, view.timezone), h24)}${if (prayer.name == "Isha") " · Islamic midnight" else ""}"
    }

    /** In time-left mode, the open prayer and how long it has left; otherwise the next event. */
    fun panelTitle(view: ScheduleView, mode: TitleMode = TitleMode.NextPrayer): String {
        val m = view.milestones
        val now = view.now
        val current = view.current
        val end = current?.end
        if (mode == TitleMode.TimeLeft && current != null && end != null && now < end) return "${current.name}, ${remaining(end, now)} left"
        if (m.active && now < m.midnight) return "Midnight in ${remaining(m.midnight, now)}"
        if (m.active && now < m.lastThird) return "Last third in ${remaining(m.lastThird, now)}"
        /* The cycle's own Fajr: after Fajr, view.night already points at tonight. */
        if (m.active && now < m.fajr) return "Fajr in ${remaining(m.fajr, now)}"
        if (m.active) return "Sunrise in ${remaining(m.sunrise, now)}"
        val next = view.next ?: return ""
        return "${next.name} in ${remaining(next.start, now)}"
    }

    /** The title split in two, for the big countdown: what ("Isha") and how long ("in 1h05min" or "1h05min left"). */
    fun titleParts(view: ScheduleView, mode: TitleMode = TitleMode.NextPrayer): Pair<String, String> {
        val title = panelTitle(view, mode)
        val left = title.indexOf(", ")
        if (left > 0 && title.endsWith(" left")) return title.substring(0, left) to title.substring(left + 2)
        val at = title.indexOf(" in ")
        return if (at > 0) title.substring(0, at) to title.substring(at + 1) else title to ""
    }

    /** Overnight, the open prayer replaces today's row of the same name instead of adding a row. */
    fun displayPrayers(view: ScheduleView): List<Prayer> = view.today.filter { !it.isSunrise }.map { prayer ->
        val current = view.current
        if (current != null && current.name == prayer.name && view.today.none { it.id == current.id }) current else prayer
    }

    fun nextSummary(view: ScheduleView, h24: Boolean = true): String {
        val next = view.next ?: return ""
        if (view.today.any { it.id == next.id }) return ""
        return "Next: ${next.name} at ${clock(next.time, h24)} tomorrow"
    }

    /** A milestone's note: "in 40min" while it's the phase under way, "Passed" once gone in the night under way. */
    fun milestoneDetail(phase: NightPhase, at: Instant, view: ScheduleView): String? = when {
        view.milestones.phase == phase -> "in ${remaining(at, view.now)}"
        view.milestones.active && at <= view.now -> "Passed"
        else -> null
    }

    /** HH:MM as the phone shows times: as it is in 24-hour, "5:50 AM" otherwise. */
    fun clock(hhmm: String, h24: Boolean): String {
        if (h24) return hhmm
        val (h, m) = hhmm.split(":").let { (it.getOrNull(0)?.toIntOrNull() ?: 0) to (it.getOrNull(1) ?: "00") }
        val hour = if (h % 12 == 0) 12 else h % 12
        return "$hour:$m ${if (h < 12) "AM" else "PM"}"
    }

    /** The turn of the next minute, when a countdown's words change. */
    fun nextMinute(now: Instant): Instant = Instant.fromEpochSeconds((now.epochSeconds / 60 + 1) * 60)
}
