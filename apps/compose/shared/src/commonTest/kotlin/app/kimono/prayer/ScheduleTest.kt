package app.kimono.prayer

import kotlinx.datetime.LocalDateTime
import kotlinx.datetime.TimeZone
import kotlinx.datetime.toInstant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.time.Instant

class ScheduleTest {
    private val place = PrayerPlace("mawaqit:test", "mawaqit", "Test mosque")

    /* A November week in Montréal: Islamic midnight falls at 23:10:30, before the day turns. */
    private val winter = Timetable(place, "America/Toronto", listOf(
        PrayerDay("2026-11-18", listOf("05:50", "07:10", "12:00", "14:20", "16:30", "18:00")),
        PrayerDay("2026-11-19", listOf("05:51", "07:11", "12:00", "14:19", "16:29", "17:59"), iqama = listOf("06:10", "12:15", "14:30", "16:34", "18:15")),
        PrayerDay("2026-11-20", listOf("05:52", "07:12", "12:00", "14:19", "16:28", "17:58"), jumua = listOf("12:30", "13:30")),
        PrayerDay("2026-11-21", listOf("05:53", "07:13", "12:00", "14:18", "16:27", "17:58")),
    ))

    /* A June night in London: Maghrib 21:22 to Fajr 02:45, so Islamic midnight is at 00:03:30 and Isha runs past the day's turn. */
    private val summer = Timetable(place, "Europe/London", listOf(
        PrayerDay("2026-06-20", listOf("02:45", "04:43", "13:03", "17:25", "21:22", "23:00")),
        PrayerDay("2026-06-21", listOf("02:45", "04:43", "13:03", "17:25", "21:22", "23:00")),
        PrayerDay("2026-06-22", listOf("02:45", "04:43", "13:03", "17:25", "21:22", "23:00")),
    ))

    private fun at(table: Timetable, text: String): Instant = LocalDateTime.parse(text).toInstant(TimeZone.of(table.timezone))
    private fun view(table: Timetable, text: String) = assertNotNull(ScheduleBuilder.build(table, at(table, text)))

    @Test fun remainingRoundsUpToWholeMinutes() {
        val now = Instant.fromEpochSeconds(0)
        assertEquals("1min", Presentation.remaining(Instant.fromEpochSeconds(5), now))
        assertEquals("1min", Presentation.remaining(Instant.fromEpochSeconds(-30), now))
        assertEquals("45min", Presentation.remaining(Instant.fromEpochSeconds(44 * 60 + 1), now))
        assertEquals("1h05min", Presentation.remaining(Instant.fromEpochSeconds(65 * 60), now))
        assertEquals("1h00min", Presentation.remaining(Instant.fromEpochSeconds(60 * 60), now))
    }

    @Test fun midday() {
        val v = view(winter, "2026-11-19T13:00")
        assertEquals("Dhuhr", v.current?.name)
        assertEquals("Asr", v.next?.name)
        assertEquals("Asr in 1h19min", Presentation.panelTitle(v))
        assertEquals("Dhuhr, 1h19min left", Presentation.panelTitle(v, TitleMode.TimeLeft))
        assertEquals("Asr" to "in 1h19min", Presentation.titleParts(v))
        assertEquals("Dhuhr" to "1h19min left", Presentation.titleParts(v, TitleMode.TimeLeft))
        val rows = Presentation.displayPrayers(v)
        assertEquals(listOf("Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"), rows.map { it.name })
        assertEquals("Ended 07:11", Presentation.prayerDetail(rows[0], v))
        assertEquals("Ends at 14:19", Presentation.currentDetail(rows[1], v))
        assertEquals("in 1h19min", Presentation.prayerDetail(rows[2], v))
        assertEquals("Ends 17:59", Presentation.prayerDetail(rows[3], v))
        assertEquals("Ends 23:10", Presentation.prayerDetail(rows[4], v))
        assertEquals("", Presentation.nextSummary(v))
        assertEquals(false, v.milestones.active)
        assertNull(Presentation.milestoneDetail(NightPhase.Midnight, v.milestones.midnight, v))
        /* Iqama runs Fajr, Dhuhr, Asr, Maghrib, Isha. */
        assertEquals(listOf("06:10", "12:15", "14:30", "16:34", "18:15"), rows.map { it.iqama })
        assertEquals(emptyList(), v.jumua)
        assertEquals("Ends 5:59 PM", Presentation.prayerDetail(rows[3], v, h24 = false))
    }

    @Test fun eveningPointsAtTomorrowsFajr() {
        val v = view(winter, "2026-11-19T20:00")
        assertEquals("Isha", v.current?.name)
        assertEquals("Next: Fajr at 05:52 tomorrow", Presentation.nextSummary(v))
        assertEquals("Next: Fajr at 5:52 AM tomorrow", Presentation.nextSummary(v, h24 = false))
        assertEquals("Ends at 23:10 · Islamic midnight", Presentation.currentDetail(v.current!!, v))
        /* 3h10min30s to Islamic midnight, rounded up. */
        assertEquals("Midnight in 3h11min", Presentation.panelTitle(v))
        assertEquals("Isha, 3h11min left", Presentation.panelTitle(v, TitleMode.TimeLeft))
        assertEquals(NightPhase.Midnight, v.milestones.phase)
        assertEquals("in 3h11min", Presentation.milestoneDetail(NightPhase.Midnight, v.milestones.midnight, v))
    }

