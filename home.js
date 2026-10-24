// The home page: every button, built in (sounds.js) and made on this device (saved.js), then the
// recent recordings, to play, save, promote to a button of their own, or bin; and pinned to the
// bottom, the ways to make sounds: adding one from a file or the web, or recording one
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
const fileInput = document.querySelector(".bar input[type=file]")
const wheel = document.querySelector(".wheel")
// Pressing and holding a button, or dragging off it, opens a wheel of things to do with it
const LONG_PRESS = 250 // ms
const RING_WIDTH = 64 // px
const SLICE_GAP = 2 // degrees
// Pulled from the button's middle less than this share of its radius, nothing is chosen
const PULL_TO_CHOOSE = 0.8

// Drawn afresh whenever a sound or button comes, goes or changes
async function show() {
	sounds.replaceChildren()
	for (const { folder, name, hue } of SOUNDS) {
		offerWheel(showButton(`${folder}/`, name, hue), [installing(`${folder}/`)])
	}
	// Served by the service worker rather than the site (see sw.js)
	for (const button of await savedButtons()) {
		const href = `custom/${button.id}/`
		offerWheel(showButton(href, button.name, button.hue), [installing(href), renaming(button), demoting(button)])
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
	const when = new Date(recording.at).toLocaleString([], { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" })
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

// A sound from a file or the web becomes a button straight away, once named and colored. It's
// checked by playing it through, then copied in, mono and at most LONGEST_SOUND long, as a WAV
// like a recording's: the button needs neither the file nor the web again
async function addFrom(sound, source) {
	const decoded = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(await sound.arrayBuffer())
	const length = Math.min(decoded.length, LONGEST_SOUND * decoded.sampleRate)
	const mono = new Float32Array(length)
	for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
		decoded.getChannelData(channel).subarray(0, length).forEach((sample, index) => mono[index] += sample / decoded.numberOfChannels)
	}
	const copy = wav(mono, decoded.sampleRate)
	startNaming("ADD", nameOf(source), Math.floor(Math.random() * 360), (name, hue) => addButton(copy, name, hue))
}

// A file's name, from its path, without its extension
function nameOf(path) {
	return decodeURIComponent(path.split("/").at(-1)).replace(/\.[^.]*$/, "")
}

document.querySelector(".from-file").addEventListener("click", () => fileInput.click())
fileInput.addEventListener("change", async () => {
	const [file] = fileInput.files
	fileInput.value = ""
	await addFrom(file, file.name).catch(() => alert("That file isn't a sound this browser can play."))
})

// Sites that let other sites read them are fetched directly; the rest through the relay
// (relay/worker.js), which fetches pages and sounds on the soundboard's behalf. at: the address
// the response came from in the end, after any redirects
const RELAY = "https://soundboard-relay.matt-grdy.workers.dev/"
async function fetchFromWeb(url) {
	const direct = await fetch(url).catch(() => null)
	if (direct?.ok) return { response: direct, at: direct.url }
	const relayed = await fetch(`${RELAY}?url=${encodeURIComponent(url)}`)
	return { response: relayed, at: relayed.headers.get("x-final-url") ?? url }
}

const found = fetching.querySelector(".found")
const LONGEST_FOUND = 60 // sounds listed from one page

document.querySelector(".from-web").addEventListener("click", () => {
	fetchingForm.reset()
	problem.hidden = true
	found.replaceChildren()
	fetching.showModal()
})
// The sounds found on a page play while it's open, never after
fetching.addEventListener("close", () => {
	for (const player of found.querySelectorAll("audio")) player.pause()
})

// An address is a sound to add, or a web page to look for sounds on
fetchingForm.addEventListener("submit", async (event) => {
	event.preventDefault()
	const url = fetchingForm.elements.url.value
	problem.hidden = true
	found.replaceChildren()
	const { response, at } = await fetchFromWeb(url).catch(() => ({}))
	if (!response) return explain("Couldn't reach that address.")
	if (!response.ok) return explain(response.status === 415 ? "That address is neither a web page nor a sound." : "Nothing to be found at that address.")
	if (/^(text\/html|application\/xhtml)/.test(response.headers.get("content-type"))) return listSounds(await response.text(), at)
	await addFromWeb(await response.blob(), at)
})

async function addFromWeb(sound, at) {
	fetching.close()
	await addFrom(sound, new URL(at).pathname).catch(() => {
		fetching.showModal()
		explain("That isn't a sound this browser can play.")
	})
}

// Every sound the page mentions, anywhere in it: links, players, and the scripts and data that
// pages built in the browser carry. Failing that, the page's own script files are searched too
async function listSounds(page, at) {
	let sounds = soundsIn(page, at)
	if (!sounds.length) {
		const scripts = [...new DOMParser().parseFromString(page, "text/html").querySelectorAll("script[src]")]
		for (const script of scripts) {
			const { response } = await fetchFromWeb(new URL(script.getAttribute("src"), at).href).catch(() => ({}))
			if (response?.ok) sounds = [...new Set([...sounds, ...soundsIn(await response.text(), at)])]
		}
	}
	if (!sounds.length) return explain("No sounds found on that page.")
	found.replaceChildren(...sounds.slice(0, LONGEST_FOUND).map(foundRow))
}

function soundsIn(text, at) {
	// Scripts write their slashes \/ and pages their ampersands &amp;
	const plain = text.replaceAll("\\/", "/").replaceAll("&amp;", "&")
	const mentions = plain.match(/[^\s"'`()<>\\,;]+\.(?:mp3|wav|ogg|oga|m4a|aac|flac|opus)(?:\?[^\s"'`()<>\\,;]*)?/gi) ?? []
	const addresses = mentions.map((mention) => URL.parse(mention, at)?.href).filter(Boolean)
	return [...new Set(addresses)]
}

// A sound found on a page: played straight from the page's site, which needs no permission, and
// only fetched, through the relay if need be, when added. Longer than LONGEST_SOUND, it can be
// played but not added
function foundRow(address) {
	const row = document.querySelector("template.found-sound").content.firstElementChild.cloneNode(true)
	const player = row.querySelector("audio")
	const add = row.querySelector(".add")
	player.src = address
	row.querySelector(".name").textContent = nameOf(new URL(address).pathname)
	player.addEventListener("loadedmetadata", () => {
		row.querySelector(".length").textContent = `${Math.floor(player.duration / 60)}:${String(Math.round(player.duration % 60)).padStart(2, "0")}`
		add.classList.toggle("too-long", player.duration > LONGEST_SOUND)
	})
	row.querySelector(".play").addEventListener("click", () => {
		const playing = !player.paused
		for (const other of found.querySelectorAll("audio")) other.pause()
		if (!playing) {
			player.currentTime = 0
			player.play()
		}
	})
	add.addEventListener("click", async () => {
		if (add.classList.contains("too-long")) return explain(`That one's too long: sounds can be ${LONGEST_SOUND} seconds at most.`)
		problem.hidden = true
		const { response, at } = await fetchFromWeb(address).catch(() => ({}))
		if (!response?.ok) return explain("Couldn't fetch that sound.")
		await addFromWeb(await response.blob(), at)
	})
	return row
}

function explain(trouble) {
	problem.textContent = trouble
	problem.hidden = false
}

// Press and hold the red dot to record, up to LONGEST_SOUND. The microphone is taped block by
// block (the "tape" processor in voices.js); a silent gain keeps the tape in the audio graph so
// it runs. The recording joins the recent sounds
const recorder = document.querySelector(".record")
let audio = null
let taperLoaded = null
let holdingRecorder = false
let taping = null

recorder.addEventListener("pointerdown", async (event) => {
	event.preventDefault()
	recorder.setPointerCapture(event.pointerId)
	holdingRecorder = true
	// Made on a press, since browsers only allow sound, and so microphones, after one
	audio ??= new AudioContext()
	taperLoaded ??= audio.audioWorklet.addModule("voices.js")
	await taperLoaded
	const microphone = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }).catch(() => null)
	// Asked for the microphone the first time, the press may be over before it's allowed
	if (!holdingRecorder) for (const track of microphone?.getTracks() ?? []) track.stop()
	if (!microphone || !holdingRecorder) return
	const tape = new AudioWorkletNode(audio, "tape")
	const source = audio.createMediaStreamSource(microphone)
	const silence = new GainNode(audio, { gain: 0 })
	const blocks = []
	tape.port.onmessage = ({ data }) => blocks.push(data)
	source.connect(tape).connect(silence).connect(audio.destination)
	taping = { microphone, tape, source, blocks, started: performance.now(), limit: setTimeout(stopTaping, LONGEST_SOUND * 1000) }
	recorder.classList.add("recording")
	requestAnimationFrame(function fill() {
		if (!taping) return
		recorder.style.setProperty("--taken", (performance.now() - taping.started) / 1000 / LONGEST_SOUND)
		requestAnimationFrame(fill)
	})
})
for (const release of ["pointerup", "pointercancel"]) {
	recorder.addEventListener(release, () => {
		holdingRecorder = false
		stopTaping()
	})
}
recorder.addEventListener("contextmenu", (event) => event.preventDefault())

async function stopTaping() {
	if (!taping) return
	const { microphone, tape, source, blocks, limit } = taping
	taping = null
	clearTimeout(limit)
	source.disconnect()
	tape.disconnect()
	for (const track of microphone.getTracks()) track.stop()
	recorder.classList.remove("recording")
	recorder.style.setProperty("--taken", 0)
	const sound = trimmed(blocks, audio.sampleRate)
	if (!sound) return
	await saveRecording(sound, audio.sampleRate)
	show()
}

// The wheel's options, each with the picture in its slice (24 px square, drawn in strokes)
function installing(href) {
	return { label: "INSTALL", picture: "M12 4v11M7 10l5 5 5-5M5 20h14", act: () => location.href = `${href}?install` }
}

function renaming(button) {
	return {
		label: "RENAME",
		picture: "M4 20h4L19 9l-4-4L4 16zM14 6l4 4",
		act: () => startNaming("RENAME", button.name, button.hue, (name, hue) => rename(button, name, hue)),
	}
}

function demoting(button) {
	return {
		label: "DEMOTE",
		picture: "M6 6l6 6 6-6M6 13l6 6 6-6",
		act: async () => {
			await demote(button)
			show()
		},
	}
}

// A press held a moment, or dragged off the button's edge, opens its wheel; the slice pulled
// toward is chosen as the press lets go. A right-click opens it too, to point at and click
function offerWheel(link, options) {
	let pressing = null // the pointer pressing this button
	let opened = false // by this press, so letting go doesn't also open the button
	let holding
	const open = (pointing) => {
		opened = true
		openWheel(link, options, pointing)
	}
	link.addEventListener("pointerdown", (event) => {
		if (event.button !== 0) return
		pressing = event.pointerId
		opened = false
		// Followed off the button, since dragging off it is how an option is chosen
		link.setPointerCapture(event.pointerId)
		holding = setTimeout(open, LONG_PRESS)
	})
	link.addEventListener("pointermove", (event) => {
		if (event.pointerId !== pressing) return
		const { x, y, radius } = circleOf(link)
		if (!opened && Math.hypot(event.clientX - x, event.clientY - y) > radius) {
			clearTimeout(holding)
			open()
		}
		if (opened) aim(event.clientX, event.clientY)
	})
	link.addEventListener("pointerup", (event) => {
		if (event.pointerId !== pressing) return
		clearTimeout(holding)
		pressing = null
		if (opened) letGo()
	})
	link.addEventListener("pointercancel", () => {
		clearTimeout(holding)
		pressing = null
		closeWheel()
	})
	link.addEventListener("click", (event) => opened && event.preventDefault())
	link.addEventListener("contextmenu", (event) => {
		event.preventDefault()
		// Android's long press is a contextmenu too, by when the wheel is already open
		if (pressing === null) open(true)
	})
}

// The small button drawn above a sound's name
function circleOf(link) {
	const box = link.getBoundingClientRect()
	const diameter = parseFloat(getComputedStyle(link, "::before").width)
	return { x: box.left + box.width / 2, y: box.top + diameter / 2, radius: diameter / 2 }
}

let turning = null // the open wheel: its options, where it is, and which slice is chosen

// pointing: opened by a right-click, so chosen by pointing and clicking rather than letting go
function openWheel(link, options, pointing = false) {
	if (turning) return
	const { x, y, radius } = circleOf(link)
	const inner = radius + 6
	const outer = inner + RING_WIDTH
	const share = 360 / options.length
	const point = (distance, degrees) => [distance * Math.cos(degrees * Math.PI / 180), distance * Math.sin(degrees * Math.PI / 180)]
	const slices = options.map((option, index) => {
		// The first slice is centred at the top, the rest following clockwise
		const middle = -90 + index * share
		const from = middle - share / 2 + SLICE_GAP / 2
		const to = middle + share / 2 - SLICE_GAP / 2
		const large = to - from > 180 ? 1 : 0
		const [pictureX, pictureY] = point((inner + outer) / 2, middle)
		return `<path class="slice" d="M ${point(outer, from)} A ${outer} ${outer} 0 ${large} 1 ${point(outer, to)} L ${point(inner, to)} A ${inner} ${inner} 0 ${large} 0 ${point(inner, from)} Z"/>
			<path class="picture" d="${option.picture}" transform="translate(${pictureX} ${pictureY}) scale(1.15) translate(-12 -12)"/>`
	})
	wheel.innerHTML = `<svg viewBox="${-outer} ${-outer} ${2 * outer} ${2 * outer}" width="${2 * outer}" height="${2 * outer}" style="left: ${x}px; top: ${y}px">
		<circle class="hole" r="${inner - 4}"/>${slices.join("")}
	</svg><span class="named" style="left: ${x}px; top: ${y}px"></span>`
	wheel.style.setProperty("--hue", link.style.getPropertyValue("--hue"))
	turning = {
		options,
		x,
		y,
		radius,
		share,
		pointing,
		name: link.textContent,
		chosen: null,
		slices: [...wheel.querySelectorAll(".slice")],
		named: wheel.querySelector(".named"),
	}
	turning.named.textContent = turning.name
	wheel.showPopover()
}

// The slice in the pointer's direction from the button's middle, once pulled out far enough
function aim(pointerX, pointerY) {
	const right = pointerX - turning.x
	const down = pointerY - turning.y
	const degrees = Math.atan2(down, right) * 180 / Math.PI
	const index = Math.floor(((((degrees + 90 + turning.share / 2) % 360) + 360) % 360) / turning.share)
	const pulled = Math.hypot(right, down) > turning.radius * PULL_TO_CHOOSE
	turning.chosen = pulled ? turning.options[index] : null
	turning.slices.forEach((slice, sliceIndex) => slice.classList.toggle("chosen", pulled && sliceIndex === index))
	turning.named.textContent = turning.chosen?.label ?? turning.name
}

function letGo() {
	const chosen = turning?.chosen
	closeWheel()
	chosen?.act()
}

function closeWheel() {
	wheel.hidePopover()
	turning = null
}

// Opened by a right-click, the wheel covers the page: pointing chooses, and a click acts on the
// choice, or closes the wheel when nothing is chosen
wheel.addEventListener("pointermove", (event) => turning?.pointing && aim(event.clientX, event.clientY))
wheel.addEventListener("pointerdown", (event) => {
	if (!turning?.pointing) return
	aim(event.clientX, event.clientY)
	letGo()
})
addEventListener("keydown", (event) => event.key === "Escape" && turning && closeWheel())

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
	// A name brought in is highlighted, to be typed straight over
	if (name) namingForm.elements.name.select()
}

function showPreview() {
	preview.style.setProperty("--hue", namingForm.elements.hue.value)
	// A no-break space holds the label's height while there's no name yet
	preview.textContent = namingForm.elements.name.value.toUpperCase() || " "
}
namingForm.addEventListener("input", showPreview)
// Enter confirms at a keyboard; on a touch screen it only closes the keyboard, so a name isn't
// confirmed by accident on the way to picking a color
namingForm.addEventListener("keydown", (event) => {
	if (event.key === "Enter" && matchMedia("(pointer: coarse)").matches) event.preventDefault()
})

naming.addEventListener("close", async () => {
	if (naming.returnValue !== "confirm") return
	await named(namingForm.elements.name.value, Number(namingForm.elements.hue.value))
	show()
})

show()
