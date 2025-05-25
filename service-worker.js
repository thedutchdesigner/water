const CACHE_NAME = 'water-finder-v2'; // Incremented version for updates
const ASSETS = [
  '.', // Represents the root (index.html)
  'index.html',
  'styles.css',
  'app.js',
  'manifest.json',
  'icon-192.png', // Assuming this is the correct path from your files
  'icon-512.png', // Assuming this is the correct path from your files
  'https://unpkg.com/leaflet@1.9.3/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.3/dist/leaflet.js',
  'https://unpkg.com/leaflet.markercluster/dist/MarkerCluster.css',
  'https://unpkg.com/leaflet.markercluster/dist/MarkerCluster.Default.css',
  'https://unpkg.com/leaflet.markercluster/dist/leaflet.markercluster.js'
];

// Install event: Cache core assets
self.addEventListener('install', evt => {
  console.log('Service Worker: Installing...');
  evt.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Service Worker: Caching core assets:', ASSETS);
        return cache.addAll(ASSETS);
      })
      .then(() => self.skipWaiting()) // Activate worker immediately
      .catch(err => console.error('Service Worker: Cache addAll error:', err))
  );
});

// Activate event: Clean up old caches
self.addEventListener('activate', evt => {
  console.log('Service Worker: Activating...');
  evt.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(keys.map(key => {
        if (key !== CACHE_NAME) {
          console.log('Service Worker: Removing old cache:', key);
          return caches.delete(key);
        }
      }));
    }).then(() => self.clients.claim()) // Take control of all open clients
  );
});

// Fetch event: Serve cached content when available, handle tile caching
self.addEventListener('fetch', evt => {
  const requestUrl = new URL(evt.request.url);

  // 1. Handle core assets (Cache First)
  // Check if the request URL (pathname or full URL for CDN assets) is in our ASSETS list
  const isCoreAsset = ASSETS.some(assetPath => {
    if (assetPath.startsWith('http')) { // Full URL for CDN assets
      return requestUrl.href === assetPath;
    }
    // For local assets, compare pathnames. '.' corresponds to '/index.html' or '/'
    const requestPathname = requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname;
    const assetPathname = assetPath === '.' ? '/index.html' : (assetPath.startsWith('/') ? assetPath : '/' + assetPath);
    return requestPathname === assetPathname;
  });

  if (isCoreAsset) {
    evt.respondWith(
      caches.match(evt.request).then(cachedResponse => {
        if (cachedResponse) {
          // console.log('SW: Serving from cache (core asset):', requestUrl.pathname);
          return cachedResponse;
        }
        // console.log('SW: Fetching (core asset not in cache, should have been):', requestUrl.pathname);
        return fetch(evt.request); // Should ideally be in cache from install
      })
    );
    return;
  }

  // 2. Handle map tiles (Cache First, then Network with Cache Update)
  // Specifically for CartoDB and OpenStreetMap tiles
  if (requestUrl.hostname.includes('global.ssl.fastly.net') || // CartoDB
      requestUrl.hostname.includes('tile.openstreetmap.org')) { // OpenStreetMap
    evt.respondWith(
      caches.open(CACHE_NAME).then(cache => {
        return cache.match(evt.request).then(cachedResponse => {
          const fetchPromise = fetch(evt.request).then(networkResponse => {
            if (networkResponse.ok) {
              // console.log('SW: Caching new tile:', requestUrl.href);
              cache.put(evt.request, networkResponse.clone());
            }
            return networkResponse;
          }).catch(err => {
            // console.error('SW: Tile fetch error:', requestUrl.href, err);
            // If fetch fails (e.g. offline), and not in cache, this will effectively result in an error for the tile
            // If it was in cache, cachedResponse would have been returned earlier.
          });

          // Return cached response if available, otherwise wait for fetch
          return cachedResponse || fetchPromise;
        });
      })
    );
    return;
  }

  // 3. Handle Overpass API requests (Network Only - Do Not Cache POST)
  if (requestUrl.hostname.includes('overpass-api.de')) {
    // console.log('SW: Forwarding Overpass API request (Network Only):', requestUrl.href);
    evt.respondWith(fetch(evt.request));
    return;
  }

  // 4. Default strategy for other requests (Network First, then Cache Fallback)
  // console.log('SW: Attempting Network then Cache for:', requestUrl.href);
  evt.respondWith(
    fetch(evt.request)
      .then(networkResponse => {
        // Optional: Cache successful GET requests if desired for other resources
        // if (networkResponse.ok && evt.request.method === 'GET') {
        //   caches.open(CACHE_NAME).then(cache => {
        //     cache.put(evt.request, networkResponse.clone());
        //   });
        // }
        return networkResponse;
      })
      .catch(() => {
        // console.log('SW: Network failed, trying cache for:', requestUrl.href);
        return caches.match(evt.request).then(cachedResponse => {
          if (cachedResponse) {
            return cachedResponse;
          }
          // console.warn('SW: Not found in cache either:', requestUrl.href);
          // For GET requests, you could return a custom offline page here if desired
          // For other types (POST, etc.), failing is usually appropriate
          if (evt.request.method === 'GET' && evt.request.headers.get('accept').includes('text/html')) {
            // return caches.match('/offline.html'); // If you have an offline.html page
          }
          return new Response(null, { status: 404, statusText: "Not Found (Offline or Resource Missing)" });
        });
      })
  );
});
