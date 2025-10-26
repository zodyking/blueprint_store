/* Blueprint Store – spotlight from ALL pages + dblclick toggle + stable sort */
const API = "/api/blueprint_store";
const $  = (s) => document.querySelector(s);

/* ---------- helpers ---------- */
function esc(s){
  return (s||"").replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
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

/* -------- title normalizer -------- */
function normalizeTokenCase(word){
  if (word.length <= 2) return word.toUpperCase();
  if (/^[A-Z0-9]{3,}$/.test(word)) return word;
  return word[0].toUpperCase() + word.slice(1).toLowerCase();
}
function formatTitle(s){
  if (!s) return "";
  let t = s.replace(/\[blueprint\]\s*/i, "")
           .replace(/^[\s\p{Emoji_Presentation}\p{Extended_Pictographic}]+/gu, "")
           .replace(/[^\p{L}\p{N}\s()\-:_&,'\/]/gu, " ");
  t = t.replace(/\s+/g," ").trim();
  t = t.split(" ").map(normalizeTokenCase).join(" ");
  t = t.replace(/\b(And|Or|Of|The|In|With|For|On|To)\b/g, m=>m.toLowerCase());
  t = t.replace(/\b(ZHA|Z2M|MQTT|RGB|ESP32|Zigbee2MQTT)\b/g, m=>m);
  return t;
}

/* ----- opener ----- */
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

/* pills */
function importButton(href){
  return `
    <a class="myha-btn" data-open="${esc(href)}">
      <sl-icon name="house"></sl-icon>
      Import to Home Assistant
    </a>`;
}
function viewDescButton(){
  return `
    <a class="myha-btn neutral" data-viewdesc="1">
      <sl-icon name="document-text"></sl-icon>
      View description
    </a>`;
}
function likesPill(likes){
  return `
  <span class="pill" title="Likes on the forum topic">
    <sl-icon name="heart"></sl-icon>
    ${likes ?? 0} Liked This
  </span>`;
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

/* -------- rewrite helpers ------ */
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

/* cache for full post body */
const detailCache = new Map();

/* card */
function renderCard(it){
  const el = document.createElement("article");
  el.className = "card";

  const title = formatTitle(it.title || "");
  const visibleTags = [it.bucket, ...(it.tags || []).slice(0,3)];
  const likeCount = it.likes ?? 0;

  el.innerHTML = `
    <div class="row">
      <h3>${esc(title)}</h3>
      ${it.author ? `<span class="author">by ${esc(it.author)}</span>` : ""}
    </div>
    ${tagPills(visibleTags)}

    <div class="desc-wrap">
      <div class="desc-box" id="desc-${it.id}">
        ${esc(it.excerpt || "")}
      </div>
    </div>

    <div class="toggle" data-id="${it.id}">Read more</div>
    <div class="more" id="more-${it.id}"></div>

    <div class="card__footer">
      ${likesPill(likeCount)}
      <span id="cta-${it.id}"></span>
    </div>
  `;

  const ctaSpan = el.querySelector(`#cta-${it.id}`);
  const defaultCTA = importButton(it.import_url);
  ctaSpan.innerHTML = defaultCTA;

  async function ensureCTAFromPost(){
    try{
      if (!detailCache.has(it.id)) {
        const data = await fetchJSON(`${API}/topic?id=${it.id}`);
        detailCache.set(it.id, data.cooked || "");
      }
      const cooked = detailCache.get(it.id) || "";
      const importCount = (cooked.match(/my\.home-assistant\.io\/redirect\/blueprint_import/gi) || []).length;
      if (importCount > 1) ctaSpan.innerHTML = viewDescButton();
    }catch{/* ignore */}
  }
  ensureCTAFromPost();

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
    }catch(e){
      setPostHTML(more, `<em>Failed to load post: ${esc(String(e.message||e))}</em>`);
    }finally{
      toggle.style.pointerEvents = "";
    }
    more.style.display = "block";
    toggle.textContent = "Less";
  }
  function collapseNow(){
    expanded = false;
    more.style.display = "none";
    toggle.textContent = "Read more";
  }

  toggle.addEventListener("click", async () => {
    if (expanded) { collapseNow(); } else { await expandNow(); }
  });

  // NEW: double-click anywhere on the card (except links/buttons) toggles
  el.addEventListener("dblclick", async (ev)=>{
    if (ev.target.closest("a,button,[data-open]")) return;
    if (expanded) { collapseNow(); } else { await expandNow(); }
  });

  el.addEventListener("click", (ev)=>{
    const opener = ev.target.closest("[data-open]");
    if (!opener) return;
    ev.preventDefault();
    if (opener.hasAttribute("data-viewdesc")) {
      expandNow();
      return;
    }
    openExternal(opener.getAttribute("data-open"));
  });

  return el;
}

function appendItems(target, items){
  for (const it of items) target.appendChild(renderCard(it));
}

/* --------------------- Creators Spotlight --------------------- */
async function fetchAllBlueprintsForSpotlight(){
  // Fetch ALL pages (no q/bucket) so spotlight is accurate
  let p = 0; const all = [];
  while (true){
    const url = new URL(`${API}/blueprints`, location.origin);
    url.searchParams.set("page", String(p));
    const data = await fetchJSON(url.toString());
    all.push(...(data.items || []));
    if (!data.has_more) break;
    p += 1;
  }
  return all;
}
function tsFor(it){
  return new Date(
    it.created_at || it.created || it.updated_at || it.updated || 0
  ).getTime() || (Number(it.id) || 0);
}
async function buildSpotlightAll(){
  const grid = $("#cs-grid");
  const loading = $("#cs-loading");
  if (!grid || !loading) return;

  grid.style.display = "none";
  loading.style.display = "flex";

  try{
    const items = await fetchAllBlueprintsForSpotlight();

    const byLikes = [...items].sort((a,b)=> (b.likes||0)-(a.likes||0));
    const mostPopular = byLikes[0];

    const byAuthor = {};
    for (const x of items) if (x.author) byAuthor[x.author] = (byAuthor[x.author]||0)+1;
    const topAuthor = Object.entries(byAuthor).sort((a,b)=>b[1]-a[1])[0] || ["",0];

    const byRecent = [...items].sort((a,b)=> tsFor(b)-tsFor(a));
    const mostRecent = byRecent[0];

    const card = (title, author, line)=>{
      return `<div class="contrib-card">
        <h4>${esc(title)}</h4>
        <div class="contrib-author">${esc(author || "—")}</div>
        <div>${line||""}</div>
      </div>`;
    };

    grid.innerHTML = `
      ${card("Most Popular Blueprint",
             mostPopular?.author,
             mostPopular ? esc(formatTitle(mostPopular.title)) : "—")}
      ${card("Most Uploaded Blueprints",
             topAuthor?.[0] || "—",
             `${topAuthor?.[1] || 0} Blueprints`)}
      ${card("Most Recent Upload",
             mostRecent?.author,
             mostRecent ? esc(formatTitle(mostRecent.title)) : "—")}
    `;
  }catch(e){
    grid.innerHTML = `<div class="contrib-card"><strong>Creators Spotlight</strong><br>${esc(String(e.message||e))}</div>`;
  }finally{
    loading.style.display = "none";
    grid.style.display = "grid";
  }
}

/* --------------------- boot & data flow --------------------- */
function boot(){
  const list   = $("#list");
  const empty  = $("#empty");
  const errorB = $("#error");
  const search = $("#search");
  const sortSel = $("#sort");
  const refreshBtn = $("#refresh");
  const sentinel = $("#sentinel");
  const heading = $("#heading");

  const tagdd = $("#tagdd");
  const tagbtn = $("#tagbtn");
  const tagmenu = $("#tagmenu");

  if (!list) return;

  let page = 0;
  let qText = "";
  let loading = false;
  let hasMore = true;
  let sort = "likes";   // likes | new | title
  let bucket = "";

  let applyingSort = false;

  const setError = (msg)=>{ if(errorB){ errorB.textContent = msg; errorB.style.display="block"; } };
  const clearError = ()=>{ if(errorB){ errorB.style.display="none"; errorB.textContent=""; } };

  function updateHeading(){
    const bits = [];
    if (sort === "likes") bits.push("Most liked blueprints");
    else if (sort === "new") bits.push("Newest blueprints");
    else bits.push("Title A–Z");
    if (qText) bits.push(`• query: “${qText}”`);
    if (bucket) bits.push(`• tag: ${bucket}`);
    heading.textContent = bits.join(" ");
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
        const val = ev.detail.item.value || "";
        bucket = val;
        tagbtn.textContent = bucket || "All tags";
        await loadAllForSearch();
      });
    }catch{/* optional */}
  }

  async function fetchPage(p){
    const url = new URL(`${API}/blueprints`, location.origin);
    url.searchParams.set("page", String(p));
    if (qText) url.searchParams.set("q", qText);
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

      const terms = (qText||"").toLowerCase().split(/\s+/).filter(Boolean);
      let out = items;
      if (terms.length){
        out = items.map(it=>{
          const hay = `${it.title||""} ${it.excerpt||""} ${(it.tags||[]).join(" ")}`.toLowerCase();
          let score = 0;
          for (const t of terms){
            if (hay.includes(t)) score += 3;
            if ((it.tags||[]).some(x=>String(x).toLowerCase().includes(t))) score += 2;
          }
          return {it, score};
        }).filter(x=>x.score>0)
          .sort((a,b)=>b.score-a.score)
          .map(x=>x.it);
      }

      if (initial){
        list.innerHTML = "";
        if (empty) empty.style.display = out.length ? "none" : "block";
      }
      appendItems(list, out);
      page += 1;
    }catch(e){
      setError(`Failed to load: ${String(e.message||e)}`);
    }finally{
      loading = false;
    }
  }

  async function loadAllForSearch(){
    page = 0; hasMore = true; list.innerHTML = ""; clearError();
    updateHeading();
    await load(true);
  }

  if (search){
    const onSearch = debounce(async () => {
      qText = (search.value || "").trim();
      await loadAllForSearch();
    }, 260);
    search.addEventListener("sl-input", onSearch);
    search.addEventListener("sl-clear", onSearch);
  }

  if (sortSel){
    sortSel.addEventListener("sl-change", async () => {
      if (applyingSort) return;
      applyingSort = true;
      try{
        const v = sortSel.value || "likes";
        if (v !== sort){ sort = v; }
        sortSel.value = sort;
        await loadAllForSearch();
      }finally{
        applyingSort = false;
      }
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
  updateHeading();
  load(true);

  // Build spotlight from ALL pages (spinner shows until done)
  buildSpotlightAll();
}

document.addEventListener("DOMContentLoaded", boot);
