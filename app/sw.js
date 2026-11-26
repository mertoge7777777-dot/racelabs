// Yalnız uygulama kabuğunu önbelleğe alır; sporcu verisi ASLA önbelleğe alınmaz (Supabase istekleri hep ağdan).
const CACHE = 'racelab-shell-v3';
const SHELL = ['./', './index.html', './app.js', './styles.css', './config.js', './icon.svg', './manifest.webmanifest', './vendor/supabase-2.45.4.js', './vendor/591.supabase.js', './core/format.js', './core/supabase.js', './core/queue.js', './core/router.js', './pages/giris.js', './pages/onay.js', './pages/salon.js', './pages/hesap.js', './pages/pano.js', './pages/profil.js', './pages/sporcular.js', './pages/sporcu.js', './pages/oturumlar.js', './pages/canli.js', './pages/formatlar.js', './pages/uyeler.js'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== self.location.origin) return;
  e.respondWith(fetch(e.request).then((r) => { const c = r.clone(); caches.open(CACHE).then((x) => x.put(e.request, c)); return r; }).catch(() => caches.match(e.request).then((r) => r || caches.match('./index.html'))));
});
