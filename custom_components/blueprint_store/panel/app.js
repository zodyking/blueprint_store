/* Blueprint Store – UI glue
 * Scope: only fixes requested (single desc, likes pill, dark desc area,
 * dynamic heading, normalize import badges, contributors strip). */
const API = "/api/blueprint_store";
const $  = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

/* ---------- small helpers ---------- */
const esc = s => (s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c]));
const sleep = ms => new Promise(r=>setTimeout(r, ms));
const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

async function fetchJSON(url, tries = 3) {
  let backoff = 500;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const j = await res.json();
      if (j && j.error) throw new Error(j.error);
      return j;
    } catch (e) {
      const msg = String(e?.message ?? e);
      if (i < tries - 1 && /429|502|503/.test(msg)) { await sleep(backoff); backoff *= 2; continue; }
      throw new Error(`fetch: ${msg}`);
    }
  }
}

/* ----- formatting ----- */
function k(n){ if (n == null) return "0"; const x = Number(n); if (!Number.isFinite(x)) return "0"; if (x >= 1_000_000) return `${(x/1_000_000).toFixed(1).replace(/\.0$/, "")}m`; if (x >= 1_000) return `${(x/1_000).toFixed(1).replace(/\.0$/, "")}k`; return `${x}`; }
function likePill(likes){ return `
  <span class="likes-pill" aria-label="${likes} people liked this">
    <i class="heart" aria-hidden="true"></i>
    <span>${k(likes)}</span>
    <span>Liked This</span>
  </span>`; }

