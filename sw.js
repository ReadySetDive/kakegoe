// Keeps the app working with no signal, while always showing the latest version when online:
// every request goes to the network first (revalidating past the browser's HTTP cache), and the
// cached copy is only the fallback. Updates to the site therefore need no version bumps here.
const CACHE = "kakegoe"
const FILES = [
	"./",
	"index.html",
	"yo.mp3",
	"voices.js",
	"sounds/fight.mp3",
	"sounds/round-1.mp3",
	"sounds/final-round.mp3",
	"sounds/prepare-yourself.mp3",
	"sounds/combo-breaker.mp3",
	"sounds/flawless-victory.mp3",
	"sounds/you-win.mp3",
	"sounds/you-lose.mp3",
	"sounds/game-over.mp3",
	"sounds/punch.mp3",
	"sounds/bell.mp3",
	"manifest.webmanifest",
	"icon-192.png",
	"icon-512.png",
	"apple-touch-icon.png",
]

self.addEventListener("install", (event) => {
	event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES.map((file) => new Request(file, { cache: "reload" })))))
	self.skipWaiting()
})

self.addEventListener("activate", (event) => {
	event.waitUntil((async () => {
		// Earlier versions served stale copies forever from caches with other names; when replacing
		// one, reload its open windows so they pick up the current site straight away
		const stale = (await caches.keys()).filter((name) => name !== CACHE)
		await Promise.all(stale.map((name) => caches.delete(name)))
		await self.clients.claim()
		if (stale.length) {
			for (const client of await self.clients.matchAll({ type: "window" })) client.navigate(client.url)
		}
	})())
})

self.addEventListener("fetch", (event) => {
	event.respondWith((async () => {
		try {
			const fresh = await fetch(event.request, { cache: "no-cache" })
			if (fresh.ok) (await caches.open(CACHE)).put(event.request, fresh.clone())
			return fresh
		} catch {
			return (await caches.match(event.request, { ignoreSearch: true })) || Response.error()
		}
	})())
})
