// The site is published all at once, every file dated with when. A page left open across a
// publish notices on being left (switching away is when it checks, so coming back is never held
// up) and reloads on being come back to, rather than go on running the old version
const DATED = new URL("sounds.js", import.meta.url)

const published = () => fetch(DATED, { method: "HEAD", cache: "no-store" }).then((response) => response.headers.get("last-modified"))
const loaded = published().catch(() => null)

export const updates = { waiting: false }

async function check() {
	const now = await published().catch(() => null)
	// Offline, nothing can be told either way
	if (now && await loaded && now !== await loaded) updates.waiting = true
}
addEventListener("blur", check)
document.addEventListener("visibilitychange", () => document.hidden && check())
