/* Blueprint Store — UI glue
 * Scope: only the requested fixes (single growable desc area; cleaned titles for Hall of Builders; centered/renamed section; blue→black bg is in CSS)
 */
const API = "/api/blueprint_store";
const $  = (s) => document.querySelector(s);

/* ---------- small helpers ---------- */
const $$ = (s) => Array.from(document.querySelectorAll(s));
function esc(s){ return (s||"").replace(/[&<>"']/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c])); }
const sleep = (ms)=> new Promise(r=>setTimeout(r, ms));
const debounce = (fn, ms=280)=>{ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms); }; };

async function fetchJSON(url, tries=3){
  let delay = 600;
  for(let i=0;i<tries;i++){
    try{
      const res = await fetch(url);
      if(!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data = await res.json();
      if (data && data.error) throw new Error(data.error);
      return data;
    }catch(e){
      if (i < tries-1 && /429/.test(String(e))) { await sleep(delay + Math.random()*250); delay*=2; continue; }
      throw e;
    }
  }
}

/* ---------- Title parsing utilities (for cards & Hall of Builders) ---------- */
function titleCaseSmart(s){
  const keepCaps = /^(AI|CPU|GPU|ZHA|Z2M|MQTT|ZBMINI|ZHA|HA|ESP|RTSP|RGB)$/i;
  return s.split(/\s+/).map(w=>{
    if (keepCaps.test(w) && w === w.toUpperCase()) return w;
    if (/^[A-Z0-9]{2,}$/.test(w)) return w;           // already caps
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  }).join(" ");
}
function cleanTitle(raw){
  if (!raw) return "";
  let s = String(raw);
  s = s.replace(/\[blueprint\]\s*/i, "");          // remove “[Blueprint]”
  s = s.replace(/^[^A-Za-z(]+/, "");               // strip leading emojis/symbols
  s = s.replace(/[^0-9A-Za-z()\- _:]/g, "");       // keep (), hyphen, space, colon, underscore
  return titleCaseSmart(s).replace(/\s{2,}/g," ").trim();
}

/* ---------- Recognition / “Hall of Builders” ---------- */
function renderContrib(sectionStats){
  const host = $("#contrib");
  const grid = $("#contrib-grid");
  if (!host || !grid) return;

  // Expect shape (provided by your backend): { most_popular:{author,title}, most_uploads:{author,count}, most_recent:{author,title} }
  const mp = sectionStats?.most_popular || {};
  const mu = sectionStats?.most_uploads || {};
  const mr = sectionStats?.most_recent  || {};

  const cards = [
    { label:"Most Popular Blueprint", author: mp.author || "—", sub: cleanTitle(mp.title || "—") },
    { label:"Most Uploaded Blueprints", author: mu.author || "—", sub: `${mu.count || 0} blueprint(s)` },
    { label:"Most Recent Upload", author: mr.author || "—", sub: cleanTitle(mr.title || "—") },
  ];

  grid.innerHTML = cards.map(c=>`
    <div class="contrib-card">
      <div class="contrib-title">${esc(c.label)}</div>
      <div class="contrib-author">${esc(titleCaseSmart(c.author))}</div>
      <div class="contrib-sub">${esc(c.sub)}</div>
    </div>
  `).join("");

  host.style.display = "block";
}

/* ---------- Cards ---------- */
const detailCache = new Map();

function likesPill(it){
  const likeText = `${it.likes_str || it.likes || 0} Liked This`;
  return `<span class="likes-pill"><i class="icon"></i>${esc(likeText)}</span>`;
}

function tagPills(tags){
  const set = [];
  (tags || []).forEach(t => {
    const v = (t || "").toString().trim();
    if (v && !set.includes(v)) set.push(v);
  });
  if (!set.length) return "";
  return `<div class="tags">${set.slice(0,4).map(t=>`<span class="tag">${esc(t)}</span>`).join("")}</div>`;
}

function renderCard(it){
  const el = document.createElement("article");
  el.className = "card";

  const title = cleanTitle(it.title);
  const author = it.author ? `by ${titleCaseSmart(it.author)}` : "";

  el.innerHTML = `
    <div class="row">
      <h3>${esc(title)}</h3>
      ${it.author ? `<span class="author">${esc(author)}</span>` : ""}
    </div>

    ${tagPills([it.bucket, ...(it.tags || []).slice(0,3)])}

    <div class="desc-wrap" id="desc-${it.id}">
      <div class="desc-teaser">${esc(it.excerpt || "")}</div>
      <div class="desc-full" id="full-${it.id}"></div>
    </div>

    <div class="toggle" data-id="${it.id}">Read more</div>
    ${likesPill(it)}
  `;

  // Expand/Collapse
  const wrap   = el.querySelector(`#desc-${it.id}`);
  const fullEl = el.querySelector(`#full-${it.id}`);
  const toggle = el.querySelector(".toggle");
  let expanded = false;

  async function ensureFullLoaded(){
    if (!detailCache.has(it.id)) {
      try{
        const data = await fetchJSON(`${API}/topic?id=${it.id}`);
        detailCache.set(it.id, data.cooked || "<em>Nothing to show.</em>");
      }catch(e){
        detailCache.set(it.id, `<em>Failed to load post: ${esc(String(e.message||e))}</em>`);
      }
    }
    fullEl.innerHTML = detailCache.get(it.id);
  }

  toggle.addEventListener("click", async () => {
    if (!expanded){
      await ensureFullLoaded();
      wrap.classList.add("expanded");
      toggle.textContent = "Less";
      expanded = true;
    }else{
      wrap.classList.remove("expanded");
      toggle.textContent = "Read more";
      expanded = false;
    }
  });

  return el;
}

function appendItems(target, items){
  for (const it of items) target.appendChild(renderCard(it));
}

/* ---------- Boot / Paging / Filters (unchanged behavior) ---------- */
function boot(){
  const list   = $("#list");
  const empty  = $("#empty");
  const errorB = $("#error");
  const search = $("#search");
  const sortSel = $("#sort");
  const refreshBtn = $("#refresh");
  const sentinel = $("#sentinel");

  const tagdd = $("#tagdd");
  const tagbtn = $("#tagbtn");
  const tagmenu = $("#tagmenu");
  const headingEl = $("#heading");

  if (!list) return;

  let page = 0;
  let qTitle = "";
  let loading = false;
  let hasMore = true;
  let sort = "new";
  let bucket = "";

  const setError = (msg)=>{ if(errorB){ errorB.textContent = msg; errorB.style.display="block"; } };
  const clearError = ()=>{ if(errorB){ errorB.style.display="none"; errorB.textContent=""; } };

  function updateHeading(){
    let parts = [];
    if (sort === "likes") parts.push("Most liked");
    else if (sort === "title") parts.push("Title A–Z");
    else parts.push("Newest");

    if (bucket) parts.push(`• ${bucket}`);
    if (qTitle) parts.push(`• “${qTitle}”`);

    headingEl.textContent = parts.join(" ") + " blueprints";
  }

  async function fetchFilters(){
    try{
      const data = await fetchJSON(`${API}/filters`);
      const tags = Array.isArray(data.tags) ? data.tags : [];
      tagmenu.innerHTML = "";
      const mk = (value,label)=>`<sl-menu-item value="${esc(value)}">${esc(label)}</sl-menu-item>`;
      tagmenu.insertAdjacentHTML("beforeend", mk("", "All tags"));
      tags.forEach(t => tagmenu.insertAdjacentHTML("beforeend", mk(t, t)));
      tagmenu.addEventListener("sl-select", async (ev)=>{
        const val = ev.detail.item.value || "";
        bucket = val;
        tagbtn.textContent = bucket || "All tags";
        updateHeading();
        await loadAllForSearch();
        if (tagdd && typeof tagdd.hide === "function") tagdd.hide();
      });
    }catch(e){ /* optional */ }
  }

  async function fetchContrib(){
    try{
      const data = await fetchJSON(`${API}/contrib`);
      renderContrib(data || {});
    }catch(e){ /* soft fail */ }
  }

  async function fetchPage(p){
    const url = new URL(`${API}/blueprints`, location.origin);
    url.searchParams.set("page", String(p));
    if (qTitle) url.searchParams.set("q_title", qTitle);
    if (sort)   url.searchParams.set("sort", sort);
    if (bucket) url.searchParams.set("bucket", bucket);
    return await fetchJSON(url.toString());
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
        if (empty) empty.style.display = items.length ? "none" : "block";
      }
      appendItems(list, items);
      page += 1;
    }catch(e){
      setError(`Failed to load: ${String(e.message||e)}`);
    }finally{
      loading = false;
    }
  }

  async function loadAllForSearch(){
    page = 0; hasMore = true; list.innerHTML = ""; clearError();
    let first = true;
    while (hasMore) {
      await load(first); first = false;
      await sleep(6);
    }
  }

  if (search){
    const onSearch = debounce(async () => { qTitle = (search.value || "").trim(); updateHeading(); await loadAllForSearch(); }, 280);
    search.addEventListener("sl-input", onSearch);
    search.addEventListener("sl-clear", onSearch);
  }
  if (sortSel){
    sortSel.addEventListener("sl-change", async () => {
      const val = sortSel.value;
      if (val === "likes" || val === "title" || val === "new") sort = val; // guard
      updateHeading();
      await loadAllForSearch();
    });
  }
  if (refreshBtn){
    refreshBtn.addEventListener("click", async () => { await loadAllForSearch(); });
  }

  if (sentinel){
    const io = new IntersectionObserver((entries)=>{
      if (entries[0] && entries[0].isIntersecting) load(false);
    },{ rootMargin:"700px" });
    io.observe(sentinel);
  }

  updateHeading();
  fetchFilters();
  fetchContrib();
  load(true);
}

document.addEventListener("DOMContentLoaded", boot);
