const API = "/api/blueprint_store";
const $ = (s) => document.querySelector(s);

function esc(s){ return (s||"").replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",""":"&quot;","'":"&#39;"}[c])); }
const debounce = (fn,ms=280)=>{ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms); }; };

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
      const msg = String(e.message||e);
      if (i < tries-1 && /429/.test(msg)) {
        await new Promise(r=>setTimeout(r, delay + Math.random()*250));
        delay *= 2; continue;
      }
      throw e;
    }
  }
}

function openExternal(url){
  try{
    const w = window.open("", "_blank");
    if (w) {
      try { w.opener = null; } catch {}
      const safe = String(url).replace(/"/g, "&quot;");
      w.document.write(`<!doctype html><meta charset="utf-8">
        <title>Opening…</title>
        <style>body{font-family:system-ui,Segoe UI,Roboto;padding:2rem;color:#123}
        a{color:#06c;font-weight:700}</style>
        <p>Opening… If nothing happens <a href="${safe}">click here</a>.</p>
        <meta http-equiv="refresh" content="0; url='${safe}'">`);
      try { w.location.href = url; } catch {}
      return true;
    }
  } catch {}
  try { window.top.location.assign(url); } catch { location.assign(url); }
  return false;
}

const fmtCompact = (n)=> new Intl.NumberFormat(undefined,{notation:"compact", maximumFractionDigits:1}).format(Number(n||0));

function importButton(href){
  return `<a class="myha-btn" data-open="${esc(href)}"><sl-icon name="house"></sl-icon> Import to Home Assistant</a>`;
}
function viewDescButton(){
  return `<button class="myha-btn neutral" data-viewdesc="1" type="button"><sl-icon name="document-text"></sl-icon> View description</button>`;
}
function statsPill(id, likes, installs){
  const l = fmtCompact(likes ?? 0);
  const i = installs == null ? "0" : fmtCompact(installs);
  return `<button class="myha-btn secondary" type="button" data-stats="${String(id)}" title="Likes & installs">
    <sl-icon name="heart"></sl-icon><span class="likes">${l}</span>&nbsp;&nbsp;
    <sl-icon name="people"></sl-icon><span class="installs" data-installs="${String(id)}">${i}</span>
  </button>`;
}
function usesBadge(n){ return n==null ? "" : `<span class="uses">${n.toLocaleString()} uses</span>`; }

function tagPills(tags){
  const set = [];
  (tags || []).forEach(t => { const v = (t || "").toString().trim(); if (v && !set.includes(v)) set.push(v); });
  if (!set.length) return "";
  return `<div class="tags">${set.slice(0,4).map(t=>`<span class="tag">${esc(t)}</span>`).join("")}</div>`;
}

function rewriteToRedirect(href){
  try{
    const u = new URL(href);
    if (u.hostname !== "community.home-assistant.io") return null;
    const parts = u.pathname.split("/").filter(Boolean);
    const idx = parts.indexOf("t");
    if (idx === -1) return null;
    let slug = "", id = "";
    if (parts[idx+1] && /^\d+$/.test(parts[idx+1])) { id = parts[idx+1]; }
    else { slug = (parts[idx+1] || ""); id = (parts[idx+2] || "").replace(/[^0-9]/g, ""); }
    if (!id) return null;
    const qs = new URLSearchParams({ tid: id, slug }).toString();
    return `${API}/go?${qs}`;
  }catch{ return null; }
}

function setPostHTML(container, html){
  const tmp = document.createElement("div");
  tmp.innerHTML = html || "<em>Nothing to show.</em>";
  tmp.querySelectorAll('a[href*="my.home-assistant.io/redirect/blueprint_import"]').forEach(a=>{
    const href = a.getAttribute("href") || a.textContent || "#";
    const pill = document.createElement("a");
    pill.className = "myha-btn myha-inline-import";
    pill.setAttribute("data-open", href);
    pill.innerHTML = `<sl-icon name="house"></sl-icon> Import to Home Assistant`;
    a.replaceWith(pill);
  });
  tmp.querySelectorAll('a[href^="https://community.home-assistant.io/"]').forEach(a=>{
    const redir = rewriteToRedirect(a.getAttribute("href"));
    if (redir) a.setAttribute("data-open", redir);
  });
  tmp.addEventListener("click", (ev)=>{
    const a = ev.target.closest("[data-open]");
    if (!a) return;
    ev.preventDefault();
    openExternal(a.getAttribute("data-open"));
  });
  container.innerHTML = "";
  container.appendChild(tmp);
}

const detailCache = new Map();
const installCountCache = new Map();

async function ensureCooked(id){
  if (!detailCache.has(id)) {
    const data = await fetchJSON(`${API}/topic?id=${id}`);
    detailCache.set(id, data);
  }
  return detailCache.get(id);
}

function renderCard(it){
  const el = document.createElement("article");
  el.className = "card";
  const visibleTags = [it.bucket, ...(it.tags || []).slice(0,3)];
  const ctaIsView = (it.import_count || 0) > 1;
  const likes = Number(it.like_count || 0);
  const knownInstalls = installCountCache.get(it.id) ?? it.install_count ?? null;

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
      ${statsPill(it.id, likes, knownInstalls)}
      ${ctaIsView ? viewDescButton() : (it.import_url ? importButton(it.import_url) : '')}
    </div>`;

  const toggle = el.querySelector(".toggle");
  const more = el.querySelector(`#more-${it.id}`);
  let expanded = false;
  async function expandNow(){
    if (!expanded) {
      expanded = true;
      toggle.style.pointerEvents = "none";
      try{
        const data = await ensureCooked(it.id);
        setPostHTML(more, data.cooked || "");
        if (!it.import_url && data.import_url){
          const footer = el.querySelector(".card__footer");
          footer.insertAdjacentHTML("beforeend", importButton(data.import_url));
        }
        if (data.install_count != null){
          installCountCache.set(it.id, data.install_count);
          const instEl = el.querySelector(`[data-installs="${it.id}"]`);
          if (instEl) instEl.textContent = fmtCompact(data.install_count);
        }
      }catch(e){
        setPostHTML(more, `<em>Failed to load post: ${esc(String(e.message||e))}</em>`);
      }finally{
        toggle.style.pointerEvents = "";
      }
      more.style.display = "block";
      toggle.textContent = "Less";
    }
  }
  toggle.addEventListener("click", async () => {
    if (expanded) { expanded = false; more.style.display = "none"; toggle.textContent = "Read more"; }
    else { await expandNow(); }
  });

  el.addEventListener("click", async (ev)=>{
    const statsBtn = ev.target.closest('[data-stats]');
    if (statsBtn) {
      ev.preventDefault();
      const id = statsBtn.getAttribute('data-stats');
      const dlg = $("#statsDialog");
      const body = $("#statsBody");
      body.textContent = `Loading…`;
      dlg.show();
      try{
        const data = await ensureCooked(id);
        const installs = data.install_count ?? 0;
        installCountCache.set(id, installs);
        const instEl = el.querySelector(`[data-installs="${id}"]`);
        if (instEl) instEl.textContent = fmtCompact(installs);
        const likesNum = Number(it.like_count || 0);
        body.textContent = `${likesNum.toLocaleString()} people liked this post.\n${installs.toLocaleString()} people have imported this blueprint.`;
      }catch(e){
        body.textContent = String(e.message || e);
      }
      return;
    }
    const opener = ev.target.closest("[data-open]");
    if (opener) { ev.preventDefault(); openExternal(opener.getAttribute("data-open")); }
  });

  const viewBtn = el.querySelector('button[data-viewdesc="1"]');
  if (viewBtn){ viewBtn.addEventListener("click", async (ev)=>{ ev.preventDefault(); await expandNow(); }); }

  return el;
}

function appendItems(target, items){ for (const it of items) target.appendChild(renderCard(it)); }

function boot(){
  const list   = $("#list");
  const empty  = $("#empty");
  const errorB = $("#error");
  const search = $("#search");
  const sortSel = $("#sort");
  const refreshBtn = $("#refresh");
  const sentinel = $("#sentinel");
  const tagdd = $("#tagdd");
  const tagbtn = $("#tagbtn");
  const tagmenu = $("#tagmenu");
  if (!list) return;

  let page = 0, qTitle = "", loading = false, hasMore = true, sort = "new", bucket = "";

  const setError = (msg)=>{ if(errorB){ errorB.textContent = msg; errorB.style.display="block"; } };
  const clearError = ()=>{ if(errorB){ errorB.style.display="none"; errorB.textContent=""; } };

  async function fetchFilters(){
    try{
      const data = await fetchJSON(`${API}/filters`);
      const tags = Array.isArray(data.tags) ? data.tags : [];
      tagmenu.innerHTML = "";
      const mk = (value,label)=>`<sl-menu-item value="${esc(value)}">${esc(label)}</sl-menu-item>`;
      tagmenu.insertAdjacentHTML("beforeend", mk("", "All tags"));
      tags.forEach(t => tagmenu.insertAdjacentHTML("beforeend", mk(t, t)));
      tagmenu.addEventListener("sl-select", async (ev)=>{
        const val = ev.detail.item.value || "";
        bucket = val;
        tagbtn.textContent = bucket || "All tags";
        await loadAllForSearch();
        if (tagdd && typeof tagdd.hide === "function") tagdd.hide();
      });
    }catch(e){}
  }

  function buildUrl(p){
    const url = new URL(`${API}/blueprints`, location.origin);
    url.searchParams.set("page", String(p));
    if (qTitle) url.searchParams.set("q_title", qTitle);
    if (sort) url.searchParams.set("sort", sort);
    if (bucket) url.searchParams.set("bucket", bucket);
    return url.toString();
  }

  async function load(initial=false){
    if (loading || (!hasMore && !initial)) return;
    loading = true; clearError();
    try{
      const data = await fetchJSON(buildUrl(page));
      const items = data.items || [];
      hasMore = !!data.has_more;
      if (initial){ list.innerHTML = ""; if (empty) empty.style.display = items.length ? "none" : "block"; }
      appendItems(list, items);
      page += 1;
    }catch(e){ setError(`Failed to load: ${String(e.message||e)}`); }
    finally{ loading = false; }
  }

  async function loadAllForSearch(){
    page = 0; hasMore = true; list.innerHTML = ""; clearError();
    let first = true;
    while (hasMore) { await load(first); first = false; await new Promise(r => setTimeout(r, 6)); }
  }

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

  if (sentinel){
    const io = new IntersectionObserver((entries)=>{ if (entries[0] && entries[0].isIntersecting) load(false); },{ rootMargin:"700px" });
    io.observe(sentinel);
  }

  fetchFilters();
  load(true);
}

document.addEventListener("DOMContentLoaded", boot);
