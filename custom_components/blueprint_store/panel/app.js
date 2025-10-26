// Blueprint Store panel script (safe load)
const API="/api/blueprint_store";
const $=(s, r=document)=>r.querySelector(s);
const $$=(s, r=document)=>Array.from(r.querySelectorAll(s));
const esc=s=>(s??"").toString().replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
const debounce=(fn,ms=250)=>{let t;return(...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),ms);};};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function fetchJSON(url,tries=3){
  let back=500;
  for(let i=0;i<tries;i++){
    const res=await fetch(url);
    if(res.ok) return res.json();
    if(res.status===429 && i<tries-1){await sleep(back); back*=2; continue;}
    throw new Error(`${res.status} ${res.statusText}`);
  }
}

/* ---------- state ---------- */
const st={
  list:null, sentinel:null, heading:null,
  search:null, sortSel:null, tagMenu:null, tagBtn:null,
  page:0, hasMore:true, loading:false,
  qTitle:"", sort:"new", tag:""
};

/* ---------- ui helpers ---------- */
const kfmt=n=>{
  if(n==null) return "0";
  const x=Number(n);
  if(!Number.isFinite(x)) return "0";
  if(x>=1_000_000) return `${(x/1_000_000).toFixed(1).replace(/\.0$/,"")}M`;
  if(x>=1_000) return `${(x/1_000).toFixed(1).replace(/\.0$/,"")}k`;
  return `${x}`;
};

function likePill(n){
  return `<div class="pill likes-pill" title="People who liked this post">
    <svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12.1 8.64l-.1.1-.11-.11C10.14 6.6 6.5 7.24 6.5 10.05c0 1.54.99 3.04 3.09 4.96 1.05.95 2.18 1.85 2.51 2.12.33-.27 1.46-1.17 2.51-2.12 2.1-1.92 3.09-3.42 3.09-4.96 0-2.81-3.64-3.45-5.59-1.41z" fill="currentColor"/></svg>
    <span class="pill-num">${kfmt(n)}</span>
    <span class="pill-suffix">Liked this</span>
  </div>`;
}

function normalizeImportBadges(scope){
  $$('a[href*="redirect/blueprint_import"]', scope).forEach(a=>{
    a.className="myha-btn myha-inline-import";
    a.innerHTML='<svg class="i" viewBox="0 0 24 24"><path d="M10 20v-6H7l5-5 5 5h-3v6z" fill="currentColor"/></svg><span>Import to Home Assistant</span>';
    $$("img, svg:not(.i)", a).forEach(n=>n.remove());
    a.style.removeProperty("width");
    a.style.removeProperty("height");
  });
}

/* description expand in-place */
function setFullDesc(container, html){
  const full=$(".desc-full", container);
  full.innerHTML = html || "<em>No additional description.</em>";
  normalizeImportBadges(full);
  container.classList.add("expanded");
  full.hidden=false;
}

function card(it){
  const tags=(it.tags||[]).slice(0,4);
  const el=document.createElement("article");
  el.className="card";
  el.innerHTML=`
    <header class="card-hd">
      <h3 class="ttl">${esc(it.title)}</h3>
      ${it.author?`<span class="author">by <strong>${esc(it.author)}</strong></span>`:""}
    </header>

    <div class="tags">${tags.map(t=>`<span class="tag">${esc(t)}</span>`).join("")}</div>

    <section class="desc">
      <p class="excerpt">${esc(it.excerpt||"")}</p>
      <div class="desc-full" hidden></div>
      <button class="readmore" type="button">Read more</button>
    </section>

    <footer class="card-ft">
      ${likePill(it.likes||0)}
      <a class="cta-import" href="${esc(it.import_url||"#")}" target="_blank" rel="noopener">
        <svg class="i" viewBox="0 0 24 24"><path d="M5 20h14v-2H5v2zM12 2l-5 5h3v6h4V7h3l-5-5z" fill="currentColor"/></svg>
        <span>Import to Home Assistant</span>
      </a>
    </footer>
  `;

  // likes pill is non-interactive
  $(".likes-pill", el).addEventListener("click", e=>e.preventDefault());

  // read more loader
  const btn=$(".readmore", el);
  const desc=$(".desc", el);
  const full=$(".desc-full", el);
  let loaded=false;

  btn.addEventListener("click", async ()=>{
    if(!loaded){
      try{
        const data=await fetchJSON(`${API}/topic?id=${encodeURIComponent(it.id)}`);
        setFullDesc(desc, data?.cooked || "");
        btn.textContent="Less";
        loaded=true;
      }catch{
        full.hidden=false;
        full.innerHTML="<em>Failed to load post.</em>";
      }
    }else{
      const expanded=desc.classList.toggle("expanded");
      full.hidden=!expanded;
      btn.textContent = expanded ? "Less" : "Read more";
    }
  });

  return el;
}

function append(items){
  const frag=document.createDocumentFragment();
  items.forEach(i=>frag.appendChild(card(i)));
  st.list.appendChild(frag);
}

