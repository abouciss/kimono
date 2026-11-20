@file:OptIn(ExperimentalLayoutApi::class)

package app.kimono.android

import android.appwidget.AppWidgetManager
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.datastore.preferences.core.Preferences
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetManager
import androidx.glance.appwidget.state.getAppWidgetState
import androidx.glance.appwidget.state.updateAppWidgetState
import androidx.glance.state.PreferencesGlanceStateDefinition
import androidx.lifecycle.lifecycleScope
import app.kimono.prayer.Prayers
import app.kimono.prayer.TitleMode
import app.kimono.theme.KimonoTheme
import app.kimono.ui.AppAccentTheme
import app.kimono.ui.InkTitle
import app.kimono.ui.Seal
import app.kimono.ui.Surface
import kotlinx.coroutines.launch

/*
 * 礼 Setting up a Prayer widget, when it's placed and whenever it's held to
 * reconfigure: what it counts, what it shows, and how it looks.
 */
class PrayerWidgetConfig : ComponentActivity() {
    private var widgetId = AppWidgetManager.INVALID_APPWIDGET_ID
    private val options = mutableStateOf<WidgetOptions?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        widgetId = intent?.extras?.getInt(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID) ?: AppWidgetManager.INVALID_APPWIDGET_ID
        /* Backing out leaves the widget as it was (or, when first placed, not placed). */
        setResult(RESULT_CANCELED, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId))
        if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) { finish(); return }
        val kind = AppWidgetManager.getInstance(this).getAppWidgetInfo(widgetId)?.provider?.className
        val widget: GlanceAppWidget = when (kind) {
            TodayPrayerReceiver::class.java.name -> TodayPrayerWidget()
            StripPrayerReceiver::class.java.name -> StripPrayerWidget()
            else -> NextPrayerWidget()
        }
        val platform = (application as KimonoApplication).platform
        lifecycleScope.launch {
            platform.readKept(app.kimono.theme.Appearance.KEY)?.let { app.kimono.theme.Appearance.choice.value = it }
            val glanceId = runCatching { GlanceAppWidgetManager(this@PrayerWidgetConfig).getGlanceIdBy(widgetId) }.getOrNull()
            options.value = glanceId?.let { runCatching { WidgetOptions.of(getAppWidgetState<Preferences>(this@PrayerWidgetConfig, PreferencesGlanceStateDefinition, it)) }.getOrNull() } ?: WidgetOptions()
        }
        setContent {
            KimonoTheme {
                app.kimono.screens.PrayerTheme(platform, Prayers.ACCENT) {
                    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.surface) {
                        options.value?.let { current ->
                            Settings(current, today = widget is TodayPrayerWidget, change = { options.value = it }) { save(widget, it) }
                        }
                    }
                }
            }
        }
    }

    private fun save(widget: GlanceAppWidget, chosen: WidgetOptions) {
        lifecycleScope.launch {
            val manager = GlanceAppWidgetManager(this@PrayerWidgetConfig)
            runCatching {
                val glanceId = manager.getGlanceIdBy(widgetId)
                updateAppWidgetState(this@PrayerWidgetConfig, PreferencesGlanceStateDefinition, glanceId) { prefs ->
                    prefs.toMutablePreferences().apply {
                        this[WidgetKeys.mode] = if (chosen.mode == TitleMode.TimeLeft) "left" else "next"
                        this[WidgetKeys.iqama] = chosen.iqama
                        this[WidgetKeys.night] = chosen.night
                        this[WidgetKeys.theme] = chosen.theme
                        this[WidgetKeys.accent] = chosen.accent
                        this[WidgetKeys.opacity] = chosen.opacity
                        this[WidgetKeys.text] = chosen.text
                    }
                }
                widget.update(this@PrayerWidgetConfig, glanceId)
            }
            PrayerWidgets.ensure(applicationContext)
            setResult(RESULT_OK, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId))
            finish()
        }
    }
}

@Composable
private fun Settings(o: WidgetOptions, today: Boolean, change: (WidgetOptions) -> Unit, done: (WidgetOptions) -> Unit) {
    Column(
        Modifier.fillMaxSize().safeDrawingPadding().verticalScroll(rememberScrollState()).padding(horizontal = 24.dp, vertical = 20.dp),
        verticalArrangement = Arrangement.spacedBy(22.dp),
    ) {
        InkTitle("Times widget", "moon")
        Choice("Counts", listOf("next" to "Next prayer", "left" to "Time left"), if (o.mode == TitleMode.TimeLeft) "left" else "next") {
            change(o.copy(mode = if (it == "left") TitleMode.TimeLeft else TitleMode.NextPrayer))
        }
        if (today) {
            Toggle("Iqama", o.iqama) { change(o.copy(iqama = it)) }
            Toggle("Night & sunrise", o.night) { change(o.copy(night = it)) }
        }
        Choice("Look", listOf("system" to "System", "tonal" to "Tonal", "nothing" to "Nothing", "light" to "Light", "dark" to "Dark", "clear" to "Clear"), o.theme) { change(o.copy(theme = it)) }
        if (o.theme != "nothing" && o.theme != "tonal") Choice("Accent", listOf("system" to "System", "prayer" to "Teal"), o.accent) { change(o.copy(accent = it)) }
        if (o.theme != "clear") Column {
            Text("Background", style = MaterialTheme.typography.titleSmall)
            Slider(o.opacity, { change(o.copy(opacity = it)) }, valueRange = .2f..1f)
        }
        Choice("Text", listOf("s" to "Small", "m" to "Medium", "l" to "Large"), o.text) { change(o.copy(text = it)) }
        Seal("Done", onClick = { done(o) }, modifier = Modifier.fillMaxWidth())
    }
}

@Composable
private fun Choice(label: String, choices: List<Pair<String, String>>, chosen: String, pick: (String) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(label, style = MaterialTheme.typography.titleSmall)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            choices.forEach { (value, name) -> FilterChip(selected = value == chosen, onClick = { pick(value) }, label = { Text(name) }) }
        }
    }
}

@Composable
private fun Toggle(label: String, on: Boolean, set: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(label, style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
        Switch(on, set)
    }
}
