/* Blueprint Store – only the requested fixes:
 * - accurate Creators Spotlight
 * - robust search (epoch cancellation)
 * - keep single expandable description & likes pill
 * - dynamic heading
 */
const API = "/api/blueprint_store";
const $  = (s) => document.querySelector(s);

/* helpers */
const esc = s => (s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c]));
const sleep = ms => new Promise(r=>setTimeout(r, ms));
const debounce = (fn, ms=250)=>{ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms); }; };

async function fetchJSON(url, tries = 3) {
  let delay = 500;
  for (let i=0;i<tries;i++){
    try{
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const j = await res.json();
      if (j?.error) throw new Error(j.error);
      return j;
    }catch(e){
      if (i<tries-1 && /429|502|503/.test(String(e))) { await sleep(delay); delay*=2; continue; }
      throw e;
    }
  }
}

/* number shortener + UI bits */
const k = n => { const x = Number(n||0); if (x>=1e6) return (x/1e6).toFixed(1).replace(/\.0$/,"")+"m"; if (x>=1e3) return (x/1e3).toFixed(1).replace(/\.0$/,"")+"k"; return String(x|0); };
const likePill = likes => `<span class="likes-pill"><i class="heart" aria-hidden="true"></i><span>${k(likes)}</span><span>Liked This</span></span>`;

/* title cleanup (visual only) */
function cleanTitle(raw){
  if (!raw) return "";
  let s = String(raw);
  s = s.replace(/\[ *blueprint *\]\s*/ig, "");
  s = s.replace(/^[^\p{L}\p{N}(]+/u, "");
  s = s.replace(/[^\p{L}\p{N}\s()\-:]/gu, " ");
  s = s.replace(/\s{2,}/g, " ").trim();
  s = s.split(" ").map(w => (w===w.toUpperCase()&&w.length>=2) ? w : w.charAt(0).toUpperCase()+w.slice(1).toLowerCase()).join(" ");
  s = s.replace(/\s*-\s*/g, " - ");
  return s;
}

/* cooked rewrite */
function rewriteCooked(container){
  container.querySelectorAll('a[href*="my.home-assistant.io/redirect/blueprint_import"]').forEach(a=>{
    a.classList.add("import-btn");
    a.innerHTML = `<sl-icon name="download"></sl-icon><span>Import to Home Assistant</span>`;
  });
}

/* cache cooked HTML by topic id */
const detailCache = new Map();

/* card renderer */
function renderCard(it){
  const el = document.createElement("article");
  el.className = "card";

  el.innerHTML = `
    <div class="row">
      <h3 title="${esc(it.title)}">${esc(cleanTitle(it.title))}</h3>
      ${it.author ? `<span class="author">by ${esc(it.author)}</span>` : ""}
    </div>
    <div class="tags">${(it.tags||[]).slice(0,4).map(t=>`<span class="tag">${esc(t)}</span>`).join("")}</div>

    <div class="desc-wrap collapsed" id="wrap-${it.id}">
      <p class="desc">${esc(it.excerpt || "")}</p>
      <div class="grad"></div>
      <div class="toggle">Read more</div>
    </div>

    <div class="meta">${likePill(it.likes||0)}</div>
    <div class="card__footer">
      <a class="import-btn" href="${esc(it.import_url)}" target="_blank" rel="noopener">
        <sl-icon name="download"></sl-icon><span>Import to Home Assistant</span>
      </a>
    </div>
  `;

  const wrap = el.querySelector(`#wrap-${it.id}`);
  const tog  = wrap.querySelector(".toggle");

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
    wrap.classList.remove("collapsed");
    wrap.innerHTML = `<div class="desc" style="-webkit-line-clamp:unset; overflow:visible">${detailCache.get(it.id)}</div><div class="toggle">Less</div>`;
    wrap.querySelector(".toggle").addEventListener("click", collapse);
  }
  function collapse(){
    wrap.classList.add("collapsed");
    wrap.innerHTML = `<p class="desc">${esc(it.excerpt || "")}</p><div class="grad"></div><div class="toggle">Read more</div>`;
    wrap.querySelector(".toggle").addEventListener("click", expand);
  }
  tog.addEventListener("click", expand);

  return el;
}
function appendItems(target, items){ for(const it of items) target.appendChild(renderCard(it)); }

