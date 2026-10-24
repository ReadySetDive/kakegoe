// The home page: every button, built in (sounds.js) and promoted on this device (saved.js), then
// the recent sounds, recorded on any button or added from a file or the web, to play, save,
// promote to a button of their own, or bin
navigator.serviceWorker?.register("sw.js")

const sounds = document.querySelector(".sounds")
const recent = document.querySelector(".recent")
const recordingsList = recent.querySelector(".recordings")
const naming = document.querySelector(".naming")
const namingForm = naming.querySelector("form")
const preview = naming.querySelector(".preview")
const fetching = document.querySelector(".fetching")
const fetchingForm = fetching.querySelector("form")
const problem = fetching.querySelector(".problem")
const fileInput = document.querySelector(".adding input[type=file]")
const radial = document.querySelector(".radial")
// Pressing and holding a button, or dragging off it, opens a radial selector of things to do with it
const LONG_PRESS = 500 // ms
const DRAG_TO_OPEN = 20 // px from the press
const DRAG_TO_CHOOSE = 40 // px from the press, toward an option
const AIM = 60 // degrees either side of an option that still choose it

// Drawn afresh whenever a sound or button comes, goes or changes
async function show() {
	sounds.replaceChildren()
	for (const { folder, name, hue } of SOUNDS) {
		offerRadial(showButton(`${folder}/`, name, hue), [installing(`${folder}/`)])
	}
	// Served by the service worker rather than the site (see sw.js)
	for (const button of await savedButtons()) {
		const href = `custom/${button.id}/`
		offerRadial(showButton(href, button.name, button.hue), [installing(href), renaming(button), demoting(button)])
	}
	const recordings = await recentRecordings()
	recent.hidden = recordings.length === 0
	recordingsList.replaceChildren(...recordings.map(recordingRow))
}

// Coming back from a button, the browser shows this page as it was left; a sound recorded there since belongs in it
addEventListener("pageshow", (event) => event.persisted && show())

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
	const when = new Date(recording.at).toLocaleString([], { dateStyle: "short", timeStyle: "short" })
	row.querySelector(".when").textContent = recording.name ? `${recording.name} · ${when}` : when
	row.querySelector(".play").addEventListener("click", () => new Audio(URL.createObjectURL(recording.sound)).play())
	row.querySelector(".promote").addEventListener("click", () => {
		startNaming("PROMOTE", recording.name ?? "", Math.floor(Math.random() * 360), (name, hue) => promote(recording, name, hue))
	})
	row.querySelector(".save").addEventListener("click", async () => {
		const download = document.createElement("a")
		download.href = URL.createObjectURL(await mp3(recording.sound))
		// The Swedish style of date is the sortable one: 2026-10-24 11:52:03
		download.download = `${recording.name ?? "RECORDING"} ${new Date(recording.at).toLocaleString("sv-SE").replaceAll(":", ".")}.mp3`
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

// A sound from a file or the web joins the recent sounds, named after where it came from. It's
// copied in, as a recording is, so it plays the same way and needs neither the file nor the web again
async function addSound(sound, source) {
	const decoded = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(await sound.arrayBuffer())
	const mono = new Float32Array(decoded.length)
	for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
		decoded.getChannelData(channel).forEach((sample, index) => mono[index] += sample / decoded.numberOfChannels)
	}
	const name = decodeURIComponent(source.split("/").at(-1)).replace(/\.[^.]*$/, "").toUpperCase()
	await saveRecording(mono, decoded.sampleRate, name)
	show()
}

document.querySelector(".from-file").addEventListener("click", () => fileInput.click())
fileInput.addEventListener("change", async () => {
	for (const file of fileInput.files) await addSound(file, file.name)
	fileInput.value = ""
})

document.querySelector(".from-web").addEventListener("click", () => {
	fetchingForm.reset()
	problem.hidden = true
	fetching.showModal()
})
fetchingForm.addEventListener("submit", async (event) => {
	event.preventDefault()
	const url = fetchingForm.elements.url.value
	problem.hidden = true
	// Sites must allow other sites to use their files; many sound sites don't
	const response = await fetch(url).catch(() => null)
	if (!response?.ok) return explain(response ? "Nothing to be found at that address." : "That site won't let other sites use its sounds. Download it, then add it from a file.")
	await addSound(await response.blob(), new URL(url).pathname)
		.then(() => fetching.close())
		.catch(() => explain("That isn't a sound this browser can play."))
})

function explain(trouble) {
	problem.textContent = trouble
	problem.hidden = false
}

// Options sit around the button at an angle: 0 degrees is to its right, -90 straight up
function installing(href) {
	return { label: "INSTALL", angle: -90, act: () => location.href = `${href}?install` }
}

function renaming(button) {
	return {
		label: "RENAME",
		angle: 180,
		act: () => startNaming("RENAME", button.name, button.hue, (name, hue) => rename(button, name, hue)),
	}
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

// Dialogs close on a press outside them, on the dimmed page, or on CANCEL
for (const dialog of [naming, fetching]) {
	dialog.addEventListener("pointerdown", (event) => {
		const box = dialog.getBoundingClientRect()
		const outside = event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom
		if (event.target === dialog && outside) dialog.close()
	})
	dialog.querySelector(".cancel").addEventListener("click", () => dialog.close())
}

let named = null // what to do with the name and color, once confirmed

function startNaming(confirming, name, hue, then) {
	namingForm.reset()
	namingForm.elements.name.value = name
	namingForm.elements.hue.value = hue
	naming.querySelector(".confirm").textContent = confirming
	named = then
	showPreview()
	naming.returnValue = ""
	naming.showModal()
}

function showPreview() {
	preview.style.setProperty("--hue", namingForm.elements.hue.value)
	// A no-break space holds the label's height while there's no name yet
	preview.textContent = namingForm.elements.name.value.toUpperCase() || " "
}
namingForm.addEventListener("input", showPreview)

naming.addEventListener("close", async () => {
	if (naming.returnValue !== "confirm") return
	await named(namingForm.elements.name.value, Number(namingForm.elements.hue.value))
	show()
})

show()
