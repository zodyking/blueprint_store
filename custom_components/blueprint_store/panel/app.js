const API = "/api/blueprint_store";
const $ = (s) => document.querySelector(s);

const list   = $("#list");
const top10C = $("#top10");
const empty  = $("#empty");
const errorB = $("#error");
const search = $("#search");
const refreshBtn = $("#refresh");
const tagsSel = $("#tags");
const chips = $("#chips");
const sortSel = $("#sort");
const sentinel = $("#sentinel");

let page = 0;
let qTitle = "";
let loading = false;
let hasMore = true;
let activeTags = [];
let sort = "new";

function esc(s){ return (s||"").replace(/[&<>"']/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c])); }
const debounce = (fn,ms=300)=>{ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms); }; };

function openExternal(url){
  try { window.top?.open(url, "_blank", "noopener"); }
  catch { window.open(url, "_blank"); }
}

function usesBadge(n){
  if (n == null) return "";
  return `<span class="uses">${n.toLocaleString()} uses</span>`;
}

function renderCard(it){
  const el = document.createElement("article");
  el.className = "card";
  el.innerHTML = `
    <div class="row">
      <h3>${esc(it.title)}</h3>
      ${it.author ? `<span style="opacity:.85;font-weight:700">by ${esc(it.author)}</span>` : ""}
      ${usesBadge(it.uses)}
    </div>
    <p class="desc">${esc(it.excerpt || "")}</p>
    <div class="actions">
      <sl-button size="small" variant="primary" pill href="${it.import_url}" target="_blank" rel="noopener">Import to Home Assistant</sl-button>
      <sl-button size="small" variant="default" pill class="forum">Forum post</sl-button>
    </div>
  `;
  el.querySelector(".forum").addEventListener("click", (e) => {
    e.preventDefault(); openExternal(it.topic_url);
  });
  return el;
}

function appendItems(target, items){
  for (const it of items) target.appendChild(renderCard(it));
}

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
  if (activeTags.length) url.searchParams.set("tags", activeTags.join(","));
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
  // Aggressively fetch all pages so “everything” matching the title appears
  page = 0; hasMore = true; list.innerHTML = ""; clearError();
  let total = 0;
  while (hasMore) {
    await load(total === 0);
    total = list.childElementCount;
    // yield back to UI a bit
    await new Promise(r => setTimeout(r, 10));
  }
}

/* ---- Filters & search ---- */
const onSearch = debounce(async () => {
  qTitle = (search.value || "").trim();
  await loadAllForSearch();
}, 300);

search.addEventListener("sl-input", onSearch);
search.addEventListener("sl-clear", onSearch);

tagsSel.addEventListener("sl-change", async () => {
  activeTags = Array.from(tagsSel.value || []);
  renderTagChips();
  await loadAllForSearch();
});

sortSel.addEventListener("sl-change", async () => {
  sort = sortSel.value || "new";
  await loadAllForSearch();
});

refreshBtn.addEventListener("click", async () => {
  await loadAllForSearch();
});

function renderTagChips(){
  chips.innerHTML = "";
  activeTags.forEach(tag => {
    const chip = document.createElement("md-filter-chip");
    chip.setAttribute("selected", "");
    chip.textContent = tag;
    chip.addEventListener("click", async () => {
      // toggle off when clicked
      const idx = activeTags.indexOf(tag);
      if (idx >= 0) { activeTags.splice(idx, 1); updateTagsSelect(); await loadAllForSearch(); }
    });
    chips.appendChild(chip);
  });
}
function updateTagsSelect(){
  // keep the Shoelace <sl-select multiple> in sync with activeTags
  tagsSel.value = [...activeTags];
}

/* ---- Top 10 ---- */
async function loadTop10(){
  try{
    const data = await fetchJSON(`${API}/blueprints/top?limit=10`);
    top10C.innerHTML = "";
    appendItems(top10C, data.items || []);
  }catch(e){ /* not fatal */ }
}

/* ---- Tag list population ---- */
async function loadFilters(){
  try{
    const data = await fetchJSON(`${API}/filters?pages=30`);
    const tags = data.tags || [];
    tagsSel.innerHTML = "";
    for (const tag of tags){
      const opt = document.createElement("sl-option");
      opt.value = tag; opt.textContent = tag;
      tagsSel.appendChild(opt);
    }
  }catch(e){ /* not fatal */ }
}

/* ---- Infinite scroll ---- */
const io = new IntersectionObserver((entries)=>{
  if (entries[0] && entries[0].isIntersecting) load(false);
},{ rootMargin:"700px" });
io.observe(sentinel);

/* ---- Kickoff ---- */
await loadFilters();
await loadTop10();
await load(true);
