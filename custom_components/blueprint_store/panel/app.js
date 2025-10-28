/* ==========================================================================
   Blueprint Store — app.js
   Scope: logic only (stable search across title/description/tags, sort & tag
   filters). No UI/layout changes.
   ========================================================================== */

/* ---------- API & element helpers ---------- */
const API = "/api/blueprint_store";

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

function esc(s) {
  return (s || "").replace(/[&<>"']/g, (c) => (
    { "&":"&amp;", "<":"&lt;", ">":"&gt;", "\"":"&quot;", "'":"&#39;" }[c]
  ));
}

const debounce = (fn, ms = 260) => {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
};

/* ---------- robust fetch with 429/backoff ---------- */
async function fetchJSONRaw(url) {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const data = await res.json();
  if (data && data.error) throw new Error(data.error);
  return data;
}

async function fetchJSON(url, tries = 4) {
  let delay = 600;
  for (let i = 0; i < tries; i++) {
    try { return await fetchJSONRaw(url); }
    catch (e) {
      // Respect 429 Too Many Requests with gentle backoff
      if (String(e).includes("429") && i < tries - 1) {
        await new Promise(r => setTimeout(r, delay));
        delay = Math.min(delay * 1.6, 4000);
        continue;
      }
      if (i === tries - 1) throw e;
      await new Promise(r => setTimeout(r, delay));
      delay = Math.min(delay * 1.6, 4000);
    }
  }
}

/* ---------- DOM refs (keep names; do not change structure) ---------- */
const list      = $("#bp-list")      || $(".js-list")      || $("#list")      || $("#cards");
const empty     = $("#bp-empty")     || $(".js-empty")     || $("#empty");
const errorBox  = $("#bp-error")     || $(".js-error")     || $("#error");
const searchEl  = $("#bp-search")    || $(".js-search")    || $("#search");
const sortBtn   = $("#bp-sort")      || $(".js-sort")      || $("#sort");
const tagBtn    = $("#bp-tags")      || $(".js-tags")      || $("#tags");
const refresh   = $("#bp-refresh")   || $(".js-refresh")   || $("#refresh");
const sentinel  = $("#bp-sentinel")  || $(".js-sentinel")  || $("#sentinel");

/* Optional: creators footer; if not present we no-op */
const creatorsWrap  = $("#creators-footer") || $(".js-creators-footer");
const creatorsSpin  = $("#creators-spin")   || $(".js-creators-spin");

/* ---------- state ---------- */
let page     = 0;
let hasMore  = true;
let loading  = false;

let q        = "";
let bucket   = "";         // tag filter (empty = all)
let sort     = "likes";    // "likes" | "new" | "title"

