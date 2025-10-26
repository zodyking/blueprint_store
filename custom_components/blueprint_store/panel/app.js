/* Blueprint Store – UI glue
 * Scope: only fixes requested (stable sort, tag filter, likes pill, dark desc area,
 * dynamic heading, normalize import badges, contributors (shout-outs)) */
const API = "/api/blueprint_store";
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

/* ---------- small helpers ---------- */
const esc = s => (s ?? "").toString().replace(/[&<>"']/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c]));
const sleep = (ms=0) => new Promise(r=> setTimeout(r, ms));
const debounce = (fn, ms = 250) => { let t=0; return (...a) => { clearTimeout(t); t = setTimeout(()=> fn(...a), ms); }; };

async function fetchJSON(url, tries = 3) {
  // retry 429 with backoff
  let backoff = 550;
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (!r.ok) throw new Error(`${r.status} ${r.statusText}`); return r.json(); }
    catch(e){
      if (String(e).includes("429") && i < tries-1) { await sleep(backoff); backoff *= 2; continue; }
      throw new Error(`Fetch ${url} failed: ${e}`);
    }
  }
}

/* ---------- state ---------- */
let page = 0, hasMore = true, loading = false;
let qTitle = ""; let filterTag = ""; let sort = "new"; // 'new', 'likes', 'title'
let likesMap = new Map(); // topic_id -> likes from list
let authorCounts = new Map(); // author -> count
let newestItem = null; // most recent by 'created' if available
let topLiked = null;   // item with most likes

/* ---------- UI bits ---------- */
const listEl = $("#list");
const emptyEl = $("#empty");
const errEl = $("#error");
const headingEl = $("#heading");
const searchEl = $("#search");
const sortSel = $("#sort");
const tagMenu = $("#tagmenu");
const tagBtn = $("#tagbtn");
const tagDD = $("#tagdd");
const refreshBtn = $("#refresh");
const sentinel = $("#sentinel");

