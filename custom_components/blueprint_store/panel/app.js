const API = "/api/blueprint_store";
const $ = (s) => document.querySelector(s);

/* ---------- helpers ---------- */
function esc(s){
  return (s||"").replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
}
const debounce = (fn,ms=280)=>{ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms); }; };
const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));

async function fetchJSONRaw(url){
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const data = await res.json();
  if (data && data.error) throw new Error(data.error);
  return data;
}
async function fetchJSON(url, tries=3){
  let delay = 600;
  for(let i=0;i<tries;i++){
    try{ return await fetchJSONRaw(url); }
    catch(e){
      if (i < tries-1 && /429/.test(String(e))) { await sleep(delay+Math.random()*250); delay*=2; continue; }
      throw e;
    }
  }
}

/* small utils */
function fmtK(n){ if (n==null) return "0"; if (n>=1000) return (Math.round(n/100)/10)+"k"; return String(n); }

/* render tag pills */
function tagPills(tags){
  const arr = [];
  (tags||[]).forEach(t=>{
    const v=(t||"").toString().trim();
    if (v && !arr.includes(v)) arr.push(v);
  });
  if (!arr.length) return "";
  return `<div class="tags">${arr.slice(0,4).map(t=>`<span class="tag">${esc(t)}</span>`).join("")}</div>`;
}

/* normalize & insert cooked HTML */
function setPostHTML(container, html){
  const tmp = document.createElement("div");
  tmp.innerHTML = html || "<em>Nothing to show.</em>";
  container.innerHTML = "";
  container.appendChild(tmp);
}

/* cache */
const detailCache = new Map();

/* card */
function renderCard(it){
  const el = document.createElement("article");
  el.className = "card";

  el.innerHTML = `
    <div class="row">
      <h3>${esc(it.title)}</h3>
      ${it.author ? `<span class="author">by ${esc(it.author)}</span>` : ""}
    </div>
    ${tagPills(it.tags)}

    <div class="desc-box">
      <p class="desc" id="desc-${it.id}">${esc(it.excerpt || "")}</p>
      <div class="more" id="more-${it.id}"></div>
      <div class="toggle" data-id="${it.id}">Read more</div>
    </div>

    <div class="card__footer">
      <a class="myha-btn" data-open="${esc(it.import_url)}">
        <sl-icon name="download"></sl-icon>
        Import to Home Assistant
      </a>
    </div>

    <div class="stat-pill">
      <sl-icon name="heart"></sl-icon>
      <span class="count">${fmtK(it.likes)}</span>
      <span class="label">Liked this</span>
    </div>
  `;

  // Expand/Collapse in-place
  const toggle = el.querySelector(".toggle");
  const more = el.querySelector(`#more-${it.id}`);
  let expanded = false;

  async function expandNow(){
    if (expanded) return;
    expanded = true;
    toggle.style.pointerEvents = "none";
    try{
      if (!detailCache.has(it.id)) {
        const data = await fetchJSON(`${API}/topic?id=${it.id}`);
        detailCache.set(it.id, data.cooked || "");
      }
      setPostHTML(more, detailCache.get(it.id));
      more.style.display = "block";
      toggle.textContent = "Less";
    }catch(e){
      setPostHTML(more, `<em>Failed to load post: ${esc(String(e.message||e))}</em>`);
      more.style.display = "block";
      toggle.textContent = "Less";
    }finally{
      toggle.style.pointerEvents = "";
    }
  }

  toggle.addEventListener("click", async () => {
    if (!expanded) { await expandNow(); }
    else { expanded = false; more.style.display = "none"; toggle.textContent = "Read more"; }
  });

  // Import button
  el.addEventListener("click", (ev)=>{
    const a = ev.target.closest("[data-open]");
    if (!a) return;
    ev.preventDefault();
    try{ window.open(a.getAttribute("data-open"), "_blank"); }catch{}
  });

  return el;
}

function appendItems(target, items){
  for (const it of items) target.appendChild(renderCard(it));
}