/* ---------- stable title cleanup (used only for sort-title) ---------- */
function cleanTitle(s = "") {
  const t = s.trim().replace(/^\p{Emoji_Presentation}|\p{Extended_Pictographic}/gu, "").trim();
  return t.replace(/^[^A-Za-z0-9(]+/, "");
}

/* ---------- SEARCH HARDENING HELPERS (logic-only) ---------- */
function tokenize(query) {
  if (!query) return [];
  return query
    .toLowerCase()
    .replace(/[_/|,.;:!?()[\]{}"'`~]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 12); // cap to keep it snappy
}

// Score ANY-word matches across title/desc/tags with weights
function scoreItem(item, toks) {
  if (!toks.length) return 0;
  const title = (item.title || "").toLowerCase();
  const desc  = (item.excerpt || "").toLowerCase();
  const tags  = (item.tags || []).map(t => String(t || "").toLowerCase());

  let s = 0;
  for (const t of toks) {
    if (title.includes(t)) s += 3;
    if (tags.some(x => x.includes(t))) s += 2;
    if (desc.includes(t))  s += 1;
  }
  return s;
}

function matchesBucket(item, bucketName) {
  if (!bucketName) return true;
  const tags = (item.tags || []).map(t => String(t || "").toLowerCase());
  return tags.includes(bucketName.toLowerCase());
}

function sorterFor(currentSort, isSearching) {
  return (a, b) => {
    if (isSearching) {
      const diff = (b._score || 0) - (a._score || 0);
      if (diff) return diff;
    }
    if (currentSort === "likes") return (b.likes || 0) - (a.likes || 0);
    if (currentSort === "new") {
      const ta = new Date(a.created_at || a.updated_at || 0).getTime();
      const tb = new Date(b.created_at || b.updated_at || 0).getTime();
      return tb - ta;
    }
    if (currentSort === "title") {
      return cleanTitle(a.title).localeCompare(cleanTitle(b.title));
    }
    return 0;
  };
}

/* ---------- backend page fetch wrapper ----------
   NOTE: keep the query param you already use. If your API is cursor-based,
   simply adapt the 'page' param here; rest of logic stays unchanged.
------------------------------------------------- */
async function fetchPage(pageNum) {
  const params = new URLSearchParams({ page: String(pageNum) });
  if (bucket) params.set("tag", bucket);
  // The backend returns: { items: [...], has_more: boolean }
  return fetchJSON(`${API}?${params.toString()}`);
}

/* ---------- creators footer hooks (no layout change) ---------- */
function footerSpin(on) {
  if (!creatorsSpin) return;
  creatorsSpin.style.visibility = on ? "visible" : "hidden";
}

function computeCreatorStats(items) {
  // Fallback if your existing footer logic is elsewhere — keep signatures
  const byAuthor = new Map();
  for (const it of items) {
    const a = (it.author || "unknown").trim();
    const c = byAuthor.get(a) || { count: 0, mostLiked: null, mostRecent: null };
    c.count++;
    if (!c.mostLiked || (it.likes || 0) > (c.mostLiked.likes || 0)) c.mostLiked = it;
    const t = new Date(it.created_at || it.updated_at || 0).getTime();
    if (!c.mostRecent || t > new Date(c.mostRecent.created_at || c.mostRecent.updated_at || 0).getTime()) c.mostRecent = it;
    byAuthor.set(a, c);
  }
  // Most popular blueprint (highest likes overall)
  let mostPopular = null;
  let mostRecent  = null;
  let topUploader = { author: "", count: 0 };

  for (const [author, data] of byAuthor.entries()) {
    if (!mostPopular || (data.mostLiked && (data.mostLiked.likes || 0) > (mostPopular.likes || 0))) {
      mostPopular = data.mostLiked;
    }
    const mr = data.mostRecent;
    if (!mostRecent || (new Date(mr.created_at || mr.updated_at || 0).getTime() >
                        new Date(mostRecent.created_at || mostRecent.updated_at || 0).getTime())) {
      mostRecent = mr;
    }
    if (data.count > topUploader.count) topUploader = { author, count: data.count };
  }
  return { mostPopular, mostRecent, topUploader };
}

function renderCreatorsFooter(stats) {
  if (!creatorsWrap || !stats) return;
  // We do not touch layout; only write texts into existing nodes.
  const mpT = creatorsWrap.querySelector("[data-slot=popular-title]");
  const mpA = creatorsWrap.querySelector("[data-slot=popular-author]");
  const muA = creatorsWrap.querySelector("[data-slot=uploader-author]");
  const muC = creatorsWrap.querySelector("[data-slot=uploader-count]");
  const mrT = creatorsWrap.querySelector("[data-slot=recent-title]");
  const mrA = creatorsWrap.querySelector("[data-slot=recent-author]");

  if (mpT) mpT.textContent = stats.mostPopular?.title || "—";
  if (mpA) mpA.textContent = stats.mostPopular?.author || "—";
  if (muA) muA.textContent = stats.topUploader?.author || "—";
  if (muC) muC.textContent = `${stats.topUploader?.count || 0} Blueprints`;
  if (mrT) mrT.textContent = stats.mostRecent?.title || "—";
  if (mrA) mrA.textContent = stats.mostRecent?.author || "—";
}

/* ---------- rendering (reuse your existing makeCard) ---------- */
/* IMPORTANT: We do not alter UI. If your project already defines makeCard(),
   we will reuse it. If not, we provide a no-op placeholder to avoid crashes. */
if (typeof window.makeCard !== "function") {
  window.makeCard = function noopMakeCard(it) {
    const li = document.createElement("div");
    li.textContent = it.title || "(untitled)";
    li.className = "bp-card";
    return li;
  };
}

/* ---------- core load() with hardened search & filters ---------- */
async function load(initial = false) {
  if (loading || (!hasMore && !initial)) return;
  loading = true;
  if (errorBox) errorBox.style.display = "none";

  const tokens = tokenize(q);
  const wantAtLeast = tokens.length ? 12 : 6; // pull more when searching
  let appended = 0;

  try {
    do {
      const data  = await fetchPage(page);
      const items = data.items || [];
      hasMore = !!data.has_more;

      if (page === 0 && initial) {
        if (list)  list.innerHTML = "";
        if (empty) empty.style.display = "none";
      }

      // filter by tag
      let out = items.filter(it => matchesBucket(it, bucket));

      // score on search
      if (tokens.length) {
        out.forEach(it => it._score = scoreItem(it, tokens));
        out = out.filter(it => it._score > 0);
      }

      // sort with fallback chain
      out.sort(sorterFor(sort, tokens.length > 0));

      // append
      for (const it of out) {
        const card = window.makeCard(it);
        if (list && card) list.appendChild(card);
        appended++;
      }

      // first page: creators footer from current batch (no layout change)
      if (page === 0 && initial) {
        footerSpin(true);
        const stats = computeCreatorStats(items);
        renderCreatorsFooter(stats);
        footerSpin(false);
      }

      page += 1;

      if (page > 0 && appended === 0 && !hasMore) {
        if (empty) empty.style.display = "block";
      }
    } while (tokens.length && appended < wantAtLeast && hasMore);

  } catch (e) {
    if (errorBox) {
      errorBox.textContent = `Failed to load: ${String(e.message || e)}`;
      errorBox.style.display = "block";
    }
  } finally {
    loading = false;
  }
}

/* ---------- boot & interactions (no UI changes) ---------- */
function resetAndLoad() {
  page = 0;
  hasMore = true;
  load(true);
}

const onSearch = debounce(() => {
  q = (searchEl?.value || "").trim();
  resetAndLoad();
}, 240);

if (searchEl) {
  searchEl.addEventListener("input", onSearch);
}

if (sortBtn) {
  sortBtn.addEventListener("change", () => {
    const v = (sortBtn.value || "").toLowerCase();
    sort = v === "title" ? "title" : v === "newest" || v === "new" ? "new" : "likes";
    resetAndLoad();
  });
}

if (tagBtn) {
  tagBtn.addEventListener("change", () => {
    bucket = (tagBtn.value || "").trim();
    resetAndLoad();
  });
}

if (refresh) {
  refresh.addEventListener("click", () => {
    resetAndLoad();
  });
}

// Infinite scroll / creep loader — intersection observer
if (sentinel) {
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) load(false);
    }
  }, { rootMargin: "600px 0px 600px 0px" });
  io.observe(sentinel);
}

// Initial load
resetAndLoad();
