// The home page: every button, built in (sounds.js) and made on this device (saved.js), then the
// recent recordings from any button, each of which can become a button of its own
navigator.serviceWorker?.register("sw.js")

const sounds = document.querySelector(".sounds")
const recent = document.querySelector(".recent")
const making = document.querySelector(".making")
const form = making.querySelector("form")
const preview = making.querySelector(".preview")

function showButton(href, name, hue) {
	const link = document.createElement("a")
	link.className = "sound"
	link.href = href
	link.style.setProperty("--hue", hue)
	link.textContent = name
	sounds.append(link)
}
for (const { folder, name, hue } of SOUNDS) showButton(`${folder}/`, name, hue)
// Made on this device, so served by the service worker rather than the site (see sw.js)
for (const { id, name, hue } of await savedButtons()) showButton(`custom/${id}/`, name, hue)

const recordings = await recentRecordings()
recent.hidden = recordings.length === 0
for (const recording of recordings) {
	const row = document.querySelector("template.recording").content.firstElementChild.cloneNode(true)
	const sound = URL.createObjectURL(recording.sound)
	const when = new Date(recording.at)
	row.querySelector(".when").textContent = `${recording.recordedOn} · ${when.toLocaleString([], { dateStyle: "short", timeStyle: "short" })}`
	row.querySelector(".play").addEventListener("click", () => new Audio(sound).play())
	row.querySelector(".make").addEventListener("click", () => startMaking(recording))
	const save = row.querySelector(".save")
	save.href = sound
	// The Swedish style of date is the sortable one: 2026-10-24 11:52:03
	save.download = `${recording.recordedOn} ${when.toLocaleString("sv-SE").replaceAll(":", ".")}.wav`
	recent.querySelector(".recordings").append(row)
}

let makingFrom = null

function startMaking(recording) {
	makingFrom = recording
	form.reset()
	form.elements.hue.value = Math.floor(Math.random() * 360)
	showPreview()
	making.returnValue = ""
	making.showModal()
}

function showPreview() {
	preview.style.setProperty("--hue", form.elements.hue.value)
	// A no-break space holds the label's height while there's no name yet
	preview.textContent = form.elements.name.value.toUpperCase() || " "
}
form.addEventListener("input", showPreview)

making.addEventListener("close", async () => {
	if (making.returnValue !== "make") return
	const id = await makeButton(makingFrom, form.elements.name.value, Number(form.elements.hue.value))
	// Straight to the new button, ready to install
	await navigator.serviceWorker.ready
	location.href = `custom/${id}/`
})
