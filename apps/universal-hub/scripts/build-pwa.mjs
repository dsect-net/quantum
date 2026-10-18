/** Precache public shell only: never cache API responses, profiles or tokens. */
import {readdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const assets=(await readdir('dist/assets')).map(f=>'/assets/'+f);
const hash=createHash('sha256').update(assets.join('|')+await readFile('dist/index.html','utf8')+await readFile('scripts/build-pwa.mjs','utf8')).digest('hex').slice(0,12);
const urls=['/','/index.html','/manifest.webmanifest','/icon-192.png','/icon-512.png',...assets];
await writeFile('dist/sw.js',`
const CACHE='singularity-${hash}', URLS=${JSON.stringify(urls)};
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(URLS))));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('singularity-')&&k!==CACHE).map(k=>caches.delete(k))))));
self.addEventListener('fetch',e=>{
 const u=new URL(e.request.url);
 if(e.request.method!=='GET'||u.origin!==location.origin||u.pathname.startsWith('/api/')||u.pathname==='/mcp') return;
 if(e.request.mode==='navigate') e.respondWith(fetch(e.request).catch(()=>caches.match('/index.html')));
 else if(URLS.includes(u.pathname)) e.respondWith(caches.match(u.pathname,{ignoreVary:true}).then(r=>r||fetch(e.request)));
});
`);
console.log('Generated shell-only service worker',hash);
