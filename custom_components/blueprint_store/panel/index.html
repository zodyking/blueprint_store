/* Blueprint Store – UI glue
 * Scope: only fixes requested (stable sort, tag filter, likes pill, dark desc area,
 * dynamic heading, normalize import badges, contributors strip).
 */
const API = "/api/blueprint_store";
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

/* ------------ small helpers ------------ */
const esc = s =>
  (s ?? "").toString().replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const delay = ms => new Promise(r => setTimeout(r, ms));
const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

async function fetchJSON(url, tries = 3) {
  let backoff = 500;
  for (let i = 0; i < tries; i++) {
    const res = await fetch(url);
    if (res.ok) return res.json();
    if (res.status === 429 && i < tries - 1) { await delay(backoff); backoff *= 2; continue; }
    throw new Error(`${res.status} ${res.statusText}`);
  }
}

/* ----------- state ----------- */
const state = {
  page: 0,
  hasMore: true,
  loading: false,
  qTitle: "",
  sort: "new",          // "new" | "title" | "likes"
  tag: "",              // curated tag value or community tag
  list: null,
  sentinel: null,
  headingEl: null,
  searchEl: null,
  sortSel: null,
  tagMenu: null,
  tagBtn: null
};

/* ---------- UI bits ---------- */
function kfmt(n) {
  if (n == null) return "0";
  const x = Number(n);
  if (!Number.isFinite(x)) return "0";
  if (x >= 1_000_000) return `${(x / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (x >= 1_000) return `${(x / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return `${x}`;
}

function likePill(likes) {
  return `
    <div class="pill likes-pill" title="People who liked this post">
      <svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12.1 8.64l-.1.1-.11-.11C10.14 6.6 6.5 7.24 6.5 10.05c0 1.54.99 3.04 3.09 4.96 1.05.95 2.18 1.85 2.51 2.12.33-.27 1.46-1.17 2.51-2.12 2.1-1.92 3.09-3.42 3.09-4.96 0-2.81-3.64-3.45-5.59-1.41z" fill="currentColor"/></svg>
      <span class="pill-num">${kfmt(likes)}</span>
      <span class="pill-suffix">Liked this</span>
    </div>
  `;
}

/* normalize forum “Import blueprint” mega badges to a compact pill */
function normalizeImportBadges(scope) {
  const sel = 'a[href*="redirect/blueprint_import"]';
  $$(sel, scope).forEach(a => {
    a.className = "myha-btn myha-inline-import";
    a.innerHTML = '<svg class="i" viewBox="0 0 24 24"><path d="M10 20v-6H7l5-5 5 5h-3v6z" fill="currentColor"/></svg><span>Import to Home Assistant</span>';
    // remove any nested images/icons that were in the original content
    $$("img, svg:not(.i)", a).forEach(n => n.remove());
    a.style.removeProperty("width");
    a.style.removeProperty("height");
  });
}

/* Install description HTML into the same dark area, expanding in-place */
function setFullDescription(descContainer, html) {
  const inner = $(".desc-inner", descContainer);
  const full = $(".desc-full", descContainer);
  full.innerHTML = html || "<em>No additional description.</em>";
  normalizeImportBadges(full);
  descContainer.classList.add("expanded");
}

/* card */
function renderCard(item) {
  const likes = item.likes ?? 0;
  const tags = (item.tags || []).slice(0, 4);

  const card = document.createElement("article");
  card.className = "card";
  card.innerHTML = `
    <header class="card-hd">
      <h3 class="ttl">${esc(item.title)}</h3>
      ${item.author ? `<span class="author">by <strong>${esc(item.author)}</strong></span>` : ""}
    </header>

    <div class="tags">${tags.map(t => `<span class="tag">${esc(t)}</span>`).join("")}</div>

    <section class="desc">
      <div class="desc-inner">
        <p class="excerpt">${esc(item.excerpt || "")}</p>
        <div class="desc-full" hidden></div>
      </div>
      <button class="readmore" type="button">Read more</button>
    </section>

    <footer class="card-ft">
      ${likePill(likes)}
      <a class="cta-import" href="${esc(item.import_url || "#")}" target="_blank" rel="noopener">
        <svg class="i" viewBox="0 0 24 24"><path d="M5 20h14v-2H5v2zM12 2l-5 5h3v6h4V7h3l-5-5z" fill="currentColor"/></svg>
        <span>Import to Home Assistant</span>
      </a>
    </footer>
  `;

  // Read more toggle
  const btn = $(".readmore", card);
  const desc = $(".desc", card);
  const full = $(".desc-full", card);
  let loaded = false;

  btn.addEventListener("click", async () => {
    if (!loaded) {
      try {
        const data = await fetchJSON(`${API}/topic?id=${encodeURIComponent(item.id)}`);
        setFullDescription(desc, data?.cooked || "");
        full.hidden = false;
        btn.textContent = "Less";
        loaded = true;
      } catch (e) {
        full.hidden = false;
        full.innerHTML = `<em>Failed to load post.</em>`;
      }
    } else {
      const expanded = desc.classList.toggle("expanded");
      full.hidden = !expanded;
      btn.textContent = expanded ? "Less" : "Read more";
    }
  });

  // prevent any action on the likes pill
  $(".likes-pill", card).addEventListener("click", e => e.preventDefault());

  return card;
}

function appendItems(items) {
  const frag = document.createDocumentFragment();
  items.forEach(it => frag.appendChild(renderCard(it)));
  state.list.appendChild(frag);
}

/* ---------- fetching + filters ---------- */
function buildQuery(page) {
  const u = new URL(`${API}/blueprints`, location.origin);
  u.searchParams.set("page", String(page));
  if (state.qTitle) u.searchParams.set("q_title", state.qTitle);
  if (state.sort) u.searchParams.set("sort", state.sort);
  if (state.tag) {
    // Support either name the backend expects
    u.searchParams.set("tag", state.tag);
    u.searchParams.set("bucket", state.tag);
  }
  return u.toString();
}

async function fetchPage(p) {
  const url = buildQuery(p);
  const data = await fetchJSON(url);
  return {
    items: data?.items || [],
    hasMore: !!data?.has_more
  };
}

async function load(initial = false) {
  if (state.loading || (!state.hasMore && !initial)) return;
  state.loading = true;

  try {
    const { items, hasMore } = await fetchPage(state.page);
    state.hasMore = hasMore;
    if (initial) state.list.innerHTML = "";
    appendItems(items);
    state.page += 1;
  } catch (e) {
    console.error("Load failed:", e);
  } finally {
    state.loading = false;
  }
}

async function reloadAll() {
  state.page = 0;
  state.hasMore = true;
  state.list.innerHTML = "";
  updateHeading();
  await load(true);
}

/* -------- heading text -------- */
function updateHeading() {
  const sortMap = { new: "Newest", likes: "Most liked", title: "A–Z" };
  const bits = [];
  bits.push(sortMap[state.sort] || "All");
  if (state.tag) bits.push(`#${state.tag}`);
  if (state.qTitle) bits.push(`“${state.qTitle}”`);
  state.headingEl.textContent = `${bits.join(" · ")} blueprints`;
}

/* -------- contributors strip (best-effort) -------- */
async function buildContributors() {
  const host = $("#contributors");
  if (!host) return;

  try {
    // Pull first few pages in most-liked and newest to compute metrics cheaply.
    const topLiked = await fetchJSON(`${API}/blueprints?sort=likes&page=0`);
    const newest = await fetchJSON(`${API}/blueprints?sort=new&page=0`);

    const likedFirst = topLiked?.items?.[0];
    const newestFirst = newest?.items?.[0];

    // Count authors on first page (good enough for shout-out)
    const counts = {};
    (newest?.items || []).forEach(i => { counts[i.author] = (counts[i.author] || 0) + 1; });
    let mostAuthor = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    const mostCount = mostAuthor ? counts[mostAuthor] : 0;

    host.innerHTML = `
      <div class="contrib-card">
        <div class="contrib-hd">Most popular</div>
        ${likedFirst ? `<div class="contrib-author">${esc(likedFirst.author || "—")}</div>
        <div class="contrib-sub">${esc(likedFirst.title || "")}</div>` : `<div class="muted">No data</div>`}
      </div>
      <div class="contrib-card">
        <div class="contrib-hd">Most blueprints</div>
        ${mostAuthor ? `<div class="contrib-author">${esc(mostAuthor)}</div>
        <div class="contrib-sub">${mostCount} blueprint(s)</div>` : `<div class="muted">No data</div>`}
      </div>
      <div class="contrib-card">
        <div class="contrib-hd">Most recent</div>
        ${newestFirst ? `<div class="contrib-author">${esc(newestFirst.author || "—")}</div>
        <div class="contrib-sub">${esc(newestFirst.title || "")}</div>` : `<div class="muted">No data</div>`}
      </div>
    `;
  } catch (e) {
    host.innerHTML = `<div class="muted">Unable to build contributors right now.</div>`;
  }
}

/* ---------- boot ---------- */
function attachSort() {
  // Shoelace <sl-select> fires sl-change; make it single-bound and stable.
  if (!state.sortSel.__bound) {
    state.sortSel.__bound = true;
    state.sortSel.addEventListener("sl-change", async () => {
      // value is "new" | "likes" | "title"
      state.sort = state.sortSel.value || "new";
      await reloadAll();
    });
  }
}
function attachSearch() {
  const onSearch = debounce(async () => {
    state.qTitle = (state.searchEl.value || "").trim();
    await reloadAll();
  }, 280);
  state.searchEl.addEventListener("sl-input", onSearch);
  state.searchEl.addEventListener("sl-clear", onSearch);
}
function attachTags() {
  // Fill menu then handle selection
  state.tagMenu.innerHTML = "";
  state.tagMenu.insertAdjacentHTML("beforeend", `<sl-menu-item value="">All tags</sl-menu-item>`);

  // Get curated/available tags from backend
  fetchJSON(`${API}/filters`).then(data => {
    const tags = Array.isArray(data?.tags) ? data.tags : [];
    tags.forEach(t => state.tagMenu.insertAdjacentHTML("beforeend", `<sl-menu-item value="${esc(t)}">${esc(t)}</sl-menu-item>`));
  }).catch(() => { /* optional */ });

  if (!state.tagMenu.__bound) {
    state.tagMenu.__bound = true;
    state.tagMenu.addEventListener("sl-select", async (ev) => {
      const val = ev.detail.item?.value || "";
      state.tag = val;
      state.tagBtn.textContent = val || "All tags";
      // close dropdown
      const dd = $("#tagdd"); if (dd && dd.hide) dd.hide();
      await reloadAll();
    });
  }
}

function watchInfiniteScroll() {
  const io = new IntersectionObserver((entries) => {
    if (entries[0]?.isIntersecting) load(false);
  }, { rootMargin: "800px" });
  io.observe(state.sentinel);
}

async function boot() {
  state.list      = $("#list");
  state.sentinel  = $("#sentinel");
  state.headingEl = $("#heading");
  state.searchEl  = $("#search");
  state.sortSel   = $("#sort");
  state.tagMenu   = $("#tagmenu");
  state.tagBtn    = $("#tagbtn");

  attachSort();
  attachSearch();
  attachTags();
  watchInfiniteScroll();
  updateHeading();
  await buildContributors();
  await load(true);
}

document.addEventListener("DOMContentLoaded", boot);
