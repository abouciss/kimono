package app.kimono.ui

import java.time.Instant
import java.time.ZoneId

actual fun hereZone(): String = ZoneId.systemDefault().id

actual fun allZones(): List<String> = ZoneId.getAvailableZoneIds().filter { it.contains('/') && !it.startsWith("Etc/") && !it.startsWith("SystemV/") }.sorted()

actual fun zoneOffsetMinutes(zone: String?, epochMs: Long): Int {
    val id = zone?.takeIf { it.isNotBlank() }?.let { runCatching { ZoneId.of(it) }.getOrNull() } ?: ZoneId.systemDefault()
    return id.rules.getOffset(Instant.ofEpochMilli(epochMs)).totalSeconds / 60
}

actual fun nowMs(): Long = System.currentTimeMillis()
