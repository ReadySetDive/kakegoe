// What's said in a recording, worked out on this device by Whisper, run by Transformers.js, in
// this worker so the page stays responsive. Given { id, samples } (16 kHz, mono), it answers
// { id, text }
import { pipeline } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1"

// The smallest English model, about 40 MB, fetched on first use and kept by the browser after
const listening = pipeline("automatic-speech-recognition", "onnx-community/whisper-tiny.en", { dtype: "q8", device: "wasm" })

onmessage = async ({ data: { id, samples } }) => {
	const { text } = await (await listening)(samples)
	postMessage({ id, text })
}
