package app.kimono.watch.tv

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import app.kimono.watch.MainActivity
import app.kimono.watch.ink.InkProgress
import app.kimono.watch.theme.Night
import app.kimono.watch.theme.ui
import app.kimono.watch.ui.Ic
import app.kimono.watch.watch
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * Kimono Watch on a TV updating itself: there's no store on a TV it came
 * through, so it asks its Kimono whether this release carries a newer build,
 * and installs that over itself, checked against the release's hash. Only a
 * package signed like this one installs. Phones keep getting Watch from the
 * Kimono app.
 */
internal object TvUpdate {
    class Found(val version: String, val build: Long, val url: String, val sha256: String)

    fun build(context: Context): Long {
        val info = context.packageManager.getPackageInfo(context.packageName, 0)
        @Suppress("DEPRECATION")
        return if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong()
    }

    suspend fun check(context: Context, server: String): Found? = withContext(Dispatchers.IO) {
        runCatching {
            val connection = URL("${server.trimEnd('/')}/api/v1/app/update?platform=android&app=watch&build=${build(context)}").openConnection() as HttpURLConnection
            connection.connectTimeout = 10_000
            connection.readTimeout = 15_000
            if (connection.responseCode != 200) return@runCatching null
            val about = JSONObject(connection.inputStream.bufferedReader().use { it.readText() })
            if (!about.optBoolean("available")) return@runCatching null
            val sha = about.optString("sha256")
            val url = about.optString("url")
            if (!Regex("[0-9a-fA-F]{64}").matches(sha) || !url.startsWith("https://")) return@runCatching null
            Found(about.optString("version"), about.optLong("build"), url, sha)
        }.getOrNull()
    }

    /** A problem to show, or null once Android has the package. */
    suspend fun install(context: Context, found: Found, progress: (Float) -> Unit): String? = withContext(Dispatchers.IO) {
        if (Build.VERSION.SDK_INT >= 26 && !context.packageManager.canRequestPackageInstalls()) {
            runCatching { context.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
                .onFailure { runCatching { context.startActivity(Intent(Settings.ACTION_SECURITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } }
            return@withContext "Let Kimono Watch install apps, then choose Update again."
        }
        val file = File(context.cacheDir, "update.apk")
        val digest = MessageDigest.getInstance("SHA-256")
        try {
            val connection = URL(found.url).openConnection() as HttpURLConnection
            connection.connectTimeout = 15_000
            connection.readTimeout = 30_000
            if (connection.responseCode != 200) return@withContext "The update isn't there any more. Try again later."
            val total = connection.contentLengthLong
            var received = 0L
            connection.inputStream.use { input ->
                file.outputStream().use { output ->
                    val buffer = ByteArray(256 * 1024)
                    while (true) {
                        val read = input.read(buffer)
                        if (read < 0) break
                        output.write(buffer, 0, read)
                        digest.update(buffer, 0, read)
                        received += read
                        if (total > 0) progress((received.toFloat() / total).coerceAtMost(.99f))
                    }
                }
            }
        } catch (_: Exception) {
            file.delete()
            return@withContext "The download stopped. Check the connection and try again."
        }
        val hex = digest.digest().joinToString("") { "%02x".format(it) }
        if (!hex.equals(found.sha256, ignoreCase = true)) {
            file.delete()
            return@withContext "The update didn't arrive whole. Try again."
        }
        progress(1f)
        try {
            val installer = context.packageManager.packageInstaller
            val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
                setAppPackageName(context.packageName)
                /* Installed itself last time: Android can skip asking again. */
                if (Build.VERSION.SDK_INT >= 31) setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
            }
            val id = installer.createSession(params)
            installer.openSession(id).use { session ->
                session.openWrite("watch.apk", 0, file.length()).use { out ->
                    file.inputStream().use { it.copyTo(out) }
                    session.fsync(out)
                }
                val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
                session.commit(PendingIntent.getBroadcast(context, id, Intent(context, TvUpdateReceiver::class.java), flags).intentSender)
            }
            null
        } catch (_: Exception) {
            "Android wouldn't install the update. Try again."
        } finally {
            file.delete()
        }
    }
}

/** What the installer says: usually "ask the person", which shows Android's own prompt. */
class TvUpdateReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE) == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            @Suppress("DEPRECATION")
            val confirm = (if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java) else intent.getParcelableExtra(Intent.EXTRA_INTENT)) ?: return
            context.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
    }
}

/** The new version is in: open it again (TVs only; a phone's Watch doesn't update itself). */
class TvUpdatedReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_MY_PACKAGE_REPLACED || !context.watch.tv) return
        context.startActivity(Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
}

/** Once per launch, a TV asks its Kimono for a newer Watch; if there is one, a card offers it. */
@Composable
fun TvUpdatePrompt() {
    val context = LocalContext.current
    val app = context.watch
    var found by remember { mutableStateOf<TvUpdate.Found?>(null) }
    var later by remember { mutableStateOf(false) }
    var progress by remember { mutableStateOf<Float?>(null) }
    var problem by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) {
        /* Whichever Kimono someone here signed in to; nobody yet, nothing to ask. */
        val profiles = withTimeoutOrNull(20_000) { app.accounts.profiles.first { it != null } } ?: return@LaunchedEffect
        val server = app.accounts.active.value?.server ?: profiles.firstOrNull()?.server ?: return@LaunchedEffect
        delay(1500)
        found = TvUpdate.check(context, server)
    }
    val f = found ?: return
    if (later) return
    Dialog(onDismissRequest = { if ((progress ?: 1f) >= 1f) later = true }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        val focus = remember { FocusRequester() }
        Column(Modifier.width(460.dp).clip(RoundedCornerShape(16.dp)).background(Night.surface).padding(28.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text("A new Kimono Watch is ready", style = ui(22, FontWeight.Bold))
            Text(if (f.version.isNotBlank()) "Version ${f.version}." else "A newer version.", style = ui(15, color = Night.fg2))
            val p = progress
            if (p != null) {
                InkProgress({ p }, Modifier.fillMaxWidth().padding(vertical = 6.dp))
                Text(if (p >= 1f) "Installing…" else "Downloading… ${(p * 100).toInt()}%", style = ui(14, color = Night.fg3))
            } else {
                problem?.let { Text(it, style = ui(14, color = Night.blush)) }
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    TvButton("Update", Ic.next, {
                        problem = null; progress = 0f
                        scope.launch {
                            val trouble = TvUpdate.install(context, f) { progress = it }
                            problem = trouble
                            if (trouble != null) progress = null
                        }
                    }, Modifier.focusRequester(focus))
                    TvButton("Later", null, { later = true }, tonal = true)
                }
                LaunchedEffect(Unit) { delay(100); runCatching { focus.requestFocus() } }
            }
        }
    }
}
