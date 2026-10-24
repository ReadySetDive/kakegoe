// The button shared by every sound. Each sound's page sits in its own folder, beside its
// sound.mp3. The page loads sounds.js, listing the built-in sounds, and saved.js, holding the
// buttons made on this device, ahead of this
const folder = location.pathname.split("/").at(-2)
const thisSound = SOUNDS.find((sound) => sound.folder === folder) ?? await savedButton(folder)

// Lets iPhones play it even with the ring/silent switch on silent
if (navigator.audioSession) navigator.audioSession.type = "playback"

document.body.style.setProperty("--hue", thisSound.hue)
document.body.insertAdjacentHTML("afterbegin", `
	<div class="socket"><button class="record" aria-label="Hold to record your own sound"><svg class="taken" viewBox="0 0 100 100"><circle cx="50" cy="50" r="48" pathLength="1"/></svg></button></div>
	<button class="call" aria-label="Play the call"><span class="dial"><span class="dot" title="Drag to change pitch"></span></span><svg class="ring" viewBox="0 0 100 100"><circle cx="50" cy="50" r="49" pathLength="1"/><circle class="head" cx="99" cy="50" r="1.6"/></svg></button>
`)
const button = document.querySelector(".call")
const record = document.querySelector(".record")
const dial = document.querySelector(".dial")
const dot = document.querySelector(".dot")
const ring = document.querySelector(".ring")

// The knob spins all the way round. From 3 o'clock, 150 degrees up is an octave up and 150
// down an octave down; the 60 degrees between, around 9 o'clock, sweep smoothly from one to the
// other, so pitch has no jump anywhere on the dial
const OCTAVE_TURN = 150
// Within this many degrees of 3 o'clock the knob is drawn softly back to normal pitch
const DETENT = 12
const WHEEL_DEGREES_PER_PIXEL = 0.1 // a wheel notch (about 100 px) turns the knob 10 degrees
// The knob is drawn by a spring chasing where it has been turned to: wheel notches settle
// briskly with a touch of overshoot, letting go after wheel turns swings it home bouncier
const SPRINGS = {
	step: { stiffness: 420, damping: 30 },
	home: { stiffness: 160, damping: 14 },
}
// Pressing within this share of the diameter, measured from the centre, also bends the call;
// dragging this share of the radius away from the press reaches the bend's limits
const BEND_ZONE = 0.78
const BEND_REACH = 0.6
// Except loudness upward, which is deliberately hard to max out: 4x is three radii up, far
// off the button, and the curve is shallow at first (one radius up is only about 1.2x)
const LOUDEST = 4
const LOUDNESS_REACH = 3
const LOUDNESS_CURVE = 2.5
const TILT_DEGREES = 8
// Number keys 1-8 play the call up a major scale, do to do, in semitones above as recorded
const SCALE = [0, 2, 4, 5, 7, 9, 11, 12]
// Key 0 cycles what the number keys play: the whole call, or just the part before or after the
// sound's split. A sound recorded here has no such parts, so then there is only the whole of it
const WHOLE = { from: 0, to: Infinity }
let parts = thisSound.split ? [
	WHOLE,
	{ from: 0, to: thisSound.split },
	{ from: thisSound.split, to: Infinity },
] : [WHOLE]
// Four anticlockwise turns of the knob unscrew the button, revealing a record button beneath
const TURNS_TO_LIFT = 4
const RECORD_LIMIT = 5 // seconds
// Phones, while the button is held, measured from how the phone was held at the press: raising
// the top edge turns the knob up, this many knob degrees per degree raised; rolling it a
// quarter turn slows the call to a standstill, and a half turn plays it backwards
const RAISE_TO_KNOB = 1.2
// Small raises count for a little less (70% at first), rising smoothly to full weight by this
// many degrees, so a steady hand doesn't wobble the pitch, yet there's no dead spot to notice
const RAISE_WELL = 15
const RAISE_WELL_FLOOR = 0.7
const SENSOR_SMOOTHING = 0.25 // of each new reading taken, so hand tremor doesn't wobble the sound

