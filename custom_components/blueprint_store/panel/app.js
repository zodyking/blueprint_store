/* Blueprint Store – UI glue
 * Scope: only requested fixes (recognition centering, plural label, title normalization)
 */
const API = "/api/blueprint_store";
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

/* ---------- helpers ---------- */
function esc(s){ return (s||"").toString().replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c])); }
const debounce = (fn,ms=280)=>{ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms); }; };

async function fetchJSON(url, tries=3){
  let delay = 500;
  for (let i=0;i<tries;i++){
    const res = await fetch(url);
    if (res.ok) return res.json();
    // Retry on 429 only
    if (res.status === 429 && i < tries-1){
      await new Promise(r=>setTimeout(r, delay + Math.random()*200));
      delay *= 2; continue;
    }
    const txt = await res.text();
    throw new Error(`${res.status} ${res.statusText} – ${txt.slice(0,120)}`);
  }
}

/* ---------- title normalization ---------- */
/* strip literal “[Blueprint]” (any case/spaces), leading emojis, remove special chars except ().
   turn hyphens into spaces. Then Title Case while preserving existing acronyms. */
function cleanTitle(raw){
  if (!raw) return "";
  let t = String(raw);

  // strip literal [Blueprint] (with optional surrounding spaces)
  t = t.replace(/\s*\[?\s*blueprint\s*\]?\s*/ig, " ");

  // strip leading emojis (common unicode emoji ranges) + decorative punctuation
  t = t.replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}\p{Emoji}\s•|:+-]+/u, "");

  // replace hyphens with spaces
  t = t.replace(/-/g, " ");

  // remove special chars except parentheses; keep letters, numbers, spaces, & ()
  t = t.replace(/[^0-9A-Za-z() ]+/g, " ").replace(/\s{2,}/g, " ").trim();

  // Title Case while preserving acronyms (already ALL CAPS with ≥2 chars)
  t = t.split(" ").map(w=>{
    if (w.length >= 2 && /^[A-Z0-9]+$/.test(w)) return w; // preserve acronyms
    if (!w) return w;
    return w[0].toUpperCase() + w.slice(1).toLowerCase();
  }).join(" ");

  return t || String(raw);
}

/* ---------- likes pill (left, only likes as requested) ---------- */
function likePill(likes){
  const fmt = (n)=>{
    if (n == null) return "0";
    if (n >= 1_000_000) return `${(n/1_000_000).toFixed(1).replace(/\.0$/,"")}M`;
    if (n >= 1_000)     return `${(n/1_000).toFixed(1).replace(/\.0$/,"")}k`;
    return `${n}`;
  };
  return `
    <div class="stats-pill" title="People who liked this">
      <span class="icon-heart" aria-hidden="true"></span>
      <span class="stat">${fmt(likes)}</span>
      <span class="lbl">Liked This</span>
    </div>`;
}

/* ---------- card renderer (uses cleanTitle) ---------- */
function renderCard(item){
  const el = document.createElement("article");
  el.className = "card";
  const title = cleanTitle(item.title);

  el.innerHTML = `
    <div class="row">
      <h3>${esc(title)}</h3>
      ${item.author ? `<span class="author">by ${esc(item.author)}</span>` : ""}
    </div>

    ${renderTagPills(item)}

    <div class="desc-wrap">
      <p class="desc">${esc(item.excerpt || "")}</p>
      <button class="toggle" type="button" data-id="${item.id}">Read more</button>
      <div class="more" id="more-${item.id}" hidden></div>
    </div>

    <div class="card__footer">
      ${likePill(item.likes)}
      <a class="myha-btn" href="${esc(item.import_url)}" target="_blank" rel="noopener">
        <span class="icon-ha"></span> Import to Home Assistant
      </a>
    </div>
  `;

  // expand/collapse
  const more = el.querySelector(`#more-${item.id}`);
  const toggle = el.querySelector(".toggle");
  let loaded = false, open = false;

  toggle.addEventListener("click", async () => {
    if (!open){
      if (!loaded){
        try{
          const data = await fetchJSON(`${API}/topic?id=${item.id}`);
          more.innerHTML = normalizeTopicHTML(data.cooked || "<em>Nothing to show.</em>");
          loaded = true;
        }catch(e){
          more.innerHTML = `<em>Failed to load post: ${esc(String(e.message||e))}</em>`;
        }
      }
      more.hidden = false;
      toggle.textContent = "Less";
      open = true;
    }else{
      more.hidden = true;
      toggle.textContent = "Read more";
      open = false;
    }
  });

  return el;
}

/* tags */
function renderTagPills(item){
  const tags = Array.from(new Set([...(item.tags||[])]));
  if (!tags.length) return "";
  return `<div class="tags">${tags.slice(0,4).map(t=>`<span class="tag">${esc(t)}</span>`).join("")}</div>`;
}

/* sanitize links inside loaded topic HTML; compact “Import blueprint” banner sizes */
function normalizeTopicHTML(html){
  const tmp = document.createElement("div");
  tmp.innerHTML = html;

  // shrink “Import Blueprint to My” banners (make consistent)
  tmp.querySelectorAll('a[href*="my.home-assistant.io/redirect/blueprint_import"]').forEach(a=>{
    a.classList.add("myha-inline"); // CSS below ensures consistent size
  });

  // ensure links open safely
  tmp.querySelectorAll("a[href]").forEach(a=>{
    a.setAttribute("target","_blank");
    a.setAttribute("rel","noopener");
  });

  return tmp.innerHTML;
}

