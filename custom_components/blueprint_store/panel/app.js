const API = "/api/blueprint_store";
const $ = (s) => document.querySelector(s);

/* Elements */
const list   = $("#list");
const empty  = $("#empty");
const errorB = $("#error");
const search = $("#search");
const sortSel = $("#sort");
const refreshBtn = $("#refresh");
const sentinel = $("#sentinel");
const activeChips = $("#active-chips");

/* Drawer */
const drawer = $("#filters-drawer");
const openFiltersBtn = $("#open-filters");
const tagSearch = $("#tag-search");
const tagsGrid = $("#tags-grid");
const applyBtn = $("#apply-filters");
const clearBtn = $("#clear-filters");

/* State */
let page = 0;
let qTitle = "";
let loading = false;
let hasMore = true;
let sort = "new";
let allBuckets = [];
let activeBucket = null;     // one category at a time (clean UI)
let stagedBucket = null;

/* Utils */
function esc(s){ return (s||"").replace(/[&<>"']/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c])); }
const debounce = (fn,ms=280)=>{ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms); }; };
function setError(msg){ errorB.textContent = msg; errorB.style.display = "block"; }
function clearError(){ errorB.style.display = "none"; errorB.textContent = ""; }
function openExternal(url){ try { window.top?.open(url, "_blank", "noopener"); } catch { window.open(url, "_blank"); } }

/* My Home Assistant–style import button */
function importButton(href){
  return `
    <a class="myha-btn" href="${href}" target="_blank" rel="noopener">
      <sl-icon name="house"></sl-icon>
      Import to Home Assistant
    </a>`;
}

function usesBadge(n){ return n==null ? "" : `<span class="uses">${n.toLocaleString()} uses</span>`; }
function tagPills(tags){ if (!tags?.length) return ""; return `<div class="tags">${tags.slice(0,6).map(t=>`<span class="tag">${esc(t)}</span>`).join("")}</div>`; }

/* Read-more helpers */
function setPostHTML(container, html){
  container.innerHTML = html || "<em>Nothing to show.</em>";
  // ensure links open outside HA iframe
  container.querySelectorAll("a[href]").forEach(a => a.setAttribute("target","_blank"));
}

function renderCard(it){
  const el = document.createElement("article");
  el.className = "card";
  el.innerHTML = `
    <div class="row">
      <h3>${esc(it.title)}</h3>
      ${it.author ? `<span class="author">by ${esc(it.author)}</span>` : ""}
      ${usesBadge(it.uses)}
    </div>
    ${tagPills([it.bucket, ...(it.tags||[]).slice(0,3)])}
    <p class="desc">${esc(it.excerpt || "")}</p>

    <div class="toggle" data-id="${it.id}">Read more</div>
    <div class="more" id="more-${it.id}"></div>

    <div class="card__footer">
      <sl-button size="small" variant="default" pill class="forum">Forum post</sl-button>
      ${importButton(it.import_url)}
    </div>
  `;

  // Read more / less
  const toggle = el.querySelector(".toggle");
  const more = el.querySelector(`#more-${it.id}`);
  let expanded = false, loaded = false;
  toggle.addEventListener("click", async () => {
    expanded = !expanded;
    if (expanded && !loaded) {
      const data = await fetchJSON(`${API}/topic?id=${it.id}`);
      setPostHTML(more, data.cooked || "");
      loaded = true;
    }
    more.style.display = expanded ? "block" : "none";
    toggle.textContent = expanded ? "Less" : "Read more";
  });

  // Forum
  el.querySelector(".forum").addEventListener("click", (e) => {
    e.preventDefault(); openExternal(it.topic_url);
  });

  return el;
}

function appendItems(target, items){ for (const it of items) target.appendChild(renderCard(it)); }

async function fetchJSON(url){
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const data = await res.json();
  if (data && data.error) throw new Error(data.error);
  return data;
}

async function fetchPage(p){
  const url = new URL(`${API}/blueprints`, location.origin);
  url.searchParams.set("page", String(p));
  if (qTitle) url.searchParams.set("q_title", qTitle);
  if (activeBucket) url.searchParams.set("bucket", activeBucket);
  if (sort) url.searchParams.set("sort", sort);
  return await fetchJSON(url.toString());
}

async function load(initial=false){
  if (loading || (!hasMore && !initial)) return;
  loading = true; clearError();
  try{
    const data = await fetchPage(page);
    const items = data.items || [];
    hasMore = !!data.has_more;
    if (initial) {
      list.innerHTML = "";
      empty.style.display = items.length ? "none" : "block";
    }
    appendItems(list, items);
    page += 1;
  }catch(e){ setError(`Failed to load: ${String(e.message || e)}`); }
  finally{ loading = false; }
}

async function loadAllForSearch(){
  page = 0; hasMore = true; list.innerHTML = ""; clearError();
  let first = true;
  while (hasMore) {
    await load(first); first = false;
    await new Promise(r => setTimeout(r, 6));
  }
}

/* ------- Active chip ------- */
function renderActiveChips(){
  activeChips.innerHTML = "";
  if (!activeBucket) return;
  const chip = document.createElement("md-filter-chip");
  chip.setAttribute("selected", "");
  chip.textContent = activeBucket;
  chip.addEventListener("click", async () => {
    activeBucket = null; renderActiveChips(); await loadAllForSearch();
  });
  activeChips.appendChild(chip);
}

/* ------- Drawer / buckets UI ------- */
function buildBucketsUI(filterText=""){
  tagsGrid.innerHTML = "";
  const ft = (filterText || "").toLowerCase();
  const toShow = allBuckets.filter(t => !ft || t.toLowerCase().includes(ft));
  toShow.forEach(tag => {
    const btn = document.createElement("sl-button");
    btn.className = "tag-btn" + (stagedBucket === tag ? " selected" : "");
    btn.variant = "default";
    btn.pill = true;
    btn.textContent = tag;
    btn.addEventListener("click", () => {
      stagedBucket = (stagedBucket === tag) ? null : tag;
      buildBucketsUI(tagSearch.value);
    });
    tagsGrid.appendChild(btn);
  });
}

openFiltersBtn.addEventListener("click", async () => {
  stagedBucket = activeBucket;
  tagSearch.value = "";
  buildBucketsUI();
  drawer.show();
});
tagSearch.addEventListener("sl-input", () => buildBucketsUI(tagSearch.value));
tagSearch.addEventListener("sl-clear", () => buildBucketsUI(""));

applyBtn.addEventListener("click", async () => {
  activeBucket = stagedBucket;
  renderActiveChips();
  drawer.hide();
  await loadAllForSearch();
});
clearBtn.addEventListener("click", () => { stagedBucket = null; buildBucketsUI(tagSearch.value); });

/* ------- Filters list ------- */
async function loadFilters(){
  try{
    const data = await fetchJSON(`${API}/filters`);
    allBuckets = data.tags || [];
  }catch(e){ /* not fatal */ }
}

/* ------- Handlers: search/sort/refresh ------- */
const onSearch = debounce(async () => { qTitle = (search.value || "").trim(); await loadAllForSearch(); }, 280);
search.addEventListener("sl-input", onSearch);
search.addEventListener("sl-clear", onSearch);
sortSel.addEventListener("sl-change", async () => { sort = sortSel.value || "new"; await loadAllForSearch(); });
refreshBtn.addEventListener("click", async () => { await loadAllForSearch(); });

/* ------- Infinite scroll ------- */
const io = new IntersectionObserver((entries)=>{
  if (entries[0] && entries[0].isIntersecting) load(false);
},{ rootMargin:"700px" });
io.observe(sentinel);

/* ------- Kickoff ------- */
await loadFilters();
renderActiveChips();
await load(true);
