@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)

package app.kimono.screens

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.zIndex
import app.kimono.BookAsk
import app.kimono.data.FriendPerson
import app.kimono.data.Friends
import app.kimono.data.KimonoProblem
import app.kimono.data.KimonoProfile
import app.kimono.data.Privacy
import app.kimono.data.PrivacyNow
import app.kimono.data.ProfileLink
import app.kimono.data.Recommendation
import app.kimono.data.ShareItem
import app.kimono.data.Widget
import app.kimono.routeOfLink
import app.kimono.theme.Kata
import app.kimono.theme.plumInk
import app.kimono.ui.AppAccentTheme
import app.kimono.ui.InkBlot
import app.kimono.ui.InkConfirm
import app.kimono.ui.InkDialog
import app.kimono.ui.InkLoader
import app.kimono.ui.InkSheet
import app.kimono.ui.InkTitle
import app.kimono.ui.KimonoRefresh
import app.kimono.ui.KimonoTopBar
import app.kimono.ui.MenuChoice
import app.kimono.ui.Portrait
import app.kimono.ui.Problem
import app.kimono.ui.Seal
import app.kimono.ui.SealTone
import app.kimono.ui.clickable
import app.kimono.ui.kimonoIcon
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/*
 * 友 A profile, as the website draws it (friends-ui.tsx ProfileView): a band
 * in the person's colour with their portrait on its edge, their name,
 * pronouns and socials, what you can do, and then the board of widgets that
 * is the whole profile. Your own is where you change it: Edit profile, Who
 * sees what, Arrange.
 */

/** The colours a profile can wear (lib/friends/model.ts profileColors), each a pigment of the house. */
val profileColors = listOf("suo" to "Suō", "plum" to "Plum", "moss" to "Moss", "ai" to "Indigo", "kuchiba" to "Kuchiba", "sakura" to "Sakura", "sumi" to "Sumi")
fun profileColor(id: String?): Color = noteTints[id] ?: Kata.suo
private fun Color.hex(): String { val v = (value shr 32).toLong() and 0xFFFFFF; return "#" + v.toString(16).padStart(6, '0') }

/** What each row of a profile says, in plain words, for Who sees what. */
private val rowWords = mapOf(
    "watch:watching" to "What you're watching, and how far",
    "watch:watched" to "What you've watched",
    "watch:rated" to "How you rated what you watched",
    "books:reviews" to "Your reviews",
    "music:stats" to "Your top artists and how much you listen",
    "watch:listed" to "Your watchlist",
    "books:reading" to "Books you're reading, and how far",
    "books:want" to "Books you want to read",
    "books:read" to "Books you've read, and how you rated them",
    "music:playing" to "Songs you've been listening to, and what's on now",
    "music:loved" to "Songs you love",
    "music:playlists" to "Your public playlists",
)
internal fun appTint(app: String) = when (app) { "books" -> Color(0xFF5C7150); "music" -> Color(0xFF2E5E8A); else -> Color(0xFFA84D63) }
internal fun appIcon(app: String) = when (app) { "books" -> "book"; "music" -> "music"; else -> "film" }

/**
 * What makes a profile the You screen: your portrait with its camera, renaming,
 * and a gear to Settings.
 */
class OwnProfile(
    val portrait: @Composable () -> Unit,
    val rename: suspend (String) -> Unit,
    val settings: () -> Unit,
    /** A photo for the banner, cut 3:1 (Platform.pickBanner); null when the person backs out. */
    val pickBanner: suspend () -> ByteArray? = { null },
)