/* ---------- title cleanup & likes format ---------- */
function likePretty(n){
  if (Number.isNaN(n)) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return `${n}`;
}
const EMOJI_START = /^[\p{Extended_Pictographic}\p{Emoji_Presentation}\p{Emoji}\p{Symbol}]+/u;
function prettifyTitle(raw){
  if (!raw) return "";
  let s = raw.replace(/\[blueprint\]/i, "");
  s = s.replace(EMOJI_START, "").trim();
  // keep parentheses, drop other non-word punctuation
  s = s.replace(/[^()\w\s\-:]/g, " ").replace(/\s{2,}/g, " ").trim();

  // Title case while preserving all-caps tokens like ZHA, MQTT
  s = s.split(/\s+/).map(w=>{
    if (w.length <= 3 && w === w.toUpperCase()) return w; // ZHA, ESP, MQTT, etc.
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(" ");
  // Fix “Long-term” -> “Long Term”
  s = s.replace(/-Term\b/g, " Term");
  return s;
}

/* ---------- dynamic heading ---------- */
function updateHeading(){
  const parts = [];
  if (sort === "likes") parts.push("Most liked");
  else if (sort === "title") parts.push("Title A–Z");
  else parts.push("Newest");

  if (filterTag) parts.push(`• ${filterTag}`);
  if (qTitle) parts.push(`• “${qTitle}”`);

  headingEl.textContent = `${parts.join(" ")} blueprints`;
}

/* ---------- tags (curated if server gives many) ---------- */
async function initTags(){
  try{
    const data = await fetchJSON(`${API}/filters`);
    const tags = Array.isArray(data?.tags) ? data.tags : [];
    tagMenu.innerHTML = "";
    const mk = (value,label)=>`<sl-menu-item value="${esc(value)}">${esc(label)}</sl-menu-item>`;
    tagMenu.insertAdjacentHTML("beforeend", mk("", "All tags"));
    tags.forEach(t=> tagMenu.insertAdjacentHTML("beforeend", mk(t, t)));

    tagMenu.addEventListener("sl-select", async (ev)=>{
      filterTag = ev.detail.item.value || "";
      tagBtn.textContent = filterTag || "All tags";
      await reloadAll();
      if (tagDD?.hide) tagDD.hide();
    });
  }catch{ /* optional */ }
}

/* ---------- fetch & aggregate ---------- */
function trackContributors(items){
  for (const it of items){
    likesMap.set(it.id, it.likes ?? 0);
    if (!topLiked || (it.likes ?? 0) > (topLiked.likes ?? 0)) topLiked = it;

    const a = (it.author || "").trim();
    if (a) authorCounts.set(a, (authorCounts.get(a) || 0) + 1);

    if (!newestItem || (it.created || 0) > (newestItem.created || 0)) newestItem = it;
  }
}
function renderContrib(){
  // Most popular blueprint
  if (topLiked){
    $("#c_pop_author").textContent = topLiked.author || "—";
    $("#c_pop_title").textContent = prettifyTitle(topLiked.title || "—");
  }
  // Most uploaded author
  if (authorCounts.size){
    let best = null, max = 0;
    for (const [a,c] of authorCounts){ if (c>max){max=c; best=a;} }
    $("#c_up_author").textContent = best || "—";
    $("#c_up_count").textContent = max ? `${max} blueprint(s)` : "—";
  }
  // Most recent
  if (newestItem){
    $("#c_rec_author").textContent = newestItem.author || "—";
    $("#c_rec_title").textContent = prettifyTitle(newestItem.title || "—");
  }
}

async function fetchPage(p){
  const url = new URL(`${API}/blueprints`, location.origin);
  url.searchParams.set("page", String(p));
  if (qTitle) url.searchParams.set("q_title", qTitle);
  if (sort) url.searchParams.set("sort", sort);
  if (filterTag) url.searchParams.set("bucket", filterTag);
  return await fetchJSON(url.toString());
}

/* ---------- card rendering ---------- */
function importButton(href){
  return `
    <a class="myha-inline" data-open="${esc(href)}" role="button" tabindex="0">
      <sl-icon name="house"></sl-icon>
      Import to Home Assistant
    </a>`;
}
function statsPill(likes){
  const n = likePretty(Number(likes||0));
  return `<span class="stats-pill" aria-label="Likes">
    <span class="icon-heart"></span>
    <span class="stat">${n}</span>
    <span class="lbl">Liked&nbsp;This</span>
  </span>`;
}

function setPostHTML(container, html){
  const tmp = document.createElement("div");
  tmp.innerHTML = html || "<em>Nothing to show.</em>";

  // Normalize embedded "Import blueprint" banners to compact size
  tmp.querySelectorAll('a[href*="my.home-assistant.io/redirect/blueprint_import"]').forEach(a=>{
    const href = a.getAttribute("href") || a.textContent || "#";
    const pill = document.createElement("a");
    pill.className = "myha-inline";
    pill.setAttribute("data-open", href);
    pill.innerHTML = `<sl-icon name="house"></sl-icon> Import to Home Assistant`;
    a.replaceWith(pill);
  });

  // intercept any data-open inside description
  tmp.addEventListener("click", (ev)=>{
    const a = ev.target.closest("[data-open]");
    if (!a) return;
    ev.preventDefault();
    try { window.open(a.getAttribute("data-open"), "_blank", "noopener"); } catch {}
  });

  container.innerHTML = "";
  container.appendChild(tmp);
}

function renderCard(it){
  const el = document.createElement("article");
  el.className = "card";

  const cleanTitle = prettifyTitle(it.title || "");
  el.innerHTML = `
    <div class="row">
      <h3>${esc(cleanTitle)}</h3>
      ${it.author ? `<span class="author">by ${esc(it.author)}</span>` : ""}
    </div>

    <div class="desc-wrap"><p class="desc" id="desc-${it.id}">${esc(it.excerpt || "")}</p></div>
    <div class="toggle" data-id="${it.id}">Read more</div>
    <div class="more" id="more-${it.id}"></div>

    <div class="card__footer">
      <div>${statsPill(it.likes)}</div>
      <div>${importButton(it.import_url)}</div>
    </div>
  `;

  // Read more / less grows the same area (shows full cooked below)
  const toggle = el.querySelector(".toggle");
  const more = el.querySelector(`#more-${it.id}`);
  let expanded = false;

  async function expandNow(){
    if (expanded) return;
    expanded = true;
    toggle.style.pointerEvents = "none";
    try{
      const data = await fetchJSON(`${API}/topic?id=${it.id}`);
      setPostHTML(more, data?.cooked || "<em>Failed to load post.</em>");
      more.style.display = "block";
      toggle.textContent = "Less";
    }catch(e){
      more.innerHTML = `<em>${esc(String(e.message||e))}</em>`;
      more.style.display = "block";
      toggle.textContent = "Less";
    }finally{
      toggle.style.pointerEvents = "";
    }
  }

  toggle.addEventListener("click", async ()=>{
    if (expanded){
      expanded = false;
      more.style.display = "none";
      toggle.textContent = "Read more";
    } else {
      await expandNow();
    }
  });

  return el;
}

function appendItems(target, items){
  for (const it of items) target.appendChild(renderCard(it));
}

/* ---------- load flows ---------- */
function clearAgg(){
  likesMap.clear(); authorCounts.clear();
  topLiked = null; newestItem = null;
}
async function load(initial=false){
  if (loading || (!hasMore && !initial)) return;
  loading = true; errEl.style.display = "none";

  try{
    const data = await fetchPage(page);
    const items = data?.items ?? [];
    hasMore = !!data?.has_more;

    if (initial){
      listEl.innerHTML = "";
      if (emptyEl) emptyEl.style.display = items.length ? "none" : "block";
      clearAgg();
    }

    appendItems(listEl, items);
    trackContributors(items);
    renderContrib();
    page += 1;
  }catch(e){
    errEl.textContent = String(e.message||e);
    errEl.style.display = "block";
  }finally{
    loading = false;
  }
}

async function reloadAll(){
  page = 0; hasMore = true;
  updateHeading();
  listEl.innerHTML = "";
  clearAgg();
  // Guaranteed full refill (iterate pages until exhausted)
  let first = true;
  while (hasMore){
    await load(first);
    first = false;
    await sleep(6);
  }
}

/* ---------- boot ---------- */
function boot(){
  if (!listEl) return;

  // search
  if (searchEl){
    const onSearch = debounce(async ()=>{
      qTitle = (searchEl.value || "").trim();
      await reloadAll();
    }, 280);
    searchEl.addEventListener("sl-input", onSearch);
    searchEl.addEventListener("sl-clear", onSearch);
  }

  // sort (stabilized)
  if (sortSel){
    sortSel.addEventListener("sl-change", async ()=>{
      const v = (sortSel.value || "new");
      sort = (v === "likes" || v === "title") ? v : "new";
      await reloadAll();
    });
  }

  // refresh (no outline)
  if (refreshBtn){
    refreshBtn.addEventListener("click", async ()=> reloadAll());
  }

  // infinite scroll
  if (sentinel){
    const io = new IntersectionObserver((entries)=>{
      if (entries[0]?.isIntersecting) load(false);
    },{ rootMargin:"700px" });
    io.observe(sentinel);
  }

  updateHeading();
  initTags();
  load(true);
}

document.addEventListener("DOMContentLoaded", boot);
