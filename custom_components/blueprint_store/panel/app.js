/* Blueprint Store – FIXES ONLY
 * - single expanding description with dark bg (dblclick to toggle)
 * - spotlight spinner + fills as soon as first page loads (no buttons)
 * - tags from title+excerpt as items stream in
 * - paced loading + resilient 429 backoff
 * - DO NOT change any other features
 */
const API = "/api/blueprint_store";
const $  = (s) => document.querySelector(s);

/* ---------- helpers ---------- */
function esc(s){ return (s||"").toString().replace(/[&<>"']/g,c=>({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c])); }
const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
const debounce = (fn,ms=280)=>{ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms); }; };
function likeFmt(n){
  if (n==null) return "0";
  const v = Number(n);
  if (v>=1_000_000) return `${(v/1_000_000).toFixed(1).replace(/\.0$/,"")}M`;
  if (v>=1_000) return `${(v/1_000).toFixed(1).replace(/\.0$/,"")}k`;
  return `${v}`;
}

/* ---- single fetch with strong 429/5xx backoff (and jitter) ---- */
async function fetchJSON(url, tries=6){
  let base = 700;
  for (let i=0; i<tries; i++){
    try{
      const res = await fetch(url, { cache:"no-store" });
      if (res.status===429) throw new Error("429");
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      if (data && data.error) throw new Error(data.error);
      return data;
    }catch(e){
      const msg = String(e.message||e);
      if (i<tries-1 && (/^5\d\d$/.test(msg) || msg==="429")){
        const jitter = Math.random()*220;
        await sleep(base + jitter);
        base = Math.min(base*1.8, 6500);
        continue;
      }
      throw e;
    }
  }
}

/* ---------- tag logic (title + excerpt; apply during stream) ---------- */
const TAG_DEFS = [
  ["Lighting", ["light","lights","illumination","led","bulb","strip","rgb","rgbw","rgbcw","cct","dimmer","brightness","fade","color","colour","hue","lifx","nanoleaf","govee","wiz","tradfri","yeelight","lamp","spotlight"]],
  ["Climate & Ventilation", ["temp","temperature","climate","hvac","thermostat","heating","cooling","ventilation","fan","radiator","humidifier","dehumidifier","aircon","ac","heater","boiler","split"]],
  ["Security & Alarm", ["alarm","armed","disarm","siren","intrusion","tamper","glassbreak","keypad","pin","panic","perimeter"]],
  ["Safety (Smoke/CO/Leak)", ["smoke","co","co2","monoxide","leak","water","gas","flood","moisture","detector"]],
  ["Presence & Occupancy", ["presence","occupancy","person","people","zone","proximity","geofence","arrival","depart"]],
  ["Access & Locks", ["lock","unlock","deadbolt","smart","keypad","garage","gate","opener","yale","schlage","kwikset","august","nuki"]],
  ["Cameras & Vision", ["camera","nvr","cctv","rtsp","onvif","doorbell","ptz","record","clip","detect","unifi","protect","ubiquiti","dahua","hikvision","reolink","wyze","arlo","ring","eufy","amcrest","blink","tapo","annke"]],
  ["Media & Entertainment", ["media","music","tv","video","speaker","sound","volume","playlist","cast","chromecast","airplay","sonos","spotify","plex","kodi","jellyfin"]],
  ["AI & Assistants", ["assistant","voice","tts","stt","wake","hotword","whisper","piper","rhasspy","wyoming","llm","ai","chatgpt","openai","groq"]],
  ["Announcements & Notifications", ["notification","announce","alert","message","notify","telegram","discord","pushover","ntfy","matrix","slack"]],
  ["Energy & Power", ["energy","power","kwh","solar","pv","inverter","battery","soc","grid","tariff","ev","charger","wallbox"]],
  ["Environment & Weather", ["weather","forecast","rain","wind","sun","uv","aqi","humidity","pressure","dew","pollen","cloud"]],
  ["Appliances & Utilities", ["appliance","washer","dryer","dishwasher","vacuum","robot","mop","oven","stove","microwave","kettle","coffee","fridge","freezer","purifier","heater","pump"]],
  ["Scheduling & Scenes", ["schedule","timer","delay","scene","script","sleep","night","morning","bedtime","quiet"]],
  ["System & Maintenance", ["system","maintenance","backup","restore","update","restart","watchdog","uptime","recorder","database","mqtt","zha","zigbee","zwave"]],
  ["Other", []]
];
const TAG_ORDER = TAG_DEFS.map(([n])=>n);

function pickBucket(it){
  const hay = `${(it.title||"")} ${(it.excerpt||"")}`.toLowerCase();
  let best = "Other", bestScore = 0;
  for (const [name, terms] of TAG_DEFS){
    if (!terms.length) continue;
    let score = 0;
    for (const t of terms) if (hay.includes(t)) score++;
    if (score > bestScore) { bestScore = score; best = name; }
  }
  return bestScore >= 3 ? best : "Other";
}

/* ---------- “open external” used elsewhere (unchanged behaviour) ---------- */
function openExternal(url){
  try{
    const w = window.open("", "_blank");
    if (w){
      try{ w.opener = null; }catch{}
      const safe = String(url).replace(/"/g,"&quot;");
      w.document.write(`<!doctype html><meta charset="utf-8">
        <title>Opening…</title>
        <style>body{font:14px system-ui;padding:2rem;color:#123}</style>
        <meta http-equiv="refresh" content="0; url='${safe}'">`);
      try{ w.location.href = url; }catch{}
      return true;
    }
  }catch{}
  try{ location.assign(url); }catch{}
  return false;
}

/* ---------- spotlight ---------- */
function renderSpotlight(container, stats){
  const { popular, uploaded, recent } = stats;
  container.innerHTML = `
    <div class="contrib-head">
      <div class="contrib-title">Creators Spotlight</div>
      <div class="contrib-sub">Shout-outs to makers moving the community forward.</div>
    </div>
    <div class="contrib-grid">
      <div class="contrib-card">
        <div class="contrib-card-title">Most Popular Blueprint</div>
        <div class="contrib-author">${esc(popular.author||"")}</div>
        <div class="contrib-desc">${esc(popular.title||"")}</div>
      </div>
      <div class="contrib-card">
        <div class="contrib-card-title">Most Uploaded Blueprints</div>
        <div class="contrib-author">${esc(uploaded.author||"")}</div>
        <div class="contrib-chip">${esc(uploaded.count||0)} Blueprints</div>
      </div>
      <div class="contrib-card">
        <div class="contrib-card-title">Most Recent Upload</div>
        <div class="contrib-author">${esc(recent.author||"")}</div>
        <div class="contrib-desc">${esc(recent.title||"")}</div>
      </div>
    </div>
  `;
}

function computeSpotlight(fromItems){
  if (!fromItems.length){
    return {
      popular:{author:"", title:""},
      uploaded:{author:"", count:0},
      recent:{author:"", title:""}
    };
  }
  // popular by likes
  const popular = [...fromItems].sort((a,b)=> (b.likes||0)-(a.likes||0))[0];

  // uploaded counts per author
  const map = new Map();
  for (const it of fromItems){
    const a = (it.author||"").trim();
    if (!a) continue;
    map.set(a, (map.get(a)||0)+1);
  }
  let upAuthor = "", upCount = 0;
  for (const [a,c] of map) if (c>upCount){ upAuthor=a; upCount=c; }

  // recent by first_seen / created_ts fallback to id
  const recent = [...fromItems].sort((a,b)=> {
    const av = a.created_ts || a.first_seen || a.id || 0;
    const bv = b.created_ts || b.first_seen || b.id || 0;
    return bv - av;
  })[0];

  return {
    popular: { author: popular?.author||"", title: popular?.title||"" },
    uploaded:{ author: upAuthor, count: upCount },
    recent:  { author: recent?.author||"", title: recent?.title||"" }
  };
}

/* ---------- card (single description with dark bg + dblclick) ---------- */
const detailCache = new Map();

function renderCard(it){
  const el = document.createElement("article");
  el.className = "card";
  const bucket = pickBucket(it);
  const likes = likeFmt(it.likes||0);

  el.innerHTML = `
    <div class="row">
      <h3>${esc(it.title)}</h3>
      ${it.author ? `<span class="author">by ${esc(it.author)}</span>` : ""}
      <span class="uses">${likes} <span class="heart" aria-hidden="true">♥</span> Liked This</span>
    </div>
    <div class="tags">${[bucket,...(it.tags||[]).slice(0,3)].map(t=>`<span class="tag">${esc(t)}</span>`).join("")}</div>

    <div class="desc-wrap" id="desc-${it.id}">
      <p class="desc-text">${esc(it.excerpt||"")}</p>
    </div>

    <div class="toggle" data-id="${it.id}">Read more</div>
    <div class="more" id="more-${it.id}"></div>

    <div class="card__footer">
      <a class="myha-btn" data-open="${esc(it.import_url)}"><sl-icon name="house"></sl-icon>Import to Home Assistant</a>
    </div>
  `;

  const wrap   = el.querySelector(`#desc-${it.id}`);
  const toggle = el.querySelector(".toggle");
  const more   = el.querySelector(`#more-${it.id}`);

  let expanded = false;

  async function expandNow(){
    if (expanded) return;
    expanded = true;
    wrap.classList.add("expanded");
    toggle.textContent = "Less";
    if (!detailCache.has(it.id)){
      try{
        const data = await fetchJSON(`${API}/topic?id=${it.id}`);
        detailCache.set(it.id, data.cooked || "");
      }catch(e){
        detailCache.set(it.id, `<em>Failed to load post: ${esc(String(e.message||e))}</em>`);
      }
    }
    setPostHTML(more, detailCache.get(it.id));
    more.style.display = "block";
  }

  function collapseNow(){
    expanded = false;
    wrap.classList.remove("expanded");
    toggle.textContent = "Read more";
    more.style.display = "none";
  }

  toggle.addEventListener("click", ()=> expanded ? collapseNow() : expandNow());
  el.addEventListener("dblclick", ()=> expanded ? collapseNow() : expandNow());

  // open buttons
  el.addEventListener("click",(ev)=>{
    const opener = ev.target.closest("[data-open]");
    if (!opener) return;
    ev.preventDefault();
    openExternal(opener.getAttribute("data-open"));
  });

  return el;
}

function setPostHTML(container, html){
  const tmp = document.createElement("div");
  tmp.innerHTML = html || "<em>Nothing to show.</em>";
  // inside-description links still open in new tab through our redirector
  tmp.querySelectorAll('a[href^="https://community.home-assistant.io/"]').forEach(a=>{
    a.setAttribute("target","_blank");
    a.setAttribute("rel","noopener");
  });
  container.innerHTML = "";
  container.appendChild(tmp);
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
  const sentinel = $("#sentinel");
  const spotlightBox = $("#spotlight");

  if (!list) return;

  // spotlight spinner immediately
  spotlightBox.innerHTML = `<div class="contrib-head">
    <div class="contrib-title">Creators Spotlight</div>
    <div class="contrib-sub">Shout-outs to makers moving the community forward.</div>
  </div><div class="spin"></div>`;

  let page = 0, loading = false, hasMore = true;
  let qTitle = "", sort = "likes"; // keep default “Most liked”
  let bucket = "";
  const streamItems = []; // for spotlight

  function setError(msg){ errorB.style.display="block"; errorB.textContent = msg; }
  function clearError(){ errorB.style.display="none"; errorB.textContent = ""; }

  /* filters (tags list) */
  (async ()=>{
    try{
      const data = await fetchJSON(`${API}/filters`);
      const tags = Array.isArray(data.tags) ? data.tags : [];
      tagmenu.innerHTML = `<sl-menu-item value="">All tags</sl-menu-item>` +
        tags.map(t=>`<sl-menu-item value="${esc(t)}">${esc(t)}</sl-menu-item>`).join("");
      tagmenu.addEventListener("sl-select", async (ev)=>{
        bucket = ev.detail.item.value||"";
        tagbtn.textContent = bucket || "All tags";
        await loadAllForSearch();
      });
    }catch{/* ignore */}
  })();

  async function fetchPage(p){
    const url = new URL(`${API}/blueprints`, location.origin);
    url.searchParams.set("page", String(p));
    if (qTitle) url.searchParams.set("q_title", qTitle);
    if (sort)   url.searchParams.set("sort", sort);
    if (bucket) url.searchParams.set("bucket", bucket);
    return await fetchJSON(url.toString());
  }

  function appendItems(target, items){
    for (const it of items){
      // stream tag bucket over title + excerpt
      it.bucket = pickBucket(it);
      target.appendChild(renderCard(it));
      streamItems.push(it);
    }
    // if spotlight not yet rendered from data, render from what we have
    if (spotlightBox && streamItems.length && !spotlightBox.dataset.ready){
      renderSpotlight(spotlightBox, computeSpotlight(streamItems));
      spotlightBox.dataset.ready = "1";
    }
  }

  async function load(initial=false){
    if (loading || (!hasMore && !initial)) return;
    loading = true; clearError();
    try{
      const data = await fetchPage(page);
      const items = data.items || [];
      hasMore = !!data.has_more;
      if (initial){
        list.innerHTML = "";
        empty.style.display = items.length ? "none":"block";
      }
      appendItems(list, items);
      page += 1;
      // pace pages to avoid 429 and to “creep load”
      await sleep(900);
    }catch(e){
      setError(`Failed to load: ${String(e.message||e)}`);
    }finally{
      loading = false;
    }
  }

  async function loadAllForSearch(){
    page = 0; hasMore = true; list.innerHTML = ""; clearError();
    await load(true);
  }

  // search (title+desc already handled server-side by q_title; keep input UX)
  if (search){
    const onSearch = debounce(async ()=>{
      qTitle = (search.value||"").trim();
      await loadAllForSearch();
    }, 300);
    search.addEventListener("sl-input", onSearch);
    search.addEventListener("sl-clear", onSearch);
  }

  // sort select
  if (sortSel){
    sortSel.addEventListener("sl-change", async ()=>{
      sort = sortSel.value || "likes";
      await loadAllForSearch();
    });
  }

  if (refreshBtn){
    refreshBtn.addEventListener("click", async ()=>{ await loadAllForSearch(); });
  }

  if (sentinel){
    const io = new IntersectionObserver((entries)=>{
      if (entries[0] && entries[0].isIntersecting) load(false);
    },{ rootMargin:"900px" });
    io.observe(sentinel);
  }

  load(true);
}

document.addEventListener("DOMContentLoaded", boot);
