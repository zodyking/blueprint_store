const API = "/api/blueprint_store";
const $ = (s) => document.querySelector(s);

/* ---------- helpers ---------- */
function esc(s){
  return (s||"").replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
}
const debounce = (fn,ms=280)=>{ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms); }; };

function formatCount(n){
  if (n == null || isNaN(n)) return "–";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return (n/1_000_000).toFixed(abs>=10_000_000?0:1)+"m";
  if (abs >= 1_000)     return (n/1_000).toFixed(abs>=10_000?0:1)+"k";
  return String(n);
}

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

/* ----- resilient opener used elsewhere (unchanged) ----- */
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
        <p>Opening forum… If nothing happens <a href="${safe}">click here</a>.</p>
        <meta http-equiv="refresh" content="0; url='${safe}'">`);
      try { w.location.href = url; } catch {}
      return true;
    }
  } catch {}
  try { window.top.location.assign(url); } catch { location.assign(url); }
  return false;
}

/* pill buttons (unchanged visuals for Import & Forum) */
function importButton(href){
  return `
    <a class="myha-btn" data-open="${esc(href)}">
      <sl-icon name="house"></sl-icon>
      Import to Home Assistant
    </a>`;
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

/* -------- normalize post HTML when expanding ------ */
function rewriteToRedirect(href){
  try{
    const u = new URL(href);
    if (u.hostname !== "community.home-assistant.io") return null;
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

  // Compact internal import badges
  tmp.querySelectorAll('a[href*="my.home-assistant.io/redirect/blueprint_import"]').forEach(a=>{
    const href = a.getAttribute("href") || a.textContent || "#";
    const pill = document.createElement("a");
    pill.className = "myha-btn myha-inline-import";
    pill.setAttribute("data-open", href);
    pill.innerHTML = `<sl-icon name="house"></sl-icon> Import to Home Assistant`;
    a.replaceWith(pill);
  });

  // Rewrite forum topic links to redirect endpoint
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

/* ---- metric helpers ---- */
function extractInstallsFromCooked(cookedHtml){
  if (!cookedHtml) return null;
  const tmp = document.createElement("div");
  tmp.innerHTML = cookedHtml;

  // Look for the MY import button and try to read a numeric badge near it
  const a = tmp.querySelector('a[href*="my.home-assistant.io/redirect/blueprint_import"]');
  if (!a) return null;

  // Strategy 1: numeric sibling element
  let sibling = a.nextElementSibling;
  while (sibling && sibling.textContent.trim() === "") sibling = sibling.nextElementSibling;
  if (sibling) {
    const m = sibling.textContent.trim().match(/(\d[\d.,]*(?:[kKmM])?)/);
    if (m) return unformatCount(m[1]);
  }

  // Strategy 2: search within parent text near the link
  const parentText = a.parentElement ? a.parentElement.innerText : "";
  const near = parentText.replace(/\s+/g, " ");
  // prefer the last compact number like 23.7k
  const numbers = [...near.matchAll(/(\d[\d.,]*(?:[kKmM])?)/g)].map(x=>x[1]);
  if (numbers.length){
    const val = unformatCount(numbers[numbers.length-1]);
    if (!isNaN(val)) return val;
  }

  return null;
}

function unformatCount(s){
  const raw = String(s).trim().toLowerCase();
  if (raw.endsWith("m")) return Math.round(parseFloat(raw)*1_000_000);
  if (raw.endsWith("k")) return Math.round(parseFloat(raw)*1_000);
  return parseInt(raw.replace(/[^\d]/g,""),10);
}

/* cache for expanded content */
const detailCache = new Map();

/* ------- card renderer ------- */
function renderCard(it){
  const el = document.createElement("article");
  el.className = "card";
  const visibleTags = [it.bucket, ...(it.tags || []).slice(0,3)];
  const initialLikes = it.likes ?? null;
  const initialInstalls = it.uses ?? null;

  el.innerHTML = `
    <div class="row">
      <h3>${esc(it.title)}</h3>
      ${it.author ? `<span class="author">by ${esc(it.author)}</span>` : ""}
    </div>
    ${tagPills(visibleTags)}
    <p class="desc">${esc(it.excerpt || "")}</p>

    <div class="toggle" data-id="${it.id}">Read more</div>
    <div class="more" id="more-${it.id}"></div>

    <div class="card__footer">
      <div class="stats" aria-label="Engagement">
        <span class="metric" data-like><sl-icon name="heart"></sl-icon><span class="val">${formatCount(initialLikes)}</span></span>
        <span class="metric" data-install><sl-icon name="chat-right-heart"></sl-icon><span class="val">${formatCount(initialInstalls)}</span></span>
      </div>
      ${it.import_url ? importButton(it.import_url) : ""}
    </div>
  `;

  const likeEl = el.querySelector('[data-like] .val');
  const installEl = el.querySelector('[data-install] .val');

  // Read more / less
  const toggle = el.querySelector(".toggle");
  const more = el.querySelector(`#more-${it.id}`);
  let expanded = false;
  async function ensureLoaded(){
    if (!detailCache.has(it.id)) {
      const data = await fetchJSON(`${API}/topic?id=${it.id}`);
      // side effect: update stats if present
      const likes = data?.post_like_count ?? data?.like_count ?? data?.post?.like_count;
      if (likes != null) likeEl.textContent = formatCount(likes);

      const installs = data?.installs ?? extractInstallsFromCooked(data?.cooked);
      if (installs != null) installEl.textContent = formatCount(installs);

      detailCache.set(it.id, data.cooked || "");
    }
  }

  toggle.addEventListener("click", async () => {
    if (expanded) {
      expanded = false;
      more.style.display = "none";
      toggle.textContent = "Read more";
    } else {
      toggle.style.pointerEvents = "none";
      try{
        await ensureLoaded();
        setPostHTML(more, detailCache.get(it.id));
        more.style.display = "block";
        toggle.textContent = "Less";
        expanded = true;
      }catch(e){
        more.style.display = "block";
        more.innerHTML = `<em>Failed to load post: ${esc(String(e.message||e))}</em>`;
      }finally{
        toggle.style.pointerEvents = "";
      }
    }
  });

  // Proactively fetch metrics in the background (no UI block)
  (async () => {
    try{
      const data = await fetchJSON(`${API}/topic?id=${it.id}`);
      const likes = data?.post_like_count ?? data?.like_count ?? data?.post?.like_count;
      if (likes != null) likeEl.textContent = formatCount(likes);
      const installs = data?.installs ?? extractInstallsFromCooked(data?.cooked);
      if (installs != null) installEl.textContent = formatCount(installs);
      if (!detailCache.has(it.id)) detailCache.set(it.id, data.cooked || "");
    }catch{/* ignore metric errors silently */}
  })();

  // Keep import button behavior (unchanged)
  el.addEventListener("click", (ev)=>{
    const opener = ev.target.closest("[data-open]");
    if (!opener) return;
    ev.preventDefault();
    openExternal(opener.getAttribute("data-open"));
  });

  return el;
}

