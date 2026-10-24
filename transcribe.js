// What's said in a recording, worked out on this device by Whisper, run by Transformers.js, in
// this worker so the page stays responsive. Given { id, samples } (16 kHz, mono), it answers
// { id, text }, or { id, error }; and while first fetching the model, { downloading } (0 to 1)
import { pipeline } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1"

// The smallest English model, about 40 MB, fetched on first use and kept by the browser after
const fetched = new Map() // file -> [bytes loaded, bytes in all]
const listening = pipeline("automatic-speech-recognition", "onnx-community/whisper-tiny.en", {
	dtype: "q8",
	device: "wasm",
	progress_callback: (progress) => {
		if (progress.status !== "progress") return
		fetched.set(progress.file, [progress.loaded, progress.total])
		const [loaded, total] = [...fetched.values()].reduce(([loadedSoFar, totalSoFar], [fileLoaded, fileTotal]) => [loadedSoFar + fileLoaded, totalSoFar + fileTotal], [0, 0])
		postMessage({ downloading: loaded / total })
	},
})

onmessage = async ({ data: { id, samples } }) => {
	try {
		const { text } = await (await listening)(samples)
		postMessage({ id, text })
	} catch (error) {
		postMessage({ id, error: error?.message ?? String(error) })
	}
}
