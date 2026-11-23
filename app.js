// Fourteen Stations: Apple Music + DJs.
// DJ breaks are this site's own audio files. Songs play from Apple Music (MusicKit on the web) once the
// listener signs in; until then (or without a developer token) they play as 30-second Apple previews.
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const short = n => n.replace(/\s[\d.]+$/, "");
const ICON_PLAY = "M8 5v14l11-7z", ICON_PAUSE = "M6 5h4v14H6zm8 0h4v14h-4z";

const audio = new Audio();               // DJ breaks and previews share one element, so one tap unlocks it on iPhone
audio.preload = "auto";
let DATA = null, music = null, mkFailed = false;
const P = { st: null, i: -1, gen: 0, playing: false, need: false, sawPlaying: false };

const full = () => !!(music && music.isAuthorized);
const cur = () => (P.st ? P.st.items[P.i] : null);
const usesMk = it => it && it.t === "song" && full();

/* ---------- start-up ---------- */
async function init() {
  try {
    DATA = await (await fetch("stations.json", { cache: "no-cache" })).json();
  } catch (e) {
    $("#grid").innerHTML = `<p class="mode">The stations didn't load. Refresh the page to try again.</p>`;
    return;
  }
  if (DATA.edition) $("#edition").textContent = `${DATA.edition} · refreshed monthly`;
  renderGrid();
  renderAccount();
  if (window.FS_TOKEN) loadMusicKit();
  const k = DATA.stations.findIndex(s => s.slug === location.hash.slice(1));
  if (k >= 0) document.querySelectorAll(".tile")[k].scrollIntoView({ block: "center" });
}

function loadMusicKit() {
  document.addEventListener("musickitloaded", async () => {
    try {
      music = await MusicKit.configure({ developerToken: window.FS_TOKEN, app: { name: "Fourteen Stations", build: "2026.11" } });
      music.addEventListener("playbackStateDidChange", onMkState);
      music.addEventListener("authorizationStatusDidChange", renderAccount);
    } catch (e) { console.warn("MusicKit", e); music = null; mkFailed = true; }
    renderAccount();
  }, { once: true });
  const s = document.createElement("script");
  s.src = "https://js-cdn.music.apple.com/musickit/v3/musickit.js";
  s.async = true;
  s.setAttribute("data-web-components", "");
  s.onerror = () => { mkFailed = true; renderAccount(); };
  document.head.appendChild(s);
}

function renderAccount() {
  const el = $("#account");
  if (!window.FS_TOKEN || mkFailed) {
    el.innerHTML = `<p class="mode"><span class="lamp live"></span><span><b>Preview mode.</b> ${mkFailed ? "Apple Music didn't connect, so" : "For now"} songs play as 30-second Apple Music previews, with every DJ break in full between them.</span></p>`;
  } else if (!music) {
    el.innerHTML = `<p class="mode"><span class="lamp"></span>Connecting to Apple Music…</p>`;
  } else if (music.isAuthorized) {
    el.innerHTML = `<p class="mode"><span class="lamp live"></span><span><b>Signed in to Apple Music.</b> Full songs, with the DJs between them.</span><button class="link" id="signout">Sign out</button></p>`;
    $("#signout").onclick = async () => { try { await music.unauthorize(); } catch (e) {} renderAccount(); };
  } else {
    el.innerHTML = `<div class="mode"><button class="btn primary" id="signin">Sign in with Apple Music</button><span>Full songs need an Apple Music subscription. Without signing in you'll hear 30-second previews and every DJ break.</span></div>`;
    $("#signin").onclick = async () => { try { await music.authorize(); } catch (e) {} renderAccount(); paint(); };
  }
}

