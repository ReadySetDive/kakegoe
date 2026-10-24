// Fetches a web page or sound for the soundboard, which can't itself read other sites that don't
// allow it. Used as ?url=<address>. It answers browsers on the soundboard's own pages only; anyone
// can forge that from outside a browser, so it also limits what it will fetch: plain pages,
// scripts and sounds, from the public web, a few megabytes at most. On Cloudflare's free plan,
// a flood of requests stops it for the rest of the day rather than costing anything
const SOUNDBOARD = /^https:\/\/readysetdive\.github\.io$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/
const LARGEST = 8 * 1024 * 1024 // bytes
const FETCHABLE = /^(text\/html|application\/xhtml\+xml|text\/javascript|application\/javascript|audio\/|application\/octet-stream)/
// Addresses on private networks, which a public relay has no business reaching
const PRIVATE = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[)|\.(local|internal)$/

export default {
	async fetch(request) {
		const origin = request.headers.get("origin") ?? ""
		if (!SOUNDBOARD.test(origin)) return new Response("Only for the soundboard", { status: 403 })
		const answer = (body, init = {}) => new Response(body, {
			...init,
			headers: {
				...init.headers,
				"access-control-allow-origin": origin,
				"access-control-expose-headers": "x-final-url",
				"vary": "origin",
			},
		})
		if (request.method !== "GET") return answer("Only GET", { status: 405 })
		const target = URL.parse(new URL(request.url).searchParams.get("url") ?? "")
		if (!target || !["http:", "https:"].includes(target.protocol) || PRIVATE.test(target.hostname)) {
			return answer("Not a public web address", { status: 400 })
		}
		const fetched = await fetch(target, { headers: { "user-agent": "SoundboardRelay/1.0 (+https://readysetdive.github.io/soundboard/)" } })
		const type = fetched.headers.get("content-type") ?? ""
		if (!FETCHABLE.test(type)) return answer(`Won't relay ${type || "that"}`, { status: 415 })
		if (Number(fetched.headers.get("content-length")) > LARGEST) return answer("Too large", { status: 413 })
		const body = await fetched.arrayBuffer()
		if (body.byteLength > LARGEST) return answer("Too large", { status: 413 })
		// Where it ended up, after any redirects, so the page's own links can be resolved against it
		return answer(body, { status: fetched.status, headers: { "content-type": type, "x-final-url": fetched.url } })
	},
}
