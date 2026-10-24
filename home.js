// The home page: every button, built in (sounds.js) and promoted on this device (saved.js), then
// the recent recordings from any button, to play, save, promote to a button of their own, or bin
navigator.serviceWorker?.register("sw.js")

const sounds = document.querySelector(".sounds")
const recent = document.querySelector(".recent")
const recordingsList = recent.querySelector(".recordings")
const promoting = document.querySelector(".promoting")
const form = promoting.querySelector("form")
const preview = promoting.querySelector(".preview")
const menu = document.querySelector(".menu")
const LONG_PRESS = 500 // ms

// Drawn afresh whenever a recording or button moves between the two
async function show() {
	sounds.replaceChildren()
	for (const { folder, name, hue } of SOUNDS) showButton(`${folder}/`, name, hue)
	// Served by the service worker rather than the site (see sw.js)
	for (const button of await savedButtons()) offerMenu(showButton(`custom/${button.id}/`, button.name, button.hue), button)
	const recordings = await recentRecordings()
	recent.hidden = recordings.length === 0
	recordingsList.replaceChildren(...recordings.map(recordingRow))
}

function showButton(href, name, hue) {
	const link = document.createElement("a")
	link.className = "sound"
	link.href = href
	link.style.setProperty("--hue", hue)
	link.textContent = name
	sounds.append(link)
	return link
}

function recordingRow(recording) {
	const row = document.querySelector("template.recording").content.firstElementChild.cloneNode(true)
	const sound = URL.createObjectURL(recording.sound)
	const when = new Date(recording.at)
	row.querySelector(".when").textContent = `${recording.recordedOn} · ${when.toLocaleString([], { dateStyle: "short", timeStyle: "short" })}`
	row.querySelector(".play").addEventListener("click", () => new Audio(sound).play())
	row.querySelector(".promote").addEventListener("click", () => startPromoting(recording))
	const save = row.querySelector(".save")
	save.href = sound
	// The Swedish style of date is the sortable one: 2026-10-24 11:52:03
	save.download = `${recording.recordedOn} ${when.toLocaleString("sv-SE").replaceAll(":", ".")}.wav`
	row.querySelector(".bin").addEventListener("click", async () => {
		await deleteRecording(recording.id)
		show()
	})
	return row
}

// Only promoted buttons have a menu, opened by pressing and holding one (or right-clicking it)
function offerMenu(link, button) {
	let holding
	let heldLong = false
	link.addEventListener("pointerdown", () => {
		heldLong = false
		holding = setTimeout(() => {
			heldLong = true
			openMenu(link, button)
		}, LONG_PRESS)
	})
	for (const end of ["pointerup", "pointerleave", "pointercancel"]) link.addEventListener(end, () => clearTimeout(holding))
	// A long press opens the menu, not the button
	link.addEventListener("click", (event) => heldLong && event.preventDefault())
	// Phones' own long-press menus give way to this one
	link.addEventListener("contextmenu", (event) => {
		event.preventDefault()
		openMenu(link, button)
	})
}

let menuFor = null

// Android fires its long press as a contextmenu too, so this can be asked twice for one press
function openMenu(link, button) {
	if (menu.matches(":popover-open")) return
	menuFor = button
	const box = link.getBoundingClientRect()
	menu.style.left = `${box.left + box.width / 2}px`
	menu.style.top = `${box.bottom + 12}px`
	menu.showPopover()
}

// Closed by hand rather than by the browser, which would close it as the long press that opened
// it is let go: a press anywhere else closes it, as does Escape
addEventListener("pointerdown", (event) => menu.contains(event.target) || menu.hidePopover())
addEventListener("keydown", (event) => event.key === "Escape" && menu.hidePopover())

menu.querySelector(".demote").addEventListener("click", async () => {
	menu.hidePopover()
	await demote(menuFor)
	show()
})

let promotingFrom = null

function startPromoting(recording) {
	promotingFrom = recording
	form.reset()
	form.elements.hue.value = Math.floor(Math.random() * 360)
	showPreview()
	promoting.returnValue = ""
	promoting.showModal()
}

function showPreview() {
	preview.style.setProperty("--hue", form.elements.hue.value)
	// A no-break space holds the label's height while there's no name yet
	preview.textContent = form.elements.name.value.toUpperCase() || " "
}
form.addEventListener("input", showPreview)

promoting.addEventListener("close", async () => {
	if (promoting.returnValue !== "promote") return
	await promote(promotingFrom, form.elements.name.value, Number(form.elements.hue.value))
	show()
})

show()