function renderGrid() {
  $("#grid").innerHTML = DATA.stations.map((s, k) => `
    <button class="tile" data-k="${k}" style="--c:${s.c}" aria-label="Tune in to ${esc(s.n)}, hosted by ${esc(s.h)}">
      <img src="${s.cover}" alt="" width="640" height="640" loading="lazy">
      <span class="meta"><span class="freq">${esc(s.f)}</span><span class="nm">${esc(short(s.n))}</span><span class="hs">${esc(s.h)}</span></span>
    </button>`).join("");
  $("#grid").onclick = e => { const t = e.target.closest(".tile"); if (t) tune(+t.dataset.k); };
}

/* ---------- playback ---------- */
function tune(k) {
  P.st = DATA.stations[k];
  document.documentElement.style.setProperty("--c", P.st.c);
  document.querySelectorAll(".tile").forEach(t => t.classList.toggle("on", +t.dataset.k === k));
  history.replaceState(null, "", "#" + P.st.slug);
  $("#player").hidden = false;
  document.body.classList.add("has-player");
  renderRows();
  go(0);
}

function stopAll() {
  audio.pause();
  if (music && music.isPlaying) { try { music.pause(); } catch (e) {} }
}

async function go(i) {
  const st = P.st;
  if (!st) return;
  if (i >= st.items.length) { i = 0; toast(`${short(st.n)}: back to the top of the hour.`); }
  if (i < 0) i = 0;
  const g = ++P.gen, it = st.items[i];
  P.i = i; P.need = false; P.sawPlaying = false; P.playing = false;
  stopAll();
  paint();
  try {
    if (usesMk(it)) {
      await music.setQueue({ song: it.id, startPlaying: false });
      if (g !== P.gen) return;
      await music.play();
    } else {
      const url = it.t === "dj" ? it.src : it.preview;
      if (!url) throw new Error("nothing to play");
      audio.src = url;
      await audio.play();
    }
    if (g === P.gen) { P.playing = true; paint(); }
  } catch (e) {
    if (g !== P.gen) return;
    if (e && e.name === "NotAllowedError") { P.need = true; paint(); return; }   // the browser wants one more tap
    toast(`Couldn't play ${it.t === "dj" ? "that DJ break" : `“${it.title}”`}. Skipping.`);
    setTimeout(() => { if (g === P.gen) go(i + 1); }, 1500);
  }
}

audio.addEventListener("ended", () => { if (!usesMk(cur())) go(P.i + 1); });
audio.addEventListener("play", () => { if (!usesMk(cur())) { P.playing = true; paint(); } });
audio.addEventListener("pause", () => { if (!usesMk(cur()) && !audio.ended) { P.playing = false; paint(); } });

function onMkState(e) {
  const S = MusicKit.PlaybackStates, it = cur();
  if (!usesMk(it)) return;
  if (e.state === S.playing) { P.sawPlaying = true; P.playing = true; P.need = false; paint(); }
  else if (e.state === S.paused) { P.playing = false; paint(); }
  else if ((e.state === S.ended || e.state === S.completed) && P.sawPlaying) { P.sawPlaying = false; go(P.i + 1); }
}

function toggle() {
  const it = cur();
  if (!it) return;
  const mk = usesMk(it);
  if (P.need || !P.playing) {
    P.need = false;
    (mk ? music.play() : audio.play()).then(() => { P.playing = true; paint(); }).catch(() => { P.need = true; paint(); });
  } else {
    mk ? music.pause() : audio.pause();
    P.playing = false;
  }
  paint();
}

function back() {
  const t = usesMk(cur()) ? music.currentPlaybackTime : audio.currentTime;
  if (t > 4) { usesMk(cur()) ? music.seekToTime(0) : (audio.currentTime = 0); } else go(P.i - 1);
}

