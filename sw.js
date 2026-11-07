const C='wallet-v9';
const CORE=['./','./index.html','./manifest.webmanifest','./icons/favicon.svg','./icons/icon-192.png','./favicon.ico','./jszip.min.js'];
try { importScripts('./jszip.min.js'); } catch(e) {}
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(CORE.map(u=>new Request(u,{cache:'reload'})))).catch(()=>{}));self.skipWaiting();});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C).map(x=>caches.delete(x)))).then(()=>self.clients.claim()));});
self.addEventListener('message',e=>{ if (e.data && e.data.zipFlush) SITES.delete(e.data.zipFlush); });

self.addEventListener('fetch',e=>{
  if (e.request.method!=='GET'||!e.request.url.startsWith(self.location.origin)) return;
  const u = new URL(e.request.url);
  const i = u.pathname.indexOf('/__zip/');
  if (i>=0){ e.respondWith(serveZip(u, i).catch(err=>new Response('Preview error: '+err,{status:500,headers:{'content-type':'text/plain;charset=utf-8'}}))); return; }
  // network-first, bypassing the HTTP cache so new versions show up immediately
  e.respondWith(fetch(e.request,{cache:'no-cache'}).then(r=>{const cp=r.clone();if(r.ok)caches.open(C).then(c=>c.put(e.request,cp));return r;}).catch(()=>caches.match(e.request).then(r=>r||caches.match('./index.html'))));
});

/* ---------- serve a project zip as a real website under <app>/__zip/<id>/ ---------- */
const MIME={html:'text/html',htm:'text/html',css:'text/css',js:'text/javascript',mjs:'text/javascript',json:'application/json',txt:'text/plain',xml:'application/xml',svg:'image/svg+xml',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',avif:'image/avif',ico:'image/x-icon',woff:'font/woff',woff2:'font/woff2',ttf:'font/ttf',otf:'font/otf',mp4:'video/mp4',webm:'video/webm',mp3:'audio/mpeg',wav:'audio/wav',pdf:'application/pdf',webmanifest:'application/manifest+json',map:'application/json',wasm:'application/wasm'};
const SITES=new Map();
function idbGet(id){ return new Promise((res,rej)=>{ const r=indexedDB.open('spyr-projects',1);
  r.onupgradeneeded=()=>{ r.result.createObjectStore('projects',{keyPath:'id'}); };
  r.onsuccess=()=>{ const db=r.result; const t=db.transaction('projects','readonly').objectStore('projects').get(id); t.onsuccess=()=>{ res(t.result); db.close(); }; t.onerror=()=>rej(t.error); };
  r.onerror=()=>rej(r.error); }); }
async function getSite(id, fresh){
  let s=SITES.get(id);
  if (s && !fresh) return s;
  const p=await idbGet(id); if (!p) throw 'project not found';
  if (s && s.updated===p.updated && s.root===(p.root||'')) return s;
  const zip=await JSZip.loadAsync(p.blob); const root=p.root||'';
  const files=new Map();
  for (const f of Object.values(zip.files)){ if (f.dir) continue; let n=f.name; if (root){ if (!n.startsWith(root+'/')) continue; n=n.slice(root.length+1); } files.set(n,f); }
  const tops=[...new Set([...files.keys()].map(n=>n.split('/')[0]))].filter(Boolean).map(x=>x.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));
  s={updated:p.updated, root, files, tops, out:new Map()}; SITES.set(id,s); return s;
}
function find(s, path, rsc){
  const F=s.files; let p=path.replace(/^\/+/,'');
  try { p=decodeURIComponent(p); } catch(e){}
  const bare=p.replace(/\/$/,'');
  const cands = rsc ? [/\.txt$/.test(bare)?bare:'', bare+'/index.txt', bare+'.txt', bare?'' : 'index.txt'] : (p===''||p.endsWith('/')) ? [p+'index.html', bare+'.html'] : [p, p+'.html', p+'/index.html', /(^|\/)index$/.test(p)?p+'.html':''];
  for (const c of cands) if (c && F.has(c)) return c;
  return null;
}
function rewrite(s, base, text, ext){
  if (s.tops.length){
    const re=new RegExp('(["\'`(=,\\s])/('+s.tops.join('|')+')(?=[/"\'`?#)\\s,]|$)','g');
    text=text.replace(re,(m,a,b)=>a+base+b);
  }
  if (ext==='html'){
    text=text.replace(/(\s(?:href|src|action|poster|data-src)=["'])\/(?=["'?#])/gi,'$1'+base);
    const shim=`<script>(function(){var B=${JSON.stringify(base)};function fx(u){u=String(u);if(u.charAt(0)==='/'&&u.charAt(1)!=='/'&&u.indexOf(B)!==0)return B+u.slice(1);return u}
function fu(u){try{var x=new URL(u,location.href);if(x.origin===location.origin&&x.pathname.indexOf(B)!==0)return fx(x.pathname)+x.search+x.hash}catch(e){}return u}
var F=window.fetch;if(F)window.fetch=function(i,o){if(typeof i==='string'||i instanceof URL)i=fu(i);return F.call(this,i,o)};
var X=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){arguments[1]=fu(u);return X.apply(this,arguments)};
['pushState','replaceState'].forEach(function(k){var o=history[k];history[k]=function(st,t,u){return u==null?o.call(this,st,t):o.call(this,st,t,fu(u))}});
document.addEventListener('click',function(e){var a=e.target&&e.target.closest&&e.target.closest('a[href]');if(!a)return;var h=a.getAttribute('href');if(h&&h.charAt(0)==='/'&&h.charAt(1)!=='/'&&h.indexOf(B)!==0)a.setAttribute('href',fx(h))},true);
})();<\/script>`;
    text = /<head[^>]*>/i.test(text) ? text.replace(/<head[^>]*>/i, m=>m+shim) : shim+text;
  }
  return text;
}
async function serveZip(u, i){
  const rest=u.pathname.slice(i+7); const slash=rest.indexOf('/');
  const id=slash<0?rest:rest.slice(0,slash); const path=slash<0?'':rest.slice(slash+1);
  const base=u.pathname.slice(0,i+7)+id+'/';
  if (slash<0) return Response.redirect(u.origin+base+u.search,302);
  const rsc=u.searchParams.has('_rsc');
  let s=await getSite(id, path===''||/\.html?$/.test(path));
  let name=find(s,path,rsc);
  let status=200;
  if (!name){ name=s.files.has('404.html')?'404.html':null; status=404; }
  if (!name) return new Response('Not found in zip: /'+path,{status:404,headers:{'content-type':'text/plain;charset=utf-8'}});
  const ext=(name.split('.').pop()||'').toLowerCase();
  const type=(rsc?'text/x-component':MIME[ext]||'application/octet-stream');
  const headers={'content-type':type+(/^text\/|json|xml|javascript|component/.test(type)?';charset=utf-8':''),'cache-control':'no-store'};
  if (/^(html?|css|js|mjs|json|txt)$/.test(ext)){
    const key=name+'|'+ext;
    let body=s.out.get(key);
    if (body==null){ body=rewrite(s, base, await s.files.get(name).async('string'), ext==='htm'?'html':ext); s.out.set(key,body); }
    return new Response(body,{status,headers});
  }
  return new Response(await s.files.get(name).async('blob'),{status,headers});
}
