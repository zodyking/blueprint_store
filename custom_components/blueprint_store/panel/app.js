// app.js
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
    const redir = rewriteToR
