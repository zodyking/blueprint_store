/* Blueprint Store – UI glue
 * Scope: only requested changes
 * - expanded tag logic (brand keywords → tag; fallback "Other")
 * - single description area with dark bg that expands/collapses (incl. double-click)
 * - keep gray "View description" CTA when multiple MyHA badges
 * - preserve sorting, filters, spotlight, and everything else
 */

const API = "/api/blueprint_store";
const $  = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

/* ---------- small helpers ---------- */
function esc(s){ return (s||"").toString().replace(/[&<>"']/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c])); }
const wait = (ms)=> new Promise(r=> setTimeout(r, ms));
const debounce = (fn, ms=280)=>{ let t; return (...a)=>{ clearTimeout(t); t = setTimeout(()=>fn(...a), ms); }; };

async function fetchJSONRaw(url){
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const data = await res.json();
  if (data && data.error) throw new Error(data.error);
  return data;
}
async function fetchJSON(url, tries=3){
  let delay = 500;
  for (let i=0;i<tries;i++){
    try { return await fetchJSONRaw(url); }
    catch(e){
      const msg = String(e.message||e);
      if (i < tries-1 && /429/.test(msg)) { await wait(delay + Math.random()*250); delay *= 2; continue; }
      throw e;
    }
  }
}

/* ----- resilient opener: blank tab -> then navigate (with meta refresh fallback) ----- */
function openExternal(url){
  try{
    const w = window.open("", "_blank");
    if (w) {
      try { w.opener = null; } catch {}
      const safe = String(url).replace(/"/g, "&quot;");
      w.document.write(`<!doctype html><meta charset="utf-8">
        <title>Opening…</title>
        <style>body{font-family:system-ui,Segoe UI,Roboto;padding:2rem;color:#123}
        a{color:#06c;font-weight:700}</style>
        <p>Opening… If nothing happens <a href="${safe}">click here</a>.</p>
        <meta http-equiv="refresh" content="0; url='${safe}'">`);
      try { w.location.href = url; } catch {}
      return true;
    }
  } catch {}
  try { window.top.location.assign(url); } catch { location.assign(url); }
  return false;
}

/* ---------- curated tags (expanded) ---------- */
const TAG_DEFS = [
  ["Lighting", ["light","lights","illumin","led","bulb","hue","lifx","nanoleaf","philips hue"]],
  ["Climate & Ventilation", ["temp","climate","hvac","thermostat","heating","cooling","ventilation","fan","radiator","ecobee","nest","tado","aqara thermostat"]],
  ["Security & Alarm", ["alarm","armed","disarm","siren","intrusion","security system"]],
  ["Safety (Smoke/CO/Leak)", ["smoke","co2","carbon monoxide","leak","water leak","gas leak","detector"]],
  ["Presence & Occupancy", ["presence","occupancy","person","people","zone","proximity","geofence"]],
  ["Access & Locks", ["lock","unlock","door lock","deadbolt","nuki","august lock","yale lock","schlage"]],
  ["Cameras & Vision", [
    "camera","nvr","cctv","rtsp","onvif","snapshot","image","doorbell",
    // brands
    "unifi","protect","ubiquiti","dahua","hikvision","reolink","wyze","arlo","ring","eufy","amcrest","blink","tp-link","tapo","annke"
  ]],
  ["Media & Entertainment", ["media","spotify","plex","kodi","chromecast","tv","music","speaker","sound"]],
  ["AI & Assistants", ["assistant","voice","llm","openai","ai","chatgpt","groq","tts","stt","whisper","piper","rhasspy","wyoming"]],
  ["Announcements & Notifications", ["notification","announce","alert","message","telegram","discord","pushover","notify"]],
  ["Energy & Power", ["energy","power","kwh","electric","solar","pv","ev","charger","inverter","battery"]],
  ["Environment & Weather", ["weather","forecast","rain","wind","sun","uv","aqi","air quality","environment"]],
  ["Appliances & Utilities", ["appliance","washer","dryer","dishwasher","vacuum","robot","roomba","mop","kitchen","oven","coffee"]],
  ["Scheduling & Scenes", ["schedule","timer","scene","mode","sleep","night","morning","bedtime"]],
  ["System & Maintenance", ["system","backup","restart","maintenance","update","health"]],
  ["Other", []]
];
const TAG_ORDER = TAG_DEFS.map(([name])=> name);

/* resolve tag (bucket) by scanning text */
function inferBucket(item){
  // Use server bucket if solid (not empty/other); else infer.
  const fromServer = (item.bucket||"").toString().trim();
  if (fromServer && fromServer.toLowerCase() !== "other") return fromServer;

  const hay = [
    (item.title||""), (item.excerpt||""), (item.author||""),
    ...(item.tags||[])
  ].join(" ").toLowerCase();

  for (const [name, words] of TAG_DEFS){
    if (!words.length) continue;
    for (const w of words){
      if (hay.includes(w.toLowerCase())) return name;
    }
  }
  return "Other";
}

/* ---------- tokens + scoring for search ---------- */
function tokenize(s){
  return (s||"")
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter(Boolean);
}
function scoreItem(item, tokens){
  if (!tokens.length) return 0;
  const title = (item.title||"").toLowerCase();
  const text  = (item.excerpt||"").toLowerCase();
  const tags  = (item.tags||[]).join(" ").toLowerCase();
  let score = 0;
  for (const t of tokens){
    if (title.includes(t)) score += 2;
    if (text.includes(t))  score += 1;
    if (tags.includes(t))  score += 1;
  }
  return score;
}

/* ---------- tags dropdown ---------- */
function populateTagsMenu(){
  const tagmenu = $("#tagmenu");
  tagmenu.innerHTML = "";
  const mk = (value,label)=>`<sl-menu-item value="${esc(value)}">${esc(label)}</sl-menu-item>`;
  tagmenu.insertAdjacentHTML("beforeend", mk("", "All tags"));
  TAG_ORDER.forEach(t => tagmenu.insertAdjacentHTML("beforeend", mk(t, t)));
}

/* ---------- forum redirect (to avoid blocked opener) ---------- */
function rewriteToRedirect(href){
  try{
    const u = new URL(href);
    if (u.hostname !== "community.home-assistant.io") return null;
    const parts = u.pathname.split("/").filter(Boolean);
    const idx = parts.indexOf("t");
    if (idx === -1) return null;
    let slug = "", id = "";
    if (parts[idx+1] && /^\d+$/.test(parts[idx+1])) { id = parts[idx+1]; }
    else { slug = (parts[idx+1] || ""); id = (parts[idx+2] || "").replace(/[^0-9]/g, ""); }
    if (!id) return null;
    const qs = new URLSearchParams({ tid: id, slug }).toString();
    return `${API}/go?${qs}`;
  }catch{ return null; }
}

/* ---------- creators spotlight ---------- */
const creators = {
  container: $("#creators"),
  popAuthor: $("#c_pop_author"),
  popTitle: $("#c_pop_title"),
  upAuthor:  $("#c_up_author"),
  upCount:   $("#c_up_count"),
  rAuthor:   $("#c_recent_author"),
  rTitle:    $("#c_recent_title"),
  loading:   $("#creators-loading"),
  show(){ this.container.style.display = ""; },
  hide(){ this.container.style.display = "none"; },
  setLoading(on){ this.loading.style.display = on ? "inline-block" : "none"; }
};

/* ---------- single-desc renderer + CTA analyzer ---------- */
function setPostHTMLInto(container, html, ctaEl){
  const tmp = document.createElement("div");
  tmp.innerHTML = html || "<em>Nothing to show.</em>";

  // Make all community links open via redirect
  tmp.querySelectorAll('a[href^="https://community.home-assistant.io/"]').forEach(a=>{
    const redir = rewriteToRedirect(a.getAttribute("href"));
    if (redir) a.setAttribute("href", redir);
  });
  // Detect multiple MyHA import badges -> convert CTA to "View description"
  const importLinks = tmp.querySelectorAll('a[href*="my.home-assistant.io/redirect/blueprint_import"]');
  if (ctaEl){
    if (importLinks.length > 1) {
      ctaEl.classList.add("gray");
      ctaEl.querySelector(".cta-text").textContent = "View description";
      ctaEl.dataset.forceView = "1";
    } else {
      ctaEl.classList.remove("gray");
      ctaEl.querySelector(".cta-text").textContent = "Import to Home Assistant";
      delete ctaEl.dataset.forceView;
    }
  }

  container.innerHTML = "";
  container.appendChild(tmp);
}

/* ---------- card renderer ---------- */
const detailCache = new Map();

function likePill(likes){
  if (likes == null) return "";
  const fmt = (v)=> v>=1_000_000 ? `${(v/1_000_000).toFixed(1).replace(/\.0$/,"")}M`
                     : v>=1_000   ? `${(v/1_000).toFixed(1).replace(/\.0$/,"")}k`
                     : `${v}`;
  return `<span class="stat-pill"><span class="icon-heart"></span><span>${fmt(likes)}</span><span class="liked-text">Liked This</span></span>`;
}

function tagPills(tags){
  const set = [];
  (tags || []).forEach(t => { const v=(t||"").toString().trim(); if (v && !set.includes(v)) set.push(v); });
  if (!set.length) return "";
  return `<div class="tags">${set.slice(0,4).map(t=>`<span class="tag">${esc(t)}</span>`).join("")}</div>`;
}

function importButton(href){
  return `
    <a class="myha-btn cta" data-open="${esc(href)}">
      <sl-icon name="house"></sl-icon>
      <span class="cta-text">Import to Home Assistant</span>
    </a>`;
}

function renderCard(it){
  // Normalize / enrich
  const bucket = inferBucket(it);
  const tags = [bucket, ...(it.tags||[])];

  const el = document.createElement("article");
  el.className = "card";

  const descShort = esc(it.excerpt || "");
  el.innerHTML = `
    <div class="row">
      <h3>${esc(it.title)}</h3>
      ${it.author ? `<span class="author">by ${esc(it.author)}</span>` : ""}
      ${likePill(it.likes)}
    </div>
    <div class="tags">${tagPills(tags)}</div>

    <div class="desc-wrap" id="desc-${it.id}">
      <div class="desc-inner">${descShort}</div>
    </div>

    <div class="toggle" data-id="${it.id}">Read more</div>

    <div class="card__footer">
      <div></div>
      ${importButton(it.import_url)}
    </div>
  `;

  const descWrap = el.querySelector(`#desc-${it.id}`);
  const descInner = el.querySelector(`#desc-${it.id} .desc-inner`);
  const toggle    = el.querySelector(".toggle");
  const ctaBtn    = el.querySelector(".cta");

  let expanded = false;
  async function expandNow(){
    if (expanded) return;
    expanded = true;
    toggle.style.pointerEvents = "none";
    try{
      if (!detailCache.has(it.id)) {
        const data = await fetchJSON(`${API}/topic?id=${it.id}`);
        detailCache.set(it.id, data.cooked || "");
      }
      setPostHTMLInto(descInner, detailCache.get(it.id), ctaBtn);
      descWrap.classList.add("expanded");
      toggle.textContent = "Less";
    }catch(e){
      setPostHTMLInto(descInner, `<em>Failed to load post: ${esc(String(e.message||e))}</em>`, ctaBtn);
      descWrap.classList.add("expanded");
      toggle.textContent = "Less";
    }finally{
      toggle.style.pointerEvents = "";
    }
  }
  function collapseNow(){
    expanded = false;
    descWrap.classList.remove("expanded");
    descInner.textContent = it.excerpt || "";
    toggle.textContent = "Read more";
    // If we forced CTA into gray "View description", keep it gray (user asked to not change behavior on collapse)
  }

  toggle.addEventListener("click", ()=> expanded ? collapseNow() : expandNow());

  // Double-click anywhere on card toggles description
  el.addEventListener("dblclick", (ev)=>{
    const inFooter = ev.target.closest(".card__footer");
    if (inFooter) return; // ignore double click on footer/CTA
    expanded ? collapseNow() : expandNow();
  });

  // Intercept CTA
  el.addEventListener("click", (ev)=>{
    const opener = ev.target.closest("[data-open]");
    if (!opener) return;
    ev.preventDefault();
    // If CTA was forced into "View description", just expand
    if (opener.classList.contains("cta") && opener.dataset.forceView === "1") {
      expandNow();
      return;
    }
    openExternal(opener.getAttribute("data-open"));
  });

  return el;
}

/* ---------- data loading & UI glue ---------- */
const list     = $("#list");
const empty    = $("#empty");
const errorB   = $("#error");
const searchEl = $("#search");
const sortSel  = $("#sort");
const tagdd    = $("#tagdd");
const tagbtn   = $("#tagbtn");
const tagmenu  = $("#tagmenu");
const refreshBtn = $("#refresh");
const sentinel = $("#sentinel");
const headingEl = $("#headingEl");

populateTagsMenu();

let page = 0;
let loading = false;
let hasMore = true;

let sort   = "likes";  // likes | new | title
let bucket = "";       // tag filter
let q      = "";       // search query tokens
let allItems = [];     // cache of all loaded items for spotlight/search

function setError(msg){ errorB.style.display="block"; errorB.textContent = msg; }
function clearError(){ errorB.style.display="none"; errorB.textContent = ""; }

function updateHeading(){
  const parts = [];
  if (sort === "likes") parts.push("Most liked blueprints");
  else if (sort === "new") parts.push("Newest blueprints");
  else parts.push("All blueprints");

  if (q) parts.push(`• query: “${q}”`);
  if (bucket) parts.push(`• tag: ${bucket}`);

  headingEl.textContent = parts.join(" ");
}

/* server page fetch */
async function fetchPage(p){
  const url = new URL(`${API}/blueprints`, location.origin);
  url.searchParams.set("page", String(p));
  // We avoid server-side title filtering; we load + client-filter for title+descr combos
  url.searchParams.set("sort", sort);
  if (bucket) url.searchParams.set("bucket", bucket);
  return await fetchJSON(url.toString());
}

/* Spotlight (after all pages loaded) */
function buildSpotlight(items){
  if (!items.length) { creators.hide(); return; }

  // Most popular blueprint
  const byLikes = [...items].sort((a,b)=>(b.likes||0)-(a.likes||0));
  const popular = byLikes[0];

  // Most uploaded blueprints (author with most blueprints)
  const byAuthor = new Map();
  for (const it of items){
    if (!it.author) continue;
    byAuthor.set(it.author, (byAuthor.get(it.author)||0)+1);
  }
  let upName = ""; let upCount = 0;
  for (const [name,count] of byAuthor.entries()){
    if (count > upCount) { upName = name; upCount = count; }
  }

  // Most recent upload (sort by server 'created' if present, else id as fallback)
  const byRecent = [...items].sort((a,b)=>{
    const at = (a.created_ts || a.created || a.updated_ts || a.updated || 0);
    const bt = (b.created_ts || b.created || b.updated_ts || b.updated || 0);
    if (at && bt) return bt - at;
    return String(b.id).localeCompare(String(a.id));
  });
  const recent = byRecent[0];

  // Fill
  creators.popAuthor.textContent = popular?.author || "—";
  creators.popTitle.textContent  = popular?.title  || "—";

  creators.upAuthor.textContent  = upName || "—";
  creators.upCount.textContent   = upCount ? `${upCount} Blueprints` : "—";

  creators.rAuthor.textContent   = recent?.author || "—";
  creators.rTitle.textContent    = recent?.title  || "—";

  creators.setLoading(false);
  creators.show();
}

/* load page -> list */
async function load(initial=false){
  if (loading || (!hasMore && !initial)) return;
  loading = true; clearError();
  try{
    const data = await fetchPage(page);
    const items = (data.items || []).map(x=> ({...x, bucket: inferBucket(x)}));

    if (initial){
      list.innerHTML = "";
      empty.style.display = items.length ? "none" : "block";
      // Also reset spotlight loader state
      creators.setLoading(true);
      creators.show();
    }

    // Keep a copy for client-side searching and spotlight
    allItems.push(...items);

    // Client-side filter by query tokens over title + excerpt + tags
    let view = items;
    if (q){
      const toks = tokenize(q);
      view = items
        .map(it => ({ it, s: scoreItem(it, toks) }))
        .filter(x => x.s > 0)
        .sort((a,b)=> b.s - a.s)
        .map(x => x.it);
    }

    // Append cards
    for (const it of view) list.appendChild(renderCard(it));

    hasMore = !!data.has_more;
    page += 1;

    // If we’ve loaded everything, compute spotlight
    if (!hasMore) buildSpotlight(allItems);
  }catch(e){
    setError(`Failed to load: ${String(e.message||e)}`);
  }finally{
    loading = false;
  }
}

/* load ALL for search refresh (keeps sort, bucket) */
async function loadAllFresh(){
  // reset
  page = 0; hasMore = true; list.innerHTML = ""; clearError();
  allItems = []; creators.setLoading(true); creators.show();
  let first = true;
  while (hasMore) {
    await load(first); first = false;
    await wait(6);
  }
}

/* search + filters */
if (searchEl){
  const onSearch = debounce(async ()=>{
    q = (searchEl.value || "").trim();
    updateHeading();
    await loadAllFresh();
  }, 300);
  searchEl.addEventListener("sl-input", onSearch);
  searchEl.addEventListener("sl-clear", onSearch);
}

if (sortSel){
  sortSel.addEventListener("sl-change", async ()=>{
    sort = sortSel.value || "likes";
    updateHeading();
    await loadAllFresh();
  });
}

if (tagmenu){
  tagmenu.addEventListener("sl-select", async (ev)=>{
    bucket = ev.detail.item.value || "";
    $("#tagbtn").textContent = bucket || "All tags";
    updateHeading();
    await loadAllFresh();
    if (tagdd && typeof tagdd.hide === "function") tagdd.hide();
  });
}

if (refreshBtn){
  refreshBtn.addEventListener("click", loadAllFresh);
}

/* infinite scroll */
if (sentinel){
  const io = new IntersectionObserver((entries)=>{
    if (entries[0] && entries[0].isIntersecting) load(false);
  },{ rootMargin:"700px" });
  io.observe(sentinel);
}

/* boot */
function boot(){
  updateHeading();
  load(true);
}
document.addEventListener("DOMContentLoaded", boot);
