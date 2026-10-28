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
// Each end of a copy's part is faded over a few milliseconds, and nothing beyond it is heard, as if
// the recording had been cut there cleanly, so a crop never pops however loud the sound is there.

const SPEED_EASE = 0.2 // share of the way a copy's speed moves to the asked-for one each 128-sample block, so changes never click
const REPORT_EVERY = 4 // blocks between progress reports, about 12 ms
const SCRUB_CATCH_UP = 128 * 6 // a scrubbed copy closes the gap to where it is dragged over about this many samples
const SCRUB_FULL = 0.5 // a scrubbed copy moving at this share of normal speed or faster sounds at full volume
const EDGE = Math.round(0.005 * sampleRate) // samples over which each end of a part fades

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

	// The moment around the copy's position, smeared: one channel per channel of the recording,
	// each with the same random phases, so the stereo image holds. Made a step at a time, one step a
	// block (see process), as making it all at once takes longer than a block lasts on a phone
	*frame(voice) {
		const phases = Float32Array.from({ length: WINDOW / 2 + 1 }, () => Math.random() * 2 * Math.PI)
		const start = Math.floor(voice.position) - STEP
		const channels = []
		for (const samples of this.recording) {
			const re = new Float32Array(WINDOW)
			const im = new Float32Array(WINDOW)
			for (let j = 0; j < WINDOW; j++) {
				const at = start + j
				const edge = Math.min(1, (at - voice.from) / EDGE, (voice.to - at) / EDGE)
				if (edge > 0) re[j] = samples[at] * edge * HANN[j]
			}
			fft(re, im)
			yield
			const loudness = Float32Array.from({ length: WINDOW / 2 + 1 }, (_, k) => Math.hypot(re[k], im[k]))
			for (let k = 0; k <= WINDOW / 2; k++) {
				const from = Math.round(k / voice.pitch)
				// Shifted up, each pitch is spread over more of the spectrum, so it's spread thinner to keep its loudness
				const level = from <= WINDOW / 2 ? loudness[from] / Math.sqrt(voice.pitch) : 0
				// Conjugated for the inverse transform; the mirror half keeps the result real
				re[k] = level * Math.cos(phases[k])
				im[k] = -level * Math.sin(phases[k])
				if (k > 0 && k < WINDOW / 2) {
					re[WINDOW - k] = re[k]
					im[WINDOW - k] = -im[k]
				}
			}
			im[0] = 0
			im[WINDOW / 2] = 0
			fft(re, im)
			yield
			channels.push(re.map((value, j) => (value / WINDOW) * SINE[j]))
		}
		return channels
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
				Object.assign(voice, { position: this.baseline.speed < 0 ? voice.to - 1 : voice.from, untilFrame: 0, frames: [], making: null, next: null })
			}
			// Held outside its part, a copy waits there, silent, starting no frames
			if (!voice.making && !voice.next && inside(voice)) voice.making = this.frame(voice)
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
					voice.frames.push({ channels: voice.next, age: 0 })
					voice.next = null
					voice.untilFrame = STEP - 1
				}
				voice.position += voice.speed
				// Held, a copy waits just outside either end of its part
				if (voice.held) voice.position = Math.max(voice.from - 1, Math.min(voice.to, voice.position))
				for (const frame of voice.frames) {
					for (let channel = 0; channel < out.length; channel++) {
						out[channel][i] += frame.channels[Math.min(channel, frame.channels.length - 1)][frame.age] * voice.loudness
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
