// Version 2024-11-25
// Service Worker para cachear tiles del mapa
const CACHE_NAME = 'gps-marker-v1';
const MAP_CACHE = 'map-tiles-v1';

// Archivos estáticos a cachear inmediatamente
const STATIC_ASSETS = [
    '/',
    '/index.html'
];

// Instalar Service Worker
self.addEventListener('install', (event) => {
    console.log('Service Worker: Installing...');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('Service Worker: Caching static assets');
                return cache.addAll(STATIC_ASSETS);
            })
            .then(() => self.skipWaiting())
    );
});

// Activar Service Worker
self.addEventListener('activate', (event) => {
    console.log('Service Worker: Activating...');
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cache => {
                    if (cache !== CACHE_NAME && cache !== MAP_CACHE) {
                        console.log('Service Worker: Clearing old cache', cache);
                        return caches.delete(cache);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// Interceptar requests
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    
    // Cachear tiles de OpenStreetMap
    if (url.hostname.includes('tile.openstreetmap.org')) {
        event.respondWith(
            caches.open(MAP_CACHE).then(cache => {
                return cache.match(event.request).then(response => {
                    if (response) {
                        // Tile encontrado en cache
                        return response;
                    }
                    
                    // Descargar tile y guardarlo
                    return fetch(event.request).then(fetchResponse => {
                        // Solo cachear si es exitoso
                        if (fetchResponse.ok) {
                            cache.put(event.request, fetchResponse.clone());
                        }
                        return fetchResponse;
                    }).catch(() => {
                        // Si falla, devolver tile vacío o placeholder
                        return new Response('', { status: 404 });
                    });
                });
            })
        );
        return;
    }
    
    // Otros recursos: cache first, network fallback
    event.respondWith(
        caches.match(event.request).then(response => {
            return response || fetch(event.request).catch(() => {
                // Si falla y es HTML, devolver index
                if (event.request.headers.get('accept').includes('text/html')) {
                    return caches.match('/index.html');
                }
            });
        })
    );
});

// Mensaje desde la app para pre-cachear tiles
self.addEventListener('message', (event) => {
    if (event.data.type === 'CACHE_TILES') {
        const tiles = event.data.tiles;
        console.log('Service Worker: Caching', tiles.length, 'tiles');
        
        event.waitUntil(
            caches.open(MAP_CACHE).then(cache => {
                const promises = tiles.map(tileUrl => {
                    return fetch(tileUrl)
                        .then(response => {
                            if (response.ok) {
                                return cache.put(tileUrl, response);
                            }
                        })
                        .catch(err => console.error('Error caching tile:', tileUrl, err));
                });
                
                return Promise.all(promises);
            }).then(() => {
                // Notificar que terminó
                self.clients.matchAll().then(clients => {
                    clients.forEach(client => {
                        client.postMessage({
                            type: 'CACHE_COMPLETE',
                            count: tiles.length
                        });
                    });
                });
            })
        );
    }
    
    if (event.data.type === 'CLEAR_CACHE') {
        event.waitUntil(
            caches.delete(MAP_CACHE).then(() => {
                console.log('Service Worker: Map cache cleared');
                self.clients.matchAll().then(clients => {
                    clients.forEach(client => {
                        client.postMessage({ type: 'CACHE_CLEARED' });
                    });
                });
            })
        );
    }
});
