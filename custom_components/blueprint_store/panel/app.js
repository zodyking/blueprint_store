const API = "/api/blueprint_browser";
const $ = (sel) => document.querySelector(sel);

const listEl   = $("#list");
const emptyEl  = $("#empty");
const errorEl  = $("#error");
const loadEl   = $("#loading");
const detailEl = $("#detail");
const searchEl = $("#search");
const sortEl   = $("#sort");
const refreshBtn = $("#refresh");

let items = [];
let filtered = [];

// ---------- utils ----------
function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}
const debounce = (fn, ms=200) => {
  let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
};

// ---------- render ----------
function card(item) {
  const el = document.createElement("article");
  el.className = "card";
  el.innerHTML = `
    <div class="card-head">
      <h3 class="title">${escapeHtml(item.title)}</h3>
    </div>
    <div class="body">${escapeHtml(item.excerpt || "")}</div>
    <div class="meta">
      <a class="link" href="${item.topic_url}" target="_blank" rel="noopener">Forum post</a>
      <a class="link btn-primary import" href="${item.import_url}" target="_blank" rel="noopener" style="padding:8px 12px;border-radius:10px;color:#fff;">Import</a>
    </div>
  `;
  el.querySelector(".title").addEventListener("click", () => showDetail(item));
  return el;
}

function render() {
  listEl.innerHTML = "";
  if (!filtered.length) {
    listEl.style.display = "none";
    emptyEl.style.display = "block";
    return;
  }
  emptyEl.style.display = "none";
  listEl.style.display = "grid";
  filtered.forEach((it) => listEl.appendChild(card(it)));
}

function showDetail(item) {
  $("#d-title").textContent = item.title;
  $("#d-excerpt").textContent = item.excerpt || "";
  $("#d-topic").href = item.topic_url;
  $("#d-import").href = item.import_url;
  $("main").style.display = "none";
  detailEl.style.display = "block";
}

function showList() {
  detailEl.style.display = "none";
  $("main").style.display = "block";
}

// ---------- filtering & sorting ----------
function doFilterAndSort() {
  const q = (searchEl.value || "").trim().toLowerCase();
  filtered = !q ? items.slice() : items.filter(i =>
    i.title.toLowerCase().includes(q) || (i.excerpt || "").toLowerCase().includes(q)
  );
  switch (sortEl.value) {
    case "az": filtered.sort((a,b) => a.title.localeCompare(b.title)); break;
    case "za": filtered.sort((a,b) => b.title.localeCompare(a.title)); break;
    default:   filtered.sort((a,b) => b.id - a.id); // newest
  }
  render();
}

const onSearch = debounce(doFilterAndSort, 180);
searchEl.addEventListener("input", onSearch);
sortEl.addEventListener("change", doFilterAndSort);

// ---------- data ----------
async function load() {
  loadEl.style.display = "block";
  errorEl.style.display = "none";
  listEl.style.display = "none";
  emptyEl.style.display = "none";

  try {
    const res = await fetch(`${API}/blueprints`, { credentials: "same-origin" });
    if (!res.ok) throw new Error(await res.text());
    items = await res.json();
    doFilterAndSort();
  } catch (e) {
    errorEl.textContent = `Failed to load: ${String(e.message || e)}`;
    errorEl.style.display = "block";
  } finally {
    loadEl.style.display = "none";
  }
}

async function refresh() {
  refreshBtn.disabled = true;
  try {
    await fetch(`${API}/refresh`, { method: "POST", credentials: "same-origin" });
    await load();
  } catch (e) {
    errorEl.textContent = `Refresh failed: ${String(e.message || e)}`;
    errorEl.style.display = "block";
  } finally {
    refreshBtn.disabled = false;
  }
}

refreshBtn.addEventListener("click", refresh);

// kick off
load();