@Composable
fun ProfileScreen(friends: Friends, username: String, still: Boolean = false, open: (String) -> Unit, own: OwnProfile? = null, back: (() -> Unit)? = null) {
    val scope = rememberCoroutineScope()
    val uri = LocalUriHandler.current
    var profile by remember(username) { mutableStateOf(friends.knownProfile(username)) }
    var problem by remember { mutableStateOf<String?>(null) }
    var asked by remember { mutableStateOf(friends.known()?.asked?.size ?: 0) }
    var removing by remember { mutableStateOf(false) }
    var unrecommending by remember { mutableStateOf<Recommendation?>(null) }
    var recommending by remember { mutableStateOf<ShareItem?>(null) }
    var refreshing by remember { mutableStateOf(false) }
    var privacyOpen by remember { mutableStateOf(false) }
    var offOpen by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf(false) }
    var editingLinks by remember { mutableStateOf(false) }
    var asFriend by remember { mutableStateOf(false) }
    var arranging by remember { mutableStateOf(false) }
    var toast by remember { mutableStateOf<String?>(null) }
    suspend fun load() { try { profile = friends.profile(username); problem = null } catch (p: KimonoProblem) { problem = p.message } }
    LaunchedEffect(username) { load() }
    /* Live: what they're playing and watching changes under you, so the profile reads itself again while it's in front. */
    WhileShown(username) { while (true) { delay(12_000); runCatching { profile = friends.profile(username) } } }
    var bannerMenu by remember { mutableStateOf(false) }
    fun newBanner() = scope.launch {
        try {
            val jpeg = own?.pickBanner?.invoke() ?: return@launch
            val banner = friends.saveBanner(jpeg)
            profile = profile?.copy(banner = banner); toast = "Banner up"
        } catch (e: KimonoProblem) { problem = e.message } catch (_: Exception) { problem = "Your banner could not be saved." }
    }
    val mine = profile?.you == true
    LaunchedEffect(mine) { if (mine) runCatching { asked = friends.list().asked.size } }
    LaunchedEffect(toast) { if (toast != null) { delay(2600); toast = null } }
    fun change(type: String) = scope.launch { try { friends.change(type, username); load() } catch (p: KimonoProblem) { problem = p.message } }
    val toSettings: () -> Unit = { own?.settings?.invoke() ?: open("settings") }
    val server = friends.server?.trimEnd('/')
    val act = BoardActions(
        openBook = { key -> BookAsk.key.value = key; open("books") },
        openWeb = { path -> val url = (server ?: "") + path; routeOfLink(url)?.let(open) ?: runCatching { uri.openUri(url) } },
        openUrl = { url -> runCatching { uri.openUri(url) } },
        openPerson = { open("people/$it") },
        openFriends = { open("friends") },
        editLinks = if (mine && !asFriend) ({ editingLinks = true }) else null,
    )
    val p: KimonoProfile? = profile
    val color = profileColor(p?.color)
    AppAccentTheme(color.hex()) {
        CompositionLocalProvider(LocalBoardColor provides color, LocalStill provides still) {
            /* Your own profile has no bar: its few controls sit on the band. Someone else's keeps its way back. */
            Scaffold(containerColor = MaterialTheme.colorScheme.surface, topBar = {
                if (p?.you != true || back != null) KimonoTopBar("", onBack = back)
            }) { padding ->
                KimonoRefresh(refreshing, onRefresh = { scope.launch { refreshing = true; load(); refreshing = false } }, modifier = Modifier.padding(padding).fillMaxSize()) {
                    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
                        if (p == null) {
                            Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) { if (problem == null) InkLoader() else Problem(problem) }
                            return@Column
                        }
                        val privacy = p.privacy
                        val visibility = privacy?.let(::visibilityOf) ?: "friends"
                        val preview = p.you && asFriend
                        /* Kept from friends: the whole app, or one row of it. */
                        val invisible = visibility == "private"
                        val closedToFriends = preview && invisible
                        val friendsKept = p.you && (invisible || privacy?.friends == false)
                        val sections = if (preview) p.sections.filter { s -> s.app !in p.hidden && "${s.app}:${s.kind}" !in p.kept } else p.sections
                        val friendList = if (preview && friendsKept) emptyList() else p.friendList.orEmpty()
                        val mineNow = p.you && !preview && p.open
                        Hero(
                            p, color, own.takeIf { p.you && !preview }, preview, closedToFriends,
                            banner = p.banner?.let { (server ?: "") + it },
                            controls = if (p.you) ({
                                if (!preview && p.open) BandButton("camera", if (p.banner != null) "Change banner" else "Add a banner") { if (p.banner != null) bannerMenu = true else newBanner() }
                                if (!preview) BandButton("eye", "Who sees what") { privacyOpen = true }
                                BandButton("person", if (asFriend) "Stop viewing as a friend" else "View as a friend", on = asFriend) { asFriend = !asFriend; if (asFriend) arranging = false }
                                BandButton("cog", "Settings", onClick = toSettings)
                            }) else null,
                            yours = if (mineNow) Yours(
                                banner = { if (p.banner != null) bannerMenu = true else newBanner() },
                                look = { editing = true },
                                links = { editingLinks = true },
                                bio = { text -> try { val saved = friends.saveBio(text); profile = profile?.copy(bio = saved); toast = "Saved" } catch (e: KimonoProblem) { problem = e.message } },
                            ) else null,
                        ) {
                            if (!p.you) when (p.link) {
                                "friends" -> Seal("Friends", compact = true, tone = SealTone.Quiet, icon = "check", onClick = { removing = true })
                                "asked" -> { Seal("Not now", compact = true, tone = SealTone.Quiet, onClick = { change("no") }); Seal("Accept", compact = true, onClick = { change("yes") }) }
                                "asking" -> Seal("Asked", compact = true, tone = SealTone.Quiet, onClick = { change("remove") })
                                else -> Seal("Ask to be friends", compact = true, onClick = { change("ask") })
                            }
                        }
                        Box(Modifier.padding(horizontal = 16.dp)) { Problem(problem) }
                        if (p.open && !closedToFriends) {
                            val data = remember(p, preview, sections, friendList, asked, color) {
                                BoardData(
                                    FriendPerson(p.username, p.name, p.picture), sections, p.links, friendList, p.music, p.books, color,
                                    own = if (p.you && !preview) OwnBoard(asked, friendsKept) else null, server = server,
                                )
                            }
                            Spacer(Modifier.height(8.dp))
                            WidgetBoard(data, p.widgets, editable = p.you && !preview, arranging = arranging && p.you && !preview, onArranging = { arranging = it }, friends = friends, act = act) { widgets ->
                                try { friends.saveWidgets(widgets); profile = profile?.copy(widgets = widgets); toast = "Saved" } catch (e: KimonoProblem) { problem = e.message }
                            }
                            if (p.recommendations.isNotEmpty()) {
                                Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 20.dp, top = 28.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                    InkBlot("recommends", size = 40.dp) { Icon(kimonoIcon("send"), null, tint = Kata.plum, modifier = Modifier.size(20.dp)) }
                                    Text("Recommends", style = MaterialTheme.typography.headlineSmall, color = plumInk)
                                }
                                Shelf(p.recommendations, { it.id }, { it.item }, { r ->
                                    if (p.you && !preview) listOf(MenuChoice("Take off your profile", danger = true) { unrecommending = r })
                                    else listOf(MenuChoice("Recommend to others") { recommending = r.item })
                                }) { r -> r.note?.let { Text("“$it”", style = MaterialTheme.typography.bodySmall, maxLines = 4, overflow = TextOverflow.Ellipsis) } }
                            }
                        }
                        Spacer(Modifier.height(40.dp))
                    }
                }
            }
            toast?.let { t ->
                Box(Modifier.fillMaxSize().padding(bottom = 40.dp), contentAlignment = Alignment.BottomCenter) {
                    Text(t, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.inverseOnSurface, modifier = Modifier.clip(RoundedCornerShape(16.dp)).background(MaterialTheme.colorScheme.inverseSurface).padding(horizontal = 18.dp, vertical = 12.dp))
                }
            }
            val privacy = p?.privacy
            if (privacyOpen && p != null && privacy != null) WhoSeesWhat(friends, privacy, p.username, p.off.size, onDismiss = { privacyOpen = false }, onOff = { privacyOpen = false; offOpen = true }) { now ->
                profile = profile?.copy(privacy = now.privacy, hidden = now.hidden, kept = now.privacy.kept)
            }
            if (bannerMenu) app.kimono.ui.InkDialog(title = "Banner", onDismiss = { bannerMenu = false }, icon = "camera", actions = {
                Seal("Remove", compact = true, tone = SealTone.Quiet, onClick = { bannerMenu = false; scope.launch { try { friends.dropBanner(); profile = profile?.copy(banner = null); toast = "Banner off" } catch (e: KimonoProblem) { problem = e.message } } })
                Seal("New photo", compact = true, icon = "camera", onClick = { bannerMenu = false; newBanner() })
            }) {
                p?.banner?.let { b -> coil3.compose.AsyncImage((server ?: "") + b, null, contentScale = androidx.compose.ui.layout.ContentScale.Crop, modifier = Modifier.fillMaxWidth().height(110.dp).clip(RoundedCornerShape(16.dp))) }
            }
            if (editing && p != null) EditProfileSheet(friends, p, own, onDismiss = { editing = false }, onLinks = { editing = false; editingLinks = true }) { next -> profile = next; toast = "Saved" }
            if (editingLinks && p != null) LinksEditor(p.links, onDismiss = { editingLinks = false }) { links ->
                try { val saved = friends.saveLinks(links); profile = profile?.copy(links = saved); true } catch (e: KimonoProblem) { problem = e.message; false }
            }
            if (removing && p != null) InkConfirm(
                title = "Remove ${p.name.ifBlank { p.username }.substringBefore(' ')}?", text = "You'll stop seeing each other's profiles and what you watch, read and listen to.",
                action = "Remove", danger = true, icon = "people", onDismiss = { removing = false }, onConfirm = { removing = false; change("remove") },
            )
            unrecommending?.let { r ->
                InkConfirm(
                    title = "Take ${r.title} off your profile?", text = if (r.note != null) "Your note goes with it." else "Friends stop seeing you recommend it.",
                    action = "Take off", danger = true, icon = "trash", onDismiss = { unrecommending = null },
                    onConfirm = { unrecommending = null; scope.launch { runCatching { friends.drop(r.id) }; load() } },
                )
            }
            recommending?.let { item -> RecommendDialog(friends, item, onDismiss = { recommending = null }, onSent = { toast = it }) }
            if (offOpen && p != null) OffDialog(friends, p.off, onDismiss = { offOpen = false }) { left ->
                profile = profile?.copy(off = left)
                if (left.isEmpty()) offOpen = false
                scope.launch { load() }
            }
        }
    }
}

