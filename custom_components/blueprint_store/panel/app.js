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

/* State */
let page = 0;
let qTitle = "";
let loading = false;
let hasMore = true;
let sort = "new";

/* Utils */
function esc(s){ return (s||"").replace(/[&<>"']/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c])); }
const debounce = (fn,ms=280)=>{ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms); }; };
function setError(msg){ errorB.textContent = msg; errorB.style.display = "block"; }
function clearError(){ errorB.style.display = "none"; errorB.textContent = ""; }
function openExternal(url){ try { window.top?.open(url, "_blank", "noopener"); } catch { window.open(url, "_blank"); } }

/* My Home Assistant–style button */
function importButton(href){
  return `
    <a class="myha-btn" href="${href}" target="_blank" rel="noopener">
      <sl-icon name="house"></sl-icon>
      Import to Home Assistant
    </a>`;
}

/* Secondary pill button for forum */
function forumButton(href){
  return `
    <a class="myha-btn secondary" href="${href}" target="_blank" rel="noopener">
      <sl-icon name="box-arrow-up-right"></sl-icon>
      Forum post
    </a>`;
}

function usesBadge(n){ return n==null ? "" : `<span class="uses">${n.toLocaleString()} uses</span>`; }

/* Prevent blank tag chips: filter empties/dupes and trim, cap length */
function tagPills(tags){
  const set = [];
  (tags || []).forEach(t => {
    const v = (t || "").toString().trim();
    if (v && !set.includes(v)) set.push(v);
  });
  if (!set.length) return "";
  return `<div class="tags">${set.slice(0,4).map(t=>`<span class="tag">${esc(t)}</span>`).join("")}</div>`;
}

/* Read-more helpers */
function setPostHTML(container, html){
  container.innerHTML = html || "<em>Nothing to show.</em>";
  container.querySelectorAll("a[href]").forEach(a => a.setAttribute("target","_blank"));
}

function renderCard(it){
  const el = document.createElement("article");
  el.className = "card";

  // compose visible tags: bucket + a couple of post tags
  const visibleTags = [it.bucket, ...(it.tags || []).slice(0,3)];

  el.innerHTML = `
    <div class="row">
      <h3>${esc(it.title)}</h3>
      ${it.author ? `<span class="author">by ${esc(it.author)}</span>` : ""}
      ${usesBadge(it.uses)}
    </div>
    ${tagPills(visibleTags)}
    <p class="desc">${esc(it.excerpt || "")}</p>

    <div class="toggle" data-id="${it.id}">Read more</div>
    <div class="more" id="more-${it.id}"></div>

    <div class="card__footer">
      ${forumButton(it.topic_url)}
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

/* Handlers */
const onSearch = debounce(async () => { qTitle = (search.value || "").trim(); await loadAllForSearch(); }, 280);
search.addEventListener("sl-input", onSearch);
search.addEventListener("sl-clear", onSearch);

sortSel.addEventListener("sl-change", async () => { sort = sortSel.value || "new"; await loadAllForSearch(); });
refreshBtn.addEventListener("click", async () => { await loadAllForSearch(); });

/* Infinite scroll */
const io = new IntersectionObserver((entries)=>{
  if (entries[0] && entries[0].isIntersecting) load(false);
},{ rootMargin:"700px" });
io.observe(sentinel);

/* Kickoff */
await load(true);