const audio = new AudioContext()
const volume = audio.createGain()
// Many overlapping calls at up to 4x volume would clip; this holds them just under full scale
const limiter = new DynamicsCompressorNode(audio, { threshold: -3, knee: 0, ratio: 20, attack: 0.002, release: 0.1 })
// Every press becomes a voice in one granular player (voices.js), so pitch and speed bend
// independently, live, on every call already sounding. Shared files sit beside this one; the
// sound sits beside the page
const voices = audio.audioWorklet.addModule(new URL("voices.js", import.meta.url)).then(async () => {
	const node = new AudioWorkletNode(audio, "voices", { outputChannelCount: [2] })
	const call = await audio.decodeAudioData(await (await fetch("sound.mp3")).arrayBuffer())
	const channels = Array.from({ length: call.numberOfChannels }, (_, channel) => call.getChannelData(channel))
	node.port.postMessage({ channels })
	drawWaveform(channels[0])
	node.port.onmessage = ({ data }) => {
		const shown = data.progress?.find((press) => press.id === ringPress)
		if (shown && !scrubbing) showThrough(shown.through)
	}
	node.connect(volume).connect(limiter).connect(audio.destination)
	return node
})

let hand = 0 // degrees the knob has been turned to (positive is anticlockwise), before the detent eases it
let raise = 0 // degrees added to the knob by raising the phone
let dragSpeed = 1
let rollSpeed = 1
let bending = null // the pointer holding the middle of the button, and where it pressed
let wheelTurned = false // the wheel turned the knob during this hold, so it springs back after
const held = new Set() // pointers currently holding the button or the knob
// Each press of the button plays its own copy of the call, which that press steers while held
const pressOf = new Map() // pointer -> the press it is holding
let presses = 0
let ringPress = null // the press whose progress the ring shows
let ringDelay
const RING_DELAY = 400 // ms a press must be held before its progress ring fades in
const RING_GRAB = 0.2 // how near the ring's leading end, in button radii, counts as grabbing it
let scrubbing = null // the pointer dragging the ring's end: its angle and how far through it is

const WAVE_BARS = 160
const WAVE_FROM = 51.5 // ring units (the ring itself is radius 49 in a 100-wide view)
const WAVE_REACH = 11 // how far the loudest moment's spike reaches beyond WAVE_FROM
const bars = []

// One spike per slice of the recording, clockwise from 12 o'clock, as long as the slice is loud
function drawWaveform(samples) {
	const slice = Math.floor(samples.length / WAVE_BARS)
	const loudness = Array.from({ length: WAVE_BARS }, (_, bar) => {
		let energy = 0
		for (let i = bar * slice; i < (bar + 1) * slice; i++) energy += samples[i] ** 2
		return Math.sqrt(energy / slice)
	})
	const loudest = Math.max(...loudness)
	const head = ring.querySelector(".head")
	loudness.forEach((level, bar) => {
		// The ring's view is turned a quarter back, so angle 0 here sits at 12 o'clock
		const angle = ((bar + 0.5) / WAVE_BARS) * 2 * Math.PI
		const reach = WAVE_FROM + 1 + (level / loudest) * WAVE_REACH
		const line = document.createElementNS("http://www.w3.org/2000/svg", "line")
		line.setAttribute("class", "bar")
		line.setAttribute("x1", 50 + Math.cos(angle) * WAVE_FROM)
		line.setAttribute("y1", 50 + Math.sin(angle) * WAVE_FROM)
		line.setAttribute("x2", 50 + Math.cos(angle) * reach)
		line.setAttribute("y2", 50 + Math.sin(angle) * reach)
		ring.insertBefore(line, head)
		bars.push(line)
	})
}

function showThrough(through) {
	through = Math.max(0, Math.min(1, through))
	ring.style.setProperty("--through", through)
	bars.forEach((bar, index) => bar.classList.toggle("played", (index + 0.5) / WAVE_BARS <= through))
}

// Clockwise from 12 o'clock, in turns
function turnsAround(event) {
	const { x, y } = centre()
	return Math.atan2(event.clientX - x, y - event.clientY) / (2 * Math.PI)
}

// note: this call's own pitch, on top of the knob's (1 is as recorded); part: which stretch of
// it; press: the held press that steers it, if any
async function play(note = 1, part = WHOLE, press) {
	// Browsers only allow sound after a touch, so wake the audio on the press itself
	if (audio.state !== "running") audio.resume()
	const node = await voices
	node.port.postMessage({ note, ...part, id: press })
}

// Speed bends from dragging and rolling the phone steer only the copies still held
async function steer() {
	const node = await voices
	node.port.postMessage({ heldSpeed: dragSpeed * rollSpeed })
}

async function glide(parameter, value, seconds = 0.02) {
	const node = await voices
	node.parameters.get(parameter).setTargetAtTime(value, audio.currentTime, seconds)
}

