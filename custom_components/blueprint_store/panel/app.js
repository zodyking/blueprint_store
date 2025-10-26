const API = "/api/blueprint_store";
const $ = (s) => document.querySelector(s);

const list   = $("#list");
const empty  = $("#empty");
const errorB = $("#error");
const search = $("#search");
const refreshBtn = $("#refresh");
const sentinel = $("#sentinel");

let page = 0;
let qTitle = "";
let loading = false;
let hasMore = true;

function esc(s){ return (s||"").replace(/[&<>"']/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c])); }
const debounce = (fn,ms=250)=>{ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms); }; };

function openExternal(url){
  try { window.top?.open(url, "_blank", "noopener"); }
  catch { window.open(url, "_blank"); }
}

function usageBadge(uses){
  if (uses == null) return "";
  const n = uses.toLocaleString();
  return `<span class="ml-2 inline-flex items-center rounded-full bg-white/15 text-white/90 px-2 py-0.5 text-xs font-semibold">
    <svg class="mr-1 h-3.5 w-3.5" viewBox="0 0 24 24" fill="none"><path d="M20 7H4m16 5H4m16 5H4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
    ${n} uses</span>`;
}

function renderCard(it){
  const el = document.createElement("article");
  el.className = "rounded-2xl border border-white/15 bg-white/10 shadow-xl backdrop-blur p-4";
  el.innerHTML = `
    <div class="flex flex-wrap gap-2 items-baseline">
      <h3 class="text-lg md:text-xl font-extrabold leading-snug">${esc(it.title)}</h3>
      ${it.author ? `<span class="text-white/70 font-semibold">by ${esc(it.author)}</span>` : ""}
      ${usageBadge(it.uses)}
    </div>
    <p class="mt-2 text-white/80 leading-relaxed">${esc(it.excerpt || "")}</p>
    <div class="mt-3 flex flex-wrap gap-2">
      <a class="inline-flex items-center rounded-lg bg-sky-300 text-sky-900 px-3 py-2 text-sm font-bold shadow hover:translate-y-[1px] transition"
         href="${it.import_url}" target="_blank" rel="noopener">Import to Home Assistant</a>
      <a class="inline-flex items-center rounded-lg border border-white/20 text-white/90 px-3 py-2 text-sm font-semibold hover:bg-white/10 forum"
         href="${it.topic_url}">Forum post</a>
    </div>
  `;
  el.querySelector(".forum").addEventListener("click", (e) => { e.preventDefault(); openExternal(it.topic_url); });
  return el;
}

function appendItems(items){ for (const it of items) list.appendChild(renderCard(it)); }
function setError(msg){ errorB.textContent = msg; errorB.classList.remove("hidden"); }
function clearError(){ errorB.classList.add("hidden"); errorB.textContent = ""; }

async function fetchPage(p, queryTitle){
  const url = new URL(`${API}/blueprints`, location.origin);
  url.searchParams.set("page", String(p));
  if (queryTitle) url.searchParams.set("q_title", queryTitle);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

async function load(initial=false){
  if (loading || (!hasMore && !initial)) return;
  loading = true; clearError();
  try{
    const data = await fetchPage(page, qTitle);
    const items = Array.isArray(data) ? data : (data.items || []);
    hasMore = !!data.has_more;
    if (initial) {
      list.innerHTML = "";
      empty.classList.toggle("hidden", items.length > 0);
    }
    appendItems(items);
    page += 1;
  }catch(e){ setError(`Failed to load: ${String(e.message || e)}`); }
  finally{ loading = false; }
}

// When searching: reset and prefetch multiple pages so user sees "everything"
const onSearch = debounce(async () => {
  qTitle = (search.value || "").trim();
  page = 0; hasMore = true; list.innerHTML = ""; empty.classList.add("hidden");
  // prefetch until we have at least ~30 items or no more pages
  let collected = 0;
  while (hasMore && collected < 30) {
    await load(collected === 0);
    collected = list.childElementCount;
    if (!qTitle && collected >= 15) break; // default view doesn't need to preload too much
  }
  if (collected === 0) empty.classList.remove("hidden");
}, 250);

search.addEventListener("input", onSearch);

refreshBtn.addEventListener("click", async () => {
  page = 0; hasMore = true;
  await load(true);
});

const io = new IntersectionObserver((entries)=>{
  if (entries[0] && entries[0].isIntersecting) load(false);
},{ rootMargin:"600px" });
io.observe(sentinel);

load(true);
