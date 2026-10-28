// Plays any number of overlapping copies of the call. Each copy is rebuilt by Paulstretch: every
// few hundredths of a second it takes a long window of the recording around where it is, turns it
// into its spectrum, gives every frequency a random phase and turns it back. Only how loud each
// frequency is survives, so a frame sounds like that moment smeared out, and frames overlap into a
// smooth sound with no repeating rhythm, however slowly the copy moves, even standing still. How
// fast a copy moves through the recording is its speed; pitch slides the spectrum up or down, so the
// two bend independently. Pitch (the knob) bends every copy at once; each copy can also carry its own
// pitch on top (a note played on the number keys), and play only part of the recording (from and
// to, in seconds).
//
// A copy whose press is still held is steered: its speed follows the bends and the phone's roll,
// down to zero, holding one moment indefinitely, and below, where it moves backwards through the
// recording. Held, it never runs off either end of its part; it waits there, silent, to be played on
// or back again. Let go, it plays on at normal speed from wherever it is. A copy can also be
// scrubbed: dragged to places in its part, sounding only while it moves, like tape under a finger.
// The progress of every held copy is reported, so the page can show and scrub it.
//
// A button can have its own speed and pitch, which every copy starts from and bends on top of.
// Backwards (a speed below zero), a copy starts at the end of its part and plays to the start.
//
// A copy starts at full strength, not swelling in as frames otherwise do, and stops where its part
// ends, as a recording cut there would, not ringing on through its last frames. Every frame is taken
// from inside its part, so nothing beyond a crop is ever heard and no frame is left half empty.

const SPEED_EASE = 0.2 // share of the way a copy's speed moves to the asked-for one each 128-sample block, so changes never click
const REPORT_EVERY = 4 // blocks between progress reports, about 12 ms
const SCRUB_CATCH_UP = 128 * 6 // a scrubbed copy closes the gap to where it is dragged over about this many samples
const SCRUB_FULL = 0.5 // a scrubbed copy moving at this share of normal speed or faster sounds at full volume
const STOP = Math.round(0.005 * sampleRate) // samples a copy takes to go quiet past the end of its part: any quicker pops

const WINDOW = 8192 // samples, about 190 ms at 44.1 kHz
const STEP = WINDOW / 2 // two frames always overlap
const BITS = Math.log2(WINDOW)
const HANN = Float32Array.from({ length: WINDOW }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / WINDOW))
// Random-phase frames overlap as noise does, adding in power: sine fades squared sum to one. The
// Hann window keeps 3/8 of the power
const SINE = Float32Array.from({ length: WINDOW }, (_, i) => Math.sin((Math.PI * i) / WINDOW) * Math.sqrt(8 / 3))
const COS = Float32Array.from({ length: WINDOW / 2 }, (_, i) => Math.cos((2 * Math.PI * i) / WINDOW))
const SIN = Float32Array.from({ length: WINDOW / 2 }, (_, i) => -Math.sin((2 * Math.PI * i) / WINDOW))
const REVERSED = Uint32Array.from({ length: WINDOW }, (_, i) => {
	let r = 0
	for (let b = 0; b < BITS; b++) r |= ((i >> b) & 1) << (BITS - 1 - b)
	return r
})

// In place. Inverse by conjugating before and after, and dividing by the length
function fft(re, im) {
	for (let i = 0; i < WINDOW; i++) {
		const j = REVERSED[i]
		if (j > i) {
			[re[i], re[j]] = [re[j], re[i]];
			[im[i], im[j]] = [im[j], im[i]]
		}
	}
	for (let size = 2; size <= WINDOW; size *= 2) {
		const half = size / 2
		const stride = WINDOW / size
		for (let start = 0; start < WINDOW; start += size) {
			for (let k = 0; k < half; k++) {
				const a = start + k
				const b = a + half
				const c = COS[k * stride]
				const s = SIN[k * stride]
				const tre = re[b] * c - im[b] * s
				const tim = re[b] * s + im[b] * c
				re[b] = re[a] - tre
				im[b] = im[a] - tim
				re[a] += tre
				im[a] += tim
			}
		}
	}
}