/* ---------- contributors (recognition) ---------- */
function renderRecognition({ most_popular, most_uploaded, most_recent }){
  const wrap = $("#recognition");
  if (!wrap) return;

  // labels (with requested plural)
  const LAB = {
    popular: "Most Popular Blueprint",
    uploaded: "Most Uploaded Blueprints",
    recent: "Most Recent Upload"
  };

  const popularTitle = most_popular?.title ? cleanTitle(most_popular.title) : "";
  const recentTitle  = most_recent?.title  ? cleanTitle(most_recent.title)  : "";
  const uploadedCnt  = Number(most_uploaded?.count || 0);

  wrap.innerHTML = `
    <section class="contrib">
      <header class="contrib-head">
        <h3>Recognition</h3>
        <p>Shout-outs to creators moving the community forward.</p>
      </header>

      <div class="contrib-grid">
        <article class="contrib-card">
          <h4>${LAB.popular}</h4>
          <div class="contrib-body">
            <div class="contrib-author">${esc(most_popular?.author || "Unknown")}</div>
            <div class="contrib-sub">${esc(popularTitle)}</div>
          </div>
        </article>

        <article class="contrib-card">
          <h4>${LAB.uploaded}</h4>
          <div class="contrib-body">
            <div class="contrib-author">${esc(most_uploaded?.author || "Unknown")}</div>
            <div class="contrib-sub">${uploadedCnt} blueprint${uploadedCnt===1?"":"s"}</div>
          </div>
        </article>

        <article class="contrib-card">
          <h4>${LAB.recent}</h4>
          <div class="contrib-body">
            <div class="contrib-author">${esc(most_recent?.author || "Unknown")}</div>
            <div class="contrib-sub">${esc(recentTitle)}</div>
          </div>
        </article>
      </div>
    </section>
  `;
}

/* ---------- list bootstrapping (unchanged from your working code except we call cleanTitle in renderCard) ---------- */
async function boot(){
  const list = $("#list");
  const headingEl = $("#heading");
  const sortSel = $("#sort");
  const tagMenu = $("#tagmenu");
  const tagBtn = $("#tagbtn");
  const refreshBtn = $("#refresh");
  const search = $("#search");
  const sentinel = $("#sentinel");

  let page=0, hasMore=true, loading=false;
  let qTitle="", sort="new", bucket="";

  const setHeading = ()=>{
    const parts = [];
    if (sort === "likes") parts.push("Most liked");
    else if (sort === "title") parts.push("Title A–Z");
    else parts.push("Newest");
    if (bucket) parts.push(`• ${bucket}`);
    if (qTitle) parts.push(`• “${qTitle}”`);
    headingEl.textContent = `${parts.join(" ")} blueprints`;
  };

  async function fetchPage(p){
    const url = new URL(`${API}/blueprints`, location.origin);
    url.searchParams.set("page", String(p));
    if (qTitle) url.searchParams.set("q_title", qTitle);
    if (sort)   url.searchParams.set("sort", sort);
    if (bucket) url.searchParams.set("bucket", bucket);
    return fetchJSON(url.toString());
  }

  async function load(initial=false){
    if (loading || (!hasMore && !initial)) return;
    loading = true;
    try{
      const data = await fetchPage(page);
      if (initial) list.innerHTML = "";
      (data.items||[]).forEach(it => list.appendChild(renderCard(it)));
      hasMore = !!data.has_more;
      page += 1;
    }finally{
      loading = false;
    }
  }

  async function reloadAll(){
    page = 0; hasMore = true; list.innerHTML = "";
    setHeading();
    await load(true);
  }

  // sort
  if (sortSel){
    sortSel.addEventListener("sl-change", async ()=>{
      const val = sortSel.value;
      if (val === "likes" || val === "new" || val === "title") sort = val;
      await reloadAll();
    });
  }

  // tags
  if (tagMenu && tagBtn){
    tagMenu.addEventListener("sl-select", async (ev)=>{
      const v = ev.detail?.item?.value ?? "";
      bucket = v;
      tagBtn.textContent = bucket || "All tags";
      await reloadAll();
    });
  }

  // search
  if (search){
    const onSearch = debounce(async ()=>{
      qTitle = (search.value||"").trim();
      await reloadAll();
    }, 300);
    search.addEventListener("sl-input", onSearch);
    search.addEventListener("sl-clear", onSearch);
  }

  if (refreshBtn) refreshBtn.addEventListener("click", reloadAll);

  if (sentinel){
    const io = new IntersectionObserver((en)=>{
      if (en[0]?.isIntersecting) load(false);
    },{ rootMargin:"700px" });
    io.observe(sentinel);
  }

  // initial filters + recognition
  try{
    const data = await fetchJSON(`${API}/filters`);
    // populate tag menu
    if (tagMenu){
      tagMenu.innerHTML = `<sl-menu-item value="">All tags</sl-menu-item>` +
        (data.tags||[]).map(t=>`<sl-menu-item value="${esc(t)}">${esc(t)}</sl-menu-item>`).join("");
    }
  }catch{}

  try{
    const stats = await fetchJSON(`${API}/contributors`);
    renderRecognition(stats || {});
  }catch{}

  setHeading();
  await load(true);
}

document.addEventListener("DOMContentLoaded", boot);