    @Test fun overnightIshaTakesTodaysRow() {
        val v = view(summer, "2026-06-21T00:01")
        val current = assertNotNull(v.current)
        assertEquals("Isha", current.name)
        assertEquals(-1, current.dayOffset)
        val rows = Presentation.displayPrayers(v)
        assertEquals(5, rows.size)
        /* Yesterday's Isha, still open, stands where today's would be. */
        assertEquals(current.id, rows[4].id)
        assertEquals("Ends at 00:03 · Islamic midnight", Presentation.currentDetail(rows[4], v))
        assertEquals("Midnight in 3min", Presentation.panelTitle(v))
        assertEquals("Isha, 3min left", Presentation.panelTitle(v, TitleMode.TimeLeft))
        assertEquals("Fajr", v.next?.name)
        assertEquals("", Presentation.nextSummary(v))
    }

    @Test fun afterIslamicMidnight() {
        val v = view(summer, "2026-06-21T00:30")
        assertNull(v.current)
        assertEquals(NightPhase.LastThird, v.milestones.phase)
        assertEquals("Last third in 28min", Presentation.panelTitle(v))
        /* No prayer is open: time left falls back to the next event. */
        assertEquals("Last third in 28min", Presentation.panelTitle(v, TitleMode.TimeLeft))
        assertEquals("Passed", Presentation.milestoneDetail(NightPhase.Midnight, v.milestones.midnight, v))
        val rows = Presentation.displayPrayers(v)
        assertEquals(0, rows[4].dayOffset)
    }

    @Test fun lastThirdThenFajr() {
        val v = view(winter, "2026-11-19T05:00")
        assertEquals(NightPhase.Sunrise, v.milestones.phase)
        assertEquals("Fajr in 51min", Presentation.panelTitle(v))
        assertEquals("Fajr in 51min", Presentation.panelTitle(v, TitleMode.TimeLeft))
    }

    @Test fun betweenFajrAndSunrise() {
        val v = view(winter, "2026-11-19T06:30")
        assertEquals("Fajr", v.current?.name)
        /* The cycle's own Fajr has passed: what's coming is sunrise, not tomorrow's Fajr. */
        assertEquals("Sunrise in 41min", Presentation.panelTitle(v))
        assertEquals("Fajr, 41min left", Presentation.panelTitle(v, TitleMode.TimeLeft))
        assertEquals(NightPhase.Sunrise, v.milestones.phase)
        assertEquals("in 41min", Presentation.milestoneDetail(NightPhase.Sunrise, v.milestones.sunrise, v))
        assertEquals("Passed", Presentation.milestoneDetail(NightPhase.LastThird, v.milestones.lastThird, v))
        assertEquals("Ends at 07:11", Presentation.currentDetail(v.current!!, v))
    }

    @Test fun afterSunriseBeforeDhuhr() {
        val v = view(winter, "2026-11-19T09:00")
        assertNull(v.current)
        assertEquals("Dhuhr in 3h00min", Presentation.panelTitle(v))
        assertEquals("Dhuhr in 3h00min", Presentation.panelTitle(v, TitleMode.TimeLeft))
        assertEquals(false, v.milestones.active)
    }

    @Test fun iqamaCountsDownWhileThePrayerWaits() {
        val v = view(winter, "2026-11-19T12:05")
        val dhuhr = assertNotNull(v.current)
        assertEquals("Iqama in 10min", Presentation.currentDetail(dhuhr, v))
        assertEquals("Ends at 14:19", Presentation.currentDetail(dhuhr, v, iqama = false))
        val after = view(winter, "2026-11-19T12:20")
        assertEquals("Ends at 14:19", Presentation.currentDetail(assertNotNull(after.current), after))
    }

    @Test fun jumuaOnFridays() {
        val v = view(winter, "2026-11-20T10:00")
        assertEquals(listOf("12:30", "13:30"), v.jumua)
    }

    @Test fun twelveHourClock() {
        assertEquals("5:50 AM", Presentation.clock("05:50", false))
        assertEquals("12:00 PM", Presentation.clock("12:00", false))
        assertEquals("12:15 AM", Presentation.clock("00:15", false))
        assertEquals("5:59 PM", Presentation.clock("17:59", false))
        assertEquals("17:59", Presentation.clock("17:59", true))
    }

    @Test fun missingDaysGiveNoSchedule() {
        assertNull(ScheduleBuilder.build(winter, at(winter, "2026-11-25T12:00")))
        assertNull(ScheduleBuilder.build(winter.copy(timezone = "Nowhere/Atall"), at(winter, "2026-11-19T12:00")))
    }
}
