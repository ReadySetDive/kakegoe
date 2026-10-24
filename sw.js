// Keeps the whole app on the device, so it opens instantly and works with no signal.
// Bump VERSION whenever a file changes, or installed copies keep the old one.
const VERSION = "kakegoe-3"
const FILES = [
	"./",
	"index.html",
	"yo.mp3",
	"manifest.webmanifest",
	"icon-192.png",
	"icon-512.png",
	"apple-touch-icon.png",
]

self.addEventListener("install", (event) => {
	event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(FILES)))
	self.skipWaiting()
})

self.addEventListener("activate", (event) => {
	event.waitUntil(caches.keys().then((names) => Promise.all(names.filter((name) => name !== VERSION).map((name) => caches.delete(name)))))
	self.clients.claim()
})

self.addEventListener("fetch", (event) => {
	event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)))
})
