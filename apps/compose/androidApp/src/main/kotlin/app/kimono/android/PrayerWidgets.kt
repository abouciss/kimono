package app.kimono.android

import android.app.AlarmManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.updateAll
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import app.kimono.data.KimonoProblem
import app.kimono.data.OFFLINE
import app.kimono.prayer.PrayerMine
import app.kimono.prayer.Prayers
import app.kimono.prayer.Presentation
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import java.util.concurrent.TimeUnit
import kotlin.time.Clock

/*
 * 礼 Prayer on the home screen. The widgets read the timetable the app keeps
 * (encrypted, like every kept value) and work everything out on the phone,
 * so they carry on offline. While any is placed, a non-waking alarm turns
 * them over at each minute (nothing runs while the screen is off; the first
 * turn after it wakes catches up), and twice a day WorkManager fetches the
 * timetable again with the app's own sign-in.
 */
object PrayerWidgets {
    /** The kept place and timetable, as the widgets last read them. */
    val mine = MutableStateFlow<PrayerMine?>(null)
    /** The minute the widgets show. */
    val now = MutableStateFlow(Clock.System.now())
    /** Kimono's own light or dark ("system", "light", "dark"), for widgets that follow it. */
    val appearance = MutableStateFlow("system")
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val widgets: List<GlanceAppWidget> get() = listOf(NextPrayerWidget(), TodayPrayerWidget(), StripPrayerWidget())
    private val receivers = listOf(NextPrayerReceiver::class.java, TodayPrayerReceiver::class.java, StripPrayerReceiver::class.java)

    private fun platform(context: Context) = (context.applicationContext as KimonoApplication).platform

    /** Reads what's kept again: the app changed it, or a widget is starting up. */
    suspend fun read(context: Context): PrayerMine? {
        val platform = platform(context)
        appearance.value = platform.readKept(app.kimono.theme.Appearance.KEY) ?: "system"
        return Prayers.readKept(platform).also { mine.value = it; now.value = Clock.System.now() }
    }

    /** The app kept a new timetable (or place): every widget looks again. */
    fun changed(context: Context) {
        val app = context.applicationContext
        scope.launch { read(app); refreshAll(app); ensure(app) }
    }

    suspend fun refreshAll(context: Context) {
        now.value = Clock.System.now()
        if (!placed(context)) return
        widgets.forEach { runCatching { it.updateAll(context) } }
    }

    fun placed(context: Context): Boolean {
        val manager = AppWidgetManager.getInstance(context)
        return receivers.any { manager.getAppWidgetIds(android.content.ComponentName(context, it)).isNotEmpty() }
    }

    /** With a widget placed: the next minute's turn and the twice-daily fetch. Without: neither. */
    fun ensure(context: Context) {
        val alarms = context.getSystemService(AlarmManager::class.java) ?: return
        val tick = PendingIntent.getBroadcast(context, 0, Intent(context, PrayerTicker::class.java).setAction(PrayerTicker.TICK), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val work = WorkManager.getInstance(context)
        if (!placed(context)) {
            alarms.cancel(tick)
            work.cancelUniqueWork(REFRESH)
            return
        }
        val at = Presentation.nextMinute(Clock.System.now()).toEpochMilliseconds()
        /* RTC, not RTC_WAKEUP: a sleeping phone isn't woken to turn a page nobody sees. */
        if (Build.VERSION.SDK_INT < 31 || alarms.canScheduleExactAlarms()) alarms.setExact(AlarmManager.RTC, at, tick)
        else alarms.set(AlarmManager.RTC, at, tick)
        val fetch = PeriodicWorkRequestBuilder<PrayerRefreshWorker>(12, TimeUnit.HOURS)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build()
        work.enqueueUniquePeriodicWork(REFRESH, ExistingPeriodicWorkPolicy.KEEP, fetch)
    }

    /** A minute has turned (or the clock or zone changed): redraw, and set the next turn. */
    fun tick(context: Context, done: () -> Unit) {
        val app = context.applicationContext
        scope.launch {
            try {
                if (mine.value == null) read(app)
                refreshAll(app)
                ensure(app)
            } finally { done() }
        }
    }

    /**
     * The widget picker shows the pictures in the app (drawable prayer_preview_*). Earlier
     * builds handed Android 15 generated previews instead, which stay until taken back:
     * take them back once per install or update.
     */
    fun clearPreviews(context: Context) {
        if (Build.VERSION.SDK_INT < 35) return
        val prefs = context.getSharedPreferences("prayer-widgets", Context.MODE_PRIVATE)
        val version = runCatching { context.packageManager.getPackageInfo(context.packageName, 0).lastUpdateTime }.getOrDefault(0)
        if (prefs.getLong("previews-cleared", -1) == version) return
        val manager = AppWidgetManager.getInstance(context)
        receivers.forEach { receiver ->
            val provider = android.content.ComponentName(context, receiver)
            listOf(android.appwidget.AppWidgetProviderInfo.WIDGET_CATEGORY_HOME_SCREEN, android.appwidget.AppWidgetProviderInfo.WIDGET_CATEGORY_KEYGUARD).forEach { category ->
                runCatching { manager.removeWidgetPreview(provider, category) }
            }
        }
        prefs.edit().putLong("previews-cleared", version).apply()
    }

    const val REFRESH = "prayer-refresh"
}

/** The minute's turn, and the clock or time zone changing under the widgets. */
class PrayerTicker : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val pending = goAsync()
        PrayerWidgets.tick(context) { pending.finish() }
    }

    companion object { const val TICK = "app.kimono.prayer.TICK" }
}

/** Twice a day: the timetable again, with the app's own sign-in. Keeping it tells the widgets. */
class PrayerRefreshWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val app = applicationContext as KimonoApplication
        if (!app.ensureSession()) return Result.success()
        return try {
            Prayers(app.session, app.platform).load()
            Result.success()
        } catch (problem: KimonoProblem) {
            if (problem.message == OFFLINE) Result.retry() else Result.success()
        }
    }
}

/** What the widgets share: placed or taken away, they start or stop the minute's turn. */
abstract class PrayerReceiver : GlanceAppWidgetReceiver() {
    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        super.onUpdate(context, appWidgetManager, appWidgetIds)
        PrayerWidgets.ensure(context.applicationContext)
    }

    override fun onDeleted(context: Context, appWidgetIds: IntArray) {
        super.onDeleted(context, appWidgetIds)
        PrayerWidgets.ensure(context.applicationContext)
    }

    override fun onDisabled(context: Context) {
        super.onDisabled(context)
        PrayerWidgets.ensure(context.applicationContext)
    }
}

class NextPrayerReceiver : PrayerReceiver() { override val glanceAppWidget: GlanceAppWidget = NextPrayerWidget() }
class TodayPrayerReceiver : PrayerReceiver() { override val glanceAppWidget: GlanceAppWidget = TodayPrayerWidget() }
class StripPrayerReceiver : PrayerReceiver() { override val glanceAppWidget: GlanceAppWidget = StripPrayerWidget() }