/** Who sees a profile, as the server says it, or as it was said before there was a choice of three. */
internal fun visibilityOf(p: Privacy) = p.visibility ?: if (p.invisible) "private" else "friends"

/* ── The hero ─────────────────────────────────────────────────────────── */

/** What you can change on your own profile, where it stands. */
private class Yours(val banner: () -> Unit, val look: () -> Unit, val links: () -> Unit, val bio: suspend (String) -> Unit)

@Composable
private fun Hero(p: KimonoProfile, color: Color, own: OwnProfile?, preview: Boolean, closed: Boolean, banner: String?, yours: Yours?, controls: (@Composable () -> Unit)? = null, actions: @Composable () -> Unit) {
    val still = app.kimono.screens.LocalStill.current
    val pop = remember { Animatable(if (still) 1f else 0f) }
    LaunchedEffect(Unit) { if (!still) pop.animateTo(1f, spring(.5f, 260f)) }
    val rise = remember { Animatable(if (still) 1f else 0f) }
    LaunchedEffect(Unit) { if (!still) { delay(200); rise.animateTo(1f, spring(.7f, 200f)) } }
    val socials = if (p.open && !closed) p.links.filter(::underName) else emptyList()
    val uri = LocalUriHandler.current
    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
        Box {
            Band(color, still, banner)
            controls?.let { c ->
                Row(Modifier.align(Alignment.TopEnd).padding(end = 22.dp, top = 14.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) { c() }
            }
            /* Seeing it as a friend: said on the band, so it's never mistaken for how you see it. */
            if (preview) Text(
                "As a friend sees it", style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Bold), color = Color.White,
                modifier = Modifier.align(Alignment.TopStart).padding(start = 24.dp, top = 20.dp).clip(RoundedCornerShape(12.dp)).background(Color.Black.copy(alpha = .38f)).padding(horizontal = 10.dp, vertical = 6.dp),
            )
        }
        Box(Modifier.pullUp(66.dp).graphicsLayer { scaleX = .7f + .3f * pop.value; scaleY = .7f + .3f * pop.value; alpha = pop.value }) {
            val ring = MaterialTheme.colorScheme.surface
            /* A ring of paper round the portrait, cut into the band; the camera on your own may hang over it. */
            Box(Modifier.drawBehind { drawCircle(ring, radius = size.minDimension / 2) }.padding(6.dp)) {
                if (own != null) own.portrait() else Portrait(p.picture, p.name, p.username, 128.dp)
            }
        }
        Column(
            Modifier.padding(horizontal = 24.dp).padding(top = 6.dp).graphicsLayer { alpha = rise.value; translationY = (1 - rise.value) * 14.dp.toPx() },
            horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(
                    (if (yours != null) Modifier.clip(RoundedCornerShape(8.dp)).clickable(onClick = yours.look).semantics { contentDescription = "Edit name, pronouns and colour" } else Modifier),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text(p.name.ifBlank { p.username }, style = MaterialTheme.typography.headlineMedium, color = plumInk, textAlign = TextAlign.Center)
                    /* The pen stays: your name is something to change. */
                    if (yours != null) Icon(kimonoIcon("brush"), null, tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = .6f), modifier = Modifier.size(18.dp))
                }
                if (p.open && !closed && p.pronouns.isNotBlank()) Text(p.pronouns, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(bottom = 6.dp).clip(RoundedCornerShape(8.dp)).background(color.copy(alpha = .12f)).padding(horizontal = 8.dp, vertical = 2.dp))
            }
            Text("@${p.username}" + if (p.open && !closed) " · ${if (p.friends == 1) "1 friend" else "${p.friends} friends"}" else "", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (socials.isNotEmpty() || yours != null) Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 2.dp)) {
                socials.forEachIndexed { i, l ->
                    val arrive = remember { Animatable(if (still) 1f else 0f) }
                    LaunchedEffect(Unit) { if (!still) { delay(250L + i * 60L); arrive.animateTo(1f, spring(.45f, 300f)) } }
                    Box(
                        Modifier.size(42.dp).graphicsLayer { scaleX = arrive.value; scaleY = arrive.value }.clip(CircleShape).background(Color(0xFFFBF6EF))
                            .border(1.dp, MaterialTheme.colorScheme.outlineVariant, CircleShape).clickable { runCatching { uri.openUri(l.url) } }.semantics { contentDescription = l.title },
                        contentAlignment = Alignment.Center,
                    ) { LinkMark(l.url, l.icon, 20.dp, color) }
                }
                /* A dashed (+) where the next link goes. */
                if (yours != null) {
                    val dash = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = .5f)
                    Box(
                        Modifier.size(42.dp).clip(CircleShape).drawBehind {
                            drawCircle(dash, size.minDimension / 2 - 1.dp.toPx(), style = Stroke(2.dp.toPx(), pathEffect = androidx.compose.ui.graphics.PathEffect.dashPathEffect(floatArrayOf(5.dp.toPx(), 4.dp.toPx()))))
                        }.clickable(onClick = yours.links).semantics { contentDescription = "Add a link" },
                        contentAlignment = Alignment.Center,
                    ) { Icon(kimonoIcon("plus"), null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(20.dp)) }
                }
            }
            if (yours != null) BioInPlace(p.bio, yours.bio)
            else if (p.open && !closed && p.bio.isNotBlank()) Text(p.bio, style = MaterialTheme.typography.bodyLarge, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 4.dp))
            p.kimonoRead?.takeIf { p.open && !closed }?.let { SilkscreenBadge(it.since, p.you, p.name.ifBlank { p.username }, still, null) }
            if (p.you && !preview && p.privacy?.let(::visibilityOf) == "private") Text("Only you see your profile", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
            if (closed) Text("Only you see your profile, so this is all friends see.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
            FlowRow(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally), verticalArrangement = Arrangement.spacedBy(8.dp)) { actions() }
        }
    }
}