const inside = (voice) => voice.position >= voice.from && voice.position < voice.to

class Voices extends AudioWorkletProcessor {
	static get parameterDescriptors() {
		return [{ name: "pitch", defaultValue: 1, minValue: 0.25, maxValue: 4, automationRate: "k-rate" }]
	}

	constructor() {
		super()
		this.recording = [] // one Float32Array per channel
		this.voices = []
		this.heldSpeed = 1
		this.baseline = { speed: 1, pitch: 1 } // the button's own, under every bend
		this.blocks = 0
		this.port.onmessage = ({ data }) => {
			if ("channels" in data) this.recording = data.channels
			// note, from, to, and for a held press its id
			else if ("note" in data) this.voices.push({ ...data, held: data.id !== undefined, scrubTo: null, speed: this.baseline.speed, loudness: 1, frames: null })
			else if ("release" in data) {
				for (const voice of this.voices) if (voice.id === data.release) Object.assign(voice, { held: false, scrubTo: null })
			} else if ("scrub" in data) {
				// through: how far into its part to drag the copy (0 to 1), or null to stop scrubbing
				for (const voice of this.voices) if (voice.id === data.scrub) Object.assign(voice, { held: true, scrubTo: data.through })
			} else if ("silence" in data) this.voices = []
			else if ("baseline" in data) this.baseline = data.baseline
			else this.heldSpeed = data.heldSpeed
		}
	}

	// The moment around the copy's position, smeared, as a left and a right channel. Both channels go
	// through one transform together, left as the real part and right as the imaginary, which halves
	// the work, and get the same random phases, so the stereo image holds. Made in two steps, one a
	// block (see process), as making it all at once takes longer than a block lasts on a phone
	// ahead: how many samples from now the frame's middle, its loudest moment, will be heard, so it's
	// made from where the copy will be then
	*frame(voice, ahead) {
		const [left, right = left] = this.recording
		const middle = Math.max(voice.from + STEP, Math.min(voice.to - STEP, Math.floor(voice.position + voice.speed * ahead)))
		const start = middle - STEP
		const re = new Float32Array(WINDOW)
		const im = new Float32Array(WINDOW)
		for (let j = 0; j < WINDOW; j++) {
			const at = start + j
			// Only a part shorter than a frame leaves any of it outside
			if (at >= voice.from && at < voice.to) {
				re[j] = left[at] * HANN[j]
				im[j] = right[at] * HANN[j]
			}
		}
		fft(re, im)
		yield
		// Each channel's loudness at each frequency, untangled from the shared spectrum by its symmetry
		const half = WINDOW / 2
		const leftLoudness = new Float32Array(half + 1)
		const rightLoudness = new Float32Array(half + 1)
		for (let k = 0; k <= half; k++) {
			const mirror = (WINDOW - k) % WINDOW
			leftLoudness[k] = Math.hypot(re[k] + re[mirror], im[k] - im[mirror]) / 2
			rightLoudness[k] = Math.hypot(re[k] - re[mirror], im[k] + im[mirror]) / 2
		}
		// Shifted up, each pitch is spread over more of the spectrum, so it's spread thinner to keep its loudness
		const thinned = 1 / Math.sqrt(voice.pitch)
		for (let k = 0; k <= half; k++) {
			const from = Math.round(k / voice.pitch)
			const l = from <= half ? leftLoudness[from] * thinned : 0
			const r = from <= half ? rightLoudness[from] * thinned : 0
			// The two ends of the spectrum get no phase, as they must stay real
			const phase = k === 0 || k === half ? 0 : Math.random() * 2 * Math.PI
			const c = Math.cos(phase)
			const s = Math.sin(phase)
			// Left plus i times right, conjugated for the inverse transform; the mirror half keeps each channel real
			re[k] = l * c - r * s
			im[k] = -(l * s + r * c)
			if (k > 0 && k < half) {
				re[WINDOW - k] = l * c + r * s
				im[WINDOW - k] = l * s - r * c
			}
		}
		fft(re, im)
		return [
			re.map((value, j) => (value / WINDOW) * SINE[j]),
			im.map((value, j) => (-value / WINDOW) * SINE[j]),
		]
	}

