const API = "/api/blueprint_browser";
const $ = (s) => document.querySelector(s);

const list   = $("#list");
const empty  = $("#empty");
const errorB = $("#error");
const search = $("#search");
const refreshBtn = $("#refresh");
const sentinel = $("#sentinel");

// state
let page = 0;
let q = "";
let loading = false;
let hasMore = true;

// utils
function esc(s){ return (s||"").replace(/[&<>"']/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c])); }
const debounce = (fn,ms=250)=>{ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms); }; };

// open external links from inside iframe safely in a new tab
function openExternal(url){
  try { window.top?.open(url, "_blank", "noopener"); }
  catch { window.open(url, "_blank"); }
}

// rendering
function renderCard(it){
  const el = document.createElement("article");
  el.className = "card";
  el.innerHTML = `
    <div class="row">
      <h3 class="title">${esc(it.title)}</h3>
      ${it.author ? `<span class="author">by ${esc(it.author)}</span>` : ""}
    </div>
    <div class="desc">${esc(it.excerpt || "")}</div>
    <div class="actions">
      <a class="import" href="${it.import_url}" target="_blank" rel="noopener">Import to Home Assistant</a>
      <a class="link forum" href="${it.topic_url}" rel="noopener">Forum post</a>
    </div>
  `;
  // force forum link into a new top-level tab (work around iframe X-Frame-Options)
  el.querySelector(".forum").addEventListener("click", (e) => {
    e.preventDefault();
    openExternal(it.topic_url);
  });
  return el;
}

function appendItems(items){
  for (const it of items) list.appendChild(renderCard(it));
}

function setError(msg){
  errorB.textContent = msg;
  errorB.style.display = "block";
}
function clearError(){ errorB.style.display = "none"; errorB.textContent = ""; }

// data
async function fetchPage(p, query){
  const url = new URL(`${API}/blueprints`, location.origin);
  url.searchParams.set("page", String(p));
  if (query) url.searchParams.set("q", query);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

async function load(initial=false){
  if (loading || !hasMore && !initial) return;
  loading = true;
  clearError();
  try{
    const data = await fetchPage(page, q);
    const items = Array.isArray(data) ? data : (data.items || []);
    hasMore = !!data.has_more;
    if (initial) {
      list.innerHTML = "";
      empty.style.display = items.length ? "none" : "block";
    }
    appendItems(items);
    page += 1;
  }catch(e){
    setError(`Failed to load: ${String(e.message || e)}`);
  }finally{
    loading = false;
  }
}

const onSearch = debounce(async () => {
  q = (search.value || "").trim();
  page = 0;
  hasMore = true;
  await load(true);
}, 250);

search.addEventListener("input", onSearch);

refreshBtn.addEventListener("click", async () => {
  page = 0; hasMore = true;
  await load(true);
});

// infinite scroll via IntersectionObserver
const io = new IntersectionObserver((entries)=>{
  const last = entries[0];
  if (last && last.isIntersecting) load(false);
}, { rootMargin: "600px" });
io.observe(sentinel);

// kick off
load(true);
