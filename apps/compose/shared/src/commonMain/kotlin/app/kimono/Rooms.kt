@file:OptIn(ExperimentalMaterial3ExpressiveApi::class)

package app.kimono

import app.kimono.ui.bottomChrome
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationRail
import androidx.compose.material3.NavigationRailItem
import androidx.compose.material3.NavigationRailItemDefaults
import androidx.compose.material3.ShortNavigationBarItem
import androidx.compose.material3.ShortNavigationBarItemDefaults
import androidx.compose.material3.Text
import app.kimono.ui.clickable
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.text.style.TextOverflow
import coil3.compose.AsyncImage
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import app.kimono.ui.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.getValue
import androidx.compose.foundation.hoverable
import androidx.compose.foundation.interaction.collectIsHoveredAsState
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import app.kimono.data.AccountProfile
import app.kimono.data.LauncherApp
import app.kimono.ui.AppAccentTheme
import app.kimono.ui.InkBloom
import app.kimono.ui.KimonoBranch
import app.kimono.ui.Portrait
import app.kimono.ui.kimonoIcon

/*
 * 間 The bottom bar is the room you're in. Its middle is the app you're in,
 * its bloom (Kimono's branch on Kimono's own pages); either side are that
 * app's rooms; on Kimono's own pages, Home and You. Pressing the bloom
 * brings up every app, to go to another. Inside an app the bar wears its colour.
 */

/** A screen to open from outside the app (an update notification, say), taken up once signed in. */
object Opening { val route = kotlinx.coroutines.flow.MutableStateFlow<String?>(null) }

/** The bar's Chats asks Kimono AI's chat screen to slide its drawer out; the ask waits for one to open. */
object AiDrawerAsk { val open = kotlinx.coroutines.flow.MutableStateFlow(false) }

/** One place in the bar: a room to go to, or something to do. */
class Room(val route: String, val label: String, val icon: String, val action: Boolean = false)

class RoomApp(val id: String, val name: String, val accent: String?, val glyph: String?, val before: List<Room>, val after: List<Room> = emptyList()) {
    val rooms get() = before + after
}

/* Kimono's own pages: Home (what's happening), the flower (every app), You. */
private val kimono = RoomApp("kimono", "Kimono", null, null, listOf(Room("home", "Home", "home")))
private val drive = RoomApp("kimono-drive", "Drive", "#5f5596", "file", listOf(Room("drive", "Spaces", "folder")), listOf(Room("trash", "Trash", "trash")))
/* Kimono AI's bar: Chats (it slides the drawer out) and For you left of the bloom, Connections right; the bloom leads to every other app. */
private val code = RoomApp(app.kimono.data.Code.APP_ID, "Kimono AI", "#2c7783", "code", listOf(Room("ai/chats", "Chats", "chat", action = true), Room("ai/memory", "For you", "spark")), listOf(Room("ai/connections", "Connections", "link")))
private val vpn = RoomApp("kimono-vpn", "VPN", "#2f6b7a", "mesh", listOf(Room("vpn", "Devices", "phone"), Room("vpn/people", "People", "person")), listOf(Room("vpn/connect", "Connect", "link")))

/* Notes, as its mockup has it: Home (all notes), the bloom, Search. */
private val notes = RoomApp(app.kimono.data.Notes.APP_ID, "Notes", "#b56d78", "notes", listOf(Room("notes", "Home", "home")), listOf(Room("notes/search", "Search", "search", action = true)))

/* Books, phone-first: Home and your shelf left of the bloom, Search right. */
private val books = RoomApp(app.kimono.data.Books.APP_ID, "Books", "#5b6b3f", "book", listOf(Room("books", "Home", "home"), Room("books/shelf", "Shelf", "book")), listOf(Room("books/search", "Search", "search")))

/* Music: Home and You left of the bloom, Search right; gilt, as Music sets it itself. */
private val music = RoomApp(app.kimono.data.Music.APP_ID, "Music", app.kimono.data.Music.GOLD, "music", listOf(Room("music", "Home", "home"), Room("music/you", "You", "person")), listOf(Room("music/search", "Search", "search")))

/* Prayer: Today left of the bloom, the coming Days right. */
private val prayer = RoomApp(app.kimono.prayer.Prayers.APP_ID, "Times", app.kimono.prayer.Prayers.ACCENT, "crescent", listOf(Room("prayer", "Today", "moon")), listOf(Room("prayer/days", "Days", "lk-calendar")))

