/* custom_components/blueprint_store/panel/app.js */

const API = "/api/blueprint_store";
const $ = (s) => document.querySelector(s);

/* ---------- tiny utils ---------- */
const fmtK = (n) => {
  if (n == null || isNaN(n)) return "0";
  const v = Number(n);
  if (v < 1000) return String(v);
  if (v < 1000000) return (v / 1000).toFixed(v % 1000 >= 100 ? 1 : 0) + "k";
  return (v / 1000000).toFixed(1) + "m";
};
const debounce = (fn, ms = 280) => {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
};
function esc(s) {
  return (s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
async function fetchJSONRaw(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}
async function fetchJSON(url, tries = 3) {
  let backoff = 600;
  for (let i = 0; i < tries; i++) {
    try {
      return await fetchJSONRaw(url);
    } catch (e) {
      const m = String(e?.message || e);
      if (i < tries - 1 && /429/.test(m)) {
        await new Promise((r) => setTimeout(r, backoff + Math.random() * 250));
        backoff *= 2;
        continue;
      }
      throw e;
    }
  }
}

/* ---------- non-navigating stats pill ---------- */
function statsPill(likes, installs) {
  return `
    <div class="stats-pill" aria-label="Blueprint popularity">
      <div class="stat">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12.1 21.35l-1.1-1.02C5.14 14.88 2 12.07 2 8.5 2 6.5 3.5 5 5.5 5c1.54 0 3.04.99 3.57 2.36h1.87C13.46 5.99 14.96 5 16.5 5 18.5 5 20 6.5 20 8.5c0 3.57-3.14 6.38-8.9 11.83l-1 1.02z"/></svg>
        <span class="num">${fmtK(likes)}</span>
      </div>
      <div class="sep"></div>
      <div class="stat">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M16 13v5H8v-5H5l7-7 7 7h-3zM5 20h14v2H5z"/></svg>
        <span class="num">${fmtK(installs)}</span>
      </div>
    </div>`;
}

/* ---------- tags ---------- */
function tagPills(tags) {
  const set = [];
  (tags || []).forEach((t) => {
    const v = (t || "").toString().trim();
    if (v && !set.includes(v)) set.push(v);
  });
  if (!set.length) return "";
  return `<div class="tags">${set.slice(0, 4).map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>`;
}

/* ---------- normalize post HTML in “Read more” ---------- */
function setPostHTML(container, html) {
  const tmp = document.createElement("div");
  tmp.innerHTML = html || "<em>Nothing to show.</em>";

  // Convert any “Import to HA” in the post into the same compact pill appearance
  tmp.querySelectorAll('a[href*="my.home-assistant.io/redirect/blueprint_import"]').forEach((a) => {
    const href = a.getAttribute("href") || a.textContent || "#";
    const pill = document.createElement("span");
    pill.className = "myha-btn myha-inline-import";
    pill.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M16 13v5H8v-5H5l7-7 7 7h-3zM5 20h14v2H5z"/></svg> Import to Home Assistant`;
    a.replaceWith(pill);

    // also copy possible next “clicks” badge text as installs
    const next = pill.nextElementSibling;
    if (next && /badge|click/.test(next.className || "")) {
      next.classList.add("inline-clicks-badge");
    }
  });

  container.innerHTML = "";
  container.appendChild(tmp);
}

/* ---------- light client cache ---------- */
const detailCache = new Map();   // topicId -> cooked
const statCache = new Map();     // topicId -> {likes, installs}

/* ---------- card renderer ---------- */
function renderCard(it, onHydrate) {
  const el = document.createElement("article");
  el.className = "card";

  // prefer backend fields; fallback to 0 so pill renders consistently
  const likes0 = Number(it.likes ?? 0);
  const installs0 = Number(it.installs ?? it.uses ?? 0);

  el.innerHTML = `
    <div class="row">
      <h3>${esc(it.title)}</h3>
      ${it.author ? `<span class="author">by ${esc(it.author)}</span>` : ""}
    </div>
    ${tagPills([it.bucket, ...(it.tags || []).slice(0, 3)])}
    <p class="desc">${esc(it.excerpt || "")}</p>

    <div class="toggle" data-id="${it.id}">Read more</div>
    <div class="more" id="more-${it.id}"></div>

    <div class="card__footer">
      ${statsPill(likes0, installs0)}
      ${it.import_url ? `<a class="myha-btn" href="${esc(it.import_url)}" target="_blank" rel="noopener">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M16 13v5H8v-5H5l7-7 7 7h-3zM5 20h14v2H5z"/></svg>
        Import to Home Assistant
      </a>` : `<button class="myha-btn neutral" type="button" disabled>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M16 13v5H8v-5H5l7-7 7 7h-3zM5 20h14v2H5z"/></svg>
        View description
      </button>`}
    </div>
  `;

  // hydrate stats asynchronously (accurate likes + installs)
  onHydrate?.(el, it);

  // Read more / less
  const toggle = el.querySelector(".toggle");
  const more = el.querySelector(`#more-${it.id}`);
  let expanded = false;

  async function expandNow() {
    if (expanded) return;
    expanded = true;
    toggle.style.pointerEvents = "none";
    try {
      if (!detailCache.has(it.id)) {
        const data = await fetchJSON(`${API}/topic?id=${it.id}`);
        // if server already includes meta, stash it for pill too
        if (data && (data.likes != null || data.installs != null)) {
          statCache.set(it.id, {
            likes: Number(data.likes ?? 0),
            installs: Number(data.installs ?? 0),
          });
          const pill = el.querySelector(".stats-pill .num");
          if (pill) {
            const [likeEl, instEl] = el.querySelectorAll(".stats-pill .num");
            if (likeEl) likeEl.textContent = fmtK(statCache.get(it.id).likes);
            if (instEl) instEl.textContent = fmtK(statCache.get(it.id).installs);
          }
        }
        detailCache.set(it.id, data?.cooked || "<em>Nothing to show.</em>");
      }
      setPostHTML(more, detailCache.get(it.id));
    } catch (e) {
      setPostHTML(more, `<em>Failed to load post: ${esc(String(e.message || e))}</em>`);
    } finally {
      toggle.style.pointerEvents = "";
    }
    more.style.display = "block";
    toggle.textContent = "Less";
  }
  toggle.addEventListener("click", () => {
    if (expanded) {
      expanded = false;
      more.style.display = "none";
      toggle.textContent = "Read more";
    } else {
      expandNow();
    }
  });

  // Do NOT let the stats pill navigate anywhere (it doesn't have links anyway)
  el.querySelector(".stats-pill")?.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
  });

  return el;
}