/* boot */
function boot(){
  const list   = $("#list");
  const empty  = $("#empty");
  const errorB = $("#error");
  const search = $("#search");
  const sortSel = $("#sort");
  const refreshBtn = $("#refresh");
  const sentinel = $("#sentinel");
  const sectionTitle = $("#sectionTitle");

  const tagdd = $("#tagdd");
  const tagbtn = $("#tagbtn");
  const tagmenu = $("#tagmenu");

  if (!list) return;

  let page = 0;
  let qTitle = "";
  let loading = false;
  let hasMore = true;
  let sort = "new";
  let tag = "";

  const setError = (msg)=>{ if(errorB){ errorB.textContent = msg; errorB.style.display="block"; } };
  const clearError = ()=>{ if(errorB){ errorB.style.display="none"; errorB.textContent=""; } };

  function updateTitle(){
    const base = sort==="likes" ? "Most liked blueprints" :
                 sort==="title" ? "A–Z blueprints" : "Newest blueprints";
    sectionTitle.textContent = tag ? `${base} — “${tag}”` : base;
  }

  async function fetchFilters(){
    try{
      const data = await fetchJSON(`${API}/filters`);
      const tags = Array.isArray(data.tags) ? data.tags : [];
      tagmenu.innerHTML = "";
      const mk = (value,label)=>`<sl-menu-item value="${esc(value)}">${esc(label)}</sl-menu-item>`;
      tagmenu.insertAdjacentHTML("beforeend", mk("", "All tags"));
      tags.forEach(t => tagmenu.insertAdjacentHTML("beforeend", mk(t, t)));
      tagmenu.addEventListener("sl-select", async (ev)=>{
        tag = ev.detail.item.value || "";
        tagbtn.textContent = tag || "All tags";
        updateTitle();
        await loadAllForSearch();
        if (tagdd && typeof tagdd.hide === "function") tagdd.hide();
      });
    }catch(e){ /* optional */ }
  }

  async function fetchPage(p){
    const url = new URL(`${API}/blueprints`, location.origin);
    url.searchParams.set("page", String(p));
    if (qTitle) url.searchParams.set("q_title", qTitle);
    if (sort) url.searchParams.set("sort", sort);
    if (tag) url.searchParams.set("tag", tag); // IMPORTANT: use 'tag' param (loads ALL pages)
    return await fetchJSON(url.toString());
  }

  async function load(initial=false){
    if (loading || (!hasMore && !initial)) return;
    loading = true; clearError();
    try{
      const data = await fetchPage(page);
      const items = data.items || [];
      hasMore = !!data.has_more;
      if (initial){
        list.innerHTML = "";
        if (empty) empty.style.display = items.length ? "none" : "block";
      }
      appendItems(list, items);
      page += 1;
    }catch(e){
      setError(`Failed to load: ${String(e.message||e)}`);
    }finally{
      loading = false;
    }
  }

  async function loadAllForSearch(){
    page = 0; hasMore = true; list.innerHTML = ""; clearError();
    let first = true;
    while (hasMore) { await load(first); first = false; await sleep(6); }
  }

  if (search){
    const onSearch = debounce(async () => { qTitle = (search.value || "").trim(); updateTitle(); await loadAllForSearch(); }, 280);
    search.addEventListener("sl-input", onSearch);
    search.addEventListener("sl-clear", onSearch);
  }
  if (sortSel){
    sortSel.addEventListener("sl-change", async () => {
      const v = sortSel.value;
      sort = (v==="likes"||v==="title"||v==="new") ? v : "new"; // harden
      updateTitle();
      await loadAllForSearch();
    });
  }
  if (refreshBtn){ refreshBtn.addEventListener("click", async () => { await loadAllForSearch(); }); }

  if (sentinel){
    const io = new IntersectionObserver((entries)=>{ if (entries[0] && entries[0].isIntersecting) load(false); },{ rootMargin:"700px" });
    io.observe(sentinel);
  }

  updateTitle();
  fetchFilters();
  load(true);
}

document.addEventListener("DOMContentLoaded", boot);