/* ---------- display ---------- */
function describe(it) {
  const st = P.st, nextSong = st.items.slice(P.i + 1).find(x => x.t === "song");
  if (it.t === "dj") {
    return { live: true, kick: `On air · DJ break ${it.n} of 6`, title: it.title,
      sub: `${st.h}${nextSong ? ` · up next: ${nextSong.title} by ${nextSong.artist}` : ""}` };
  }
  const n = st.items.slice(0, P.i + 1).filter(x => x.t === "song").length;
  return { live: false, kick: `${short(st.n)} · song ${n} of 24${usesMk(it) ? "" : " · 30-sec preview"}`, title: it.title, sub: it.artist };
}

function paint() {
  const it = cur();
  if (!it) return;
  const d = describe(it);
  $("#p-cover").src = P.st.cover;
  const kick = $("#p-kick");
  kick.className = "kick" + (d.live ? " live" : "");
  kick.innerHTML = `${d.live ? '<span class="lamp live"></span>' : ""}${esc(P.need ? "Tap play to keep listening" : d.kick)}`;
  $("#p-title").textContent = d.title;
  $("#p-sub").textContent = d.sub;
  $("#pp-icon").setAttribute("d", P.playing ? ICON_PAUSE : ICON_PLAY);
  $("#pp").setAttribute("aria-label", P.playing ? "Pause" : "Play");
  $("#pp").classList.toggle("nudge", P.need);
  document.querySelectorAll(".row").forEach(r => r.setAttribute("aria-current", +r.dataset.i === P.i ? "true" : "false"));
  document.title = `${d.title} · ${short(P.st.n)}`;
  if ("mediaSession" in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({ title: d.title, artist: d.live ? P.st.h : d.sub, album: P.st.n,
      artwork: [{ src: new URL(P.st.cover, location.href).href, sizes: "640x640", type: "image/jpeg" }] });
    navigator.mediaSession.playbackState = P.playing ? "playing" : "paused";
  }
}

function renderRows() {
  $("#sheet-title").textContent = `${short(P.st.n)} · run order`;
  $("#rows").innerHTML = P.st.items.map((it, i) => it.t === "dj"
    ? `<button class="row dj" data-i="${i}"><span class="n">DJ</span><span class="t">Break ${it.n}: ${esc(it.title)}</span><span></span></button>`
    : `<button class="row" data-i="${i}"><span class="n">${P.st.items.slice(0, i + 1).filter(x => x.t === "song").length}</span><span class="t">${esc(it.title)} <small>${esc(it.artist)}</small></span><a href="https://music.apple.com/song/${it.id}" target="_blank" rel="noopener" aria-label="Open ${esc(it.title)} in Apple Music">Apple Music ↗</a></button>`).join("");
}
$("#rows").addEventListener("click", e => {
  if (e.target.closest("a")) return;
  const r = e.target.closest(".row");
  if (r) go(+r.dataset.i);
});

setInterval(() => {
  const it = cur();
  if (!it) return;
  const [t, d] = usesMk(it) ? [music.currentPlaybackTime, music.currentPlaybackDuration] : [audio.currentTime, audio.duration];
  $("#prog").style.width = d > 0 ? `${Math.min(100, (t / d) * 100)}%` : "0";
}, 500);

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}

$("#pp").onclick = toggle;
$("#next").onclick = () => go(P.i + 1);
$("#back").onclick = back;
$("#list").onclick = () => {
  const s = $("#sheet"); s.hidden = !s.hidden;
  $("#list").setAttribute("aria-expanded", String(!s.hidden));
  if (!s.hidden) document.querySelector('.row[aria-current="true"]')?.scrollIntoView({ block: "center" });
};
document.addEventListener("keydown", e => { if (e.key === "Escape") { $("#sheet").hidden = true; $("#list").setAttribute("aria-expanded", "false"); } });
if ("mediaSession" in navigator) {
  const ms = navigator.mediaSession;
  ms.setActionHandler("play", () => { if (!P.playing) toggle(); });
  ms.setActionHandler("pause", () => { if (P.playing) toggle(); });
  ms.setActionHandler("nexttrack", () => go(P.i + 1));
  ms.setActionHandler("previoustrack", back);
}
init();