const knob = { shown: 0, target: 0, velocity: 0, spring: SPRINGS.step, moving: false }

// motion: "drag" follows the hand exactly; "step" and "home" spring there (see SPRINGS)
function turnKnob(degrees, motion) {
	hand = degrees
	aimKnob()
	loosen()
	if (motion === "drag") {
		knob.shown = knob.target
		knob.velocity = 0
		showKnob()
		return
	}
	knob.spring = SPRINGS[motion]
	if (!knob.moving) {
		knob.moving = true
		let then = performance.now()
		requestAnimationFrame(function step(now) {
			const seconds = Math.min((now - then) / 1000, 1 / 30)
			then = now
			const { stiffness, damping } = knob.spring
			knob.velocity += ((knob.target - knob.shown) * stiffness - knob.velocity * damping) * seconds
			knob.shown += knob.velocity * seconds
			const settled = Math.abs(knob.target - knob.shown) < 0.01 && Math.abs(knob.velocity) < 0.1
			if (settled) knob.shown = knob.target
			showKnob()
			knob.moving = !settled
			if (knob.moving) requestAnimationFrame(step)
		})
	}
}

function aimKnob() {
	// The hand's turn eases to zero near the centre, so dwelling close to normal settles there,
	// while matching the hand exactly at the detent's edge so there is never a jump. Raising
	// the phone has its own gentler well (see eased) and goes on top
	const fromNormal = around(hand)
	const settled = Math.abs(fromNormal) < DETENT ? fromNormal * (fromNormal / DETENT) ** 2 : fromNormal
	knob.target = hand - fromNormal + settled + raise
}

// An angle as the nearest equivalent between -180 and 180 degrees
function around(degrees) {
	return ((((degrees + 180) % 360) + 360) % 360) - 180
}

function octaves(degrees) {
	const angle = around(degrees)
	if (Math.abs(angle) <= OCTAVE_TURN) return angle / OCTAVE_TURN
	const across = ((angle > 0 ? angle : angle + 360) - OCTAVE_TURN) / (360 - 2 * OCTAVE_TURN)
	return Math.cos(Math.PI * across)
}

function eased(tilt) {
	const progress = Math.min(Math.abs(tilt) / RAISE_WELL, 1)
	const smooth = progress * progress * (3 - 2 * progress)
	return tilt * (RAISE_WELL_FLOOR + (1 - RAISE_WELL_FLOOR) * smooth)
}

// The pitch follows the drawn knob, so its springy settle can be heard as well as seen
function showKnob() {
	dial.style.setProperty("--turn", `${-knob.shown}deg`)
	glide("pitch", 2 ** octaves(knob.shown), 0.01)
}

// Offsets of the drag from where the middle was pressed, in px
function bend(right, down) {
	const limit = (value) => Math.max(-1, Math.min(1, value))
	const across = limit(right / bending.reach)
	const lowering = limit(down / bending.reach)
	// The button tips toward the drag, as if pressed off-centre
	button.style.setProperty("--tilt-x", `${-lowering * TILT_DEGREES}deg`)
	button.style.setProperty("--tilt-y", `${across * TILT_DEGREES}deg`)
	// Speed along a curve, so fine changes near normal are easy: 0.2x fully left, 3.5x fully right
	dragSpeed = across < 0 ? 0.2 ** -across : 3.5 ** across
	steer()
	const lift = limit(-down / (bending.radius * LOUDNESS_REACH))
	const loudness = lift > 0 ? 1 + (LOUDEST - 1) * lift ** LOUDNESS_CURVE : 1 - 0.8 * lowering // down to 0.2x
	volume.gain.setTargetAtTime(loudness, audio.currentTime, 0.02)
}

function centre() {
	const box = button.getBoundingClientRect()
	return { x: box.left + box.width / 2, y: box.top + box.height / 2, radius: box.width / 2 }
}

// Past halfway to unscrewed, the button starts to rise and swell, the only hint of what's below
function loosen() {
	const turns = hand / 360
	const loose = Math.max(0, Math.min(1, (turns - TURNS_TO_LIFT / 2) / (TURNS_TO_LIFT / 2)))
	button.style.setProperty("--rise", `${loose * 1.5}vmin`)
	button.style.setProperty("--swell", 1 + loose * 0.04)
	if (turns >= TURNS_TO_LIFT && !document.body.classList.contains("lifted")) liftOff()
}

let microphone = null
let taping = null