/* spotlight (accurate) */
async function buildSpotlightAccurate(){
  const host = $("#contrib"); const grid = $("#contribGrid");
  if (!host || !grid) return;

  // most popular (likes) + most recent straight from first page
  const mostLikedResp = await fetchJSON(`${API}/blueprints?page=0&sort=likes`);
  const mostRecentResp= await fetchJSON(`${API}/blueprints?page=0&sort=new`);
  const mostPopular = mostLikedResp?.items?.[0] || null;
  const mostRecent  = mostRecentResp?.items?.[0] || null;

  // author with most uploads (scan all pages once)
  let page=0, hasMore=true;
  const counts = new Map();
  while (hasMore){
    const r = await fetchJSON(`${API}/blueprints?page=${page}&sort=title`);
    const items = r?.items||[];
    for(const it of items){ if(!it.author) continue; counts.set(it.author, (counts.get(it.author)||0)+1); }
    hasMore = !!r?.has_more; page++;
    // tiny yield to keep UI responsive
    await sleep(10);
  }
  let topAuthor=null, topCount=0;
  for (const [a,c] of counts){ if (c>topCount){ topAuthor=a; topCount=c; } }

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

/* heading */
function updateHeading({sort, bucket, q}) {
  const h = $("#headingEl"); if (!h) return;
  let base = (sort==="likes") ? "Most liked blueprints" : (sort==="title") ? "Titles A–Z" : "Newest blueprints";
  const parts = [base];
  if (bucket) parts.push(`tag: ${bucket}`);
  if (q) parts.push(`query: “${q}”`);
  h.textContent = parts.join(" • ");
}

/* boot + data plumbing (epoch to cancel stale loads) */
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
  const sentinel = $("#sentinel");

  if (!list) return;

  let page = 0;
  let qTitle = "";
  let loading = false;
  let hasMore = true;
  let sort = "new";
  let bucket = "";

  let epoch = 0;                      // increases on each new query
  let io;                             // IntersectionObserver

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
        bucket = ev.detail.item.value || "";
        tagbtn.textContent = bucket || "All tags";
        await loadAll(true);
        if (tagdd && typeof tagdd.hide === "function") tagdd.hide();
      });
    }catch{}
  }

  function pageURL(p){
    const url = new URL(`${API}/blueprints`, location.origin);
    url.searchParams.set("page", String(p));
    if (qTitle) url.searchParams.set("q_title", qTitle);
    if (sort) url.searchParams.set("sort", sort);
    if (bucket) url.searchParams.set("bucket", bucket);
    return url.toString();
  }

  async function load(first, myEpoch){
    if (loading || (!hasMore && !first)) return;
    loading = true; clearError();
    try{
      const data = await fetchJSON(pageURL(page));
      if (myEpoch !== epoch) return; // stale request
      const items = data.items || [];
      hasMore = !!data.has_more;

      if (first){
        list.innerHTML = "";
        empty.style.display = items.length ? "none" : "block";
      }
      appendItems(list, items);
      page += 1;
    }catch(e){
      if (myEpoch === epoch) setError(`Failed to load: ${String(e.message||e)}`);
    }finally{
      loading = false;
    }
  }

  async function loadAll(resetSpotlight=false){
    epoch += 1; const myEpoch = epoch;
    page = 0; hasMore = true;
    updateHeading({sort, bucket, q:qTitle});

    // reset infinite scroll
    if (io) io.disconnect();
    await load(true, myEpoch);
    if (sentinel){
      io = new IntersectionObserver((entries)=>{ if (entries[0]?.isIntersecting) load(false, myEpoch); }, {rootMargin:"700px"});
      io.observe(sentinel);
    }

    // spotlight is global (no filters). Only rebuild on manual refresh or very first boot.
    if (resetSpotlight) buildSpotlightAccurate();
  }

  // search (epoch cancels stale loads)
  if (search){
    const onSearch = debounce(async ()=>{
      qTitle = (search.value || "").trim();
      await loadAll(false);
    }, 260);
    search.addEventListener("sl-input", onSearch);
    search.addEventListener("sl-clear", onSearch);
  }

  if (sortSel){
    sortSel.addEventListener("sl-change", async ()=>{ sort = sortSel.value || "new"; await loadAll(false); });
  }
  if (refreshBtn){
    refreshBtn.addEventListener("click", async ()=>{ await loadAll(true); });
  }

  fetchFilters();
  updateHeading({sort, bucket, q:qTitle});
  buildSpotlightAccurate();       // once on boot (accurate)
  loadAll(false);
}

document.addEventListener("DOMContentLoaded", boot);
