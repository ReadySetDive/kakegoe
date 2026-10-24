// The home page: every button, built in (sounds.js) and promoted on this device (saved.js), then
// the recent recordings from any button, to play, save, promote to a button of their own, or bin
navigator.serviceWorker?.register("sw.js")

const sounds = document.querySelector(".sounds")
const recent = document.querySelector(".recent")
const recordingsList = recent.querySelector(".recordings")
const promoting = document.querySelector(".promoting")
const form = promoting.querySelector("form")
const preview = promoting.querySelector(".preview")
const radial = document.querySelector(".radial")
// Pressing and holding a button, or dragging off it, opens a radial selector of things to do with it
const LONG_PRESS = 500 // ms
const DRAG_TO_OPEN = 20 // px from the press
const DRAG_TO_CHOOSE = 40 // px from the press, toward an option
const AIM = 60 // degrees either side of an option that still choose it

// Drawn afresh whenever a recording or button moves between the two
async function show() {
	sounds.replaceChildren()
	for (const { folder, name, hue } of SOUNDS) {
		offerRadial(showButton(`${folder}/`, name, hue), [installing(`${folder}/`)])
	}
	// Served by the service worker rather than the site (see sw.js)
	for (const button of await savedButtons()) {
		const href = `custom/${button.id}/`
		offerRadial(showButton(href, button.name, button.hue), [installing(href), demoting(button)])
	}
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
	// Dragging off a button opens its options, rather than dragging the link somewhere
	link.draggable = false
	sounds.append(link)
	return link
}

function recordingRow(recording) {
	const row = document.querySelector("template.recording").content.firstElementChild.cloneNode(true)
	const when = new Date(recording.at)
	row.querySelector(".when").textContent = `${recording.recordedOn} · ${when.toLocaleString([], { dateStyle: "short", timeStyle: "short" })}`
	row.querySelector(".play").addEventListener("click", () => new Audio(URL.createObjectURL(recording.sound)).play())
	row.querySelector(".promote").addEventListener("click", () => startPromoting(recording))
	row.querySelector(".save").addEventListener("click", async () => {
		const download = document.createElement("a")
		download.href = URL.createObjectURL(await mp3(recording.sound))
		// The Swedish style of date is the sortable one: 2026-10-24 11:52:03
		download.download = `${recording.recordedOn} ${when.toLocaleString("sv-SE").replaceAll(":", ".")}.mp3`
		download.click()
	})
	row.querySelector(".bin").addEventListener("click", async () => {
		await deleteRecording(recording.id)
		show()
	})
	return row
}

// Recordings are kept as WAVs (see saved.js), made into MP3s by lamejs, fetched only when wanted
let encoder = null
async function mp3(wav) {
	encoder ??= new Promise((resolve, reject) => {
		const script = document.createElement("script")
		script.src = "vendor/lame.min.js"
		script.onload = resolve
		script.onerror = reject
		document.head.append(script)
	})
	await encoder
	const sampleRate = new DataView(await wav.slice(24, 28).arrayBuffer()).getUint32(0, true)
	const samples = new Int16Array(await wav.slice(44).arrayBuffer())
	const encoding = new lamejs.Mp3Encoder(1, sampleRate, 128)
	const frames = []
	// lamejs takes the samples an MP3 frame at a time
	for (let start = 0; start < samples.length; start += 1152) frames.push(encoding.encodeBuffer(samples.subarray(start, start + 1152)))
	frames.push(encoding.flush())
	return new Blob(frames, { type: "audio/mpeg" })
}

// Options sit around the button at an angle: 0 degrees is to its right, -90 straight up
function installing(href) {
	return { label: "INSTALL", angle: -90, act: () => location.href = `${href}?install` }
}

function demoting(button) {
	return {
		label: "DEMOTE",
		angle: 90,
		act: async () => {
			await demote(button)
			show()
		},
	}
}

function offerRadial(link, options) {
	let press = null // where the pointer went down, while it's held
	let opened = false // by this press, so letting go doesn't also open the button
	let holding
	const open = () => {
		opened = true
		openRadial(link, options)
	}
	link.addEventListener("pointerdown", (event) => {
		press = { x: event.clientX, y: event.clientY }
		opened = false
		// Followed off the button, since dragging off it is how an option is chosen
		link.setPointerCapture(event.pointerId)
		holding = setTimeout(open, LONG_PRESS)
	})
	link.addEventListener("pointermove", (event) => {
		if (!press) return
		const right = event.clientX - press.x
		const down = event.clientY - press.y
		if (!opened && Math.hypot(right, down) > DRAG_TO_OPEN) open()
		if (opened) aim(right, down)
	})
	link.addEventListener("pointerup", () => {
		clearTimeout(holding)
		press = null
		// Let go on an option and it's chosen; anywhere else, the options stay open to be tapped
		const chosen = selecting?.options.find((option) => option.chosen)
		if (chosen) choose(chosen)
	})
	link.addEventListener("pointercancel", () => {
		clearTimeout(holding)
		press = null
		closeRadial()
	})
	link.addEventListener("click", (event) => opened && event.preventDefault())
	// Right-clicks open it too, and phones' own long-press menus give way to it
	link.addEventListener("contextmenu", (event) => {
		event.preventDefault()
		open()
	})
}

let selecting = null // the options open, each with its element and whether it's chosen

// Android fires its long press as a contextmenu too, so this can be asked twice for one press
function openRadial(link, options) {
	if (selecting) return
	const box = link.getBoundingClientRect()
	const diameter = parseFloat(getComputedStyle(link, "::before").width)
	radial.style.left = `${box.left + box.width / 2}px`
	radial.style.top = `${box.top + diameter / 2}px`
	radial.style.setProperty("--reach", `${diameter / 2 + 44}px`)
	selecting = {
		options: options.map((option) => {
			const element = document.createElement("button")
			element.textContent = option.label
			element.style.setProperty("--angle", `${option.angle}deg`)
			element.addEventListener("click", () => choose(option))
			return { ...option, element, chosen: false }
		}),
	}
	radial.replaceChildren(...selecting.options.map((option) => option.element))
	radial.showPopover()
}

// The option in the drag's direction, once the drag has gone far enough
function aim(right, down) {
	const angle = Math.atan2(down, right) * 180 / Math.PI
	const apart = (option) => Math.abs((((angle - option.angle) % 360) + 540) % 360 - 180)
	const far = Math.hypot(right, down) > DRAG_TO_CHOOSE
	const nearest = selecting.options.reduce((best, option) => apart(option) < apart(best) ? option : best)
	for (const option of selecting.options) {
		option.chosen = far && option === nearest && apart(option) < AIM
		option.element.classList.toggle("chosen", option.chosen)
	}
}

function choose(option) {
	closeRadial()
	option.act()
}

function closeRadial() {
	radial.hidePopover()
	selecting = null
}

// Closed by hand rather than by the browser, which would close it as the long press that opened
// it is let go: a press anywhere else closes it, as does Escape
addEventListener("pointerdown", (event) => radial.contains(event.target) || closeRadial())
addEventListener("keydown", (event) => event.key === "Escape" && closeRadial())

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