async function liftOff() {
	document.body.classList.add("lifted")
	// Let go of everything the button was doing, and have it come back as new
	for (const pointer of held) if (dot.hasPointerCapture(pointer)) dot.releasePointerCapture(pointer)
	held.clear()
	button.classList.remove("pressed")
	hand = 0
	aimKnob()
	knob.shown = knob.target
	knob.velocity = 0
	showKnob()
	loosen()
	// Ask for the microphone now, so the record button starts the instant it is pressed
	await voices
	microphone = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }).catch(() => null)
	if (!microphone) slotBack()
}

function slotBack() {
	document.body.classList.remove("lifted")
	button.classList.add("landing")
	setTimeout(() => button.classList.remove("landing"), 700)
}

record.addEventListener("pointerdown", (event) => {
	event.preventDefault()
	if (!microphone || taping) return
	record.setPointerCapture(event.pointerId)
	if (audio.state !== "running") audio.resume()
	// The microphone is taped block by block (the "tape" processor in voices.js); a silent
	// gain keeps the tape in the audio graph so it runs
	const tape = new AudioWorkletNode(audio, "tape")
	const source = audio.createMediaStreamSource(microphone)
	const silence = new GainNode(audio, { gain: 0 })
	const blocks = []
	tape.port.onmessage = ({ data }) => blocks.push(data)
	source.connect(tape).connect(silence).connect(audio.destination)
	taping = { tape, source, blocks, started: performance.now(), limit: setTimeout(stopTaping, RECORD_LIMIT * 1000) }
	record.classList.add("recording")
	requestAnimationFrame(function fill() {
		if (!taping) return
		record.style.setProperty("--taken", (performance.now() - taping.started) / 1000 / RECORD_LIMIT)
		requestAnimationFrame(fill)
	})
})
for (const release of ["pointerup", "pointercancel"]) record.addEventListener(release, stopTaping)

function stopTaping() {
	if (!taping) return
	const { tape, source, blocks, limit } = taping
	taping = null
	clearTimeout(limit)
	source.disconnect()
	tape.disconnect()
	record.classList.remove("recording")
	record.style.setProperty("--taken", 0)
	for (const track of microphone.getTracks()) track.stop()
	microphone = null
	const sound = trimmed(blocks)
	if (sound) {
		useSound(sound)
		saveRecording(sound, audio.sampleRate, thisSound.name)
	}
	slotBack()
}

// The recording without the silence either side, so a press sounds at once, and brought up to
// full volume, so a quiet recording still punches. Nothing worth keeping gives null
function trimmed(blocks) {
	const samples = new Float32Array(blocks.reduce((total, block) => total + block.length, 0))
	let offset = 0
	for (const block of blocks) {
		samples.set(block, offset)
		offset += block.length
	}
	const loudest = samples.reduce((peak, sample) => Math.max(peak, Math.abs(sample)), 0)
	if (loudest < 0.01) return null
	const begins = Math.max(0, samples.findIndex((sample) => Math.abs(sample) > loudest * 0.05) - audio.sampleRate * 0.01)
	const ends = Math.min(samples.length, samples.findLastIndex((sample) => Math.abs(sample) > loudest * 0.03) + audio.sampleRate * 0.05)
	if (ends - begins < audio.sampleRate * 0.1) return null
	return samples.slice(begins, ends).map((sample) => (sample / loudest) * 0.9)
}

async function useSound(samples) {
	const node = await voices
	node.port.postMessage({ channels: [samples] })
	for (const bar of bars) bar.remove()
	bars.length = 0
	drawWaveform(samples)
	parts = [WHOLE]
	keyPart = 0
}

dot.addEventListener("pointerdown", (event) => {
	// Grabbing the dot turns the knob instead of pressing the button
	event.stopPropagation()
	event.preventDefault()
	dot.setPointerCapture(event.pointerId)
	held.add(event.pointerId)
})
dot.addEventListener("pointermove", (event) => {
	if (!dot.hasPointerCapture(event.pointerId)) return
	const { x, y } = centre()
	const angle = Math.atan2(y - event.clientY, event.clientX - x) * 180 / Math.PI
	turnKnob(hand + around(angle - hand), "drag")
})