	process(_inputs, outputs, parameters) {
		const knobPitch = parameters.pitch[0]
		const out = outputs[0]
		const length = this.recording[0]?.length ?? 0
		for (const voice of this.voices) {
			voice.pitch = knobPitch * voice.note * this.baseline.pitch
			if (!voice.frames) {
				voice.from = Math.round(voice.from * sampleRate)
				voice.to = Math.min(length - 2, Math.round(voice.to * sampleRate))
				// making: the next frame, while it's being made; next: that frame, made and waiting to be due
				Object.assign(voice, { position: this.baseline.speed < 0 ? voice.to - 1 : voice.from, untilFrame: 0, frames: [], making: null, next: null, sounding: 1 })
			}
			// Held outside its part, a copy waits there, silent, starting no frames
			if (!voice.making && !voice.next && inside(voice)) {
				voice.making = this.frame(voice, voice.frames.length ? Math.max(0, voice.untilFrame) + STEP : 0)
			}
			if (voice.making) {
				const { done, value } = voice.making.next()
				if (done) Object.assign(voice, { making: null, next: value })
			}
			const scrubbing = voice.scrubTo !== null
			let wanted = (voice.held ? this.heldSpeed : 1) * this.baseline.speed
			if (scrubbing) {
				const target = voice.from + voice.scrubTo * (voice.to - voice.from)
				wanted = Math.max(-4, Math.min(4, (target - voice.position) / SCRUB_CATCH_UP))
			}
			voice.speed += (wanted - voice.speed) * (scrubbing ? 0.5 : SPEED_EASE)
			// Scrubbed, a copy sounds only while it moves, louder the faster, like tape under a finger
			const loudness = scrubbing ? Math.min(1, Math.abs(voice.speed) / SCRUB_FULL) : 1
			voice.loudness += (loudness - voice.loudness) * 0.3
			for (let i = 0; i < out[0].length; i++) {
				if (voice.untilFrame-- <= 0 && voice.next) {
					// The first frame starts halfway through, at full strength, and the next is due at once
					// to swell in as it fades
					const first = !voice.frames.length
					voice.frames.push({ channels: voice.next, age: first ? STEP : 0 })
					voice.next = null
					voice.untilFrame = first ? 0 : STEP - 1
				}
				voice.position += voice.speed
				// Held, a copy waits just outside either end of its part
				if (voice.held) voice.position = Math.max(voice.from - 1, Math.min(voice.to, voice.position))
				// Past either end, it goes quiet and lets its frames go; back inside, it starts afresh at full strength
				voice.sounding = inside(voice) ? 1 : Math.max(0, voice.sounding - 1 / STOP)
				if (voice.sounding === 0) Object.assign(voice, { frames: [], making: null, next: null })
				for (const frame of voice.frames) {
					for (let channel = 0; channel < out.length; channel++) {
						out[channel][i] += frame.channels[channel][frame.age] * voice.loudness * voice.sounding
					}
					frame.age++
				}
				if (voice.frames[0]?.age >= WINDOW) voice.frames.shift()
			}
		}
		this.voices = this.voices.filter((voice) => voice.held || inside(voice) || voice.making || voice.next || voice.frames.length)
		const pressed = this.voices.filter((voice) => voice.held && voice.frames)
		if (++this.blocks % REPORT_EVERY === 0 && pressed.length) {
			this.port.postMessage({ progress: pressed.map((voice) => ({ id: voice.id, through: (voice.position - voice.from) / (voice.to - voice.from) })) })
		}
		return true
	}
}

registerProcessor("voices", Voices)

// Records whatever reaches it (the microphone), handing it over block by block.
class Tape extends AudioWorkletProcessor {
	process(inputs) {
		const channel = inputs[0][0]
		if (channel) this.port.postMessage(channel.slice())
		return true
	}
}

registerProcessor("tape", Tape)
