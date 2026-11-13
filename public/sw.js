// MAX app shell: always try the network first so a new deploy is picked up at once;
// when the device is offline, open the last saved page so the cashier can keep working.
const SHELL = 'max-shell-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.add('/index.html')).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || req.mode !== 'navigate') return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(SHELL).then((c) => c.put('/index.html', copy));
        return res;
      })
      .catch(() => caches.match('/index.html')),
  );
});
