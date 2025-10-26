/* Blueprint Store — UI glue
 * Scope: fixed sort menu stability, robust tag filter, likes pill, dark desc area that expands,
 *        dynamic heading, creator spotlight, contributors strip, word-based search
 */
const API = "/api/blueprint_store";
const $  = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

/* ---------- small helpers ---------- */
const esc = (s => (s ?? "").toString().replace(/[&<>"']/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c])));
const once = (el, name, fn) => { el.addEventListener(name, fn, { once:true }); };
const sleep = (ms=200) => new Promise(r=>setTimeout(r,ms));
const debounce = (fn, ms=250) => { let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; };

/* ---------- network ---------- */
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
      if (i<tries-1 && /429|timeout|network/i.test(msg)) {
        await sleep(delay + Math.random()*250);
        delay = Math.min(4000, delay*2);
        continue;
      }
      throw e;
    }
  }
}

/* ---------- curated tags (expanded) ---------- */
const TAG_DEFS = [
  ["Lighting", [
    "light","lights","illumination","led","bulb","strip","rgb","rgbw","rgbcw","cct",
    "dimmer","brightness","fade","color","colour","hue","lifx","nanoleaf","govee",
    "wiz","ikea tradfri","philips hue","tuya light","yeelight","scene light",
    "motion light","night light","ambilight","backlight","downlight","spotlight",
    "switch light","lamp","wall wash"
  ]],
  ["Climate & Ventilation", [
    "temp","temperature","climate","hvac","thermostat","heating","cooling","ventilation",
    "fan","radiator","heat pump","humidifier","dehumidifier","vent","aircon","ac",
    "ecobee","nest","tado","honeywell","daikin","mitsubishi","bosch","trane","furnace",
    "air handler","vrf","mini split","heater","boiler","thermo","aqara thermostat"
  ]],
  ["Security & Alarm", [
    "alarm","alarmo","armed","arm","disarm","entry","exit","delay","siren","intrusion",
    "tamper","glassbreak","door contact","window contact","security system","keypad",
    "pin code","panic","perimeter","motion sensor","pir","reed switch","zone bypass",
    "alert mode","security camera","armer","arming","triggered","burglar"
  ]],
  ["Safety (Smoke/CO/Leak)", [
    "smoke","smoke alarm","co","co2","carbon monoxide","co alarm","leak","water leak",
    "gas leak","lpg","methane","flood","moisture","detector","sensor","nest protect",
    "kidde","first alert","sirene","test alarm","low battery","safety","fire","heat",
    "temperature rise","hazard","valve shutoff","water shutoff","drip","overflow"
  ]],
  ["Presence & Occupancy", [
    "presence","occupancy","person","people","zone","proximity","geofence","ibeacon",
    "bluetooth","ble","wifi presence","device tracker","gps","room-assistant","espresense",
    "face detect","arrival","depart","enter","leave","home","away","work","school",
    "guest","visitor","motion occupied","unoccupied","away mode"
  ]],
  ["Access & Locks", [
    "lock","unlock","door lock","deadbolt","smart lock","code","pin","rfid","nfc",
    "keypad","garage door","gate","opener","yale","schlage","kwikset","august lock",
    "nuki","danalock","tuya lock","bolt","latch","auto lock","auto unlock","door sensor",
    "strike","intercom","access control","entry system"
  ]],
  ["Cameras & Vision", [
    "camera","nvr","cctv","rtsp","onvif","snapshot","image","doorbell","ipc","ptz",
    "frigate","scrypted","motioneye","blue iris","zoneminder","recording","clip",
    "detect","object","person detect","face","license plate","frame","stream","ffmpeg",
    "unifi","protect","ubiquiti","dahua","hikvision","reolink","wyze","arlo","ring",
    "eufy","amcrest","blink","tp-link","tapo","annke"
  ]],
  ["Media & Entertainment", [
    "media","music","tv","video","speaker","sound","volume","playlist","radio","cast",
    "chromecast","airplay","dlna","sonos","spotify","plex","kodi","jellyfin","emby",
    "apple tv","android tv","fire tv","avr","denon","marantz","yamaha","soundbar",
    "tunein","mpd","homepod","spotify connect","now playing"
  ]],
  ["AI & Assistants", [
    "assistant","voice","tts","stt","wake word","hotword","whisper","faster-whisper",
    "piper","coqui","azure tts","google tts","rasa","rhasspy","wyoming","openwakeword",
    "porcupine","snowboy","llm","ai","chatgpt","openai","groq","llama","mistral",
    "gpt","claude","intent","conversation","assist","pipeline","microphone","speaker"
  ]],
  ["Announcements & Notifications", [
    "notification","announce","announcement","alert","message","notify","push","email",
    "smtp","sms","twilio","mobile_app","html5","pushover","pushbullet","pushcut",
    "telegram","discord","matrix","slack","gotify","ntfy","webhook","call","tts notify",
    "rich text","priority","rate limit","digest"
  ]],
  ["Energy & Power", [
    "energy","power","kwh","consumption","production","solar","pv","panel","inverter",
    "battery","soc","grid","tariff","peak","offpeak","smart plug","meter","shelly",
    "sonoff pow","ct clamp","victron","fronius","growatt","solis","goodwe","tesla",
    "powerwall","charger","ev","wallbox","zappi","influx","efficiency"
  ]],
  ["Environment & Weather", [
    "weather","forecast","rain","wind","sun","uv","aqi","air quality","humidity",
    "pressure","barometer","dew point","temperature","lightning","pollen","cloud",
    "visibility","storm","openweather","met.no","pirateweather","accuweather",
    "season","sunrise","sunset","moon","environment","outdoor","sensor","index"
  ]],
  ["Appliances & Utilities", [
    "appliance","washer","washing machine","dryer","dishwasher","vacuum","robot vacuum",
    "roborock","dreame","deebot","mop","kitchen","oven","stove","range","microwave",
    "kettle","coffee","coffee maker","espresso","fridge","freezer","humidifier",
    "dehumidifier","air purifier","fan","heater","water heater","pump","ir blaster"
  ]],
  ["Scheduling & Scenes", [
    "schedule","timer","delay","cooldown","interval","calendar","holiday","weekday",
    "weekend","sunset","sunrise","golden hour","offset","automation mode","scene",
    "script","mode","sleep","night","morning","bedtime","quiet hours","do not disturb",
    "repeat","cron","window","time range","period","duration"
  ]],
  ["System & Maintenance", [
    "system","maintenance","backup","restore","snapshot","supervisor","addon","hassio",
    "update","upgrade","restart","reboot","watchdog","ping","uptime","health",
    "recorder","database","purge","logbook","template","mqtt","zha","zigbee","zwave",
    "integration","device","entity","automation","debug"
  ]],
  ["Other", []]
];
const TAG_ORDER = TAG_DEFS.map(([name]) => name);

