package app.kimono.ui

/*
 * 時 Time zones, as the phone knows them: the one you're in, every one it
 * knows, and how far one is from UTC at a moment (for a profile's clock).
 */

/** The zone this phone is in ("Europe/Paris"). */
expect fun hereZone(): String

/** Every zone the phone knows, sorted. */
expect fun allZones(): List<String>

/** Minutes [zone] is ahead of UTC at [epochMs]; this phone's own when [zone] is blank or unknown. */
expect fun zoneOffsetMinutes(zone: String?, epochMs: Long): Int

/** Milliseconds since 1970, now. */
expect fun nowMs(): Long