function appendItems(target, items){
  for (const it of items) target.appendChild(renderCard(it));
}

/* ------- dynamic heading ------- */
function updateHeading({sort, bucket, qTitle}){
  const titleEl = $("#sectionTitle");
  if (!titleEl) return;
  let base =
    sort === "likes" ? "Most liked" :
    sort === "title" ? "A–Z" :
    "Newest";
  let bits = [`${base} blueprints`];
  if (bucket) bits.push(`— ${bucket}`);
  if (qTitle) bits.push(`— matches “${qTitle}”`);
  titleEl.textContent = bits.join(" ");
}

/* -------- boot & data flow -------- */
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
        updateHeading({sort, bucket, qTitle});
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

  if (search){
    const onSearch = debounce(async () => {
      qTitle = (search.value || "").trim();
      updateHeading({sort, bucket, qTitle});
      await loadAllForSearch();
    }, 280);
    search.addEventListener("sl-input", onSearch);
    search.addEventListener("sl-clear", onSearch);
  }
  if (sortSel){
    // trust the exact values and update heading before fetching
    sortSel.addEventListener("sl-change", async () => {
      const v = sortSel.value;
      sort = v === "likes" ? "likes" : v === "title" ? "title" : "new";
      updateHeading({sort, bucket, qTitle});
      await loadAllForSearch();
    });
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
  updateHeading({sort, bucket, qTitle});
  load(true);
}

document.addEventListener("DOMContentLoaded", boot);