/** One of your profile's few controls, a round mark on the band; [on] fills it. */
@Composable
private fun BandButton(icon: String, label: String, on: Boolean = false, onClick: () -> Unit) {
    Box(
        Modifier.size(40.dp).clip(CircleShape).background(if (on) Color.White else Color.Black.copy(alpha = .32f)).clickable(onClick = onClick).semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) { Icon(kimonoIcon(icon), null, tint = if (on) Color.Black.copy(alpha = .8f) else Color.White, modifier = Modifier.size(20.dp)) }
}

/** Your bio, changed where it sits: tap it, type, Done saves. */
@Composable
private fun BioInPlace(bio: String, save: suspend (String) -> Unit) {
    val scope = rememberCoroutineScope()
    var draft by remember { mutableStateOf<String?>(null) }
    val d = draft
    if (d == null) {
        Text(
            bio.ifBlank { "Add a few words about you" },
            style = MaterialTheme.typography.bodyLarge.copy(fontStyle = if (bio.isBlank()) androidx.compose.ui.text.font.FontStyle.Italic else null),
            color = if (bio.isBlank()) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface, textAlign = TextAlign.Center,
            modifier = Modifier.padding(top = 4.dp).clip(RoundedCornerShape(10.dp)).clickable { draft = bio }.padding(horizontal = 8.dp, vertical = 4.dp),
        )
        return
    }
    val focus = remember { androidx.compose.ui.focus.FocusRequester() }
    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
    val done = { val text = d.trim(); draft = null; if (text != bio) scope.launch { save(text) } }
    OutlinedTextField(
        d, { if (it.length <= 280) draft = it.replace("\n", " ") }, modifier = Modifier.fillMaxWidth().padding(top = 4.dp).focusRequester(focus),
        placeholder = { Text("A few words about you") }, textStyle = MaterialTheme.typography.bodyLarge.copy(textAlign = TextAlign.Center), shape = RoundedCornerShape(14.dp),
        keyboardOptions = KeyboardOptions(imeAction = androidx.compose.ui.text.input.ImeAction.Done), keyboardActions = androidx.compose.foundation.text.KeyboardActions(onDone = { done() }),
        trailingIcon = { Box(Modifier.size(40.dp).clip(CircleShape).clickable { done() }, contentAlignment = Alignment.Center) { Icon(kimonoIcon("check"), "Save", tint = MaterialTheme.colorScheme.primary) } },
    )
}

/** Draws something [by] higher than it sits, and takes that much less room: the portrait on the band's edge. */
private fun Modifier.pullUp(by: androidx.compose.ui.unit.Dp) = layout { m, c ->
    val placed = m.measure(c)
    val up = by.roundToPx()
    layout(placed.width, (placed.height - up).coerceAtLeast(0)) { placed.place(0, -up) }
}

/**
 * The band in their colour, with seigaiha (overlapping waves, the
 * house's pattern) drifting across it slowly.
 */
@Composable
private fun Band(color: Color, still: Boolean, banner: String? = null) {
    if (banner != null) {
        /* Their own photo across the top, a soft shade at its head under the bar's buttons. */
        Box(Modifier.fillMaxWidth().padding(horizontal = 12.dp).padding(top = 4.dp).height(136.dp).clip(RoundedCornerShape(28.dp)).background(color)) {
            coil3.compose.AsyncImage(banner, null, contentScale = androidx.compose.ui.layout.ContentScale.Crop, modifier = Modifier.fillMaxSize())
            Box(Modifier.fillMaxWidth().height(56.dp).background(androidx.compose.ui.graphics.Brush.verticalGradient(listOf(Color.Black.copy(alpha = .25f), Color.Transparent))))
        }
        return
    }
    val drift = if (still) null else rememberInfiniteTransition(label = "band").animateFloat(0f, 1f, infiniteRepeatable(tween(60_000, easing = LinearEasing)), label = "drift")
    Canvas(Modifier.fillMaxWidth().padding(horizontal = 12.dp).padding(top = 4.dp).height(136.dp).clip(RoundedCornerShape(28.dp)).background(color)) {
        val r = 22.dp.toPx()
        val shift = (drift?.value ?: 0f) * r * 2
        val wave = Color.White.copy(alpha = .1f)
        var row = 0
        var y = -r
        while (y < size.height + r) {
            var x = -r * 2 + shift + if (row % 2 == 0) 0f else r
            while (x < size.width + r * 2) {
                listOf(1f, .7f, .4f).forEach { k -> drawArc(wave, 180f, 180f, false, topLeft = Offset(x - r * k, y - r * k), size = Size(r * 2 * k, r * 2 * k), style = Stroke(1.5.dp.toPx())) }
                x += r * 2
            }
            y += r * .5f
            row++
        }
        /* A soft sheet of paper rising from its foot, where the portrait sits. */
        drawRect(Color.Black.copy(alpha = .06f), Offset(0f, size.height * .82f), Size(size.width, size.height * .18f))
    }
}

/* ── Who sees what ────────────────────────────────────────────────────── */

