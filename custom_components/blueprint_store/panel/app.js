const API = "/api/blueprint_browser";
const $ = (sel) => document.querySelector(sel);
const listEl = $("#list");
const detailEl = $("#detail");
const searchEl = $("#search");
const refreshBtn = $("#refresh");

let items = [];
let filtered = [];

function card(item) {
  const div = document.createElement("div");
  div.className = "card";
  div.innerHTML = `
    <button class="title link" style="all:unset;cursor:pointer;color:#2563eb">${escapeHtml(item.title)}</button>
    <p class="excerpt">${escapeHtml(item.excerpt || "")}</p>
    <div class="meta">
      <a class="link" href="${item.topic_url}" target="_blank" rel="noopener">Forum post</a>
      <a class="link btn-primary" href="${item.import_url}" target="_blank" rel="noopener">Import</a>
    </div>
  `;
  div.querySelector(".title").addEventListener("click", () => showDetail(item));
  return div;
}

function render() {
  listEl.innerHTML = "";
  if (!filtered.length) {
    listEl.innerHTML = `<div class="empty">No blueprints matched.</div>`;
    return;
  }
  filtered.forEach((it) => listEl.appendChild(card(it)));
}

function showDetail(item) {
  $("#d-title").textContent = item.title;
  $("#d-excerpt").textContent = item.excerpt || "";
  $("#d-topic").href = item.topic_url;
  $("#d-import").href = item.import_url;
  listEl.style.display = "none";
  detailEl.style.display = "block";
}

function showList() {
  detailEl.style.display = "none";
  listEl.style.display = "block";
}

function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c]));
}

function applyFilter() {
  const q = (searchEl.value || "").trim().toLowerCase();
  filtered = !q ? items : items.filter(i =>
    i.title.toLowerCase().includes(q) || (i.excerpt || "").toLowerCase().includes(q)
  );
  render();
}

async function load(q="") {
  const url = q ? `${API}/blueprints?q=${encodeURIComponent(q)}` : `${API}/blueprints`;
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) throw new Error(await res.text());
  items = await res.json();
  filtered = items.slice();
  render();
}

async function refresh() {
  refreshBtn.disabled = true;
  try {
    await fetch(`${API}/refresh`, { method: "POST", credentials: "same-origin" });
    await load();
  } catch(e) {
    alert("Refresh failed: " + e);
  } finally {
    refreshBtn.disabled = false;
  }
}

searchEl.addEventListener("input", applyFilter);
refreshBtn.addEventListener("click", refresh);

load().catch(e => {
  listEl.innerHTML = `<div class="empty">Failed to load: ${escapeHtml(String(e))}</div>`;
});
