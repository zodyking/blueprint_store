const API = "/api/blueprint_store";
const $ = (s) => document.querySelector(s);

const list   = $("#list");
const top10C = $("#top10");
const empty  = $("#empty");
const errorB = $("#error");
const search = $("#search");
const refreshBtn = $("#refresh");
const sortSel = $("#sort");
const tagsList = $("#tags-list");
const clearBtn = $("#clear-filters");
const sentinel = $("#sentinel");

let page = 0;
let qTitle = "";
let loading = false;
let hasMore = true;
let sort = "new";
let activeTags = new Set();

function esc(s){ return (s||"").replace(/[&<>"']/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c])); }
const debounce = (fn,ms=280)=>{ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms); }; };

function openExternal(url){
  try { window.top?.open(url, "_blank", "noopener"); }
  catch { window.open(url, "_blank"); }
}

function usesBadge(n){ return n==null ? "" : `<span class="uses">${n.toLocaleString()} uses</span>`; }

/* My Home Assistant style import button HTML */
function importButton(href){
  return `
    <a class="myha-btn" href="${href}" target="_blank" rel="noopener">
      <sl-icon name="house"></sl-icon>
      Import to Home Assistant
    </a>`;
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
    <p class="desc">${esc(it.excerpt || "")}</p>
    <div class="actions" style="display:flex;gap:8px;flex-wrap:wrap">
      ${importButton(it.import_url)}
      <sl-button size="small" variant="default" pill class="forum">Forum post</sl-button>
    </div>
  `;
  el.querySelector(".forum").addEventListener("click", (e) => {
    e.preventDefault(); openExternal(it.topic_url);
  });
  return el;
}

function appendItems(target, items){ for (const it of items) target.appendChild(renderCard(it)); }
function setError(msg){ errorB.textContent = msg; errorB.style.display = "block"; }
function clearError(){ errorB.style.display = "none"; errorB.textContent = ""; }

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
  // Fetch all pages for a “complete” title match result set
  page = 0; hasMore = true; list.innerHTML = ""; clearError();
  let first = true;
  while (hasMore) {
    await load(first); first = false;
    // let UI breathe
    await new Promise(r => setTimeout(r, 6));
  }
}

/* ---------- Filters & search ---------- */
const onSearch = debounce(async () => { qTitle = (search.value || "").trim(); await loadAllForSearch(); }, 280);
search.addEventListener("sl-input", onSearch);
search.addEventListener("sl-clear", onSearch);

sortSel.addEventListener("sl-change", async () => {
  sort = sortSel.value || "new";
  await loadAllForSearch();
});

clearBtn.addEventListener("click", async () => {
  activeTags.clear();
  // uncheck all
  tagsList.querySelectorAll("sl-checkbox").forEach(cb => cb.checked = false);
  await loadAllForSearch();
});

/* Build tag checkboxes in the sidebar */
async function loadFilters(){
  try{
    const data = await fetchJSON(`${API}/filters?pages=30`);
    const tags = data.tags || [];
    tagsList.innerHTML = "";
    for (const tag of tags){
      const row = document.createElement("sl-checkbox");
      row.size = "small";
      row.innerText = tag;
      row.addEventListener("sl-change", async (e) => {
        if (e.target.checked) activeTags.add(tag);
        else activeTags.delete(tag);
        // debounce to avoid glitch while quickly toggling
        scheduleReload();
      });
      tagsList.appendChild(row);
    }
  }catch(e){ /* not fatal */ }
}

/* Debounced reload after tag toggles */
let reloadT = null;
function scheduleReload(){ clearTimeout(reloadT); reloadT = setTimeout(loadAllForSearch, 200); }

/* ---------- Top 10 ---------- */
async function loadTop10(){
  try{
    const data = await fetchJSON(`${API}/blueprints/top?limit=10`);
    top10C.innerHTML = "";
    appendItems(top10C, data.items || []);
  }catch(e){ /* not fatal */ }
}

/* ---------- Infinite scroll ---------- */
const io = new IntersectionObserver((entries)=>{
  if (entries[0] && entries[0].isIntersecting) load(false);
},{ rootMargin:"700px" });
io.observe(sentinel);

/* ---------- Kickoff ---------- */
await loadFilters();
await loadTop10();
await load(true);
