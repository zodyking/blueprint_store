const API = "/api/blueprint_store";
const $  = (s) => document.querySelector(s);

/* helpers */
const esc = s => (s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c]));
const sleep = ms => new Promise(r=>setTimeout(r, ms));
const debounce = (fn, ms=260)=>{ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms); }; };

async function fetchJSON(url, tries = 3) {
  let delay = 500;
  for (let i=0;i<tries;i++){
    try{
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const j = await res.json();
      if (j && j.error) throw new Error(j.error);
      return j;
    }catch(e){
      if (i<tries-1 && /429|502|503/.test(String(e))) { await sleep(delay); delay*=2; continue; }
      throw e;
    }
  }
}

/* number shortener */
const k = n => { const x = Number(n||0); if (x>=1e6) return (x/1e6).toFixed(1).replace(/\.0$/,"")+"m"; if (x>=1e3) return (x/1e3).toFixed(1).replace(/\.0$/,"")+"k"; return String(x|0); };
const likePill = likes => `<span class="likes-pill"><i class="heart" aria-hidden="true"></i><span>${k(likes)}</span><span>Liked This</span></span>`;

/* safe title cleanup */
function cleanTitle(raw){
  if (!raw) return "";
  let s = String(raw);
  s = s.replace(/\[ *blueprint *\]\s*/ig, "");
  s = s.replace(/^[^A-Za-z0-9(]+/, "");              // drop leading emojis/symbols
  s = s.replace(/[^A-Za-z0-9() \-:]/g, " ");         // keep (), letters, digits, space, - :
  s = s.replace(/\s{2,}/g, " ").trim();
  s = s.split(" ").map(w => (w===w.toUpperCase()&&w.length>=2) ? w : w.charAt(0).toUpperCase()+w.slice(1).toLowerCase()).join(" ");
  s = s.replace(/\s*-\s*/g, " - ");
  return s;
}

/* count import buttons in cooked */
function rewriteCookedAndCount(container){
  let importCount = 0;
  container.querySelectorAll('a[href*="my.home-assistant.io/redirect/blueprint_import"]').forEach(a=>{
    importCount++;
    a.classList.add("import-btn");
    a.innerHTML = `<sl-icon name="download"></sl-icon><span>Import to Home Assistant</span>`;
  });
  return importCount;
}

const cookedCache = new Map(); // id -> {html, count}

/* tokenized search */
function tokenize(q){
  if (!q) return [];
  const out = [];
  (q.toLowerCase().match(/"([^"]+)"|(\S+)/g) || []).forEach(m=>{
    const t = m.replace(/^"|"$/g,"").trim();
    if (t) out.push(t);
  });
  return out;
}
function matchesTokens(it, tokens){
  if (!tokens.length) return true;
  const hayTitle = (it.title||"").toLowerCase();
  const hayDesc  = (it.excerpt||"").toLowerCase();
  const hayTags  = (it.tags||[]).map(t=>String(t).toLowerCase()).join(" ");
  return tokens.every(tok => hayTitle.includes(tok) || hayDesc.includes(tok) || hayTags.includes(tok));
}

/* card renderer */
function renderCard(it){
  const el = document.createElement("article");
  el.className = "card";

  const showNeutral = (it.import_count || 0) > 1;

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
      ${showNeutral
        ? `<a class="neutral-btn" data-viewdesc="${it.id}"><sl-icon name="file-text"></sl-icon><span>View description</span></a>`
        : `<a class="import-btn" href="${esc(it.import_url)}" target="_blank" rel="noopener">
             <sl-icon name="download"></sl-icon><span>Import to Home Assistant</span>
           </a>`}
    </div>
  `;

  const wrap = el.querySelector(`#wrap-${it.id}`);
  const tog  = wrap.querySelector(".toggle");

  async function expand(){
    if (!cookedCache.has(it.id)) {
      try{
        const data = await fetchJSON(`${API}/topic?id=${it.id}`);
        const tmp = document.createElement("div");
        tmp.innerHTML = data.cooked || "";
        const count = rewriteCookedAndCount(tmp);
        cookedCache.set(it.id, { html: tmp.innerHTML, count });
      }catch(e){
        cookedCache.set(it.id, { html:`<em>Failed to load post: ${esc(String(e.message||e))}</em>`, count:0 });
      }
    }
    wrap.classList.remove("collapsed");
    wrap.innerHTML = `<div class="desc" style="-webkit-line-clamp:unset; overflow:visible">${cookedCache.get(it.id).html}</div><div class="toggle">Less</div>`;
    wrap.querySelector(".toggle").addEventListener("click", collapse);
  }
  function collapse(){
    wrap.classList.add("collapsed");
    wrap.innerHTML = `<p class="desc">${esc(it.excerpt || "")}</p><div class="grad"></div><div class="toggle">Read more</div>`;
    wrap.querySelector(".toggle").addEventListener("click", expand);
  }
  tog.addEventListener("click", expand);

  const viewBtn = el.querySelector(`[data-viewdesc="${it.id}"]`);
  if (viewBtn){
    viewBtn.addEventListener("click", (ev)=>{ ev.preventDefault(); expand(); });
  }

  return el;
}
function appendItems(target, items){ for(const it of items) target.appendChild(renderCard(it)); }