/* ---------- opener (import & forum redirect safety) ---------- */
function openExternal(url){
  try{
    const w = window.open("", "_blank");
    if (w) {
      try { w.opener = null; } catch {}
      const safe = String(url).replace(/"/g,"&quot;");
      w.document.write(`<!doctype html><meta charset="utf-8"><title>Opening…</title>
        <style>html,body{height:100%}body{display:grid;place-items:center;font:14px system-ui}</style>
        <p>Opening… If nothing happens <a href="${safe}">click here</a>.</p>
        <meta http-equiv="refresh" content="0; url='${safe}'">`);
      try { w.location.href = url; } catch {}
      return;
    }
  }catch{}
  location.assign(url);
}

/* ---------- text utils ---------- */
const ACRONYM = /\b([A-Z0-9]{2,})\b/g;
const LEAD_EMOJI = /^[\p{Emoji_Presentation}\p{Emoji}\uFE0F\u200D]+/u;
function titleCasePreserveAcronyms(s){
  const keep = {};
  s.replace(ACRONYM, (m)=> (keep[m.toLowerCase()] = m));
  const t = s.toLowerCase().replace(/\b([a-z])/g, m=>m.toUpperCase());
  return t.replace(/\b([a-z0-9]+)\b/gi, (m)=> keep[m.toLowerCase()] ?? m);
}
function normalizeTitle(raw){
  let t = (raw||"").replace(/\[ ?blueprint ?\]/i,"").replace(LEAD_EMOJI,"").trim();
  // allow parentheses but strip stray punctuation
  t = t.replace(/[^\w\s()\-:]/g, "");
  t = titleCasePreserveAcronyms(t).replace(/\s{2,}/g," ");
  return t;
}
function likeFmt(n){
  if (!n || n<0) return "0";
  if (n>=1_000_000) return `${(n/1_000_000).toFixed(1).replace(/\.0$/,"")}M`;
  if (n>=1_000)     return `${(n/1_000).toFixed(1).replace(/\.0$/,"")}k`;
  return String(n);
}

/* ---------- tag inference ---------- */
const TAG_LOOKUP = TAG_DEFS.reduce((m,[name,keys])=>{
  m[name] = keys.map(k=>k.toLowerCase());
  return m;
}, {});

function inferTagsFromText(text){
  const hay = (text||"").toLowerCase();
  const hit = new Set();
  for (const [name, keys] of Object.entries(TAG_LOOKUP)){
    if (name === "Other") continue;
    for (const k of keys){ if (hay.includes(k)) { hit.add(name); break; } }
  }
  if (!hit.size) hit.add("Other");
  return Array.from(hit);
}
function mergeTags(item){
  const base = Array.isArray(item.tags) ? [...item.tags] : [];
  const auto = inferTagsFromText(`${item.title} ${item.excerpt} ${base.join(" ")}`);
  const all = new Set([...base, ...auto]);
  item._tags = Array.from(all);
}

/* ---------- description cook/expand ---------- */
function setPostHTML(container, html){
  const tmp = document.createElement("div");
  tmp.innerHTML = html || "<em>Nothing to show.</em>";

  // make external import badges compact pills that open in new tab
  tmp.querySelectorAll('a[href*="my.home-assistant.io/redirect/blueprint_import"]').forEach(a=>{
    a.classList.add("myha-inline");
  });

  // Intercept open
  tmp.addEventListener("click", (ev)=>{
    const a = ev.target.closest('a[href^="http"]');
    if (!a) return;
    a.target = "_blank";
  });

  container.innerHTML = "";
  container.appendChild(tmp);
}

/* ---------- cache ---------- */
const detailCache = new Map();

/* ---------- render card ---------- */
function renderCard(it){
  mergeTags(it);

  const el = document.createElement("article");
  el.className = "card";

  const niceTitle = normalizeTitle(it.title);
  const likes = it.likes ?? it.like_count ?? it.favorites ?? 0;

  el.innerHTML = `
    <header class="card__head">
      <h3 class="card__title">${esc(niceTitle)}</h3>
      ${it.author ? `<span class="author">by ${esc(it.author)}</span>` : ""}
    </header>

    <div class="tags">${(it._tags||[]).slice(0,4).map(t=>`<span class="tag">${esc(t)}</span>`).join("")}</div>

    <div class="desc-wrap">
      <p class="desc">${esc(it.excerpt||"")}</p>
      <button class="readmore" type="button">Read more</button>
      <div class="more" hidden id="more-${it.id}"></div>
    </div>

    <footer class="card__foot">
      <div class="likepill" title="People who clicked ❤️ on the forum">
        <span class="icon-heart"></span>
        <span class="num">${likeFmt(likes)}</span>
        <span class="lbl">Liked This</span>
      </div>
      ${
        it.import_url
        ? `<a class="myha-btn" data-open="${esc(it.import_url)}">
             <span class="myha-icon"></span>
             Import to Home Assistant
           </a>`
        : `<button class="myha-btn neutral" type="button" data-toggle="1">View description</button>`
      }
    </footer>
  `;

  // open import (no target="_blank" blocking issues)
  el.addEventListener("click", (ev)=>{
    const opener = ev.target.closest("[data-open]");
    if (opener){ ev.preventDefault(); openExternal(opener.getAttribute("data-open")); }
  });

  // expand logic
  const descWrap = el.querySelector(".desc-wrap");
  const more     = el.querySelector(`#more-${it.id}`);
  const btn      = el.querySelector(".readmore");
  let expanded   = false;

  async function ensureLoaded(){
    if (detailCache.has(it.id)) return;
    const data = await fetchJSON(`${API}/topic?id=${it.id}`);
    detailCache.set(it.id, data.cooked || "");
  }
  async function expand(){
    if (expanded) return;
    expanded = true;
    btn.textContent = "Less";
    descWrap.classList.add("open");
    if (!detailCache.has(it.id)) {
      btn.disabled = true;
      try {
        await ensureLoaded();
      } finally {
        btn.disabled = false;
      }
    }
    setPostHTML(more, detailCache.get(it.id));
    more.hidden = false;
  }
  function collapse(){
    if (!expanded) return;
    expanded = false;
    btn.textContent = "Read more";
    descWrap.classList.remove("open");
    more.hidden = true;
  }

  btn.addEventListener("click", ()=> expanded ? collapse() : expand());
  // double-click anywhere on the card toggles
  el.addEventListener("dblclick", (e)=>{
    // ignore dblclicks on links/buttons inside footer to avoid accidental opens
    if (e.target.closest(".card__foot a,[data-open]")) return;
    expanded ? collapse() : expand();
  });

  return el;
}

/* ---------- creator spotlight ---------- */
function normalizeAuthor(a){ return (a||"").trim() || "Unknown"; }

function computeSpotlight(items){
  const out = {
    popular: null,       // highest likes
    mostUploaded: null,  // { author, count }
    recent: null         // newest by created
  };

  // popular
  out.popular = items.reduce((best, it)=>{
    const likes = it.likes ?? it.like_count ?? 0;
    return (!best || likes > (best.likes ?? 0)) ? it : best;
  }, null);

  // most uploaded (by author)
  const byAuthor = new Map();
  for (const it of items){
    const a = normalizeAuthor(it.author);
    byAuthor.set(a, (byAuthor.get(a)||0)+1);
  }
  let maxA=null, maxC=0;
  for (const [a,c] of byAuthor){ if (c>maxC){ maxC=c; maxA=a; } }
  out.mostUploaded = { author:maxA||"Unknown", count:maxC };

  // recent
  out.recent = items.slice().sort((a,b)=> (b.created_ts||0)-(a.created_ts||0))[0] || null;

  return out;
}
function renderSpotlight(sp){
  const root = $("#spot");
  if (!root) return;

  const slot = (title, author, body) => `
    <div class="contrib-card">
      <div class="contrib-head">${esc(title)}</div>
      <div class="contrib-sub">${esc(author||"")}</div>
      <div class="contrib-body">${body}</div>
    </div>`;

  const popBody = sp.popular
    ? `<div class="contrib-chip">${esc(normalizeTitle(sp.popular.title))}</div>`
    : `<em>—</em>`;
  const upBody = `<div class="contrib-chip">${sp.mostUploaded?.count||0} Blueprints</div>`;
  const recBody = sp.recent
    ? `<div class="contrib-chip">${esc(normalizeTitle(sp.recent.title))}</div>`
    : `<em>—</em>`;

  root.innerHTML = `
    ${slot("Most Popular Blueprint", sp.popular?.author||"—", popBody)}
    ${slot("Most Uploaded Blueprints", sp.mostUploaded?.author||"—", upBody)}
    ${slot("Most Recent Upload", sp.recent?.author||"—", recBody)}
  `;
}

/* ---------- list rendering ---------- */
function appendItems(target, items){
  const frag = document.createDocumentFragment();
  for (const it of items) frag.appendChild(renderCard(it));
  target.appendChild(frag);
}

/* ---------- search/sort/filter ---------- */
function tokenize(q){
  return (q||"").toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu," ")
    .split(/\s+/).filter(Boolean);
}
function scoreItem(it, tokens){
  if (!tokens.length) return 0;
  const hayTitle = (it.title||"").toLowerCase();
  const hayEx    = (it.excerpt||"").toLowerCase();
  const hayTags  = (it._tags||[]).join(" ").toLowerCase();
  let s = 0;
  for (const t of tokens){
    if (hayTitle.includes(t)) s += 3;
    if (hayEx.includes(t))    s += 2;
    if (hayTags.includes(t))  s += 2;
  }
  return s;
}
function applySort(items, mode, tokens){
  if (mode==="likes"){
    items.sort((a,b)=> (b.likes??b.like_count??0) - (a.likes??a.like_count??0));
  } else if (mode==="title"){
    items.sort((a,b)=> normalizeTitle(a.title).localeCompare(normalizeTitle(b.title)));
  } else {
    items.sort((a,b)=> (b.created_ts||0)-(a.created_ts||0));
  }
  // If tokens present, re-rank by score keeping sort as tie-breaker
  if (tokens.length){
    items.forEach(it => it._score = scoreItem(it, tokens));
    items.sort((a,b)=> (b._score - a._score) || items.indexOf(a)-items.indexOf(b));
  }
}