/* -------- fetch -------- */
function buildUrl(page){
  const u=new URL(`${API}/blueprints`, location.origin);
  u.searchParams.set("page", String(page));
  if(st.qTitle) u.searchParams.set("q_title", st.qTitle);
  if(st.sort) u.searchParams.set("sort", st.sort);
  if(st.tag){ u.searchParams.set("tag", st.tag); u.searchParams.set("bucket", st.tag); }
  return u.toString();
}

async function fetchPage(p){
  const data=await fetchJSON(buildUrl(p));
  return { items:data?.items||[], hasMore:!!data?.has_more };
}

async function load(initial=false){
  if(st.loading || (!st.hasMore && !initial)) return;
  st.loading=true;
  try{
    const {items, hasMore}=await fetchPage(st.page);
    st.hasMore=hasMore;
    if(initial) st.list.innerHTML="";
    append(items);
    st.page+=1;
  }finally{ st.loading=false; }
}

async function reloadAll(){
  st.page=0; st.hasMore=true; st.list.innerHTML="";
  updateHeading();
  await load(true);
}

/* -------- heading -------- */
function updateHeading(){
  const m={new:"Newest", likes:"Most liked", title:"A–Z"};
  const bits=[];
  bits.push(m[st.sort]||"All");
  if(st.tag) bits.push(`#${st.tag}`);
  if(st.qTitle) bits.push(`“${st.qTitle}”`);
  st.heading.textContent = `${bits.join(" · ")} blueprints`;
}

/* -------- contributors (best-effort) -------- */
async function buildContrib(){
  const host=$("#contributors"); if(!host) return;
  try{
    const liked=await fetchJSON(`${API}/blueprints?sort=likes&page=0`);
    const newest=await fetchJSON(`${API}/blueprints?sort=new&page=0`);
    const topLiked=liked?.items?.[0];
    const topNew=newest?.items?.[0];

    const counts={};
    (newest?.items||[]).forEach(i=>{ counts[i.author]=(counts[i.author]||0)+1; });
    const mostAuthor=Object.keys(counts).sort((a,b)=>counts[b]-counts[a])[0];
    const mostCount=mostAuthor?counts[mostAuthor]:0;

    host.innerHTML=`
      <div class="contrib-card">
        <div class="contrib-hd">Most popular</div>
        ${topLiked?`<div class="contrib-author">${esc(topLiked.author||"—")}</div>
        <div class="contrib-sub">${esc(topLiked.title||"")}</div>`:`<div class="muted">No data</div>`}
      </div>
      <div class="contrib-card">
        <div class="contrib-hd">Most blueprints</div>
        ${mostAuthor?`<div class="contrib-author">${esc(mostAuthor)}</div>
        <div class="contrib-sub">${mostCount} blueprint(s)</div>`:`<div class="muted">No data</div>`}
      </div>
      <div class="contrib-card">
        <div class="contrib-hd">Most recent</div>
        ${topNew?`<div class="contrib-author">${esc(topNew.author||"—")}</div>
        <div class="contrib-sub">${esc(topNew.title||"")}</div>`:`<div class="muted">No data</div>`}
      </div>`;
  }catch{ host.innerHTML=`<div class="muted">Unable to build contributors right now.</div>`; }
}

/* -------- boot -------- */
function attachSort(){
  if(st.sortSel.__bound) return;
  st.sortSel.__bound=true;
  st.sortSel.addEventListener("sl-change", async ()=>{
    st.sort = st.sortSel.value || "new";
    await reloadAll();
  });
}
function attachSearch(){
  const on=debounce(async ()=>{
    st.qTitle=(st.search.value||"").trim();
    await reloadAll();
  },280);
  st.search.addEventListener("sl-input", on);
  st.search.addEventListener("sl-clear", on);
}
function attachTags(){
  st.tagMenu.innerHTML = `<sl-menu-item value="">All tags</sl-menu-item>`;
  fetchJSON(`${API}/filters`).then(d=>{
    (Array.isArray(d?.tags)?d.tags:[]).forEach(t=>{
      st.tagMenu.insertAdjacentHTML("beforeend", `<sl-menu-item value="${esc(t)}">${esc(t)}</sl-menu-item>`);
    });
  }).catch(()=>{});
  if(st.tagMenu.__bound) return;
  st.tagMenu.__bound=true;
  st.tagMenu.addEventListener("sl-select", async ev=>{
    st.tag = ev.detail.item?.value || "";
    st.tagBtn.textContent = st.tag || "All tags";
    const dd=$("#tagdd"); if(dd&&dd.hide) dd.hide();
    await reloadAll();
  });
}
function watchScroll(){
  const io=new IntersectionObserver(es=>{
    if(es[0]?.isIntersecting) load(false);
  },{rootMargin:"800px"});
  io.observe(st.sentinel);
}

async function boot(){
  st.list=$("#list"); st.sentinel=$("#sentinel"); st.heading=$("#heading");
  st.search=$("#search"); st.sortSel=$("#sort"); st.tagMenu=$("#tagmenu"); st.tagBtn=$("#tagbtn");
  attachSort(); attachSearch(); attachTags(); watchScroll(); updateHeading();
  await buildContrib();
  await load(true);
}
document.addEventListener("DOMContentLoaded", boot);
