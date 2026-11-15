package app.kimono.ui

import platform.Foundation.NSDate
import platform.Foundation.NSTimeZone
import platform.Foundation.dateWithTimeIntervalSince1970
import platform.Foundation.knownTimeZoneNames
import platform.Foundation.localTimeZone
import platform.Foundation.timeIntervalSince1970
import platform.Foundation.timeZoneWithName

actual fun hereZone(): String = NSTimeZone.localTimeZone.name

@Suppress("UNCHECKED_CAST")
actual fun allZones(): List<String> = (NSTimeZone.knownTimeZoneNames as List<String>).filter { it.contains('/') }.sorted()

actual fun zoneOffsetMinutes(zone: String?, epochMs: Long): Int {
    val tz = zone?.takeIf { it.isNotBlank() }?.let { NSTimeZone.timeZoneWithName(it) } ?: NSTimeZone.localTimeZone
    return (tz.secondsFromGMTForDate(NSDate.dateWithTimeIntervalSince1970(epochMs / 1000.0)) / 60).toInt()
}

actual fun nowMs(): Long = (NSDate().timeIntervalSince1970 * 1000).toLong()