/** Which app's bar a screen shows, or null for a screen opened from a room (it has its own back). */
fun appOfRoom(route: String?): RoomApp? = when (route) {
    "home", "you" -> kimono
    "drive", "trash" -> drive
    "code", "ai/new", "ai/new/{in}", "code/{id}", "ai/connections", "ai/memory" -> code
    "vpn", "vpn/people", "vpn/connect" -> vpn
    "notes", "notes/{notebook}" -> notes
    "books", "books/shelf", "books/search" -> books
    "music", "music/you", "music/search" -> music
    "prayer", "prayer/days" -> prayer
    else -> null
}

@Composable
fun RoomBar(app: RoomApp, route: String?, launcherApp: LauncherApp?, me: AccountProfile?, go: (String) -> Unit, startTask: () -> Unit, openApps: () -> Unit) {
    val accent = if (app === music) app.accent else launcherApp?.accent ?: app.accent
    AppAccentTheme(accent) {
        val colors = ShortNavigationBarItemDefaults.colors(
            selectedIndicatorColor = MaterialTheme.colorScheme.secondaryContainer, selectedIconColor = MaterialTheme.colorScheme.primary,
            selectedTextColor = MaterialTheme.colorScheme.onSurface, unselectedIconColor = MaterialTheme.colorScheme.onSurfaceVariant, unselectedTextColor = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        @Composable fun RowScope.place(room: Room) = ShortNavigationBarItem(
            selected = route == room.route, onClick = { if (room.action) startTask() else go(room.route) },
            icon = { Icon(kimonoIcon(room.icon), null) }, label = { Text(room.label, maxLines = 1, softWrap = false, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis) }, colors = colors,
            /* Every room, the bloom and You get the same share of the bar, whatever their names or how many sit each side. */
            modifier = Modifier.weight(1f),
        )
        /* The bloom sits between the app's rooms (before it, after it) as one more slot of the same width. */
        /* It stands on the screen's hem (see bottomChrome), not a whole inset above it. */
        Surface(color = MaterialTheme.colorScheme.surface) {
            Row(Modifier.fillMaxWidth().bottomChrome().heightIn(min = 64.dp).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                app.before.forEach { place(it) }
                Column(
                    Modifier.weight(1f).clip(RoundedCornerShape(24.dp)).clickable(onClickLabel = "Every app", onClick = openApps).padding(vertical = 4.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    if (accent == null) KimonoBranch(36.dp) else InkBloom(launcherApp?.id ?: app.id, accent, launcherApp?.glyph ?: app.glyph, 42.dp)
                    Text(if (app.id == "kimono-code") app.name else launcherApp?.name ?: app.name, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis, modifier = Modifier.padding(top = 2.dp))
                }
                app.after.forEach { place(it) }
                /* You is Kimono's: inside an app the bar is that app's alone. */
                if (app === kimono) ShortNavigationBarItem(selected = route == "you", onClick = { go("you") }, icon = { Portrait(me?.picture, me?.name, me?.username, 24.dp) }, label = { Text("You") }, colors = colors, modifier = Modifier.weight(1f))
            }
        }
    }
}

/**
 * The rail down the left edge of a wide window (an iPad, either way up), the same whichever
 * app you're in: the bloom at the top brings up every app, then Home and Kimono's suite
 * ([apps]), and You at the foot. The app you're in is lit, its own rooms (Kimono AI's
 * Chats, Drive's Trash, Music's Search) gathered under it. A bar across the bottom of a
 * tablet puts every room a long reach from where the thumbs rest; a rail keeps them beside
 * the content and gives the screen its height back.
 */
@Composable
fun RoomRail(
    app: RoomApp, route: String?, launcherApp: LauncherApp?, me: AccountProfile?, go: (String) -> Unit, startTask: () -> Unit, openApps: () -> Unit,
    apps: List<LauncherApp> = emptyList(), openApp: (LauncherApp) -> Unit = {},
) {
    val accent = if (app === music) app.accent else launcherApp?.accent ?: app.accent
    AppAccentTheme(accent) {
        val colors = NavigationRailItemDefaults.colors(
            indicatorColor = MaterialTheme.colorScheme.secondaryContainer, selectedIconColor = MaterialTheme.colorScheme.primary,
            selectedTextColor = MaterialTheme.colorScheme.onSurface, unselectedIconColor = MaterialTheme.colorScheme.onSurfaceVariant, unselectedTextColor = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        /* Inside an app the rail is its icons alone, so the app has the room; a name shows on a hover, a press, or for the app you're in. */
        val iconsOnly = app !== kimono
        @Composable fun item(
            selected: Boolean, onClick: () -> Unit, name: String, modifier: Modifier = Modifier, keepName: Boolean = false, icon: @Composable () -> Unit,
        ) {
            val touch = remember { androidx.compose.foundation.interaction.MutableInteractionSource() }
            val hovered by touch.collectIsHoveredAsState()
            val pressed by touch.collectIsPressedAsState()
            val named = !iconsOnly || selected || keepName
            NavigationRailItem(
                selected = selected, onClick = onClick, colors = colors, interactionSource = touch, alwaysShowLabel = named,
                icon = { Box(contentAlignment = Alignment.Center) { icon(); if (!named && (hovered || pressed)) RailTip(name) } },
                label = { Text(name, maxLines = 1, softWrap = false, overflow = TextOverflow.Ellipsis) },
                modifier = modifier.widthIn(max = 96.dp).hoverable(touch),
            )
        }
        NavigationRail(
            containerColor = MaterialTheme.colorScheme.surface,
            modifier = Modifier.widthIn(min = 96.dp),
            header = {
                Column(
                    Modifier.padding(top = 10.dp, bottom = 14.dp).width(92.dp).clip(RoundedCornerShape(26.dp)).clickable(onClickLabel = "Every app", onClick = openApps).padding(vertical = 6.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    if (accent == null) KimonoBranch(40.dp) else InkBloom(launcherApp?.id ?: app.id, accent, launcherApp?.glyph ?: app.glyph, 48.dp)
                    Text(if (app.id == "kimono-code") app.name else launcherApp?.name ?: app.name, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary, maxLines = 1, modifier = Modifier.padding(top = 2.dp))
                }
            },
        ) {
            /* The app you're in stays on the rail even when it isn't one of the suite (VPN, say). */
            val listed = if (app !== kimono && launcherApp != null && apps.none { it.id == app.id }) apps + launcherApp else apps
            /* Tapping the app you're in again folds its rooms away (and back); another app opens with them showing. */
            var folded by remember(app.id) { mutableStateOf(false) }
            Column(Modifier.weight(1f).verticalScroll(rememberScrollState()), horizontalAlignment = Alignment.CenterHorizontally) {
                item(route == "home", { go("home") }, "Home") { Icon(kimonoIcon("home"), null, Modifier.size(26.dp)) }
                listed.forEach { a ->
                    val inside = app !== kimono && a.id == app.id
                    /* Lit for the app you're in; its rooms below say where in it. The app you're in keeps its name. */
                    item(
                        inside && (folded || app.rooms.none { it.route == route && !it.action }),
                        { if (inside && app.rooms.isNotEmpty()) folded = !folded else openApp(a) },
                        if (a.id == "kimono-code") "Kimono AI" else a.name,
                        keepName = inside,
                    ) {
                        Box(Modifier.size(32.dp), contentAlignment = Alignment.Center) {
                            InkBloom(a.id, a.accent, a.glyph, 32.dp)
                            /* An app without one of Kimono's glyphs wears its own icon in the heart, as on its tile. */
                            if (a.glyph == null && a.icon != null) AsyncImage(model = a.icon, contentDescription = null, modifier = Modifier.size(32.dp * .3f))
                        }
                    }
                    if (inside && app.rooms.isNotEmpty() && !folded) Column(
                        Modifier.padding(vertical = 2.dp).clip(RoundedCornerShape(20.dp)).background(MaterialTheme.colorScheme.surfaceContainer).padding(vertical = 4.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        app.rooms.forEach { room ->
                            NavigationRailItem(
                                selected = route == room.route, onClick = { if (room.action) startTask() else go(room.route) },
                                icon = { Icon(kimonoIcon(room.icon), null) }, label = { Text(room.label, maxLines = 1, softWrap = false, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis) }, colors = colors,
                            )
                        }
                    }
                }
            }
            /* You, at the foot whichever app you're in: your profile and settings a tap away. */
            item(route == "you", { go("you") }, "You", Modifier.padding(bottom = 14.dp)) { Portrait(me?.picture, me?.name, me?.username, 28.dp) }
        }
    }
}

/** An app's name in a small tag beside its icon on the rail, while a pointer rests on it or a finger holds it. */
@Composable
private fun RailTip(name: String) {
    val density = androidx.compose.ui.platform.LocalDensity.current
    androidx.compose.ui.window.Popup(
        alignment = Alignment.CenterStart,
        offset = androidx.compose.ui.unit.IntOffset(with(density) { 44.dp.roundToPx() }, 0),
    ) {
        androidx.compose.material3.Surface(shape = RoundedCornerShape(10.dp), color = MaterialTheme.colorScheme.inverseSurface, shadowElevation = 4.dp) {
            Text(name, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.inverseOnSurface, maxLines = 1, modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp))
        }
    }
}
