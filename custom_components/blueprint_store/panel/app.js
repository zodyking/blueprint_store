/* Blueprint Store — UI glue (minimal, focused changes)
 * - Single dark description area that expands/collapses (no separate "more" section)
 * - Expanded TAG_DEFS (one-word keywords), tag applied only if >=3 hits; default "Other"
 * - Search/sort/filter, spotlight, double-click toggle preserved
 */
const API = "/api/blueprint_store";
const $  = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

/* ---------- helpers ---------- */
const esc = (s => (s ?? "").toString().replace(/[&<>"']/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c])));
const sleep = (ms=200) => new Promise(r=>setTimeout(r,ms));
const debounce = (fn, ms=250) => { let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; };
async function fetchJSONRaw(url){ const r=await fetch(url); if(!r.ok) throw new Error(`${r.status} ${r.statusText}`); const d=await r.json(); if(d&&d.error) throw new Error(d.error); return d; }
async function fetchJSON(url, tries=3){ let d=500; for(let i=0;i<tries;i++){ try{ return await fetchJSONRaw(url);}catch(e){ if(i<tries-1 && /429|timeout|network/i.test(String(e))){ await sleep(d+Math.random()*250); d=Math.min(4000,d*2); continue;} throw e; } } }
function openExternal(url){
  try{ const w=window.open("","_blank"); if(w){ try{w.opener=null;}catch{} const safe=String(url).replace(/"/g,"&quot;");
    w.document.write(`<!doctype html><meta charset="utf-8"><title>Opening…</title>
      <style>html,body{height:100%}body{display:grid;place-items:center;font:14px system-ui}</style>
      <p>Opening… If nothing happens <a href="${safe}">click here</a>.</p>
      <meta http-equiv="refresh" content="0; url='${safe}'">`);
    try{ w.location.href=url; }catch{} return; } }catch{} location.assign(url);
}

/* ---------- title utilities ---------- */
const ACRONYM = /\b([A-Z0-9]{2,})\b/g;
const LEAD_EMOJI = /^[\p{Emoji_Presentation}\p{Emoji}\uFE0F\u200D]+/u;
function titleCasePreserveAcronyms(s){
  const keep={}; s.replace(ACRONYM,(m)=>keep[m.toLowerCase()]=m);
  const t=s.toLowerCase().replace(/\b([a-z])/g,m=>m.toUpperCase());
  return t.replace(/\b([a-z0-9]+)\b/gi,(m)=>keep[m.toLowerCase()]??m);
}
function normalizeTitle(raw){
  let t=(raw||"").replace(/\[ ?blueprint ?\]/i,"").replace(LEAD_EMOJI,"").trim();
  t=t.replace(/[^\w\s()\-:]/g,""); t=titleCasePreserveAcronyms(t).replace(/\s{2,}/g," ");
  return t;
}
function likeFmt(n){ if(!n||n<0) return "0"; if(n>=1_000_000) return `${(n/1_000_000).toFixed(1).replace(/\.0$/,"")}M`; if(n>=1_000) return `${(n/1_000).toFixed(1).replace(/\.0$/,"")}k`; return String(n); }

/* ---------- curated tags (expanded, one-word) ---------- */
const TAG_DEFS = [
  ["Lighting", ["light","lights","illumination","led","bulb","strip","rgb","rgbw","rgbcw","cct","dimmer","brightness","fade","color","colour","hue","lifx","nanoleaf","govee","wiz","tradfri","philips","yeelight","scene","motionlight","nightlight","ambilight","backlight","downlight","spotlight","floodlight","neon","daylight","warmwhite","coolwhite","sconce","chandelier","filament","torch","lamp","wallwash","pendant","recessed","ceiling","tablelamp","floorlamp","controller","poweron","transition","strobe","blink"]],
  ["Climate & Ventilation", ["temp","temperature","thermostat","heating","cooling","hvac","ventilation","fan","radiator","heatpump","humidifier","dehumidifier","aircon","ac","ecobee","nest","tado","honeywell","daikin","mitsubishi","bosch","trane","furnace","airhandler","vrf","minisplit","heater","boiler","thermo","vents","airflow","blower","duct","climate","setpoint","coolsetpoint","heatsetpoint","compressor","defrost","humidity","ventfan","exhaust","circulation","thermometer","comfort","eco","awaytemp","hold","mode"]],
  ["Security & Alarm", ["alarm","alarmo","armed","disarm","siren","intrusion","tamper","glassbreak","doorcontact","windowcontact","keypad","pincode","panic","perimeter","pir","reed","zonebypass","arming","triggered","burglar","entrydelay","exitdelay","security","partition","motion","sensor","lockout","monitoring","central","armedhome","armedaway","armnight","stay","away","chime","bypass","alert","duress","code","hush","notify","watch","guard","patrol","perimeterzone"]],
  ["Safety (Smoke/CO/Leak)", ["smoke","co","co2","monoxide","leak","waterleak","gasleak","flood","moisture","detector","nestprotect","kidde","firstalert","sirene","testalarm","lowbattery","safety","fire","heat","overheat","hazard","valve","shutoff","watershutoff","drip","overflow","pressure","propane","methane","lpg","extinguisher","sprinkler","o2sensor","nox","panic","evac","evacuation","alarmbell","hazmat","soak","dryrun","sump","float","spill","containment","reset","ack"]],
  ["Presence & Occupancy", ["presence","occupancy","person","people","zone","proximity","geofence","ibeacon","bluetooth","ble","wifipresence","devicetracker","gps","roomassistant","espresense","arrival","depart","enter","leave","home","away","work","school","guest","visitor","occupied","unoccupied","autoaway","autodetect","tracker","localization","seen","nothome","residence","household","roommate","presencehold","presencezone","presenceprob","presenceflag","lastseen","present","absent","visitorflag"]],
  ["Access & Locks", ["lock","unlock","doorlock","deadbolt","smartlock","code","pin","rfid","nfc","keypad","garagedoor","gate","opener","yale","schlage","kwikset","august","nuki","danalock","bolt","latch","autolock","autounlock","doorsensor","strike","intercom","access","entry","buzzer","fob","mortise","handle","latchbolt","card","keyless","passcode","keycode","doorbell","garage","rollup","shutter","barrier","controller","relay","maglock","turnstile","knox","doorstate"]],
  ["Cameras & Vision", ["camera","nvr","cctv","rtsp","onvif","snapshot","image","doorbell","ipc","ptz","frigate","scrypted","motioneye","blueiris","zoneminder","recording","clip","detect","detection","person","face","lpr","plate","stream","ffmpeg","substream","unifi","protect","ubiquiti","dahua","hikvision","reolink","wyze","arlo","ring","eufy","amcrest","blink","tplink","tapo","annke","ivs","timeline","smartdetection","event","cam","preview","thumbnail","streaming"]],
  ["Media & Entertainment", ["media","music","tv","video","speaker","sound","volume","playlist","radio","cast","chromecast","airplay","dlna","sonos","spotify","plex","kodi","jellyfin","emby","appletv","androidtv","firetv","avr","denon","marantz","yamaha","soundbar","tunein","mpd","homepod","netflix","disneyplus","primevideo","hulu","hbomax","tidal","deezer","podcast","mediaplayer","nowplaying","queue","shuffle","repeat","subtitle","track","episode","channel","input"]],
  ["AI & Assistants", ["assistant","voice","tts","stt","wakeword","hotword","whisper","fasterwhisper","piper","coqui","azuretts","googletts","rasa","rhasspy","wyoming","openwakeword","porcupine","snowboy","llm","ai","chatgpt","openai","groq","llama","mistral","gpt","claude","intent","conversation","pipeline","microphone","nlu","asr","diarization","reply","summarizer","prompt","agent","skill","intentmap","slot","transcript","speakerid","respond","assistantpipe"]],
  ["Announcements & Notifications", ["notification","announce","announcement","alert","message","notify","push","email","smtp","sms","twilio","mobileapp","html5","pushover","pushbullet","pushcut","telegram","discord","matrix","slack","gotify","ntfy","webhook","call","ringtone","ttsnotify","richtext","priority","ratelimit","digest","reminder","bulletin","toast","banner","chime","ping","beep","vibrate","badge","inbox","outbox","notifygroup","channel"]],
  ["Energy & Power", ["energy","power","kwh","consumption","production","solar","pv","panel","inverter","battery","soc","grid","tariff","peak","offpeak","smartplug","meter","shelly","sonoff","ctclamp","victron","fronius","growatt","solis","goodwe","tesla","powerwall","charger","ev","wallbox","zappi","influx","efficiency","voltage","current","watt","wattage","amp","amps","frequency","phase","load","demand","export","import","net"]],
  ["Environment & Weather", ["weather","forecast","rain","wind","sun","uv","aqi","airquality","humidity","pressure","barometer","dewpoint","temperature","lightning","pollen","cloud","visibility","storm","openweather","metno","pirateweather","accuweather","season","sunrise","sunset","moon","environment","outdoor","sensor","index","snowfall","hail","thunder","gale","drought","fog","mist","breeze","gust","front","radar","satellite","shield","shade"]],
  ["Appliances & Utilities", ["appliance","washer","washingmachine","dryer","dishwasher","vacuum","robotvacuum","roborock","dreame","deebot","mop","kitchen","oven","stove","range","microwave","kettle","coffee","coffeemaker","espresso","fridge","refrigerator","freezer","humidifier","dehumidifier","airpurifier","fan","heater","waterheater","pump","boiler","sprinkler","irrigation","lawn","mower","iron","toaster","blender","cooktop","hood","disposal","ice","filter","purifier","scale"]],
  ["Scheduling & Scenes", ["schedule","timer","delay","cooldown","interval","calendar","holiday","weekday","weekend","sunset","sunrise","goldenhour","offset","mode","scene","script","sleep","night","morning","bedtime","quiethours","dnd","repeat","cron","window","period","duration","timespan","timeslot","slot","snooze","recurrence","cycle","routine","profile","scheduleon","scheduleoff","weekdayonly","weekendonly","timesync","tempo"]],
  ["System & Maintenance", ["system","maintenance","backup","restore","snapshot","supervisor","addon","hassio","update","upgrade","restart","reboot","watchdog","ping","uptime","health","recorder","database","purge","logbook","template","mqtt","zha","zigbee","zwave","integration","device","entity","automation","debug","diagnostics","logger","trace","state","event","webhook","token","auth","infra","server","docker","container","host","memory"]]
];
const TAG_ORDER = TAG_DEFS.map(([n])=>n);

function escapeRe(s){ return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/* Tag inference: require >=3 keyword hits per tag */
function inferTagsFromText(text){
  const hay=(text||"").toLowerCase();
  const hits=new Set();
  for (const [name, keys] of TAG_DEFS){
    if (name==="Other") continue;
    let count=0;
    for (const k of keys){
      const re=new RegExp(`\\b${escapeRe(k)}\\b`,"i");
      if (re.test(hay)) { count++; if (count>=3){ hits.add(name); break; } }
    }
  }
  if (!hits.size) hits.add("Other");
  return Array.from(hits);
}
function mergeTags(item){
  const base = Array.isArray(item.tags) ? [...item.tags] : [];
  const auto = inferTagsFromText(`${item.title} ${item.excerpt} ${(base||[]).join(" ")}`);
  const all = new Set([...base, ...auto]);
  item._tags = Array.from(all);
}

/* ---------- set HTML into a container ---------- */
function setPostHTML(container, html){
  const tmp=document.createElement("div");
  tmp.innerHTML = html || "<em>Nothing to show.</em>";
  // open external links in new tab safely
  tmp.addEventListener("click", (ev)=>{
    const a=ev.target.closest('a[href^="http"]'); if(!a) return; a.target="_blank";
  });
  container.innerHTML=""; container.appendChild(tmp);
}

/* ---------- cache ---------- */
const detailCache=new Map();

/* ---------- render a card (single expanding desc) ---------- */
function renderCard(it){
  mergeTags(it);

  const el = document.createElement("article");
  el.className = "card";

  const niceTitle = normalizeTitle(it.title);
  const likes = it.likes ?? it.like_count ?? it.favorites ?? 0;
  const excerptText = it.excerpt || "";

  el.innerHTML = `
    <header class="card__head">
      <h3 class="card__title">${esc(niceTitle)}</h3>
      ${it.author ? `<span class="author">by ${esc(it.author)}</span>` : ""}
    </header>

    <div class="tags">${(it._tags||[]).slice(0,4).map(t=>`<span class="tag">${esc(t)}</span>`).join("")}</div>

    <div class="desc-wrap">
      <div class="desc" id="desc-${it.id}">${esc(excerptText)}</div>
      <button class="readmore" type="button">Read more</button>
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

  // Import button
  el.addEventListener("click",(ev)=>{
    const a=ev.target.closest("[data-open]"); if(!a) return; ev.preventDefault(); openExternal(a.getAttribute("data-open"));
  });

  // expand/collapse logic using single .desc
  const wrap = el.querySelector(".desc-wrap");
  const desc = el.querySelector(`#desc-${it.id}`);
  const btn  = el.querySelector(".readmore");
  let expanded=false;

  async function loadCooked(){
    if (detailCache.has(it.id)) return detailCache.get(it.id);
    const data = await fetchJSON(`${API}/topic?id=${it.id}`);
    const cooked = data.cooked || "";
    detailCache.set(it.id, cooked);
    return cooked;
  }
  async function expand(){
    if (expanded) return;
    expanded=true; wrap.classList.add("open"); btn.textContent="Less";
    // replace content with cooked
    btn.disabled=true;
    try{
      const cooked = await loadCooked();
      setPostHTML(desc, cooked);
    }finally{ btn.disabled=false; }
  }
  function collapse(){
    if (!expanded) return;
    expanded=false; wrap.classList.remove("open"); btn.textContent="Read more";
    desc.innerHTML = esc(excerptText);
  }

  btn.addEventListener("click", ()=> expanded ? collapse() : expand());
  el.addEventListener("dblclick", (e)=>{
    if (e.target.closest(".card__foot a,[data-open]")) return;
    expanded ? collapse() : expand();
  });

  return el;
}

/* ---------- spotlight ---------- */
function normalizeAuthor(a){ return (a||"").trim() || "Unknown"; }
function computeSpotlight(items){
  const out={ popular:null, mostUploaded:null, recent:null };
  out.popular = items.reduce((b,it)=> (!b || (it.likes??0)>(b.likes??0)) ? it : b, null);
  const map=new Map(); for(const it of items){ const a=normalizeAuthor(it.author); map.set(a,(map.get(a)||0)+1); }
  let maxA=null,maxC=0; for(const [a,c] of map){ if(c>maxC){maxC=c;maxA=a;} }
  out.mostUploaded={ author:maxA||"Unknown", count:maxC };
  out.recent = items.slice().sort((a,b)=>(b.created_ts||0)-(a.created_ts||0))[0]||null;
  return out;
}
function renderSpotlight(sp){
  const root=$("#spot"); if(!root) return;
  const slot=(t,a,b)=>`
    <div class="contrib-card">
      <div class="contrib-head">${esc(t)}</div>
      <div class="contrib-sub">${esc(a||"")}</div>
      <div class="contrib-body"><div class="contrib-chip">${b}</div></div>
    </div>`;
  const popBody = sp.popular ? esc(normalizeTitle(sp.popular.title)) : "—";
  const upBody  = `${sp.mostUploaded?.count||0} Blueprints`;
  const recBody = sp.recent ? esc(normalizeTitle(sp.recent.title)) : "—";
  root.innerHTML = `
    ${slot("Most Popular Blueprint", sp.popular?.author||"—", popBody)}
    ${slot("Most Uploaded Blueprints", sp.mostUploaded?.author||"—", upBody)}
    ${slot("Most Recent Upload", sp.recent?.author||"—", recBody)}
  `;
}

/* ---------- list + search/sort/filter ---------- */
function tokenize(q){ return (q||"").toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu," ").split(/\s+/).filter(Boolean); }
function scoreItem(it,toks){
  if(!toks.length) return 0;
  const t=(it.title||"").toLowerCase(), e=(it.excerpt||"").toLowerCase(), g=(it._tags||[]).join(" ").toLowerCase();
  let s=0; for(const w of toks){ if(t.includes(w)) s+=3; if(e.includes(w)) s+=2; if(g.includes(w)) s+=2; } return s;
}
function applySort(items, mode, toks){
  if(mode==="likes"){ items.sort((a,b)=>(b.likes??0)-(a.likes??0)); }
  else if(mode==="title"){ items.sort((a,b)=> normalizeTitle(a.title).localeCompare(normalizeTitle(b.title))); }
  else{ items.sort((a,b)=>(b.created_ts||0)-(a.created_ts||0)); }
  if(toks.length){ items.forEach(it=>it._score=scoreItem(it,toks)); items.sort((a,b)=> (b._score - a._score)); }
}
function setHeading(sort, tag, toks){
  const h=$("#heading"); if(!h) return;
  const base = sort==="likes"?"Most liked blueprints": sort==="title"?"A–Z blueprints":"Newest blueprints";
  const parts=[base]; if(tag) parts.push(`• tag: “${tag}”`); if(toks.length) parts.push(`• query: “${toks.join(" ")}”`);
  h.textContent = parts.join(" ");
}

/* ---------- boot ---------- */
function boot(){
  const list=$("#list"), empty=$("#empty"), errorB=$("#error"), search=$("#search"), sortSel=$("#sort"), refreshBtn=$("#refresh"),
        tagdd=$("#tagdd"), tagbtn=$("#tagbtn"), tagmenu=$("#tagmenu");
  if(!list) return;

  let page=0, hasMore=true, loading=false, q="", sort="likes", bucket="";

  const setError=(m)=>{ if(errorB){ errorB.textContent=m; errorB.style.display="block"; } };
  const clearError=()=>{ if(errorB){ errorB.style.display="none"; errorB.textContent=""; } };

  async function fetchFilters(){
    try{
      const data=await fetchJSON(`${API}/filters`);
      const apiTags=Array.isArray(data.tags)?data.tags:[];
      const merged=Array.from(new Set(["All tags", ...TAG_ORDER.filter(n=>"Other"!==n), ...apiTags, "Other"]));
      tagmenu.innerHTML="";
      const mk=(v,l)=>`<sl-menu-item value="${esc(v)}">${esc(l)}</sl-menu-item>`;
      tagmenu.insertAdjacentHTML("beforeend", mk("", "All tags"));
      merged.filter(t=>"All tags"!==t).forEach(t=> tagmenu.insertAdjacentHTML("beforeend", mk(t,t)));
      tagmenu.addEventListener("sl-select", async(ev)=>{ bucket=ev.detail.item.value||""; tagbtn.textContent=bucket||"All tags"; await loadAll(true); }, { once:true });
      tagdd.addEventListener("sl-show", ()=>{ const cur=tagmenu.querySelector(`[value="${bucket}"]`); if(cur) cur.setAttribute("checked",""); });
    }catch{}
  }
  function urlFor(p){ const u=new URL(`${API}/blueprints`, location.origin); u.searchParams.set("page",String(p)); u.searchParams.set("sort",sort); if(bucket) u.searchParams.set("bucket",bucket); if(q) u.searchParams.set("q_title",q); return u.toString(); }
  async function loadPage(p){ const d=await fetchJSON(urlFor(p)); hasMore=!!d.has_more; return d.items||[]; }

  async function loadAll(resetHead=false){
    if(loading) return; loading=true; clearError();
    try{
      page=0; hasMore=true; list.innerHTML=""; empty.style.display="none";
      const spinner=$("#spot-spinner"); if(spinner) spinner.hidden=false;

      const all=[];
      while(hasMore){ const items=await loadPage(page); items.forEach(mergeTags); all.push(...items); page+=1; await sleep(10); }

      const toks=tokenize(q);
      const filtered=all.filter(it=>{ if(bucket && !(it._tags||[]).includes(bucket)) return false; return !toks.length || scoreItem(it,toks)>0; });
      applySort(filtered, sort, toks);
      const frag=document.createDocumentFragment(); for(const it of filtered) frag.appendChild(renderCard(it)); list.appendChild(frag);
      empty.style.display = filtered.length ? "none" : "block";
      if(resetHead) setHeading(sort, bucket, toks);

      const sp=computeSpotlight(all); renderSpotlight(sp); if(spinner) spinner.hidden=true;
    }catch(e){ setError(`Failed to load: ${String(e.message||e)}`);} finally{ loading=false; }
  }

  if(search){ const onSearch=debounce(async()=>{ q=(search.value||"").trim(); await loadAll(true); },250); search.addEventListener("sl-input",onSearch); search.addEventListener("sl-clear",onSearch); }
  if(sortSel){ sortSel.addEventListener("sl-change", async()=>{ const v=sortSel.value; sort=(v==="likes"||v==="title"||v==="new")?v:"likes"; await loadAll(true); }); }
  if(refreshBtn){ refreshBtn.addEventListener("click", async()=>{ await loadAll(true); }); }

  fetchFilters(); setHeading(sort,bucket,[]); loadAll(true);
}
document.addEventListener("DOMContentLoaded", boot);
