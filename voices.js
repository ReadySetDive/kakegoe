// Plays any number of overlapping copies of the call. Each copy is rebuilt from short, overlapping,
// faded grains of the recording: how fast it moves through the recording is its speed, and how fast
// each grain is read is its pitch, so the two bend independently, live, on every copy at once.
// At normal speed and pitch the grains line up exactly and rebuild the recording untouched.

const GRAIN = 2048 // samples, about 46 ms
const HOP = GRAIN / 2 // two grains always overlap, and their fades sum to exactly one
const FADE = Float32Array.from({ length: GRAIN }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / GRAIN))

class Voices extends AudioWorkletProcessor {
	static get parameterDescriptors() {
		return [
			{ name: "pitch", defaultValue: 1, minValue: 0.25, maxValue: 4, automationRate: "k-rate" },
			{ name: "speed", defaultValue: 1, minValue: 0.1, maxValue: 4, automationRate: "k-rate" },
		]
	}

	constructor() {
		super()
		this.recording = [] // one Float32Array per channel
		this.voices = []
		this.port.onmessage = ({ data }) => {
			if (data === "play") this.voices.push(null)
			else this.recording = data.channels
		}
	}

	process(_inputs, outputs, parameters) {
		const pitch = parameters.pitch[0]
		const speed = parameters.speed[0]
		const out = outputs[0]
		const length = this.recording[0]?.length ?? 0
		for (let v = 0; v < this.voices.length; v++) {
			// A new copy starts with a grain already at full strength, so its first moment is not faded in
			this.voices[v] ??= { position: 0, untilGrain: 0, grains: [{ start: -HOP * pitch, age: HOP }] }
			const voice = this.voices[v]
			for (let i = 0; i < out[0].length; i++) {
				if (voice.untilGrain-- <= 0 && voice.position < length) {
					voice.grains.push({ start: voice.position, age: 0 })
					voice.untilGrain = HOP - 1
				}
				voice.position += speed
				for (const grain of voice.grains) {
					const at = grain.start + grain.age * pitch
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
		this.voices = this.voices.filter((voice) => voice.position < length || voice.grains.length)
		return true
	}
}

registerProcessor("voices", Voices)