/* ----- title parsing for spotlight & cards (only visual) ----- */
function cleanTitle(raw){
  if (!raw) return "";
  let s = String(raw);

  // remove explicit "[Blueprint]" marker
  s = s.replace(/\[ *blueprint *\]\s*/ig, "");

  // strip leading emojis/non-alnum
  s = s.replace(/^[^\p{L}\p{N}(]+/u, "");

  // allow letters, numbers, whitespace, () and simple separators
  s = s.replace(/[^\p{L}\p{N}\s()\-:]/gu, " ");

  // squash whitespace
  s = s.replace(/\s{2,}/g, " ").trim();

  // Title Case while preserving acronyms
  s = s.split(" ").map(w=>{
    if (w === w.toUpperCase() && w.length >= 2) return w; // acronym
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  }).join(" ");

  // minor cosmetic: " - " spacing normalized (keep dashes)
  s = s.replace(/\s*-\s*/g, " - ");
  return s;
}

/* ----- rewrite MyHA banners inside cooked description to compact pills ----- */
function rewriteCooked(container){
  container.querySelectorAll('a[href*="my.home-assistant.io/redirect/blueprint_import"]').forEach(a=>{
    a.classList.add("import-btn");
    a.innerHTML = `<sl-icon name="download"></sl-icon><span>Import to Home Assistant</span>`;
  });
}

/* cache cooked HTML by topic id */
const detailCache = new Map();

/* -------- card renderer (single expandable description) -------- */
function renderCard(it){
  const el = document.createElement("article");
  el.className = "card";

  const header = `
    <div class="row">
      <h3 title="${esc(it.title)}">${esc(cleanTitle(it.title))}</h3>
      ${it.author ? `<span class="author">by ${esc(it.author)}</span>` : ""}
    </div>
    <div class="tags">${(it.tags||[]).slice(0,4).map(t=>`<span class="tag">${esc(t)}</span>`).join("")}</div>
  `;

  const desc = `
    <div class="desc-wrap collapsed" id="wrap-${it.id}">
      <p class="desc" id="desc-${it.id}">${esc(it.excerpt || "")}</p>
      <div class="grad"></div>
      <div class="toggle" id="tog-${it.id}">Read more</div>
    </div>
  `;

  const footer = `
    <div class="meta">${likePill(it.likes||0)}</div>
    <div class="card__footer">
      <a class="import-btn" href="${esc(it.import_url)}" target="_blank" rel="noopener">
        <sl-icon name="download"></sl-icon><span>Import to Home Assistant</span>
      </a>
    </div>
  `;

  el.innerHTML = header + desc + footer;

  // expand/collapse
  const wrap = el.querySelector(`#wrap-${it.id}`);
  const tog  = el.querySelector(`#tog-${it.id}`);

  async function expand(){
    if (!detailCache.has(it.id)) {
      try{
        const data = await fetchJSON(`${API}/topic?id=${it.id}`);
        const tmp = document.createElement("div");
        tmp.innerHTML = data.cooked || "";
        rewriteCooked(tmp);
        detailCache.set(it.id, tmp.innerHTML);
      }catch(e){
        detailCache.set(it.id, `<em>Failed to load post: ${esc(String(e.message||e))}</em>`);
      }
    }
    // replace excerpt with cooked HTML
    wrap.classList.remove("collapsed");
    wrap.querySelector(".grad")?.remove();
    wrap.querySelector(".desc").outerHTML = `<div class="desc" style="-webkit-line-clamp:unset; overflow:visible">${detailCache.get(it.id)}</div>`;
    tog.textContent = "Less";
  }

  let expanded = false;
  tog.addEventListener("click", async () => {
    if (!expanded){ expanded = true; await expand(); }
    else { // collapse back to excerpt
      expanded = false;
      wrap.innerHTML = `
        <p class="desc">${esc(it.excerpt || "")}</p>
        <div class="grad"></div>
        <div class="toggle">Read more</div>
      `;
      wrap.classList.add("collapsed");
      wrap.querySelector(".toggle").addEventListener("click", async ()=>{ if (!expanded){ expanded=true; await expand(); } });
    }
  });

  return el;
}

/* ----- list plumbing ----- */
function appendItems(target, items){ for (const it of items) target.appendChild(renderCard(it)); }

/* ----- spotlight (creators) ----- */
function buildSpotlight(items){
  if (!items?.length) return;
  const byAuthor = new Map();
  let mostPopular = items[0];

  for (const it of items){
    if (!byAuthor.has(it.author)) byAuthor.set(it.author, []);
    byAuthor.get(it.author).push(it);
    if ((it.likes||0) > (mostPopular.likes||0)) mostPopular = it;
  }

  // most uploaded
  let topAuthor = null, topCount = 0;
  for (const [a, arr] of byAuthor){
    if (arr.length > topCount){ topAuthor = a; topCount = arr.length; }
  }

  // most recent = first item when sort=new (we call spotlight after initial load with sort=new)
  const mostRecent = items[0];

  const grid = $("#contribGrid");
  const host = $("#contrib");
  if (!grid || !host) return;

  grid.innerHTML = `
    <div class="contrib-card">
      <h4>Most Popular Blueprint</h4>
      <div class="contrib-title">${esc(mostPopular?.author ?? "—")}</div>
      <div style="margin-top:8px">${esc(cleanTitle(mostPopular?.title ?? ""))}</div>
    </div>
    <div class="contrib-card">
      <h4>Most Uploaded Blueprints</h4>
      <div class="contrib-title">${esc(topAuthor ?? "—")}</div>
      <div class="contrib-chip">${k(topCount)} blueprint(s)</div>
    </div>
    <div class="contrib-card">
      <h4>Most Recent Upload</h4>
      <div class="contrib-title">${esc(mostRecent?.author ?? "—")}</div>
      <div style="margin-top:8px">${esc(cleanTitle(mostRecent?.title ?? ""))}</div>
    </div>
  `;
  host.style.display = "block";
}

/* ----- dynamic heading ----- */
function updateHeading({sort, bucket, q}) {
  const h = $("#headingEl"); if (!h) return;
  let base = "All blueprints";
  if (sort === "likes") base = "Most liked blueprints";
  else if (sort === "title") base = "Titles A–Z";
  else base = "Newest blueprints";

  const parts = [base];
  if (bucket) parts.push(`tag: ${bucket}`);
  if (q) parts.push(`query: “${q}”`);
  h.textContent = parts.join(" • ");
}

/* ----- boot ----- */
function boot(){
  const list   = $("#list");
  const empty  = $("#empty");
  const errorB = $("#error");
  const search = $("#search");
  const sortSel = $("#sort");
  const refreshBtn = $("#refresh");

  const tagdd = $("#tagdd");
  const tagbtn = $("#tagbtn");
  const tagmenu = $("#tagmenu");

  if (!list) return;

  let page = 0;
  let qTitle = "";
  let loading = false;
  let hasMore = true;
  let sort = "new";
  let bucket = "";
  let spotlightSeed = []; // for spotlight on first load

  const setError = (msg)=>{ if(errorB){ errorB.textContent = msg; errorB.style.display="block"; } };
  const clearError = ()=>{ if(errorB){ errorB.style.display="none"; errorB.textContent=""; } };

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
        updateHeading({sort, bucket, q:qTitle});
        await loadAll(true);
        if (tagdd && typeof tagdd.hide === "function") tagdd.hide();
      });
    }catch(e){ /* ignore */ }
  }

  function pageURL(p){
    const url = new URL(`${API}/blueprints`, location.origin);
    url.searchParams.set("page", String(p));
    if (qTitle) url.searchParams.set("q_title", qTitle);
    if (sort) url.searchParams.set("sort", sort);
    if (bucket) url.searchParams.set("bucket", bucket);
    return url.toString();
  }

  async function load(first=false){
    if (loading || (!hasMore && !first)) return;
    loading = true; clearError();
    try{
      const data = await fetchJSON(pageURL(page));
      const items = data.items || [];
      hasMore = !!data.has_more;

      if (first){
        list.innerHTML = "";
        if (empty) empty.style.display = items.length ? "none" : "block";
        spotlightSeed = items.slice(0, 18); // decent seed for spotlight
        if (sort === "new") buildSpotlight(spotlightSeed);
      }
      appendItems(list, items);
      page += 1;
    }catch(e){
      setError(`Failed to load: ${String(e.message||e)}`);
    }finally{
      loading = false;
    }
  }

  async function loadAll(firstPage=false){
    // reset then load all available pages to satisfy tag+search
    page = 0; hasMore = true;
    updateHeading({sort, bucket, q:qTitle});
    await load(true);
    // progressive fill
    while (hasMore) { await load(false); await sleep(8); }
  }

  // search
  if (search){
    const onSearch = debounce(async ()=>{
      qTitle = (search.value || "").trim();
      await loadAll(true);
    }, 260);
    search.addEventListener("sl-input", onSearch);
    search.addEventListener("sl-clear", onSearch);
  }

  // sort
  if (sortSel){
    sortSel.addEventListener("sl-change", async ()=>{
      sort = sortSel.value || "new";
      await loadAll(true);
    });
  }

  // refresh
  if (refreshBtn){
    refreshBtn.addEventListener("click", async ()=>{ await loadAll(true); });
  }

  // infinite
  const sentinel = $("#sentinel");
  if (sentinel){
    const io = new IntersectionObserver((entries)=>{ if (entries[0]?.isIntersecting) load(false); }, {rootMargin:"700px"});
    io.observe(sentinel);
  }

  fetchFilters();
  updateHeading({sort, bucket, q:qTitle});
  load(true);
}

document.addEventListener("DOMContentLoaded", boot);