/* Spotlight (fast & robust) */
async function buildSpotlight(){
  const host = $("#contrib"); const grid = $("#contribGrid");
  if (!host || !grid) return;

  try{
    const [liked, recent] = await Promise.all([
      fetchJSON(`${API}/blueprints?page=0&sort=likes`),
      fetchJSON(`${API}/blueprints?page=0&sort=new`)
    ]);
    const mostPopular = liked?.items?.[0] || null;
    const mostRecent  = recent?.items?.[0] || null;

    // most uploads: scan first few pages quickly
    let page=0, hasMore=true, maxPages=5;
    const counts = new Map();
    while (hasMore && page<maxPages){
      const r = await fetchJSON(`${API}/blueprints?page=${page}&sort=title`);
      (r?.items||[]).forEach(it => { if (it.author) counts.set(it.author, (counts.get(it.author)||0)+1); });
      hasMore = !!r?.has_more; page++;
    }
    let topAuthor="—", topCount=0;
    counts.forEach((c,a)=>{ if (c>topCount){ topAuthor=a; topCount=c; } });

    grid.innerHTML = `
      <div class="contrib-card">
        <h4>Most Popular Blueprint</h4>
        <div class="contrib-title">${esc(mostPopular?.author ?? "—")}</div>
        <div style="margin-top:8px">${esc(cleanTitle(mostPopular?.title ?? ""))}</div>
      </div>
      <div class="contrib-card">
        <h4>Most Uploaded Blueprints</h4>
        <div class="contrib-title">${esc(topAuthor)}</div>
        <div class="contrib-chip">${k(topCount)} blueprint(s)</div>
      </div>
      <div class="contrib-card">
        <h4>Most Recent Upload</h4>
        <div class="contrib-title">${esc(mostRecent?.author ?? "—")}</div>
        <div style="margin-top:8px">${esc(cleanTitle(mostRecent?.title ?? ""))}</div>
      </div>
    `;
    host.style.display = "block";
  }catch{
    // keep section hidden on failure
  }
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

/* boot */
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
  let qText = "";
  let qTokens = [];
  let loading = false;
  let hasMore = true;
  let sort = "new";
  let bucket = "";

  let epoch = 0;
  let io;

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
    if (qText) url.searchParams.set("q_title", qText);  // server-side title match
    if (sort) url.searchParams.set("sort", sort);
    if (bucket) url.searchParams.set("bucket", bucket);
    return url.toString();
  }

  function matchesClientSide(it){ return matchesTokens(it, qTokens); }

  async function load(first, myEpoch, accumulateAll=false){
    if (loading || (!hasMore && !first)) return;
    loading = true; clearError();
    try{
      const data = await fetchJSON(pageURL(page));
      if (myEpoch !== epoch) return;
      const items = (data.items || []).filter(matchesClientSide);
      if (first){ list.innerHTML = ""; empty.style.display = items.length ? "none" : "block"; }
      appendItems(list, items);
      hasMore = !!data.has_more;
      page += 1;
      if (accumulateAll && hasMore) await load(false, myEpoch, true);
    }catch(e){
      if (myEpoch === epoch) setError(`Failed to load: ${String(e.message||e)}`);
    }finally{ loading = false; }
  }

  async function loadAll(resetSpotlight=false){
    epoch += 1; const myEpoch = epoch;
    page = 0; hasMore = true;
    updateHeading({sort, bucket, q:qText});

    if (io) io.disconnect();

    const wantAllNow = !!qTokens.length;
    await load(true, myEpoch, wantAllNow);

    if (!wantAllNow && sentinel){
      io = new IntersectionObserver((e)=>{ if (e[0] && e[0].isIntersecting) load(false, myEpoch, false); }, {rootMargin:"700px"});
      io.observe(sentinel);
    }

    if (resetSpotlight) buildSpotlight();
  }

  if (search){
    const onSearch = debounce(async ()=>{
      qText = (search.value || "").trim();
      qTokens = tokenize(qText);
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
  updateHeading({sort, bucket, q:qText});
  buildSpotlight();      // show quickly
  loadAll(false);        // load cards
}

document.addEventListener("DOMContentLoaded", boot);
