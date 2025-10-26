/* Blueprint Store — fixes: smaller footer, single desc box, direct-import (no double open),
   restore sort/tags/search, title parsing, read-more left + import right, creator count label. */

const API = "/api/blueprint_store";
const $  = (s, d=document) => d.querySelector(s);

/* ---------------- helpers ---------------- */
function esc(s){ return (s||"").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
const wait = ms => new Promise(r=>setTimeout(r, ms));
const debounce = (fn,ms=220)=>{ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms); }; };

async function fetchJSON(url, tries=3){
  let backoff = 500;
  for(let i=0;i<tries;i++){
    try{
      const r = await fetch(url, {cache: "no-store"});
      if(!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      const j = await r.json();
      if (j && j.error) throw new Error(j.error);
      return j;
    }catch(e){
      if (String(e.message||e).startsWith("429") && i < tries-1){
        await wait(backoff); backoff = Math.min(backoff*2, 4000);
        continue;
      }
      throw e;
    }
  }
}

/* open directly (no interstitial) — and only once */
function openDirectOnce(ev, url){
  if (ev){ ev.preventDefault(); ev.stopPropagation(); }
  try{
    const w = window.open(url, "_blank", "noopener,noreferrer");
    if (!w) location.assign(url);
  }catch{ location.assign(url); }
}

/* remove “image1234x456 …” attachment links, rewrite forum links to API redirect */
function sanitizeCookedHTML(html){
  const tmp = document.createElement("div");
  tmp.innerHTML = html || "";

  // drop attachment links that show as "image1536x1024 …"
  tmp.querySelectorAll('a').forEach(a=>{
    const t = (a.textContent||"").trim();
    if (/^image\d+x\d+\b/i.test(t)) a.remove();
  });

  // rewrite community links via redirect (leave my.home-assistant.io links intact)
  tmp.querySelectorAll('a[href^="https://community.home-assistant.io/"]').forEach(a=>{
    try{
      const u = new URL(a.href);
      const parts = u.pathname.split("/").filter(Boolean);
      const idx = parts.indexOf("t");
      if (idx !== -1){
        let slug = "", id = "";
        if (parts[idx+1] && /^\d+$/.test(parts[idx+1])) id = parts[idx+1];
        else { slug = parts[idx+1]||""; id = (parts[idx+2]||"").replace(/\D+/g,""); }
        if (id){
          const qs = new URLSearchParams({ tid:id, slug }).toString();
          a.setAttribute("href", `${API}/go?${qs}`);
          a.target = "_blank";
          a.rel = "noopener";
        }
      }
    }catch{}
  });

  return tmp.innerHTML;
}

/* title parsing (clean + title-case with acronyms kept) */
const ACRONYMS = new Set(["ZHA","Z2M","MQTT","API","RGB","RGBW","AI","TTS","STT","LLM","HVAC","UV","TV","UPS"]);
function cleanTitle(raw){
  if (!raw) return "";
  let t = raw;

  // remove [Blueprint] tokens
  t = t.replace(/\[?\s*blue\s*print\s*]?/ig, "");

  // strip leading emojis/symbols until letter/number/(
  t = t.replace(/^[^\p{L}\p{N}(]+/u, "");

  // drop most specials except () - _ : and spaces
  t = t.replace(/[^\p{L}\p{N}\s()\-_:]/gu, "");

  // collapse whitespace/dashes
  t = t.replace(/\s{2,}/g, " ").replace(/\s-\s/g, " - ").trim();

  // Title Case while keeping acronyms & already-all-caps
  t = t.split(" ").map(w=>{
    if (ACRONYMS.has(w.toUpperCase())) return w.toUpperCase();
    if (/^[A-Z0-9]{3,}$/.test(w)) return w; // keep existing caps like "HAOS"
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  }).join(" ");

  return t;
}

/* format likes */
function formatLikes(n){
  if (n >= 1_000_000) return `${(n/1_000_000).toFixed(1).replace(/\.0$/,"")}m`;
  if (n >= 1_000)     return `${(n/1_000).toFixed(1).replace(/\.0$/,"")}k`;
  return String(n);
}

/* expanded/cached cooked */
const expandedMap = new Map();   // postId -> boolean
const cookedCache = new Map();   // postId -> sanitized cooked HTML

/* ---------------- creators footer ---------------- */
function footerSpin(show=true){
  const s = $("#creators-spin");
  if (s) s.style.opacity = show ? "1" : "0";
}
function renderCreatorsFooter(stats){
  const root = $("#creators-footer");
  if (!root) return;
  root.innerHTML = `
    <div class="contrib-grid">
      <section class="contrib-card">
        <div class="contrib-head">Most Popular Blueprint</div>
        <div class="author">${esc(stats.popular.author || "-")}</div>
        <div class="desc">${esc(stats.popular.title || "-")}</div>
      </section>
      <section class="contrib-card">
        <div class="contrib-head">Most Uploaded Blueprints</div>
        <div class="author">${esc(stats.uploader.name || "-")}</div>
        <div class="desc"><span class="count-chip">${(stats.uploader.count ?? 0)} Blueprints</span></div>
      </section>
      <section class="contrib-card">
        <div class="contrib-head">Most Recent Upload</div>
        <div class="author">${esc(stats.recent.author || "-")}</div>
        <div class="desc">${esc(stats.recent.title || "-")}</div>
      </section>
    </div>`;
}
function computeCreatorStats(items){
  const byAuthor = new Map();
  let mostLiked = null, mostRecent = null;

  for (const it of items){
    const a = it.author || "—";
    byAuthor.set(a, (byAuthor.get(a)||0) + 1);

    if (!mostLiked || (it.likes || 0) > (mostLiked.likes || 0)) mostLiked = it;
    if (!mostRecent || (new Date(it.created_at||it.updated_at||0) > new Date(mostRecent.created_at||mostRecent.updated_at||0)))
      mostRecent = it;
  }
  let uploader = {name:"—", count:0};
  for (const [name,count] of byAuthor) if (count > uploader.count) uploader = {name,count};

  return {
    popular: { title: mostLiked?.title, author: mostLiked?.author },
    uploader,
    recent:  { title: mostRecent?.title, author: mostRecent?.author }
  };
}

/* ---------------- card rendering ---------------- */
function tagPills(tags){
  const set = [];
  (tags||[]).forEach(t => { const v=(t||"").toString().trim(); if(v && !set.includes(v)) set.push(v); });
  if (!set.length) return "";
  return `<div class="tags">${set.slice(0,6).map(t=>`<span class="tag">${esc(t)}</span>`).join("")}</div>`;
}

async function toggleDesc(id, it, card, forceOpen=false){
  const box = card.querySelector(`#desc-${id}`);
  const nowExpanded = forceOpen ? true : !expandedMap.get(id);

  if (nowExpanded){
    if (!cookedCache.has(id)){
      try{
        const data = await fetchJSON(`${API}/topic?id=${id}`);
        const cooked = sanitizeCookedHTML(data.cooked || "");
        cookedCache.set(id, cooked);
      }catch(e){
        cookedCache.set(id, `<em>Failed to load: ${esc(String(e.message||e))}</em>`);
      }
    }
    box.innerHTML = cookedCache.get(id);
    box.classList.add("open");
  } else {
    box.textContent = it.excerpt || "";
    box.classList.remove("open");
  }
  expandedMap.set(id, nowExpanded);
}

function makeCard(it){
  const el = document.createElement("article");
  el.className = "card";
  el.dataset.id = it.id;

  const liked = it.likes ?? 0;
  const showGreyImport = (it.import_count || 0) > 1;

  el.innerHTML = `
    <h3 class="title">${esc(cleanTitle(it.title))}</h3>
    ${it.author ? `<div class="meta">by ${esc(it.author)} <span class="pill likes">${esc(formatLikes(liked))} <b>Liked This</b></span></div>` : ""}
    ${tagPills([...(it.tags||[])])}
    <div class="desc-box" id="desc-${it.id}">${esc(it.excerpt || "No description")}</div>
    <div class="row-actions">
      <button class="readmore" data-read="${it.id}" type="button">Read more</button>
      ${showGreyImport
        ? `<button class="cta gray" data-open="desc:${it.id}">Read description</button>`
        : `<button class="cta" data-import="${esc(it.import_url||"")}">Import to Home Assistant</button>`
      }
    </div>
  `;

  // double-click toggles description (don’t trigger if clicking inside links)
  el.addEventListener("dblclick", async (ev)=>{
    if (ev.target.closest("a")) return;
    await toggleDesc(it.id, it, el);
  });

  // explicit read more
  el.querySelector('[data-read]')?.addEventListener("click", async (ev)=>{
    ev.preventDefault(); ev.stopPropagation();
    await toggleDesc(it.id, it, el);
  });

  // import (single open only)
  el.querySelector('[data-import]')?.addEventListener("click", (ev)=>{
    const url = ev.currentTarget.getAttribute("data-import");
    if (url) openDirectOnce(ev, url);
  });

  // when multiple imports -> open description instead
  el.querySelector('[data-open^="desc:"]')?.addEventListener("click", async (ev)=>{
    ev.preventDefault(); ev.stopPropagation();
    await toggleDesc(it.id, it, el, true);
  });

  return el;
}

/* ---------------- paging & boot ---------------- */
async function boot(){
  const list      = $("#list");
  const sentinel  = $("#sentinel");
  const errorBox  = $("#error");
  const empty     = $("#empty");
  const sortSel   = $("#sort");
  const searchIn  = $("#search");
  const tagMenu   = $("#tagmenu");
  const tagBtn    = $("#tagbtn");

  if (!list) return;

  let page = 0, hasMore = true, loading = false;
  let sort = "likes";          // "likes" | "new" | "title"
  let q = "";
  let bucket = "";

  // dynamic heading text
  const headingEl = $("#heading");
  function setHeading(){
    let title = (sort === "likes") ? "Most liked blueprints"
              : (sort === "title") ? "Title A–Z"
              : "Newest blueprints";
    const parts = [];
    if (q) parts.push(`query: “${q}”`);
    if (bucket) parts.push(bucket);
    headingEl.textContent = parts.length ? `${title} • ${parts.join(" · ")}` : title;
  }

  async function fetchPage(p){
    const url = new URL(`${API}/blueprints`, location.origin);
    url.searchParams.set("page", String(p));
    if (q){ url.searchParams.set("q", q); url.searchParams.set("q_title", q); } // support both keys
    if (sort)   url.searchParams.set("sort", sort);
    if (bucket) url.searchParams.set("bucket", bucket);
    return await fetchJSON(url.toString());
  }

  async function load(initial=false){
    if (loading || (!hasMore && !initial)) return;
    loading = true; errorBox.style.display="none";

    try{
      const data = await fetchPage(page);
      const items = data.items || [];
      hasMore = !!data.has_more;

      if (initial){
        list.innerHTML = "";
        empty.style.display = items.length ? "none":"block";
      }
      for (const it of items) list.appendChild(makeCard(it));

      if (page === 0){
        footerSpin(true);
        const stats = computeCreatorStats(items);
        renderCreatorsFooter(stats);
        footerSpin(false);
      }
      page += 1;
    }catch(e){
      errorBox.textContent = `Failed to load: ${String(e.message||e)}`;
      errorBox.style.display="block";
    }finally{
      loading = false;
    }
  }

  async function reloadAll(){
    page=0; hasMore=true; list.innerHTML=""; expandedMap.clear();
    setHeading();
    await load(true);
  }

  // sort dropdown
  if (sortSel){
    sortSel.addEventListener("sl-change", async ()=>{
      sort = sortSel.value || "likes";
      await reloadAll();
    });
  }

  // search (debounced & snappy)
  if (searchIn){
    const onS = debounce(async ()=>{
      q = (searchIn.value||"").trim();
      await reloadAll();
    }, 220);
    searchIn.addEventListener("sl-input", onS);
    searchIn.addEventListener("sl-clear", onS);
  }

  // tags menu
  try{
    const f = await fetchJSON(`${API}/filters`);
    const tags = Array.isArray(f.tags) ? f.tags : [];
    tagMenu.innerHTML = "";
    const mk = (v,l)=>`<sl-menu-item value="${esc(v)}">${esc(l)}</sl-menu-item>`;
    tagMenu.insertAdjacentHTML("beforeend", mk("","All tags"));
    tags.forEach(t=> tagMenu.insertAdjacentHTML("beforeend", mk(t,t)));
    tagMenu.addEventListener("sl-select", async (ev)=>{
      bucket = ev.detail.item.value || "";
      tagBtn.textContent = bucket || "All tags";
      await reloadAll();
    });
  }catch{}

  // infinite scroll
  if (sentinel){
    const io = new IntersectionObserver((e)=>{ if (e[0].isIntersecting) load(false); }, {rootMargin:"900px"});
    io.observe(sentinel);
  }

  setHeading();
  await load(true);
}

/* -------------- CSS helpers injected -------------- */
const style = document.createElement("style");
style.textContent = `
  .desc-box{
    background: rgba(12,24,58,.75);
    border: 1px solid rgba(255,255,255,.15);
    box-shadow: inset 0 1px 0 rgba(255,255,255,.08);
    color:#e8f1ff; padding:12px 14px; border-radius:12px;
    margin: 6px 0 8px; max-height: 132px; overflow: hidden;
    transition: max-height .25s ease;
  }
  .desc-box.open{ max-height: 9999px; }

  .row-actions{
    display:flex; align-items:center; margin-top:8px;
  }
  .readmore{ margin-right:auto; background:transparent; color:#d6e6ff;
    border:1px solid #ffffff33; border-radius:999px; padding:8px 12px; font-weight:700; }
  .cta{ margin-left:auto; background:linear-gradient(135deg,#00b2ff,#0a84ff); color:#032149;
       border:1px solid rgba(255,255,255,.35); border-radius:999px;
       padding:10px 14px; font-weight:800; }
  .cta.gray{ background:#6d7a92; color:#f6f8ff; }

  .pill.likes{ background:#ffffff22; border:1px solid #ffffff33; border-radius:999px; padding:3px 8px; margin-left:8px; }
  .tags{ display:flex; gap:6px; flex-wrap:wrap; margin:8px 0 6px; }
  .tag{ background:#0e2a66; border:1px solid #29539a; color:#cfe2ff; padding:2px 8px; border-radius:999px; font-size:12px; }

  /* compact footer */
  #creators-footer{ position:fixed; left:0; right:0; bottom:0; z-index:5;
    background:linear-gradient(180deg, rgba(10,20,52,.86), rgba(8,18,46,.94));
    border-top:1px solid rgba(255,255,255,.15); padding:8px 10px 10px; }
  .contrib-grid{ display:grid; gap:8px; grid-template-columns:repeat(3,1fr); max-width:1200px; margin:0 auto; }
  .contrib-card{ border:1px solid rgba(255,255,255,.18); border-radius:12px; padding:8px 10px;
    background:linear-gradient(180deg, rgba(12,24,58,.82), rgba(9,20,50,.88)); }
  .contrib-head{ font-weight:900; margin-bottom:2px; font-size:12px; }
  .author{ font-weight:800; font-size:12px; }
  .desc{ font-size:12px; opacity:.95; }
  #creators-spin{ display:block; width:10px; height:10px; border-radius:999px; border:2px solid #9dd1ff; border-top-color:transparent;
    margin:4px auto; animation: sp 1s linear infinite; opacity:0; }
  @keyframes sp{ to { transform: rotate(360deg); } }
  .count-chip{ display:inline-block; padding:4px 8px; border-radius:999px; background:#0a84ff; color:#032149; border:1px solid #fff5; font-weight:800; font-size:12px; }
  body{ padding-bottom: 92px; }
`;
document.head.appendChild(style);

/* ------------ kick ------------- */
document.addEventListener("DOMContentLoaded", boot);