/** Friends or Only me, as two words side by side: what's chosen is filled. */
@Composable
private fun Who(friends: Boolean, enabled: Boolean = true, onChange: (Boolean) -> Unit) {
    Row(Modifier.alpha(if (enabled) 1f else .5f).clip(RoundedCornerShape(14.dp)).background(MaterialTheme.colorScheme.surfaceContainerHigh).padding(3.dp), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
        listOf(true to ("people" to "Friends"), false to ("lock" to "Only me")).forEach { (value, mark) ->
            val on = value == friends
            Row(
                Modifier.clip(RoundedCornerShape(11.dp)).background(if (on) (if (value) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.primary.copy(alpha = .2f)) else Color.Transparent)
                    .clickable(enabled = enabled) { if (!on) onChange(value) }.padding(horizontal = 10.dp, vertical = 7.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp),
            ) {
                Icon(kimonoIcon(mark.first), null, tint = if (on) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(15.dp))
                Text(mark.second, style = MaterialTheme.typography.labelMedium.copy(fontWeight = if (on) FontWeight.Bold else FontWeight.Medium), color = if (on) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

/**
 * Every privacy choice in one place: who sees your profile at all (friends,
 * anyone with the link, only you), your friends list, and each app and each
 * of its rows. Each choice saves as it's made.
 */
@Composable
private fun WhoSeesWhat(friends: Friends, privacy: Privacy, username: String?, offCount: Int, onDismiss: () -> Unit, onOff: () -> Unit, onChanged: (PrivacyNow) -> Unit) {
    val scope = rememberCoroutineScope()
    var now by remember { mutableStateOf(privacy) }
    var problem by remember { mutableStateOf<String?>(null) }
    fun save(optimistic: Privacy, call: suspend () -> PrivacyNow) {
        val was = now
        now = optimistic
        scope.launch { try { val r = call(); now = r.privacy; onChanged(r); problem = null } catch (e: KimonoProblem) { now = was; problem = e.message } }
    }
    val visibility = visibilityOf(now)
    val closed = visibility == "private"
    InkSheet(onDismissRequest = onDismiss, seed = "who sees what") {
        Row(Modifier.fillMaxWidth().padding(start = 24.dp, end = 16.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.weight(1f)) { InkTitle("Who sees what", "eye") }
            Seal("Done", compact = true, onClick = onDismiss)
        }
        Column(Modifier.heightIn(max = 640.dp).verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(bottom = 20.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("Your profile", style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(start = 4.dp, top = 4.dp))
            listOf(
                Triple("friends", "people", "Friends" to "Your friends see what you choose below"),
                Triple("public", "link", "Anyone with the link" to "Like friends do, even without an account"),
                Triple("private", "lock", "Only me" to "Friends see your name and picture"),
            ).forEach { (id, icon, words) ->
                val on = visibility == id
                Row(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(if (on) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surfaceContainerHighest)
                        .then(if (on) Modifier.border(2.dp, MaterialTheme.colorScheme.primary, RoundedCornerShape(20.dp)) else Modifier)
                        .clickable { if (!on) save(now.copy(visibility = id, invisible = id == "private")) { friends.setVisibility(id) } }.padding(14.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    Icon(kimonoIcon(icon), null, tint = if (on) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(22.dp))
                    Column(Modifier.weight(1f)) {
                        Text(words.first, style = MaterialTheme.typography.titleSmall)
                        Text(words.second, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    if (on) Icon(kimonoIcon("check"), null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(20.dp))
                }
            }
            val server = friends.server
            if (visibility == "public" && server != null && username != null) PublicLink("${server.trimEnd('/')}/p/$username")
            Column(Modifier.alpha(if (closed) .45f else 1f).padding(top = 10.dp)) {
                PrivacyLine("Your friends list", "Who you're friends with", now.friends, !closed) { f -> save(now.copy(friends = f)) { friends.showPart("friends", f) } }
                now.apps.forEach { a ->
                    Box(Modifier.fillMaxWidth().padding(vertical = 8.dp).height(1.dp).background(MaterialTheme.colorScheme.outlineVariant))
                    Row(Modifier.fillMaxWidth().heightIn(min = 52.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        InkBlot("app:${a.app}", tint = appTint(a.app), size = 34.dp) { Icon(kimonoIcon(appIcon(a.app)), null, tint = Kata.plum, modifier = Modifier.size(18.dp)) }
                        Text(a.name, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                        Who(a.shown, !closed) { f -> save(now.copy(apps = now.apps.map { if (it.app == a.app) it.copy(shown = f) else it })) { friends.showAppOf(a.app, f) } }
                    }
                    a.rows.forEach { r ->
                        Box(Modifier.padding(start = 12.dp).alpha(if (a.shown) 1f else .5f)) {
                            PrivacyLine(rowWords["${a.app}:${r.kind}"] ?: r.title, null, r.shown && a.shown, !closed && a.shown) { f ->
                                save(now.copy(apps = now.apps.map { if (it.app == a.app) it.copy(rows = it.rows.map { x -> if (x.kind == r.kind) x.copy(shown = f) else x }) else it })) { friends.showPart("${a.app}:${r.kind}", f) }
                            }
                        }
                    }
                }
            }
            if (offCount > 0) Row(
                Modifier.fillMaxWidth().padding(top = 12.dp).clip(RoundedCornerShape(18.dp)).background(MaterialTheme.colorScheme.surfaceContainerHighest).clickable(onClick = onOff).padding(14.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Icon(kimonoIcon("eye"), null, modifier = Modifier.size(20.dp))
                Column(Modifier.weight(1f)) {
                    Text("Things you took off your profile", style = MaterialTheme.typography.titleSmall)
                    Text("${if (offCount == 1) "1 thing" else "$offCount things"}: put them back", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Icon(kimonoIcon("go"), null, modifier = Modifier.size(18.dp))
            }
            Problem(problem)
        }
    }
}

/** Your public profile's address, to copy. */
@Composable
private fun PublicLink(href: String) {
    @Suppress("DEPRECATION") val clip = androidx.compose.ui.platform.LocalClipboardManager.current
    var copied by remember { mutableStateOf(false) }
    LaunchedEffect(copied) { if (copied) { delay(1600); copied = false } }
    Row(
        Modifier.fillMaxWidth().padding(top = 6.dp).clip(RoundedCornerShape(16.dp)).background(MaterialTheme.colorScheme.surfaceContainer).padding(start = 14.dp, end = 6.dp, top = 6.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(kimonoIcon("link"), null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(18.dp))
        Text(href.removePrefix("https://").removePrefix("http://"), style = MaterialTheme.typography.bodyMedium.copy(fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
        Seal(if (copied) "Copied" else "Copy", compact = true, tone = SealTone.Quiet, onClick = { clip.setText(androidx.compose.ui.text.AnnotatedString(href)); copied = true })
    }
}

@Composable
private fun PrivacyLine(label: String, note: String?, friendsSee: Boolean, enabled: Boolean, change: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min = 52.dp).padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Column(Modifier.weight(1f)) {
            Text(label, style = MaterialTheme.typography.bodyLarge)
            note?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
        Who(friendsSee, enabled, change)
    }
}

/* ── Editing your profile ─────────────────────────────────────────────── */

/** Your name, pronouns, words, colour and links, in one place, saved together. */
@Composable
private fun EditProfileSheet(friends: Friends, profile: KimonoProfile, own: OwnProfile?, onDismiss: () -> Unit, onLinks: () -> Unit, onSaved: (KimonoProfile) -> Unit) {
    val scope = rememberCoroutineScope()
    var name by remember { mutableStateOf(profile.name) }
    var pronouns by remember { mutableStateOf(profile.pronouns) }
    var bio by remember { mutableStateOf(profile.bio) }
    var color by remember { mutableStateOf(profile.color ?: "suo") }
    var busy by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }
    InkSheet(onDismissRequest = onDismiss, seed = "edit profile", tint = profileColor(color)) {
        Row(Modifier.fillMaxWidth().padding(start = 24.dp, end = 16.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Box(Modifier.weight(1f)) { InkTitle("Edit profile", "brush", profileColor(color)) }
        }
        Column(Modifier.heightIn(max = 620.dp).verticalScroll(rememberScrollState()).padding(horizontal = 24.dp).padding(bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                if (own != null) OutlinedTextField(name, { if (it.length <= 80) name = it }, label = { Text("Name") }, singleLine = true, colors = kataFieldColors(), modifier = Modifier.weight(1.4f))
                OutlinedTextField(pronouns, { if (it.length <= 30) pronouns = it }, label = { Text("Pronouns") }, placeholder = { Text("they/them") }, singleLine = true, colors = kataFieldColors(), modifier = Modifier.weight(1f))
            }
            OutlinedTextField(bio, { if (it.length <= 280) bio = it }, label = { Text("About you") }, minLines = 3, maxLines = 6, colors = kataFieldColors(), modifier = Modifier.fillMaxWidth())
            Text("Colour", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Swatches(color) { color = it }
            Row(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(MaterialTheme.colorScheme.surfaceContainerHighest).clickable(onClick = onLinks).padding(12.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Box(Modifier.size(40.dp).clip(RoundedCornerShape(12.dp)).background(MaterialTheme.colorScheme.surface), contentAlignment = Alignment.Center) { Icon(kimonoIcon("link"), null, tint = profileColor(color), modifier = Modifier.size(20.dp)) }
                Column(Modifier.weight(1f)) {
                    Text("Links", style = MaterialTheme.typography.titleSmall)
                    Text(if (profile.links.isNotEmpty()) "${profile.links.size} on your profile" else "Your Instagram, your site, your playlist", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Icon(kimonoIcon("go"), null, modifier = Modifier.size(18.dp))
            }
            Problem(problem)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) {
                Seal("Cancel", compact = true, tone = SealTone.Quiet, onClick = onDismiss)
                Seal("Save", compact = true, busy = busy, onClick = {
                    busy = true; problem = null
                    scope.launch {
                        try {
                            if (own != null && name.isNotBlank() && name.trim() != profile.name) own.rename(name.trim())
                            val (pr, c, b) = friends.saveLook(pronouns.trim(), color, bio.trim())
                            onSaved(profile.copy(name = if (own != null && name.isNotBlank()) name.trim() else profile.name, pronouns = pr, color = c, bio = b))
                            onDismiss()
                        } catch (e: KimonoProblem) { problem = e.message }
                        busy = false
                    }
                })
            }
        }
    }
}

/* ── Your links, edited as they'll look ───────────────────────────────── */

private val siteNames = listOf(
    "instagram\\." to "Instagram", "(^|\\.)x\\.com$|twitter\\." to "X", "bsky\\." to "Bluesky", "threads\\." to "Threads", "mastodon" to "Mastodon",
    "tiktok\\." to "TikTok", "youtube\\.|youtu\\.be" to "YouTube", "twitch\\." to "Twitch", "github\\." to "GitHub", "gitlab\\." to "GitLab",
    "linkedin\\." to "LinkedIn", "facebook\\." to "Facebook", "spotify\\." to "Spotify", "soundcloud\\." to "SoundCloud", "bandcamp\\." to "Bandcamp",
    "letterboxd\\." to "Letterboxd", "goodreads\\." to "Goodreads", "discord\\." to "Discord", "reddit\\." to "Reddit", "pinterest\\." to "Pinterest",
    "behance\\." to "Behance", "dribbble\\." to "Dribbble", "vimeo\\." to "Vimeo", "last\\.fm" to "Last.fm", "substack\\." to "Substack", "medium\\." to "Medium",
).map { (re, name) -> Regex(re) to name }

/** An address as typed, made whole: "github.com/me" → https://github.com/me, "me@x.com" → mailto. Null when it isn't one. */
fun wholeLink(raw: String): String? {
    var url = raw.trim()
    if (url.isEmpty()) return null
    if (!Regex("^[a-z][a-z0-9+.-]*:", RegexOption.IGNORE_CASE).containsMatchIn(url)) url = if (url.contains('@') && !url.contains('/')) "mailto:$url" else "https://$url"
    if (url.startsWith("mailto:")) return url.takeIf { Regex(".+@.+\\..+").matches(it.removePrefix("mailto:")) }
    val u = runCatching { io.ktor.http.Url(url) }.getOrNull() ?: return null
    if (u.protocol.name !in setOf("https", "http") || !u.host.contains('.')) return null
    return url
}

/** What to call a link when nobody named it: the site's name, and the handle after it when there is one. */
fun nameFor(url: String): String {
    if (url.startsWith("mailto:")) return "Email"
    val host = hostOf(url)
    val site = siteNames.firstOrNull { it.first.containsMatchIn(host) }?.second
    val handle = runCatching { io.ktor.http.Url(url).encodedPath.split('/').firstOrNull { it.isNotBlank() } }.getOrNull().orEmpty()
    return if (site != null) (if (handle.isNotBlank() && !Regex("^(channel|user|c|in|p)$", RegexOption.IGNORE_CASE).matches(handle)) "$site · $handle" else site) else host
}

/**
 * 鎖 Your links: paste an address and it's there, named after the site; hold
 * and drag to order them (or nudge them up and down); the star puts one first,
 * featured. Socials show as marks under your name; the rest are the buttons
 * in your Links widget. Each change saves a moment later.
 */
@Composable
private fun LinksEditor(start: List<ProfileLink>, onDismiss: () -> Unit, onSave: suspend (List<ProfileLink>) -> Boolean) {
    var links by remember { mutableStateOf(start) }
    var typed by remember { mutableStateOf("") }
    var openAt by remember { mutableStateOf<Int?>(null) }
    var saving by remember { mutableStateOf<String?>(null) }
    var last by remember { mutableStateOf(start) }
    LaunchedEffect(links) {
        if (links == last) return@LaunchedEffect
        delay(600)
        last = links
        saving = "Saving…"
        saving = if (onSave(links.filter { wholeLink(it.url) != null }.map { it.copy(url = wholeLink(it.url)!!) })) "Saved" else "Not saved"
    }
    val ready = wholeLink(typed)
    fun add() { if (ready == null || links.size >= 8) return; links = links + ProfileLink(nameFor(ready), ready); typed = "" }
    fun move(from: Int, to: Int) { if (to !in links.indices || from == to) return; links = links.toMutableList().apply { add(to, removeAt(from)) } }
    /* The first link in the Links widget is its featured one. */
    val featured = links.indexOfFirst(::inLinks)
    var dragging by remember { mutableStateOf<Int?>(null) }
    var dragY by remember { mutableStateOf(0f) }
    val rowPx = with(androidx.compose.ui.platform.LocalDensity.current) { 68.dp.toPx() }
    InkSheet(onDismissRequest = onDismiss, seed = "links") {
        Row(Modifier.fillMaxWidth().padding(start = 24.dp, end = 16.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Box(Modifier.weight(1f)) { InkTitle("Your links", "link") }
            saving?.let { Text(it, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            Seal("Done", compact = true, onClick = onDismiss)
        }
        Column(Modifier.heightIn(max = 640.dp).verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(bottom = 20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(MaterialTheme.colorScheme.surfaceContainerHighest)
                    .then(if (typed.isNotBlank() && ready == null) Modifier.border(1.5.dp, MaterialTheme.colorScheme.error, RoundedCornerShape(20.dp)) else Modifier).padding(start = 12.dp, end = 6.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Box(Modifier.size(34.dp).clip(RoundedCornerShape(10.dp)).background(Color(0xFFFBF6EF)), contentAlignment = Alignment.Center) {
                    if (ready != null) Favicon(ready, 18.dp) else Icon(kimonoIcon("link"), null, tint = LocalBoardColor.current, modifier = Modifier.size(18.dp))
                }
                androidx.compose.foundation.text.BasicTextField(
                    typed, { typed = it }, singleLine = true, enabled = links.size < 8,
                    textStyle = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface),
                    cursorBrush = androidx.compose.ui.graphics.SolidColor(MaterialTheme.colorScheme.primary),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = androidx.compose.ui.text.input.ImeAction.Done),
                    keyboardActions = androidx.compose.foundation.text.KeyboardActions(onDone = { add() }),
                    modifier = Modifier.weight(1f).padding(vertical = 16.dp).semantics { contentDescription = "Add a link" },
                    decorationBox = { inner -> Box { if (typed.isEmpty()) Text("Paste a link: instagram.com/you", style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant); inner() } },
                )
                Seal("Add", compact = true, icon = "plus", enabled = ready != null && links.size < 8, onClick = { add() })
            }
            val hint = when {
                typed.isNotBlank() && ready == null -> "That isn't a web address yet."
                ready != null -> "Adds as ${nameFor(ready)}${if (isSocial(ready)) ", under your name and in Links" else ", in Links"}"
                links.size >= 8 -> "That's eight: take one away to add another."
                else -> null
            }
            hint?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(start = 8.dp)) }
            if (links.isEmpty()) Column(Modifier.fillMaxWidth().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(kimonoIcon("link"), null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(28.dp))
                Text("Your Instagram, your site, your playlist: paste the first one above.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
            }
            links.forEachIndexed { i, l ->
                val whole = wholeLink(l.url)
                val linked = whole != null && inLinks(l)
                val lifted = dragging == i
                Column(
                    Modifier.fillMaxWidth().zIndex(if (lifted) 1f else 0f).graphicsLayer { if (lifted) { translationY = dragY; scaleX = 1.03f; scaleY = 1.03f; shadowElevation = 12f } }
                        .clip(RoundedCornerShape(20.dp)).background(MaterialTheme.colorScheme.surfaceContainer)
                        .then(if (whole == null) Modifier.border(1.5.dp, MaterialTheme.colorScheme.error.copy(alpha = .6f), RoundedCornerShape(20.dp)) else Modifier),
                ) {
                    Row(Modifier.fillMaxWidth().heightIn(min = 60.dp).padding(start = 4.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        /* The grip: hold and drag. */
                        Box(
                            Modifier.size(34.dp, 48.dp).pointerInput(i, links.size) {
                                detectDragGesturesAfterLongPress(onDragStart = { dragging = i; dragY = 0f }, onDragEnd = { dragging = null; dragY = 0f }, onDragCancel = { dragging = null; dragY = 0f }) { change, amount ->
                                    change.consume()
                                    dragY += amount.y
                                    val at = dragging ?: return@detectDragGesturesAfterLongPress
                                    val steps = (dragY / rowPx).toInt()
                                    if (steps != 0) { val to = (at + steps).coerceIn(0, links.lastIndex); if (to != at) { move(at, to); dragY -= (to - at) * rowPx; dragging = to } }
                                }
                            }.semantics { contentDescription = "Hold to move" },
                            contentAlignment = Alignment.Center,
                        ) { Column(verticalArrangement = Arrangement.spacedBy(3.dp)) { repeat(3) { Box(Modifier.size(14.dp, 2.dp).clip(CircleShape).background(MaterialTheme.colorScheme.onSurfaceVariant)) } } }
                        Box(Modifier.size(36.dp).clip(RoundedCornerShape(10.dp)).background(Color(0xFFFBF6EF)), contentAlignment = Alignment.Center) { if (whole != null) LinkMark(whole, l.icon, 18.dp) else Icon(kimonoIcon("link"), null, modifier = Modifier.size(18.dp)) }
                        Column(Modifier.weight(1f).clip(RoundedCornerShape(10.dp)).clickable { openAt = if (openAt == i) null else i }.padding(horizontal = 6.dp, vertical = 6.dp)) {
                            Text(l.title.ifBlank { nameFor(whole ?: l.url) }, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(
                                if (whole == null) "Not a web address" else hostOf(whole).ifEmpty { whole.removePrefix("mailto:") },
                                style = MaterialTheme.typography.bodySmall, color = if (whole == null) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis,
                            )
                        }
                        if (linked) Box(
                            Modifier.size(36.dp).clip(CircleShape).clickable { if (i != featured) move(i, maxOf(0, featured)) }
                                .semantics { contentDescription = if (i == featured) "First in Links" else "Put it first in Links" },
                            contentAlignment = Alignment.Center,
                        ) { Icon(kimonoIcon("star"), null, tint = if (i == featured) LocalBoardColor.current else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = .6f), modifier = Modifier.size(20.dp)) }
                        Column {
                            Icon(kimonoIcon("up"), "Move up", tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = if (i == 0) .3f else 1f), modifier = Modifier.size(28.dp, 22.dp).clickable(enabled = i > 0) { move(i, i - 1) })
                            Icon(kimonoIcon("down"), "Move down", tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = if (i == links.lastIndex) .3f else 1f), modifier = Modifier.size(28.dp, 22.dp).clickable(enabled = i < links.lastIndex) { move(i, i + 1) })
                        }
                        Box(Modifier.size(36.dp).clip(CircleShape).clickable { links = links.filterIndexed { j, _ -> j != i }; openAt = null }.semantics { contentDescription = "Remove ${l.title}" }, contentAlignment = Alignment.Center) {
                            Icon(kimonoIcon("close"), null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(18.dp))
                        }
                    }
                    if (openAt == i) Column(Modifier.padding(start = 14.dp, end = 14.dp, bottom = 14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(l.title, { t -> if (t.length <= 40) links = links.mapIndexed { j, x -> if (j == i) x.copy(title = t) else x } }, label = { Text("Title") }, singleLine = true, colors = kataFieldColors(), modifier = Modifier.fillMaxWidth())
                        OutlinedTextField(l.url.removePrefix("mailto:"), { u -> links = links.mapIndexed { j, x -> if (j == i) x.copy(url = u) else x } }, label = { Text("Address") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri), colors = kataFieldColors(), modifier = Modifier.fillMaxWidth())
                        ShowPick(showOf(l)) { show -> links = links.mapIndexed { j, x -> if (j == i) x.copy(show = show) else x } }
                        IconPick(whole, l.icon) { icon -> links = links.mapIndexed { j, x -> if (j == i) x.copy(icon = icon) else x } }
                    }
                }
            }
        }
    }
}

/** Where a link shows: under your name, in Links, or both. */
@Composable
private fun ShowPick(show: String, pick: (String) -> Unit) {
    Text("Shows", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        listOf("name" to "Under your name", "links" to "In Links", "both" to "Both").forEachIndexed { k, (value, label) ->
            val on = show == value
            val shape = when (k) { 0 -> RoundedCornerShape(12.dp, 3.dp, 3.dp, 12.dp); 2 -> RoundedCornerShape(3.dp, 12.dp, 12.dp, 3.dp); else -> RoundedCornerShape(3.dp) }
            Box(
                Modifier.weight(1f).heightIn(min = 42.dp).clip(shape).background(if (on) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surfaceContainerHighest)
                    .then(if (on) Modifier.border(2.dp, LocalBoardColor.current, shape) else Modifier).clickable { pick(value) }
                    .semantics { contentDescription = label; selected = on }.padding(horizontal = 6.dp),
                contentAlignment = Alignment.Center,
            ) { Text(label, style = MaterialTheme.typography.labelLarge, color = if (on) LocalBoardColor.current else MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis) }
        }
    }
}

/** What a link wears: the site's own icon, one of the drawn marks, or any emoji. */
@Composable
private fun IconPick(url: String?, icon: String?, pick: (String?) -> Unit) {
    Text("Icon", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        @Composable fun Tile(on: Boolean, label: String, onClick: () -> Unit, content: @Composable () -> Unit) = Box(
            Modifier.size(42.dp).clip(RoundedCornerShape(12.dp)).background(if (on) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surfaceContainerHighest)
                .then(if (on) Modifier.border(2.dp, MaterialTheme.colorScheme.primary, RoundedCornerShape(12.dp)) else Modifier).clickable(onClick = onClick).semantics { contentDescription = label },
            contentAlignment = Alignment.Center,
        ) { content() }
        Tile(icon == null, "The site's own", { pick(null) }) { if (url != null) Favicon(url, 20.dp) else Icon(kimonoIcon("link"), null, modifier = Modifier.size(20.dp)) }
        linkGlyphs.forEach { (key, name) -> Tile(icon == key, name, { pick(key) }) { Icon(kimonoIcon("lk-$key"), null, tint = LocalBoardColor.current, modifier = Modifier.size(20.dp)) } }
        /* Any emoji: the last one typed. */
        val emoji = icon?.takeIf { it.startsWith("emoji:") }?.removePrefix("emoji:").orEmpty()
        Box(
            Modifier.size(42.dp).clip(RoundedCornerShape(12.dp)).background(if (emoji.isNotEmpty()) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surfaceContainerHighest)
                .then(if (emoji.isNotEmpty()) Modifier.border(2.dp, MaterialTheme.colorScheme.primary, RoundedCornerShape(12.dp)) else Modifier),
            contentAlignment = Alignment.Center,
        ) {
            androidx.compose.foundation.text.BasicTextField(
                emoji, { typed -> val last = lastGrapheme(typed); pick(if (last.isEmpty()) null else "emoji:$last") }, singleLine = true,
                textStyle = MaterialTheme.typography.titleLarge.copy(textAlign = TextAlign.Center),
                modifier = Modifier.size(42.dp).padding(top = 6.dp).semantics { contentDescription = "An emoji instead" },
                decorationBox = { inner -> Box(contentAlignment = Alignment.Center) { if (emoji.isEmpty()) Text("🙂", style = MaterialTheme.typography.titleLarge, modifier = Modifier.alpha(.45f)); inner() } },
            )
        }
    }
}

/** The last character typed, whole enough for an emoji (with its joins, skin tone and flags kept together). */
private fun lastGrapheme(v: String): String {
    val t = v.trim()
    if (t.isEmpty()) return ""
    var i = t.length
    fun prev(at: Int) = if (at >= 2 && t[at - 1].isLowSurrogate() && t[at - 2].isHighSurrogate()) at - 2 else at - 1
    var start = prev(i)
    /* Walk back over joiners, variation selectors and modifiers glued to what's before them. */
    while (start > 0) {
        val c = t.substring(start, i).let { if (it.length == 2) (((it[0].code - 0xD800) shl 10) + (it[1].code - 0xDC00) + 0x10000) else it[0].code }
        val before = prev(start)
        val bc = t.substring(before, start).let { if (it.length == 2) (((it[0].code - 0xD800) shl 10) + (it[1].code - 0xDC00) + 0x10000) else it[0].code }
        val glued = c == 0xFE0F || c == 0x20E3 || c in 0x1F3FB..0x1F3FF || bc == 0x200D || c == 0x200D
        if (!glued) break
        i = start; start = before
    }
    return t.substring(start)
}

/* ── Sharing an app with friends, asked once ──────────────────────────── */

/* Asked once a run of the app, whatever they answer. */
private val askedThisRun = mutableSetOf<String>()

/**
 * The first time you open Watch, Books or Music with a friend to share with, it
 * asks what of it your friends see (components/sharing-ask.tsx on the web).
 * Until you answer, they see nothing of it; each choice starts where it should,
 * and Save makes them yours. Who sees what changes them after.
 */
@Composable
fun SharingAsk(friends: Friends, app: String) {
    val scope = rememberCoroutineScope()
    var asks by remember { mutableStateOf<List<app.kimono.data.ShareChoice>?>(null) }
    var on by remember { mutableStateOf(setOf<String>()) }
    var saving by remember { mutableStateOf(false) }
    LaunchedEffect(app) {
        if (app in askedThisRun) return@LaunchedEffect
        val now = runCatching { friends.sharingAsk(app) }.getOrNull() ?: return@LaunchedEffect
        if (!now.ask || now.asks.isEmpty()) return@LaunchedEffect
        askedThisRun += app
        on = now.asks.filter { it.on }.map { it.key }.toSet()
        asks = now.asks
    }
    val list = asks ?: return
    fun save(keys: List<String>) {
        saving = true
        scope.launch { runCatching { friends.answerSharing(app, keys) }; asks = null; saving = false }
    }
    InkDialog(title = "What your friends can see", icon = "people", tint = appTint(app), onDismiss = { asks = null }, actions = {
        Seal("Share nothing", compact = true, tone = SealTone.Quiet, enabled = !saving, onClick = { save(emptyList()) })
        Seal("Save", compact = true, busy = saving, onClick = { save(list.filter { it.key in on }.map { it.key }) })
    }) {
        list.forEach { a ->
            Row(Modifier.fillMaxWidth().heightIn(min = 56.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(a.says, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
                Switch(a.key in on, { v -> on = if (v) on + a.key else on - a.key })
            }
        }
    }
}