/* ---------- dynamic heading ---------- */
function setHeading(sort, tag, tokens){
  const h = $("#heading");
  if (!h) return;
  const base = sort==="likes" ? "Most liked blueprints"
             : sort==="title" ? "A–Z blueprints"
             : "Newest blueprints";
  const parts = [base];
  if (tag) parts.push(`• tag: “${tag}”`);
  if (tokens.length) parts.push(`• query: “${tokens.join(" ")}”`);
  h.textContent = parts.join(" ");
}

/* ---------- boot ---------- */
function boot(){
  const list   = $("#list");
  const empty  = $("#empty");
  const errorB = $("#error");
  const search = $("#search");
  const sortSel= $("#sort");
  const refreshBtn = $("#refresh");
  const tagdd  = $("#tagdd");
  const tagbtn = $("#tagbtn");
  const tagmenu= $("#tagmenu");

  if (!list) return;

  let page     = 0;
  let hasMore  = true;
  let loading  = false;
  let q        = "";
  let sort     = "likes"; // default Most liked
  let bucket   = "";

  const setError = (msg)=>{ if(errorB){ errorB.textContent = msg; errorB.style.display="block"; } };
  const clearError = ()=>{ if(errorB){ errorB.style.display="none"; errorB.textContent=""; } };

  async function fetchFilters(){
    try{
      const data = await fetchJSON(`${API}/filters`);
      const tags = Array.isArray(data.tags) ? data.tags : [];
      // Merge API tags with curated order
      const merged = Array.from(new Set(["All tags", ...TAG_ORDER.filter(n=>n!=="Other"), ...tags, "Other"]));

      tagmenu.innerHTML = "";
      const mk = (value,label)=>`<sl-menu-item value="${esc(value)}">${esc(label)}</sl-menu-item>`;
      tagmenu.insertAdjacentHTML("beforeend", mk("", "All tags"));
      merged.filter(t=>t!=="All tags").forEach(t=> tagmenu.insertAdjacentHTML("beforeend", mk(t,t)));

      tagmenu.addEventListener("sl-select", async (ev)=>{
        bucket = ev.detail.item.value || "";
        tagbtn.textContent = bucket || "All tags";
        await loadAll(true);
      }, { once:true }); // attach once; Shoelace re-fires internally
      // reattach on each open to be safe
      tagdd.addEventListener("sl-show", ()=>{
        // ensure the current selection is highlighted
        const current = tagmenu.querySelector(`[value="${bucket}"]`);
        if (current) current.setAttribute("checked","");
      });
    }catch(e){ /* optional */ }
  }

  function urlFor(p){
    const url = new URL(`${API}/blueprints`, location.origin);
    url.searchParams.set("page", String(p));
    url.searchParams.set("sort", sort);
    if (bucket) url.searchParams.set("bucket", bucket);
    // server search kept light; we do heavy client side ranking
    if (q) url.searchParams.set("q_title", q);
    return url.toString();
  }

  async function loadPage(p){
    const data = await fetchJSON(urlFor(p));
    const items = data.items || [];
    hasMore = !!data.has_more;
    return items;
  }

  async function loadAll(resetHeading=false){
    if (loading) return;
    loading = true; clearError();
    try{
      page = 0; hasMore = true;
      list.innerHTML = "";
      empty.style.display = "none";

      const spinner = $("#spot-spinner");
      if (spinner) spinner.hidden = false;

      // collect all pages
      const all = [];
      while (hasMore){
        const items = await loadPage(page);
        items.forEach(mergeTags);
        all.push(...items);
        page += 1;
        await sleep(10);
      }

      // client-search + sort
      const tokens = tokenize(q);
      const filtered = all.filter(it => {
        if (bucket && !(it._tags||[]).includes(bucket)) return false;
        if (!tokens.length) return true;
        return scoreItem(it, tokens) > 0;
      });

      applySort(filtered, sort, tokens);
      appendItems(list, filtered);

      empty.style.display = filtered.length ? "none" : "block";
      if (resetHeading) setHeading(sort, bucket, tokens);

      // spotlight
      const sp = computeSpotlight(all);
      renderSpotlight(sp);
      if (spinner) spinner.hidden = true;
    }catch(e){
      setError(`Failed to load: ${String(e.message||e)}`);
    }finally{
      loading = false;
    }
  }

  // events
  if (search){
    const onSearch = debounce(async ()=>{
      q = (search.value||"").trim();
      await loadAll(true);
    }, 250);
    search.addEventListener("sl-input", onSearch);
    search.addEventListener("sl-clear", onSearch);
  }
  if (sortSel){
    sortSel.addEventListener("sl-change", async ()=>{
      const v = sortSel.value;
      sort = v==="likes"||v==="title"||v==="new" ? v : "likes";
      await loadAll(true);
    });
  }
  if (refreshBtn){
    refreshBtn.addEventListener("click", async ()=>{ await loadAll(true); });
  }

  fetchFilters();
  setHeading(sort, bucket, []);
  loadAll(true);
}

document.addEventListener("DOMContentLoaded", boot);
