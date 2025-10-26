const API = "/api/blueprint_store";
const $ = (s) => document.querySelector(s);

function esc(s){ return (s||"").replace(/[&<>"']/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c])); }
const debounce = (fn,ms=280)=>{ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms); }; };

function importButton(href){
  return `
    <a class="myha-btn" href="${href}" target="_blank" rel="noopener">
      <sl-icon name="house"></sl-icon>
      Import to Home Assistant
    </a>`;
}
function forumButton(href){
  return `
    <a class="myha-btn secondary" href="${href}" target="_blank" rel="noopener">
      <sl-icon name="box-arrow-up-right"></sl-icon>
      Forum post
    </a>`;
}
function usesBadge(n){ return n==null ? "" : `<span class="uses">${n.toLocaleString()} uses</span>`; }
function tagPills(tags){
  const set = [];
  (tags || []).forEach(t => {
    const v = (t || "").toString().trim();
    if (v && !set.includes(v)) set.push(v);
  });
  if (!set.length) return "";
  return `<div class="tags">${set.slice(0,4).map(t=>`<span class="tag">${esc(t)}</span>`).join("")}</div>`;
}
function setPostHTML(container, html){
  container.innerHTML = html || "<em>Nothing to show.</em>";
  container.querySelectorAll("a[href]").forEach(a => a.setAttribute("target","_blank"));
}

async function fetchJSON(url){
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const data = await res.json();
  if (data && data.error) throw new Error(data.error);
  return data;
}

function renderCard(it){
  const el = document.createElement("article");
  el.className = "card";
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
  const toggle = el.querySelector(".toggle");
  const more = el.querySelector(`#more-${it.id}`);
  let expanded = false, loaded = false;
  toggle.addEventListener("click", async () => {
    expanded = !expanded;
    if (expanded && !loaded) {
      try {
        const data = await fetchJSON(`${API}/topic?id=${it.id}`);
        setPostHTML(more, data.cooked || "");
        loaded = true;
      } catch (e) {
        setPostHTML(more, `<em>Failed to load post: ${esc(String(e.message||e))}</em>`);
      }
    }
    more.style.display = expanded ? "block" : "none";
    toggle.textContent = expanded ? "Less" : "Read more";
  });
  return el;
}

function appendItems(target, items){ for (const it of items) target.appendChild(renderCard(it)); }

function boot(){
  // Grab DOM nodes safely
  const list   = $("#list");
  const empty  = $("#empty");
  const errorB = $("#error");
  const search = $("#search");
  const sortSel = $("#sort");
  const refreshBtn = $("#refresh");
  const sentinel = $("#sentinel");

  if (!list) return; // nothing to do if panel DOM failed to load

  // State
  let page = 0;
  let qTitle = "";
  let loading = false;
  let hasMore = true;
  let sort = "new";

  const setError = (msg)=>{ if(errorB){ errorB.textContent = msg; errorB.style.display="block"; } };
  const clearError = ()=>{ if(errorB){ errorB.style.display="none"; errorB.textContent=""; } };

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
    while (hasMore) {
      await load(first); first = false;
      await new Promise(r => setTimeout(r, 6));
    }
  }

  // Handlers
  if (search){
    const onSearch = debounce(async () => { qTitle = (search.value || "").trim(); await loadAllForSearch(); }, 280);
    search.addEventListener("sl-input", onSearch);
    search.addEventListener("sl-clear", onSearch);
  }
  if (sortSel){
    sortSel.addEventListener("sl-change", async () => { sort = sortSel.value || "new"; await loadAllForSearch(); });
  }
  if (refreshBtn){
    refreshBtn.addEventListener("click", async () => { await loadAllForSearch(); });
  }

  // Infinite scroll (guard sentinel)
  if (sentinel){
    const io = new IntersectionObserver((entries)=>{
      if (entries[0] && entries[0].isIntersecting) load(false);
    },{ rootMargin:"700px" });
    io.observe(sentinel);
  }

  // Initial load
  load(true);
}

// Start after DOM is parsed (script is deferred)
document.addEventListener("DOMContentLoaded", boot);
