/* Blueprint Store panel JS
 * - Robust sort control (new / likes / title) with request cancellation
 * - Infinite scroll & search
 * - Safe external opener & forum redirect
 */

const API = "/api/blueprint_store";
const $ = (s) => document.querySelector(s);

/* ---------- helpers ---------- */
function esc(s){
  return (s||"").replace(/[&<>"']/g, c=>({
    "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"
  }[c]));
}
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

/* ----- resilient opener: blank tab -> then navigate (with meta refresh fallback) ----- */
function openExternal(url){
  try{
    const w = window.open("", "_blank");   // blank inherits our origin
    if (w) {
      try { w.opener = null; } catch {}
      const safe = String(url).replace(/"/g, "&quot;");
      // lightweight fallback content
      w.document.write(`<!doctype html><meta charset="utf-8">
        <title>Opening…</title>
        <style>body{font-family:system-ui,Segoe UI,Roboto;padding:2rem;color:#123}
        a{color:#06c;font-weight:700}</style>
        <p>Opening forum… If nothing happens <a href="${safe}">click here</a>.</p>
        <meta http-equiv="refresh" content="0; url='${safe}'">`);
      try { w.location.href = url; } catch {}
      return true;
    }
  } catch {}
  // ultimate fallback – same tab
  try { window.top.location.assign(url); } catch { location.assign(url); }
  return false;
}

/* pill buttons */
function importButton(href){
  return `
    <a class="myha-btn" data-open="${esc(href)}">
      <sl-icon name="house"></sl-icon>
      Import to Home Assistant
    </a>`;
}
function viewDescButton(){
  return `
    <button class="myha-btn neutral" data-viewdesc="1" type="button">
      <sl-icon name="document-text"></sl-icon>
      View description
    </button>`;
}
function forumButtonRedirect(tid, slug){
  const qs = new URLSearchParams({ tid: String(tid), slug: slug || "" }).toString();
  const href = `${API}/go?${qs}`;
  return `
    <a class="myha-btn secondary" data-open="${esc(href)}">
      <sl-icon name="box-arrow-up-right"></sl-icon>
      Forum post
    </a>`;
}
function usesBadge(n){ return n==null ? "" : `<span class="uses">${n.toLocaleString()} uses</span>`; }

/* tags renderer */
function tagPills(tags){
  const set = [];
  (tags || []).forEach(t => {
    const v = (t || "").toString().trim();
    if (v && !set.includes(v)) set.push(v);
  });
  if (!set.length) return "";
  return `<div class="tags">${set.slice(0,4).map(t=>`<span class="tag">${esc(t)}</span>`).join("")}</div>`;
}

/* -------- normalize post HTML & rewrite forum links via redirect ------ */
function rewriteToRedirect(href){
  try{
    const u = new URL(href);
    if (u.hostname !== "community.home-assistant.io") return null;
    // Discourse topic URLs are /t/<slug>/<id> or /t/<id>
    const parts = u.pathname.split("/").filter(Boolean);
    const idx = parts.indexOf("t");
    if (idx === -1) return null;
    let slug = "", id = "";
    if (parts[idx+1] && /^\d+$/.test(parts[idx+1])) {
      id = parts[idx+1];
    } else {
      slug = (parts[idx+1] || "");
      id = (parts[idx+2] || "").replace(/[^0-9]/g, "");
    }
    if (!id) return null;
    const qs = new URLSearchParams({ tid: id, slug }).toString();
    return `${API}/go?${qs}`;
  }catch{ return null; }
}

function setPostHTML(container, html){
  const tmp = document.createElement("div");
  tmp.innerHTML = html || "<em>Nothing to show.</em>";

  // Convert big MyHA banners to compact pill
  tmp.querySelectorAll('a[href*="my.home-assistant.io/redirect/blueprint_import"]').forEach(a=>{
    const href = a.getAttribute("href") || a.textContent || "#";
    const pill = document.createElement("a");
    pill.className = "myha-btn myha-inline-import";
    pill.setAttribute("data-open", href);
    pill.innerHTML = `<sl-icon name="house"></sl-icon> Import to Home Assistant`;
    a.replaceWith(pill);
  });

  // Rewrite forum-topic links to same-origin redirect + add data-open
  tmp.querySelectorAll('a[href^="https://community.home-assistant.io/"]').forEach(a=>{
    const redir = rewriteToRedirect(a.getAttribute("href"));
    if (redir) a.setAttribute("data-open", redir);
  });

  // intercept clicks on any data-open inside description
  tmp.addEventListener("click", (ev)=>{
    const a = ev.target.closest("[data-open]");
    if (!a) return;
    ev.preventDefault();
    openExternal(a.getAttribute("data-open"));
  });

  container.innerHTML = "";
  container.appendChild(tmp);
}

/* cache */
const detailCache = new Map();

/* card */
function renderCard(it){
  const el = document.createElement("article");
  el.className = "card";
  const visibleTags = [it.bucket, ...(it.tags || []).slice(0,3)];
  const ctaIsView = (it.import_count || 0) > 1;

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
      ${forumButtonRedirect(it.id, it.slug || "")}
      ${ctaIsView ? viewDescButton() : importButton(it.import_url)}
    </div>
  `;

  // Read more / less
  const toggle = el.querySelector(".toggle");
  const more = el.querySelector(`#more-${it.id}`);
  let expanded = false;
  async function expandNow(){
    if (!expanded) {
      expanded = true;
      toggle.style.pointerEvents = "none";
      try{
        if (!detailCache.has(it.id)) {
          const data = await fetchJSON(`${API}/topic?id=${it.id}`);
          detailCache.set(it.id, data.cooked || "");
        }
        setPostHTML(more, detailCache.get(it.id));
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
    if (expanded) {
      expanded = false;
      more.style.display = "none";
      toggle.textContent = "Read more";
    } else {
      await expandNow();
    }
  });

  // Intercept open buttons on the card footer
  el.addEventListener("click", (ev)=>{
    const opener = ev.target.closest("[data-open]");
    if (!opener) return;
    ev.preventDefault();
    openExternal(opener.getAttribute("data-open"));
  });

  const viewBtn = el.querySelector('button[data-viewdesc="1"]');
  if (viewBtn){
    viewBtn.addEventListener("click", async (ev)=>{ ev.preventDefault(); await expandNow(); });
  }

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

  const tagdd = $("#tagdd");
  const tagbtn = $("#tagbtn");
  const tagmenu = $("#tagmenu");

  if (!list) return;

  let page = 0;
  let qTitle = "";
  let loading = false;
  let hasMore = true;
  let sort = "new";
  const VALID_SORT = new Set(["new", "likes", "title"]);
  // token that invalidates in-flight loads (prevents stale appends)
  let runToken = 0;
  // initialize from control safely, if present
  if (sortSel && VALID_SORT.has(sortSel.value)) sort = sortSel.value;

  let bucket = "";

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
    }catch(e){ /* optional */ }
  }

  async function fetchPage(p){
    const url = new URL(`${API}/blueprints`, location.origin);
    url.searchParams.set("page", String(p));
    if (qTitle) url.searchParams.set("q_title", qTitle);
    if (sort) url.searchParams.set("sort", sort);
    if (bucket) url.searchParams.set("bucket", bucket);
    return await fetchJSON(url.toString());
  }

  async function load(initial=false){
    const tokenAtStart = runToken;
    if (loading || (!hasMore && !initial)) return;
    loading = true; clearError();
    try{
      const data = await fetchPage(page);
      // if a new run started while we were fetching, do nothing
      if (tokenAtStart !== runToken) return;
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
    // start a new run and invalidate any previous one
    const myToken = ++runToken;
    page = 0; hasMore = true; list.innerHTML = ""; clearError();
    let first = true;
    while (hasMore && myToken === runToken) {
      await load(first);
      first = false;
      // small yield for UI responsiveness
      await new Promise(r => setTimeout(r, 6));
    }
  }

  if (search){
    const onSearch = debounce(async () => { qTitle = (search.value || "").trim(); await loadAllForSearch(); }, 280);
    search.addEventListener("sl-input", onSearch);
    search.addEventListener("sl-clear", onSearch);
  }

  function setSortSafe(next){
    if (!VALID_SORT.has(next)) next = "new";
    if (sort === next) return false;                 // ignore no-op
    sort = next;
    if (sortSel && sortSel.value !== next) sortSel.value = next; // keep UI in sync
    return true;
  }
  if (sortSel){
    sortSel.addEventListener("sl-change", async (ev) => {
      const next = ev.target?.value || "new";
      if (setSortSafe(next)) await loadAllForSearch();
    }, { passive: true });
  }

  if (refreshBtn){
    refreshBtn.addEventListener("click", async () => { await loadAllForSearch(); });
  }

  if (sentinel){
    const io = new IntersectionObserver((entries)=>{
      if (entries[0] && entries[0].isIntersecting) load(false);
    },{ rootMargin:"700px" });
    io.observe(sentinel);
  }

  fetchFilters();
  load(true);
}

document.addEventListener("DOMContentLoaded", boot);
