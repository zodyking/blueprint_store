/* Blueprint Store – front-end (only the requested changes) */
const API = "/api/blueprint_store";
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

/* ---------- small utils ---------- */
const fmt = n => (n == null || isNaN(n) ? "-" : Intl.NumberFormat("en", { notation: "compact" }).format(n));
const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

async function fetchJSON(url) {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

/* we’ll lazy-get views from topic meta; cache it */
const topicMetaCache = new Map(); // id -> { views, likes, replies }
async function getTopicMeta(id) {
  if (topicMetaCache.has(id)) return topicMetaCache.get(id);
  const data = await fetchJSON(`${API}/topic?id=${encodeURIComponent(id)}`);
  // Discourse fields we expect to exist; defensively default
  const meta = {
    views: data?.views ?? data?.topic?.views ?? 0,
    likes: data?.like_count ?? data?.topic?.like_count ?? 0,
    replies: (data?.posts_count ?? data?.topic?.posts_count ?? 1) - 1
  };
  topicMetaCache.set(id, meta);
  return meta;
}

/* ---------- render helpers ---------- */
function pillHtml(likesText, viewsText) {
  return `
  <div class="stat-pill" role="group" aria-label="Post stats">
    <span class="stat likes" title="Likes" data-noaction>
      <sl-icon name="heart"></sl-icon><b class="num">${likesText}</b>
    </span>
    <span class="sep"></span>
    <span class="stat views" title="Views" data-noaction>
      <sl-icon name="eye"></sl-icon><b class="num">${viewsText}</b>
    </span>
  </div>`;
}

function tagPills(tags) {
  if (!Array.isArray(tags) || !tags.length) return "";
  const unique = [];
  tags.forEach(t => {
    const v = (t || "").toString().trim();
    if (v && !unique.includes(v)) unique.push(v);
  });
  return `<div class="tags">${unique.slice(0, 4).map(t => `<span class="tag">${t}</span>`).join("")}</div>`;
}

function renderCard(item) {
  const el = document.createElement("article");
  el.className = "card";

  const likesText = fmt(item.likes ?? item.like_count);
  const viewsPlaceholder = "–";

  el.innerHTML = `
    <div class="row">
      <h3 class="title">${item.title ?? ""}</h3>
      ${item.author ? `<span class="author">by ${item.author}</span>` : ""}
    </div>
    ${tagPills([item.bucket, ...(item.tags || [])])}
    <p class="desc">${item.excerpt ?? ""}</p>

    <button class="toggle" type="button" data-id="${item.id}">Read more</button>
    <div class="more" id="more-${item.id}"></div>

    ${pillHtml(likesText, viewsPlaceholder)}

    <div class="footer">
      <a class="cta-import" href="${item.import_url}" target="_blank" rel="noopener">
        <sl-icon name="download"></sl-icon> Import to Home Assistant
      </a>
    </div>
  `;

  // prevent stats pill clicks from navigating anywhere
  el.addEventListener("click", (e) => {
    const node = e.target.closest("[data-noaction]");
    if (node) {
      e.preventDefault();
      e.stopPropagation();
    }
  });

  // lazy fill views number
  const viewsNum = $(".stat.views .num", el);
  getTopicMeta(item.id).then(m => { viewsNum.textContent = fmt(m.views); }).catch(() => { /* leave placeholder */ });

  // read more / less loads cooked once
  const toggle = $(".toggle", el);
  const more = $(`#more-${item.id}`, el);
  let expanded = false;

  async function expandOnce() {
    if (expanded) return;
    expanded = true;
    toggle.disabled = true;
    try {
      const data = await fetchJSON(`${API}/topic?id=${encodeURIComponent(item.id)}`);
      const cooked = data?.cooked ?? "<em>No content</em>";
      const box = document.createElement("div");
      box.innerHTML = cooked;
      // rewrite any external anchors to open new tab safely
      $$("a", box).forEach(a => { a.target = "_blank"; a.rel = "noopener"; });
      more.innerHTML = "";
      more.appendChild(box);
    } catch (e) {
      more.innerHTML = `<em>Failed to load post</em>`;
    } finally {
      toggle.disabled = false;
    }
  }

  toggle.addEventListener("click", async () => {
    if (more.style.display === "block") {
      more.style.display = "none";
      toggle.textContent = "Read more";
    } else {
      await expandOnce();
      more.style.display = "block";
      toggle.textContent = "Less";
    }
  });

  return el;
}

function appendCards(target, items) {
  const frag = document.createDocumentFragment();
  items.forEach(it => frag.appendChild(renderCard(it)));
  target.appendChild(frag);
}

/* ---------- app boot ---------- */
function boot() {
  const list = $("#list");
  const empty = $("#empty");
  const errorB = $("#error");

  const search = $("#search");
  const sortSel = $("#sort");
  const tagBtn = $("#tagbtn");
  const tagMenu = $("#tagmenu");
  const tagDD = $("#tagdd");
  const refreshBtn = $("#refresh");
  const heading = $("#sectionTitle");

  if (!list) return;

  const SORT = {
    NEW: "new",
    LIKES: "likes",
    TITLE: "title"
  };
  const LABEL_BY_SORT = {
    [SORT.NEW]: "Newest",
    [SORT.LIKES]: "Most liked",
    [SORT.TITLE]: "A–Z"
  };

  let page = 0;
  let loading = false;
  let hasMore = true;

  let qTitle = "";
  let sort = SORT.NEW;
  let bucket = "";

  const sentinel = $("#sentinel");
  const setError = (msg) => { if (errorB) { errorB.textContent = msg; errorB.style.display = "block"; } };
  const clearError = () => { if (errorB) { errorB.textContent = ""; errorB.style.display = "none"; } };

  function updateHeading() {
    let base = LABEL_BY_SORT[sort] || "All";
    let suffix = "blueprints";
    if (qTitle && bucket) {
      heading.textContent = `Results for “${qTitle}” in ${bucket} — ${base.toLowerCase()}`;
    } else if (qTitle) {
      heading.textContent = `Results for “${qTitle}” — ${base.toLowerCase()}`;
    } else if (bucket) {
      heading.textContent = `${bucket} — ${base.toLowerCase()}`;
    } else {
      heading.textContent = `${base} ${suffix}`;
    }
  }

  async function fetchPage(p) {
    const url = new URL(`${API}/blueprints`, location.origin);
    url.searchParams.set("page", String(p));
    if (qTitle) url.searchParams.set("q_title", qTitle);
    if (sort) url.searchParams.set("sort", sort);
    if (bucket) url.searchParams.set("bucket", bucket);
    return fetchJSON(url.toString());
  }

  async function load(initial = false) {
    if (loading || (!hasMore && !initial)) return;
    loading = true; clearError();
    try {
      const data = await fetchPage(page);
      const items = data?.items || [];
      hasMore = !!data?.has_more;

      if (initial) {
        list.innerHTML = "";
        if (empty) empty.style.display = items.length ? "none" : "block";
      }
      appendCards(list, items);
      page += 1;
    } catch (e) {
      setError(`Failed to load: ${String(e.message || e)}`);
    } finally {
      loading = false;
    }
  }

  async function reloadAll() {
    page = 0; hasMore = true; list.innerHTML = "";
    clearError(); updateHeading();
    await load(true);
  }

  /* ---- SORT (hardened) ---- */
  // enforce values; never rely on display text
  if (sortSel) {
    sortSel.value = SORT.NEW;
    sortSel.addEventListener("sl-change", () => {
      const v = String(sortSel.value || "").toLowerCase();
      sort = v === SORT.LIKES ? SORT.LIKES : v === SORT.TITLE ? SORT.TITLE : SORT.NEW;
      reloadAll();
    });
  }

  /* ---- TAGS ---- */
  async function fetchFilters() {
    try {
      const data = await fetchJSON(`${API}/filters`);
      const tags = Array.isArray(data.tags) ? data.tags : [];
      tagMenu.innerHTML = `<sl-menu-item value="">All tags</sl-menu-item>`;
      tags.forEach(t => tagMenu.insertAdjacentHTML("beforeend", `<sl-menu-item value="${t}">${t}</sl-menu-item>`));
      tagMenu.addEventListener("sl-select", (ev) => {
        bucket = ev.detail.item.value || "";
        tagBtn.textContent = bucket || "All tags";
        reloadAll();
        tagDD?.hide?.();
      });
    } catch {
      // optional
    }
  }

  /* ---- SEARCH ---- */
  if (search) {
    const onSearch = debounce(() => {
      qTitle = (search.value || "").trim();
      reloadAll();
    }, 280);
    search.addEventListener("sl-input", onSearch);
    search.addEventListener("sl-clear", onSearch);
  }

  /* ---- Refresh ---- */
  refreshBtn?.addEventListener("click", reloadAll);

  /* ---- Infinite scroll ---- */
  if (sentinel) {
    new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) load(false);
    }, { rootMargin: "700px" }).observe(sentinel);
  }

  fetchFilters();
  updateHeading();
  load(true);
}

document.addEventListener("DOMContentLoaded", boot);
