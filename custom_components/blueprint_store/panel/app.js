/* Blueprint Store – focused fixes
 * - single expanding description with dark bg (read-more + dbl-click)
 * - keep expansion state when scrolling/re-rendering
 * - filter “image1234x567 12.3 KB” attachment links out of cooked HTML
 * - if cooked post contains >1 “Import to Home Assistant” links, gray the card’s CTA and show “Read Description”
 * - move Creators Spotlight rendering into footer (IDs unchanged)
 * - robust search + tags unchanged from last good build
 */

const API = "/api/blueprint_store";
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

/* ---------- helpers ---------- */
const esc = s => (s ?? "").toString().replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c]));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const debounce = (fn, ms = 280) => { let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms); }; };
const toNum = (x) => { x = Number(x); return Number.isFinite(x) ? x : 0; };

/* retry with backoff (handles 429s) */
async function fetchJSONRaw(url){
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const data = await res.json();
  if (data && data.error) throw new Error(data.error);
  return data;
}
async function fetchJSON(url, tries=4){
  let delay = 500;
  for (let i=0;i<tries;i++){
    try { return await fetchJSONRaw(url); }
    catch(e){
      const msg = String(e.message||e);
      if (i < tries-1 && /429|timeout|temporarily/i.test(msg)) {
        await sleep(delay + Math.random()*250);
        delay = Math.min(delay*2, 4000);
        continue;
      }
      throw e;
    }
  }
}