/* ---------- list helpers ---------- */
function appendItems(target, items, onHydrate) {
  for (const it of items) target.appendChild(renderCard(it, onHydrate));
}

/* ---------- boot ---------- */
function boot() {
  const list = $("#list");
  const empty = $("#empty");
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
  let sort = "new"; // 'new' | 'likes' | 'title'
  let bucket = "";

  const setError = (msg) => {
    if (errorB) {
      errorB.textContent = msg;
      errorB.style.display = "block";
    }
  };
  const clearError = () => {
    if (errorB) {
      errorB.style.display = "none";
      errorB.textContent = "";
    }
  };

  async function fetchFilters() {
    try {
      const data = await fetchJSON(`${API}/filters`);
      const tags = Array.isArray(data.tags) ? data.tags : [];
      tagmenu.innerHTML = "";
      const mk = (value, label) => `<sl-menu-item value="${esc(value)}">${esc(label)}</sl-menu-item>`;
      tagmenu.insertAdjacentHTML("beforeend", mk("", "All tags"));
      tags.forEach((t) => tagmenu.insertAdjacentHTML("beforeend", mk(t, t)));
      tagmenu.addEventListener("sl-select", async (ev) => {
        const val = ev.detail.item.value || "";
        bucket = val;
        tagbtn.textContent = bucket || "All tags";
        await loadAllForSearch();
        if (tagdd && typeof tagdd.hide === "function") tagdd.hide();
      });
    } catch (e) {
      /* optional */
    }
  }

  function buildUrl(p) {
    const url = new URL(`${API}/blueprints`, location.origin);
    url.searchParams.set("page", String(p));
    if (qTitle) url.searchParams.set("q_title", qTitle);
    if (sort) url.searchParams.set("sort", sort);
    if (bucket) url.searchParams.set("bucket", bucket);
    return url.toString();
  }

  async function fetchPage(p) {
    return await fetchJSON(buildUrl(p));
  }

  // hydrate stats with an ultra-light queue so we don’t thump the backend
  const HYDRATE_CONCURRENCY = 3;
  const queue = [];
  let inflight = 0;

  async function enqueueHydrate(cardEl, item) {
    queue.push({ cardEl, item });
    pump();
  }
  async function pump() {
    if (inflight >= HYDRATE_CONCURRENCY || queue.length === 0) return;
    const { cardEl, item } = queue.shift();
    inflight++;
    try {
      if (!statCache.has(item.id)) {
        const data = await fetchJSON(`${API}/topic?id=${item.id}`);
        // compute accurate stats from the topic JSON when available
        let likes = null;
        let installs = null;

        // If backend sends meta directly
        if (data && (data.likes != null || data.installs != null)) {
          likes = Number(data.likes ?? 0);
          installs = Number(data.installs ?? 0);
        } else if (data && data.post && data.post.like_count != null) {
          // Legacy compatibility if backend returns {post:{like_count}, post:{link_counts:[]}}
          likes = Number(data.post.like_count || 0);
          const linkCounts = Array.isArray(data.post.link_counts) ? data.post.link_counts : [];
          for (const lc of linkCounts) {
            if ((lc.url || "").includes("my.home-assistant.io/redirect/blueprint_import")) {
              installs = Number(lc.clicks || 0);
              break;
            }
          }
          // as last resort, try to infer clicks in cooked html (not perfect, but helps)
          if (installs == null && typeof data.cooked === "string") {
            const tmp = document.createElement("div");
            tmp.innerHTML = data.cooked;
            const a = tmp.querySelector('a[href*="my.home-assistant.io/redirect/blueprint_import"]');
            if (a && a.nextElementSibling) {
              const txt = (a.nextElementSibling.textContent || "").trim().replace(/[^\d.km]/gi, "");
              if (txt) {
                // parse compact strings like "23.7k"
                const m = txt.match(/^([\d.]+)\s*([kKmM])?$/);
                if (m) {
                  const num = parseFloat(m[1]);
                  installs = m[2] ? (m[2].toLowerCase() === "m" ? Math.round(num * 1e6) : Math.round(num * 1e3)) : Math.round(num);
                }
              }
            }
          }
        }

        statCache.set(item.id, {
          likes: Number(likes ?? item.likes ?? 0),
          installs: Number(installs ?? item.installs ?? item.uses ?? 0),
        });
      }

      // write to the pill
      const likeEl = cardEl.querySelectorAll(".stats-pill .num")[0];
      const instEl = cardEl.querySelectorAll(".stats-pill .num")[1];
      if (likeEl) likeEl.textContent = fmtK(statCache.get(item.id).likes);
      if (instEl) instEl.textContent = fmtK(statCache.get(item.id).installs);
    } catch {
      // keep silent – UI already shows initial values
    } finally {
      inflight--;
      pump();
    }
  }

  async function load(initial = false) {
    if (loading || (!hasMore && !initial)) return;
    loading = true;
    clearError();
    try {
      const data = await fetchPage(page);
      const items = data.items || [];
      hasMore = !!data.has_more;
      if (initial) {
        list.innerHTML = "";
        if (empty) empty.style.display = items.length ? "none" : "block";
      }
      appendItems(list, items, enqueueHydrate);
      page += 1;
    } catch (e) {
      setError(`Failed to load: ${String(e.message || e)}`);
    } finally {
      loading = false;
    }
  }

  async function loadAllForSearch() {
    page = 0;
    hasMore = true;
    list.innerHTML = "";
    clearError();
    let first = true;
    while (hasMore) {
      await load(first);
      first = false;
      await new Promise((r) => setTimeout(r, 8));
    }
  }

  // search
  if (search) {
    const onSearch = debounce(async () => {
      qTitle = (search.value || "").trim();
      await loadAllForSearch();
    }, 280);
    search.addEventListener("sl-input", onSearch);
    search.addEventListener("sl-clear", onSearch);
  }

  // sort — hardened to avoid flicker/glitch
  if (sortSel) {
    let sortLock = false;
    sortSel.addEventListener("sl-change", async () => {
      if (sortLock) return;
      sortLock = true;
      try {
        const v = (sortSel.value || "new").toLowerCase();
        sort = v === "likes" ? "likes" : v === "title" ? "title" : "new";
        await loadAllForSearch();
      } finally {
        sortLock = false;
      }
    });
  }

  if (refreshBtn) {
    refreshBtn.addEventListener("click", async () => {
      await loadAllForSearch();
    });
  }

  if (sentinel) {
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0] && entries[0].isIntersecting) load(false);
      },
      { rootMargin: "700px" }
    );
    io.observe(sentinel);
  }

  fetchFilters();
  load(true);
}

document.addEventListener("DOMContentLoaded", boot);

/* ----------------------- styles (kept consistent) ----------------------- */
/* (Your existing CSS rules remain in index.html / theme. Only classes used above:)
   .stats-pill, .stats-pill .stat, .stats-pill .sep  */
