const API = "/api/blueprint_store";
const $ = (s) => document.querySelector(s);

/* Elements */
const list   = $("#list");
const top10C = $("#top10");
const empty  = $("#empty");
const errorB = $("#error");
const search = $("#search");
const sortSel = $("#sort");
const refreshBtn = $("#refresh");
const sentinel = $("#sentinel");
const activeChips = $("#active-chips");

/* Drawer / filters */
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
let allTags = [];
let activeTags = new Set();     // user-chosen
let stagedTags = new Set();     // staging inside drawer

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

function renderCard(it){
  const el = document.createElement("article");
  el.className = "card";
  el.innerHTML = `
    <div class="card__ribbon"></div>
    <div class="row">
      <h3>${esc(it.title)}</h3>
      ${it.author ? `<span class="author">by ${esc(it.author)}</span>` : ""}
      ${usesBadge(it.uses)}
    </div>
    <p class="desc">${esc(it.excerpt || "")}</p>
    ${tagPills(it.tags)}
    <div class="actions" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
      ${importButton(it.import_url)}
      <sl-button size="small" variant="default" pill class="forum">Forum post</sl-button>
    </div>
  `;
  el.querySelector(".forum").addEventListener("click", (e) => { e.preventDefault(); openExternal(it.topic_url); });
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
  if (activeTags.size) url.searchParams.set("tags", Array.from(activeTags).join(","));
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

/* ------- Active chips row ------- */
function renderActiveChips(){
  activeChips.innerHTML = "";
  if (!activeTags.size) return;
  for (const tag of activeTags){
    const chip = document.createElement("md-filter-chip");
    chip.setAttribute("selected", "");
    chip.textContent = tag;
    chip.addEventListener("click", async () => {
      activeTags.delete(tag);
      renderActiveChips();
      await loadAllForSearch();
    });
    activeChips.appendChild(chip);
  }
}

/* ------- Drawer / tags UI ------- */
function buildTagsGrid(filterText=""){
  tagsGrid.innerHTML = "";
  const ft = (filterText || "").toLowerCase();
  const toShow = allTags.filter(t => !ft || t.toLowerCase().includes(ft));
  toShow.forEach(tag => {
    const cb = document.createElement("sl-checkbox");
    cb.size = "small";
    cb.checked = stagedTags.has(tag);
    cb.innerText = tag;
    cb.addEventListener("sl-change", e => {
      if (e.target.checked) stagedTags.add(tag);
      else stagedTags.delete(tag);
    });
    tagsGrid.appendChild(cb);
  });
}

openFiltersBtn.addEventListener("click", () => {
  // stage current selection, open drawer
  stagedTags = new Set(activeTags);
  tagSearch.value = "";
  buildTagsGrid();
  drawer.show();
});

tagSearch.addEventListener("sl-input", () => buildTagsGrid(tagSearch.value));
tagSearch.addEventListener("sl-clear", () => buildTagsGrid(""));

applyBtn.addEventListener("click", async () => {
  activeTags = new Set(stagedTags);
  renderActiveChips();
  drawer.hide();
  await loadAllForSearch();
});

clearBtn.addEventListener("click", () => {
  stagedTags.clear(); buildTagsGrid(tagSearch.value);
});

/* ------- Top 10 / Filters data ------- */
async function loadTop10(){
  try{
    const data = await fetchJSON(`${API}/blueprints/top?limit=10`);
    top10C.innerHTML = "";
    appendItems(top10C, data.items || []);
  }catch(e){ /* not fatal */ }
}

async function loadFilters(){
  try{
    const data = await fetchJSON(`${API}/filters?pages=30`);
    allTags = data.tags || [];
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
await loadTop10();
renderActiveChips();
await load(true);