/* safe external open */
function openExternal(url){
  try{
    const w = window.open("", "_blank");
    if (w){
      try{ w.opener = null; }catch{}
      const safe = String(url).replace(/"/g, "&quot;");
      w.document.write(`<!doctype html><meta charset="utf-8">
        <title>Opening…</title>
        <style>body{font-family:system-ui,Segoe UI,Roboto;padding:2rem;color:#123}
        a{color:#06c;font-weight:700}</style>
        <p>Opening… If nothing happens <a href="${safe}">click here</a>.</p>
        <meta http-equiv="refresh" content="0; url='${safe}'">`);
      try{ w.location.href = url; }catch{}
      return true;
    }
  }catch{}
  try{ window.top.location.assign(url); }catch{ location.assign(url); }
  return false;
}

/* ---------- tags (unchanged behaviour) ---------- */
const TAG_DEFS = [
  ["Lighting", ["light","lights","led","bulb","strip","rgb","rgbw","rgbcw","cct","dimmer","brightness","fade","color","hue","lifx","nanoleaf","govee","wiz","tradfri","philips","tuya","yeelight","ambilight","downlight","spotlight","lamp","wallwash","illumination","backlight","nightlight","switchlight","scene","motionlight"]],
  ["Climate & Ventilation", ["temp","temperature","climate","hvac","thermostat","heating","cooling","ventilation","fan","radiator","heatpump","humidifier","dehumidifier","aircon","ac","ecobee","nest","tado","honeywell","daikin","mitsubishi","bosch","trane","furnace","minisplit","heater","boiler","vent","aqara"]],
  ["Security & Alarm", ["alarm","alarmo","armed","arm","disarm","siren","intrusion","tamper","glassbreak","doorcontact","windowcontact","keypad","pincode","panic","perimeter","pir","reed","zone","burglary","securitysystem"]],
  ["Safety (Smoke/CO/Leak)", ["smoke","smokealarm","co","co2","carbonmonoxide","leak","waterleak","gasleak","lpg","methane","flood","moisture","detector","protect","kidde","firstalert","safety","fire","heat","hazard","valve","watershutoff"]],
  ["Presence & Occupancy", ["presence","occupancy","person","people","zone","proximity","geofence","ibeacon","bluetooth","ble","wifi","devicetracker","gps","espresense","arrival","depart","home","away","guest","motionoccupied"]],
  ["Access & Locks", ["lock","unlock","doorlock","deadbolt","smartlock","code","pin","rfid","nfc","keypad","garage","gate","opener","yale","schlage","kwikset","august","nuki","danalock","strike","intercom","access"]],
  ["Cameras & Vision", ["camera","nvr","cctv","rtsp","onvif","snapshot","image","doorbell","ipc","ptz","frigate","scrypted","motioneye","blueiris","zoneminder","clip","detect","person","face","lpr","stream","ffmpeg","unifi","protect","ubiquiti","dahua","hikvision","reolink","wyze","arlo","ring","eufy","amcrest","blink","tplink","tapo","annke"]],
  ["Media & Entertainment", ["media","music","tv","video","speaker","sound","volume","playlist","radio","cast","chromecast","airplay","dlna","sonos","spotify","plex","kodi","jellyfin","emby","appletv","androidtv","firetv","avr","denon","marantz","yamaha","soundbar"]],
  ["AI & Assistants", ["assistant","voice","tts","stt","wake","hotword","whisper","piper","coqui","azuretts","googl etts","rasa","rhasspy","wyoming","openwakeword","porcupine","llm","ai","chatgpt","openai","groq","llama","mistral","gpt","claude","intent","pipeline","microphone"]],
  ["Announcements & Notifications", ["notification","announce","announcement","alert","message","notify","push","email","smtp","sms","twilio","mobile_app","pushover","pushbullet","pushcut","telegram","discord","matrix","slack","gotify","ntfy","webhook","call"]],
  ["Energy & Power", ["energy","power","kwh","consumption","solar","pv","panel","inverter","battery","soc","grid","tariff","smartplug","meter","shelly","sonoff","victron","fronius","growatt","solis","goodwe","tesla","charger","ev","wallbox","zappi"]],
  ["Environment & Weather", ["weather","forecast","rain","wind","sun","uv","aqi","airquality","humidity","pressure","barometer","dewpoint","lightning","pollen","cloud","visibility","storm","openweather","met","season","sunrise","sunset","moon","outdoor","sensor"]],
  ["Appliances & Utilities", ["appliance","washer","washingmachine","dryer","dishwasher","vacuum","robot","roborock","dreame","deebot","mop","kitchen","oven","stove","microwave","kettle","coffee","espresso","fridge","freezer","airpurifier","heater","waterheater","pump","irblaster"]],
  ["Scheduling & Scenes", ["schedule","timer","delay","interval","calendar","holiday","weekday","weekend","sunset","sunrise","offset","scene","script","mode","sleep","night","morning","bedtime","quiet","repeat","cron","duration"]],
  ["System & Maintenance", ["system","maintenance","backup","restore","snapshot","supervisor","addon","update","upgrade","restart","reboot","watchdog","ping","uptime","health","recorder","database","purge","logbook","template","mqtt","zha","zigbee","zwave","integration","entity","debug"]],
  ["Other", []]
];
const TAG_ORDER = TAG_DEFS.map(([n])=>n);
function deriveTags(text){
  const t = text.toLowerCase();
  const hits = [];
  for (const [name, keys] of TAG_DEFS){
    if (!keys.length) continue;
    let c = 0;
    for (const k of keys){
      if (t.includes(k)) c++;
      if (c >= 3) { hits.push(name); break; }
    }
  }
  if (!hits.length) hits.push("Other");
  return Array.from(new Set(hits));
}

/* ---------- title parsing ---------- */
const LEADING_EMOJI_RE = /^[\p{Extended_Pictographic}\p{Emoji_Presentation}\p{Emoji}\s\W_]+/u;
function sanitizeTitle(raw){
  let s = (raw || "").toString();
  s = s.replace(/\[blueprint\]/i, "");
  s = s.replace(LEADING_EMOJI_RE, "");
  s = s.replace(/[^0-9A-Za-z()\-: ]+/g, " ").replace(/\s{2,}/g," ").trim();
  s = s.split(" ").map(w=>{
    if (w.length <= 4 && w === w.toUpperCase()) return w;
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  }).join(" ");
  return s;
}

/* ---------- cooked HTML sanitation ---------- */
function setPostHTMLInto(container, html){
  const tmp = document.createElement("div");
  tmp.innerHTML = html || "<em>Nothing to show.</em>";

  // remove “image1234x567 12.3 KB” style attachment links / meta
  tmp.querySelectorAll("a").forEach(a=>{
    const txt = (a.textContent||"").trim().toLowerCase();
    const href = a.getAttribute("href")||"";
    const looksImageLabel = /^image\d+x\d+/.test(txt) || /kb$/.test(txt);
    const looksAttachment = a.classList.contains("attachment") || a.classList.contains("lightbox");
    const isImageFile = /\.(jpg|jpeg|png|gif|webp|avif)(\?|$)/i.test(href);
    if (looksImageLabel || looksAttachment || isImageFile){
      // keep actual <img> tags, but drop orphan “image123x…” labels
      if (!a.querySelector("img")) a.remove();
    }
  });
  tmp.querySelectorAll(".meta, .filename, figcaption").forEach(n=>{
    const t = (n.textContent||"").trim().toLowerCase();
    if (/^image\d+x\d+/.test(t) || /kb$/.test(t)) n.remove();
  });

  // rewrite community links via redirect
  tmp.querySelectorAll('a[href^="https://community.home-assistant.io/"]').forEach(a=>{
    const href = a.getAttribute("href");
    try{
      const u = new URL(href);
      const parts = u.pathname.split("/").filter(Boolean);
      const tIdx = parts.indexOf("t");
      if (tIdx !== -1){
        let slug = "", id = "";
        if (parts[tIdx+1] && /^\d+$/.test(parts[tIdx+1])) id = parts[tIdx+1];
        else { slug = (parts[tIdx+1]||""); id = (parts[tIdx+2]||"").replace(/\D/g,""); }
        if (id){
          const qs = new URLSearchParams({ tid: id, slug }).toString();
          a.href = `${API}/go?${qs}`;
          a.addEventListener("click",(ev)=>{ ev.preventDefault(); openExternal(a.href); });
        }
      }
    }catch{}
  });

  // open MyHA redirects in new tab
  tmp.querySelectorAll('a[href*="my.home-assistant.io/redirect/blueprint_import"]').forEach(a=>{
    a.target = "_blank"; a.rel="noopener";
  });

  container.innerHTML = "";
  while (tmp.firstChild) container.appendChild(tmp.firstChild);
}

/* ---------- search scoring ---------- */
function tokenize(q){
  return (q||"").toLowerCase().replace(/[^\p{L}\p{N} ]+/gu," ").split(/\s+/).filter(Boolean);
}
function scoreItem(item, tokens){
  if (!tokens.length) return 1;
  const hay = (item._searchText || "").toLowerCase();
  let s = 0; for (const t of tokens) if (hay.includes(t)) s++;
  return s;
}

/* ---------- Spotlight model ---------- */
const spotlight = {
  popular: null,
  recent:  null,
  counts:  new Map(),
  topAuthor(){
    let a=null,c=0;
    for (const [k,v] of this.counts){ if (v>c){ a=k; c=v; } }
    return a?{author:a,count:c}:null;
  }
};

/* ---------- caches & state ---------- */
const detailCache = new Map();   // id -> { html, importCnt }
const openState = new Set();     // expanded cards by id

/* ---------- card renderer ---------- */
function tagPills(tags){
  const set = [];
  (tags||[]).forEach(t=>{
    const v=(t||"").toString().trim();
    if (v && !set.includes(v)) set.push(v);
  });
  if (!set.length) return "";
  return `<div class="tags">${set.slice(0,5).map(t=>`<span class="tag">${esc(t)}</span>`).join("")}</div>`;
}
function formatLikes(n){
  if (n >= 1_000_000) return `${(n/1_000_000).toFixed(1)}M`.replace(/\.0$/,"M");
  if (n >= 1_000) return `${(n/1_000).toFixed(1)}k`.replace(/\.0$/,"k");
  return `${n}`;
}

function renderCard(it){
  const el = document.createElement("article");
  el.className = "card";

  const title = sanitizeTitle(it.title || "");
  const author = it.author ? `by ${esc(it.author)}` : "";
  const likes  = toNum(it.likes || it.like_count || 0);

  const tagsTxt = (it.tags || []).join(" ");
  it._searchText = `${title} ${it.excerpt||""} ${tagsTxt}`;

  el.innerHTML = `
    <h3 class="card__title">${esc(title)}</h3>
    ${author ? `<div class="author">${author}</div>` : ""}
    ${tagPills([...(it.tags||[])])}
    <div class="desc-wrap" id="desc-${it.id}">
      <div class="desc">${esc(it.excerpt || "")}</div>
    </div>

    <div class="card__footer">
      <div class="likes-pill"><span class="icon-heart"></span>${formatLikes(likes)} <b>Liked This</b></div>
      <a class="myha-btn" id="cta-${it.id}" data-open="${esc(it.import_url)}">
        <sl-icon name="house"></sl-icon>
        Import to Home Assistant
      </a>
    </div>

    <button class="toggle" id="tgl-${it.id}" type="button">Read more</button>
  `;

  const wrap   = el.querySelector(`#desc-${it.id}`);
  const toggle = el.querySelector(`#tgl-${it.id}`);
  const cta    = el.querySelector(`#cta-${it.id}`);
  let expanded = openState.has(it.id);

  function setCTAForMultiple(){
    cta.classList.add("disabled");
    cta.removeAttribute("data-open");
    cta.textContent = "Read Description";
  }
  function setCTAForSingle(){
    cta.classList.remove("disabled");
    if (it.import_url) cta.setAttribute("data-open", it.import_url);
    cta.innerHTML = `<sl-icon name="house"></sl-icon> Import to Home Assistant`;
  }

  async function expandNow(){
    if (expanded) return;
    expanded = true; openState.add(it.id);
    toggle.disabled = true;
    try{
      if (!detailCache.has(it.id)){
        const data = await fetchJSON(`${API}/topic?id=${it.id}`);
        const cooked = data.cooked || "<em>No content.</em>";
        const importCnt = (cooked.match(/my\.home-assistant\.io\/redirect\/blueprint_import/gi)||[]).length;
        detailCache.set(it.id, { html: cooked, importCnt });
      }
      const { html, importCnt } = detailCache.get(it.id);
      const holder = document.createElement("div");
      setPostHTMLInto(holder, html);
      wrap.innerHTML = "";
      wrap.appendChild(holder);
      toggle.textContent = "Less";
      if (importCnt > 1) setCTAForMultiple();
      else setCTAForSingle();
    }catch(e){
      wrap.innerHTML = `<div class="desc"><em>Failed to load post: ${esc(String(e.message||e))}</em></div>`;
      toggle.textContent = "Less";
    }finally{
      toggle.disabled = false;
    }
  }
  function collapseNow(){
    expanded = false; openState.delete(it.id);
    wrap.innerHTML = `<div class="desc">${esc(it.excerpt || "")}</div>`;
    toggle.textContent = "Read more";
  }

  toggle.addEventListener("click", ()=> expanded ? collapseNow() : expandNow());
  el.addEventListener("dblclick",(e)=>{
    if (e.target.closest("a,button")) return;
    expanded ? collapseNow() : expandNow();
  });

  el.addEventListener("click",(ev)=>{
    const a = ev.target.closest("[data-open]");
    if (!a || a.classList.contains("disabled")) return;
    ev.preventDefault();
    openExternal(a.getAttribute("data-open"));
  });

  // restore expanded content if user had it open and list re-rendered
  if (expanded){
    (async ()=>{ await expandNow(); })();
  }

  return el;
}

/* ---------- Spotlight UI ---------- */
function updateSpotlightUI(root, stateReady){
  const s = $("#spot-popular");
  const u = $("#spot-uploaded");
  const r = $("#spot-recent");
  const spinner = $("#spot-spin");
  if (!s || !u || !r) return;

  if (!stateReady){
    s.innerHTML = u.innerHTML = r.innerHTML = "";
    if (spinner) spinner.style.display = "block";
    return;
  }
  if (spinner) spinner.style.display = "none";

  if (spotlight.popular){
    const it = spotlight.popular;
    s.innerHTML = `
      <div class="spot-head">Most Popular Blueprint</div>
      <div class="spot-author">${esc(it.author||"")}</div>
      <div class="spot-title">${esc(sanitizeTitle(it.title||""))}</div>
    `;
  }
  const top = spotlight.topAuthor();
  if (top){
    u.innerHTML = `
      <div class="spot-head">Most Uploaded Blueprints</div>
      <div class="spot-author">${esc(top.author)}</div>
      <div class="spot-meta">${top.count} Blueprints</div>
    `;
  }
  if (spotlight.recent){
    const it = spotlight.recent;
    r.innerHTML = `
      <div class="spot-head">Most Recent Upload</div>
      <div class="spot-author">${esc(it.author||"")}</div>
      <div class="spot-title">${esc(sanitizeTitle(it.title||""))}</div>
    `;
  }
}

/* ---------- main ---------- */
function boot(){
  const list     = $("#list");
  const empty    = $("#empty");
  const errorB   = $("#error");
  const searchEl = $("#search");
  const sortSel  = $("#sort");
  const refresh  = $("#refresh");
  const tagmenu  = $("#tagmenu");
  const tagbtn   = $("#tagbtn");
  const sentinel = $("#sentinel");

  let page = 0, hasMore = true, loading=false;
  let items = [];
  let qText = "";
  let sort = "likes";       // likes | new | title
  let bucket = "";

  function setError(msg){ errorB.style.display="block"; errorB.textContent=msg; }
  function clearError(){ errorB.style.display="none"; errorB.textContent=""; }

  function applyTagsTo(it){
    if (it.tags && it.tags.length) return;
    const base = `${(it.title||"")} ${it.excerpt||""}`.toLowerCase();
    it.tags = deriveTags(base);
  }

  function pushAndUpdateSpotlight(batch){
    for (const it of batch){
      it.title = sanitizeTitle(it.title||"");
      applyTagsTo(it);
      const lk = toNum(it.likes||it.like_count);
      if (!spotlight.popular || lk > toNum(spotlight.popular.likes||spotlight.popular.like_count)) {
        spotlight.popular = it;
      }
      const t = toNum(it.created_ts || it.created || it.id || 0);
      if (!spotlight.recent || t > toNum(spotlight.recent.created_ts || spotlight.recent.created || spotlight.recent.id || 0)){
        spotlight.recent = it;
      }
      if (it.author) spotlight.counts.set(it.author, (spotlight.counts.get(it.author)||0)+1);
    }
    updateSpotlightUI($("#spotlight"), true);
  }

  async function fetchFilters(){
    try{
      const data = await fetchJSON(`${API}/filters`);
      const tags = Array.isArray(data.tags) ? data.tags : TAG_ORDER;
      tagmenu.innerHTML = "";
      const mk = (value,label)=>`<sl-menu-item value="${esc(value)}">${esc(label)}</sl-menu-item>`;
      tagmenu.insertAdjacentHTML("beforeend", mk("", "All tags"));
      tags.forEach(t => tagmenu.insertAdjacentHTML("beforeend", mk(t, t)));
      tagmenu.addEventListener("sl-select", async (ev)=>{
        bucket = ev.detail.item.value || "";
        tagbtn.textContent = bucket || "All tags";
        await reflow();
      });
    }catch(e){ /* optional */ }
  }

  async function fetchPage(p){
    const url = new URL(`${API}/blueprints`, location.origin);
    url.searchParams.set("page", String(p));
    return await fetchJSON(url.toString());
  }

  function tokenize(q){ return (q||"").toLowerCase().replace(/[^\p{L}\p{N} ]+/gu," ").split(/\s+/).filter(Boolean); }
  function scoreItem(item, tokens){
    if (!tokens.length) return 1;
    const hay = (item._searchText||"").toLowerCase();
    let s = 0; for (const t of tokens) if (hay.includes(t)) s++; return s;
  }

  function recomputeAndRender(){
    const tokens = tokenize(qText);
    let pool = items.slice();
    if (bucket) pool = pool.filter(it => (it.tags||[]).includes(bucket));
    pool = pool.map(it => ({ it, sc: scoreItem(it, tokens) }))
               .filter(({sc}) => (tokens.length ? sc>0 : true));
    if (sort === "new") pool.sort((a,b)=> toNum((b.it.created_ts||b.it.created||b.it.id)) - toNum((a.it.created_ts||a.it.created||a.it.id))).reverse();
    else if (sort === "title") pool.sort((a,b)=> a.it.title.localeCompare(b.it.title));
    else pool.sort((a,b)=> toNum(b.it.likes||b.it.like_count) - toNum(a.it.likes||a.it.like_count));

    list.innerHTML = "";
    if (!pool.length){ empty.style.display="block"; return; }
    empty.style.display="none";
    for (const {it} of pool) list.appendChild(renderCard(it));
  }

  async function loadPage(p){
    if (loading) return;
    loading = true; clearError();
    try{
      const data = await fetchPage(p);
      const batch = (data.items || []).map(it => {
        it.tags = (it.tags || []).slice(0,4);
        return it;
      });
      batch.forEach(applyTagsTo);
      items.push(...batch);
      hasMore = !!data.has_more;
      pushAndUpdateSpotlight(batch);
      recomputeAndRender();
    }catch(e){
      setError(`Failed to load: ${String(e.message||e)}`);
    }finally{
      loading = false;
    }
  }

  async function loadAll(){
    page = 0; hasMore = true; items = [];
    updateSpotlightUI($("#spotlight"), false);
    await loadPage(page);
    (async ()=>{
      while (hasMore){
        await sleep(400);
        page += 1;
        await loadPage(page);
      }
    })();
  }

  // UI
  if (searchEl){
    const onSearch = debounce(()=>{ qText = (searchEl.value||"").trim(); recomputeAndRender(); }, 160);
    searchEl.addEventListener("sl-input", onSearch);
    searchEl.addEventListener("sl-clear", onSearch);
  }
  if (sortSel) sortSel.addEventListener("sl-change", ()=>{ sort = sortSel.value || "likes"; recomputeAndRender(); });
  if (refresh) refresh.addEventListener("click", async ()=>{ await loadAll(); });

  if (sentinel){
    const io = new IntersectionObserver(e=>{
      if (e[0]?.isIntersecting && hasMore && !loading){ page += 1; loadPage(page); }
    }, { rootMargin: "800px" });
    io.observe(sentinel);
  }

  fetchFilters();
  loadAll();
}

document.addEventListener("DOMContentLoaded", boot);
