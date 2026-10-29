// Keeps the app working with no signal, while always showing the latest version when online:
// every request goes to the network first (revalidating past the browser's HTTP cache), and the
// cached copy is only the fallback. Updates to the site therefore need no version bumps here.
const CACHE = "soundboard"
importScripts("sounds.js", "saved.js", "icons.js")
const FILES = [
	"./",
	"index.html",
	"manifest.webmanifest",
	"icon-192.png",
	"icon-512.png",
	"maskable-512.png",
	"apple-touch-icon.png",
	"home.js",
	"updates.js",
	"transcribe.js",
	"sounds.js",
	"saved.js",
	"icons.js",
	"button.js",
	"button.css",
	"voices.js",
	"fonts/OpenDyslexic-Bold.woff",
	"vendor/lame.min.js",
	...SOUNDS.flatMap(({ folder }) => [
		`${folder}/`,
		`${folder}/index.html`,
		`${folder}/sound.mp3`,
		`${folder}/manifest.webmanifest`,
		`${folder}/icon-192.png`,
		`${folder}/icon-512.png`,
		`${folder}/maskable-512.png`,
		`${folder}/apple-touch-icon.png`,
	]),
]

self.addEventListener("install", (event) => {
	// Installs even if the offline copies can't all be made: the buttons made on this device need
	// this worker whether or not there's signal
	event.waitUntil(caches.open(CACHE)
		.then((cache) => cache.addAll(FILES.map((file) => new Request(file, { cache: "reload" }))))
		.catch((error) => console.warn("No offline copies:", error)))
	self.skipWaiting()
})

self.addEventListener("activate", (event) => {
	event.waitUntil((async () => {
		// Earlier versions served stale copies forever from caches with other names; when replacing
		// one, reload its open windows so they pick up the current site straight away. The speech
		// model's cache (see transcribe.js) is kept: it's large, and changes with no version here
		const stale = (await caches.keys()).filter((name) => name !== CACHE && name !== "transformers-cache")
		await Promise.all(stale.map((name) => caches.delete(name)))
		await self.clients.claim()
		if (stale.length) {
			for (const client of await self.clients.matchAll({ type: "window" })) client.navigate(client.url)
		}
	})())
})

self.addEventListener("fetch", (event) => {
	const url = new URL(event.request.url)
	// Sounds fetched from other sites, to be added to the soundboard, are copied in by the page
	if (url.origin !== location.origin) return
	if (event.request.method === "POST" && url.searchParams.has("share")) return event.respondWith(shared(event.request))
	const custom = url.pathname.match(/\/custom\/(\w+)\/([\w.-]*)$/)
	if (custom) return event.respondWith(customFile(...custom.slice(1)))
	event.respondWith((async () => {
		try {
			const fresh = await fetch(event.request, { cache: "no-cache" })
			// Only what's fetched whole is kept: checks for a newer version (see updates.js) ask just for dates
			if (fresh.ok && event.request.method === "GET") (await caches.open(CACHE)).put(event.request, fresh.clone())
			return fresh
		} catch {
			return (await caches.match(event.request, { ignoreSearch: true })) || Response.error()
		}
	})())
})

// Shared to the soundboard from another app (the manifest's share_target), as the installed app
// on Android. A sound is kept for the home page to add, like one from a file; a link, often
// shared within text, is handed over to look for sounds at, like one typed in
async function shared(request) {
	const form = await request.formData()
	const sound = form.get("sound")
	if (sound) {
		await (await caches.open(CACHE)).put("shared", new Response(sound))
		return Response.redirect(`index.html?sound=${encodeURIComponent(sound.name)}`, 303)
	}
	const address = `${form.get("url")} ${form.get("text")}`.match(/https?:\/\/\S+/)?.[0]
	return Response.redirect(address ? `index.html?address=${encodeURIComponent(address)}` : "index.html", 303)
}

// A button made on this device has no folder on the site: its files are made here, from storage,
// the same files a built-in sound's folder holds, so it installs as an app of its own
async function customFile(id, file) {
	const button = await savedButton(id)
	if (!button) return new Response("No such button on this device", { status: 404 })
	const name = button.name.replace(/[&<>"]/g, (character) => `&#${character.charCodeAt(0)};`)
	switch (file) {
		case "":
		case "index.html":
			return new Response(`<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">
	<title>${name}</title>
	<meta name="theme-color" content="#141010">
	<meta name="mobile-web-app-capable" content="yes">
	<meta name="apple-mobile-web-app-capable" content="yes">
	<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
	<meta name="apple-mobile-web-app-title" content="${name}">
	<link rel="manifest" href="manifest.webmanifest">
	<link rel="icon" href="icon.png">
	<link rel="apple-touch-icon" href="maskable.png">
	<link rel="stylesheet" href="../../button.css">
	<script src="../../sounds.js"></script>
	<script src="../../saved.js"></script>
	<script type="module" src="../../button.js"></script>
</head>
<body></body>
</html>`, { headers: { "content-type": "text/html" } })
		case "manifest.webmanifest":
			return Response.json({
				name: button.name,
				short_name: button.name,
				start_url: "./",
				scope: "./",
				display: "standalone",
				launch_handler: { client_mode: "focus-existing" },
				orientation: "portrait",
				background_color: "#141010",
				theme_color: "#141010",
				icons: [
					{ src: "icon.png", sizes: "512x512", type: "image/png", purpose: "any" },
					{ src: "maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
				],
			}, { headers: { "content-type": "application/manifest+json" } })
		// The recording, as a WAV; named like the built-in sounds' files so the button finds it the same way
		case "sound.mp3":
			return new Response(await soundOf(button))
		case "icon.png":
			return new Response(await buttonIcon(button.hue, "floating"))
		case "maskable.png":
			return new Response(await buttonIcon(button.hue, "filling"))
		default:
			return new Response("Not found", { status: 404 })
	}
}
