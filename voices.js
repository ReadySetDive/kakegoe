// Plays any number of overlapping copies of the call. Each copy is rebuilt from short, overlapping,
// faded grains of the recording: how fast it moves through the recording is its speed, and how fast
// each grain is read is its pitch, so the two bend independently. Pitch (the knob) bends every copy
// at once; each copy can also carry its own pitch on top (a note played on the number keys), and
// play only part of the recording (from and to, in seconds).
//
// A copy whose press is still held is steered: its speed follows the bends and the phone's roll,
// down to zero, holding one moment indefinitely, and below, where grains read backwards so it plays
// truly reversed. Held, it never runs off either end of its part; it waits there, silent, to be
// played on or back again, and its progress is reported so the page can show it. Let go, it plays
// on at normal speed from wherever it is.
//
// Grains are placed by WSOLA: each new grain may slide a few milliseconds from where it would
// naturally start, to wherever the recording best matches what the previous grain is playing as
// they cross-fade. Unaligned grains half-cancel each other at a steady rate, which is what makes
// plain granular stretching flutter and chop when slowed down; aligned ones join seamlessly. At
// normal speed and pitch the best match is no slide at all, so the recording comes back untouched.

const GRAIN = 1024 // samples, about 23 ms
const HOP = GRAIN / 2 // two grains always overlap, and their fades sum to exactly one
const FADE = Float32Array.from({ length: GRAIN }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / GRAIN))
const SEARCH = 256 // how far, in samples either way, a grain may slide to line up: a voice's pitch period or two
const MATCH = 256 // how many samples are compared when judging a line-up
const STRIDE = 4 // compare every fourth sample and slide in steps of four: plenty for a smooth join, and cheap
const SPEED_EASE = 0.2 // share of the way a copy's speed moves to the asked-for one each 128-sample block, so changes never click
const REPORT_EVERY = 4 // blocks between progress reports, about 12 ms

class Voices extends AudioWorkletProcessor {
	static get parameterDescriptors() {
		return [{ name: "pitch", defaultValue: 1, minValue: 0.25, maxValue: 4, automationRate: "k-rate" }]
	}

	constructor() {
		super()
		this.recording = [] // one Float32Array per channel
		this.voices = []
		this.heldSpeed = 1
		this.blocks = 0
		this.port.onmessage = ({ data }) => {
			if ("channels" in data) this.recording = data.channels
			// note, from, to, and for a held press its id
			else if ("note" in data) this.voices.push({ ...data, held: data.id !== undefined, speed: 1, grains: null })
			else if ("release" in data) {
				for (const voice of this.voices) if (voice.id === data.release) voice.held = false
			} else this.heldSpeed = data.heldSpeed
		}
	}

	// Where, near `natural`, the recording best continues what is heard at `continuing`, both read
	// `step` samples per sample (negative backwards). Searches outward from no slide and only moves
	// for a strictly better match.
	lineUp(natural, continuing, step) {
		const samples = this.recording[0]
		const readable = (start) => Math.min(start, start + MATCH * step) >= 0 && Math.max(start, start + MATCH * step) <= samples.length - 2
		if (!readable(continuing)) return natural
		let best = natural
		let bestScore = -Infinity
		for (let slide = 0; slide <= SEARCH; slide = slide > 0 ? -slide : -slide + STRIDE) {
			const start = natural + slide
			if (!readable(start)) continue
			let together = 0
			let energy = 1e-9
			for (let j = 0; j < MATCH; j += STRIDE) {
				const candidate = samples[Math.floor(start + j * step)]
				together += candidate * samples[Math.floor(continuing + j * step)]
				energy += candidate * candidate
			}
			const score = together / Math.sqrt(energy)
			if (score > bestScore + 1e-9) {
				best = start
				bestScore = score
			}
		}
		return best
	}

	process(_inputs, outputs, parameters) {
		const knobPitch = parameters.pitch[0]
		const out = outputs[0]
		const length = this.recording[0]?.length ?? 0
		for (const voice of this.voices) {
			const pitch = knobPitch * voice.note
			if (!voice.grains) {
				voice.from = Math.round(voice.from * sampleRate)
				voice.to = Math.min(length - 2, Math.round(voice.to * sampleRate))
				// Starting at the very beginning, a copy begins with a grain already at full strength, so
				// its first moment is not faded in; starting mid-sound, it fades in to avoid a click
				const grains = voice.from === 0 ? [{ start: -HOP * pitch, age: HOP, direction: 1 }] : []
				Object.assign(voice, { position: voice.from, untilGrain: 0, grains })
			}
			voice.speed += ((voice.held ? this.heldSpeed : 1) - voice.speed) * SPEED_EASE
			for (let i = 0; i < out[0].length; i++) {
				if (voice.untilGrain-- <= 0 && voice.position >= voice.from && voice.position < voice.to) {
					const direction = voice.speed < 0 ? -1 : 1
					const previous = voice.grains[voice.grains.length - 1]
					const continuing = previous && previous.start + previous.age * pitch * previous.direction
					// Grains only line up with ones read the same way; at a reversal they just cross-fade
					const start = previous?.direction === direction ? this.lineUp(voice.position, continuing, pitch * direction) : voice.position
					voice.grains.push({ start, age: 0, direction })
					voice.untilGrain = HOP - 1
				}
				voice.position += voice.speed
				// Held, a copy waits just outside either end of its part, where no grains start
				if (voice.held) voice.position = Math.max(voice.from - 1, Math.min(voice.to, voice.position))
				for (const grain of voice.grains) {
					const at = grain.start + grain.age * pitch * grain.direction
					const fade = FADE[grain.age++]
					if (at < 0 || at >= length - 1) continue
					const index = Math.floor(at)
					const between = at - index
					for (let channel = 0; channel < out.length; channel++) {
						const samples = this.recording[Math.min(channel, this.recording.length - 1)]
						out[channel][i] += (samples[index] + (samples[index + 1] - samples[index]) * between) * fade
					}
				}
				if (voice.grains[0]?.age >= GRAIN) voice.grains.shift()
			}
		}
		this.voices = this.voices.filter((voice) => voice.held || (voice.position >= voice.from && voice.position < voice.to) || voice.grains.length)
		const held = this.voices.filter((voice) => voice.held && voice.grains)
		if (++this.blocks % REPORT_EVERY === 0 && held.length) {
			this.port.postMessage({ progress: held.map((voice) => ({ id: voice.id, through: (voice.position - voice.from) / (voice.to - voice.from) })) })
		}
		return true
	}
}

registerProcessor("voices", Voices)