// On press rather than click: the sound starts the instant a finger lands
button.addEventListener("pointerdown", (event) => {
	event.preventDefault()
	button.setPointerCapture(event.pointerId)
	held.add(event.pointerId)
	button.classList.add("pressed")
	const press = ++presses
	pressOf.set(event.pointerId, press)
	play(1, WHOLE, press)
	ringPress = press
	ring.classList.remove("showing")
	ring.style.setProperty("--through", 0)
	clearTimeout(ringDelay)
	ringDelay = setTimeout(() => ring.classList.add("showing"), RING_DELAY)
	const { x, y, radius } = centre()
	if (!bending && Math.hypot(event.clientX - x, event.clientY - y) < radius * BEND_ZONE) {
		bending = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, reach: radius * BEND_REACH, radius }
		button.classList.add("bending")
	}
})
button.addEventListener("pointermove", (event) => {
	if (event.pointerId !== bending?.pointerId) return
	bend(event.clientX - bending.x, event.clientY - bending.y)
})
for (const release of ["pointerup", "pointercancel"]) {
	button.addEventListener(release, (event) => {
		held.delete(event.pointerId)
		const press = pressOf.get(event.pointerId)
		if (press) {
			pressOf.delete(event.pointerId)
			// Mid-scrub, the press lasts until the scrubbing finger lifts too
			const scrubbed = press === ringPress && scrubbing !== null
			if (!scrubbed) voices.then((node) => node.port.postMessage({ release: press }))
			if (press === ringPress && !scrubbed) {
				clearTimeout(ringDelay)
				ring.classList.remove("showing")
			}
		}
		if (held.size === 0) {
			button.classList.remove("pressed")
			// Pitch from the wheel or from raising the phone lasts only while held: it swings home
			raise = 0
			restingRaise = null
			rollSpeed = 1
			restingRoll = null
			steer()
			// Unscrewing takes four turns in one go: let go short of that and the button screws back
			// down. Whole turns drop off the knob unseen and unheard, a turn round being the same pitch
			const wholeTurns = hand - around(hand)
			hand -= wholeTurns
			knob.shown -= wholeTurns
			turnKnob(wheelTurned ? 0 : hand, "home")
			wheelTurned = false
		}
		if (event.pointerId === bending?.pointerId) {
			// Let go and the button springs back flat, the call back to normal speed and volume
			bend(0, 0)
			bending = null
			button.classList.remove("bending")
		}
	})
}
button.addEventListener("keydown", (event) => {
	if (event.key === " " || event.key === "Enter") {
		event.preventDefault()
		play()
	}
})
button.addEventListener("contextmenu", (event) => event.preventDefault())

let unflash
let keyPart = 0
addEventListener("keydown", (event) => {
	// One note per keypress: holding a key down would otherwise machine-gun it
	if (event.repeat) return
	if (event.key === "0") {
		// Playing the newly chosen part is how you know which one is chosen
		keyPart = (keyPart + 1) % parts.length
		play(1, parts[keyPart])
	} else {
		const degree = Number(event.key) - 1
		if (!(degree in SCALE)) return
		play(2 ** (SCALE[degree] / 12), parts[keyPart])
	}
	button.classList.add("pressed")
	clearTimeout(unflash)
	unflash = setTimeout(() => held.size || button.classList.remove("pressed"), 90)
})

let unpress
// Listened for on the whole page: wheel events go to whatever is under the cursor, and a held
// button keeps tracking drags that wander off it, so the wheel must too
addEventListener("wheel", (event) => {
	event.preventDefault()
	// While the button is held down, the wheel turns the pitch knob instead of pressing
	if (held.size) {
		const pixels = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * 33 : event.deltaY
		turnKnob(hand - pixels * WHEEL_DEGREES_PER_PIXEL, "step")
		wheelTurned = true
		return
	}
	// Otherwise every notch of a mouse wheel over the button is a press. A notch arrives as one
	// big jump (a line, or about 100 px); touchpads send streams of small deltas, which are ignored
	if (!button.contains(event.target)) return
	if (event.deltaMode === WheelEvent.DOM_DELTA_PIXEL && Math.abs(event.deltaY) < 40) return
	play()
	button.classList.add("pressed")
	clearTimeout(unpress)
	unpress = setTimeout(() => held.size || button.classList.remove("pressed"), 60)
}, { passive: false })

// Grabbing the ring's leading end scrubs that press's call. Listened for on the whole page,
// ahead of the button, because the ring lies partly outside the button
addEventListener("pointerdown", (event) => {
	if (!ring.classList.contains("showing")) return
	const { x, y, radius } = centre()
	const through = Number(ring.style.getPropertyValue("--through"))
	const angle = through * 2 * Math.PI
	const end = { x: x + Math.sin(angle) * radius * 1.1, y: y - Math.cos(angle) * radius * 1.1 }
	if (Math.hypot(event.clientX - end.x, event.clientY - end.y) > radius * RING_GRAB) return
	event.preventDefault()
	event.stopPropagation()
	document.body.setPointerCapture(event.pointerId)
	scrubbing = { pointerId: event.pointerId, turns: turnsAround(event), through }
	ring.classList.add("scrubbing")
	if (audio.state !== "running") audio.resume()
}, { capture: true })
document.body.addEventListener("pointermove", (event) => {
	if (event.pointerId !== scrubbing?.pointerId) return
	// Follow the drag round the circle by its change in angle, so crossing 12 o'clock doesn't jump
	const turns = turnsAround(event)
	const moved = ((turns - scrubbing.turns + 1.5) % 1) - 0.5
	scrubbing.turns = turns
	scrubbing.through = Math.max(0, Math.min(1, scrubbing.through + moved))
	showThrough(scrubbing.through)
	const press = ringPress
	voices.then((node) => node.port.postMessage({ scrub: press, through: scrubbing.through }))
})
for (const release of ["pointerup", "pointercancel"]) {
	document.body.addEventListener(release, (event) => {
		if (event.pointerId !== scrubbing?.pointerId) return
		scrubbing = null
		ring.classList.remove("scrubbing")
		// Still held on the button, the press goes back to being steered; otherwise it plays on
		const press = ringPress
		const stillHeld = [...pressOf.values()].includes(press)
		voices.then((node) => node.port.postMessage(stillHeld ? { scrub: press, through: null } : { release: press }))
		if (!stillHeld) ring.classList.remove("showing")
	})
}

// Which way is up, in the phone's own axes (x to its right, y to its top, z out of the screen)
let up = null
let restingRaise = null // the top edge's angle above level when the button was pressed
let restingRoll = null // the roll around the phone's long axis when the button was pressed
addEventListener("deviceorientation", ({ beta, gamma }) => {
	if (beta === null) return // a computer without motion sensors
	const tipped = beta * Math.PI / 180
	const leaning = gamma * Math.PI / 180
	const reading = { x: -Math.sin(leaning) * Math.cos(tipped), y: Math.sin(tipped), z: Math.cos(leaning) * Math.cos(tipped) }
	up ??= reading
	for (const axis of ["x", "y", "z"]) up[axis] += (reading[axis] - up[axis]) * SENSOR_SMOOTHING
	if (!held.size) return
	// Speed is the cosine of the roll around the phone's long axis since the press: a quarter
	// turn is a standstill, a half turn full speed backwards. Unreadable while the phone
	// stands upright, end-on to the ground
	if (Math.hypot(up.x, up.z) > 0.2) {
		const roll = Math.atan2(up.x, up.z)
		restingRoll ??= roll
		const speed = Math.cos(roll - restingRoll)
		rollSpeed = speed > 0.97 ? 1 : speed // a little lean counts as level
		steer()
	}
	const raised = Math.asin(Math.max(-1, Math.min(1, up.y))) * 180 / Math.PI
	restingRaise ??= raised
	raise = eased(raised - restingRaise) * RAISE_TO_KNOB
	aimKnob()
	// A springing knob carries on to the new aim; a resting one follows the phone directly
	if (!knob.moving) {
		knob.shown = knob.target
		showKnob()
	}
})
// iPhones share motion only once the person allows it, which can only be asked on a tap
if (typeof DeviceOrientationEvent?.requestPermission === "function") {
	button.addEventListener("click", () => DeviceOrientationEvent.requestPermission(), { once: true })
}

// Opening the page, or coming back to it, plays the call once, so a shortcut to it on a home
// screen or desktop is itself the button. Only while the browser allows sound without a touch:
// a call it held back would otherwise go off late, alongside the touch that finally wakes it
const WAKE_WAIT = 200 // ms the browser has to wake the audio before it counts as not allowed
let away = true // opening the page counts as coming back
async function comeBack() {
	if (!away || document.hidden) return
	away = false
	// A press that brought the page into focus has played already
	if (held.size) return
	const awake = await Promise.race([
		audio.resume().then(() => true),
		new Promise((resolve) => setTimeout(resolve, WAKE_WAIT, false)),
	])
	if (awake) play()
}
addEventListener("focus", comeBack)
addEventListener("blur", () => away = true)
document.addEventListener("visibilitychange", () => document.hidden ? away = true : comeBack())
comeBack()

navigator.serviceWorker?.register(new URL("sw.js", import.meta.url))
