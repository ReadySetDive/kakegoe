// Recordings and buttons made on this device, kept in its storage (IndexedDB) and shared by every
// page and the service worker. None of it reaches the site: clearing the browser's data loses it
const RECENT_LIMIT = 10
// Recordings stop, and sounds added from files or the web are cut off, at this length. Much
// longer, and phones run short of memory, since a button holds its whole sound decoded
const LONGEST_SOUND = 180 // seconds

function saved(storeName, mode, work) {
	return new Promise((resolve, reject) => {
		const opening = indexedDB.open("soundboard", 1)
		opening.onupgradeneeded = () => {
			opening.result.createObjectStore("recordings", { keyPath: "id", autoIncrement: true })
			opening.result.createObjectStore("buttons", { keyPath: "id" })
		}
		opening.onerror = () => reject(opening.error)
		opening.onsuccess = () => {
			const transaction = opening.result.transaction(storeName, mode)
			const request = work(transaction.objectStore(storeName))
			transaction.oncomplete = () => resolve(request.result)
			transaction.onerror = () => reject(transaction.error)
		}
	})
}

// Recordings go by when they were made, until named by what's said in them (see home.js)
function saveRecording(samples, sampleRate) {
	// Asks the browser not to clear the site's storage when the device runs short of space
	navigator.storage?.persist()
	return keepRecording({ sound: wav(samples, sampleRate), at: Date.now() })
}

// Into the recent list, which holds only the latest few. Gives the recording's id
async function keepRecording(recording) {
	const id = await saved("recordings", "readwrite", (recordings) => recordings.add(recording))
	for (const old of (await recentRecordings()).slice(RECENT_LIMIT)) await deleteRecording(old.id)
	return id
}

// Unless it's been promoted or binned meanwhile
async function nameRecording(id, name) {
	const recording = await saved("recordings", "readonly", (recordings) => recordings.get(id))
	if (recording) await saved("recordings", "readwrite", (recordings) => recordings.put({ ...recording, name }))
}

// Newest first
async function recentRecordings() {
	return (await saved("recordings", "readonly", (recordings) => recordings.getAll())).reverse()
}

function deleteRecording(id) {
	return saved("recordings", "readwrite", (recordings) => recordings.delete(id))
}

// sound: a WAV, like a recording's
function addButton(sound, name, hue) {
	const id = crypto.randomUUID().slice(0, 8)
	return saved("buttons", "readwrite", (buttons) => buttons.add({ id, name: name.toUpperCase(), hue, sound }))
}

// A recording becomes a button, leaving the recent list
async function promote(recording, name, hue) {
	await addButton(recording.sound, name, hue)
	await deleteRecording(recording.id)
}

// A button goes back to being a recording, the newest, named after the button
async function demote(button) {
	await keepRecording({ sound: button.sound, name: button.name, at: Date.now() })
	await saved("buttons", "readwrite", (buttons) => buttons.delete(button.id))
}

function rename(button, name, hue) {
	return saved("buttons", "readwrite", (buttons) => buttons.put({ ...button, name: name.toUpperCase(), hue }))
}

function savedButtons() {
	return saved("buttons", "readonly", (buttons) => buttons.getAll())
}

function savedButton(id) {
	return saved("buttons", "readonly", (buttons) => buttons.get(id))
}

// A recording, from its blocks, without the silence either side, so a press sounds at once, and brought up to
// full volume, so a quiet recording still punches. Nothing worth keeping gives null
function trimmed(blocks, sampleRate) {
	const samples = new Float32Array(blocks.reduce((total, block) => total + block.length, 0))
	let offset = 0
	for (const block of blocks) {
		samples.set(block, offset)
		offset += block.length
	}
	const loudest = samples.reduce((peak, sample) => Math.max(peak, Math.abs(sample)), 0)
	if (loudest < 0.01) return null
	const begins = Math.max(0, samples.findIndex((sample) => Math.abs(sample) > loudest * 0.05) - sampleRate * 0.01)
	const ends = Math.min(samples.length, samples.findLastIndex((sample) => Math.abs(sample) > loudest * 0.03) + sampleRate * 0.05)
	if (ends - begins < sampleRate * 0.1) return null
	return samples.slice(begins, ends).map((sample) => (sample / loudest) * 0.9)
}

// Mono, 16-bit
function wav(samples, sampleRate) {
	const data = new DataView(new ArrayBuffer(44 + samples.length * 2))
	const text = (offset, letters) => [...letters].forEach((letter, index) => data.setUint8(offset + index, letter.charCodeAt(0)))
	text(0, "RIFF")
	data.setUint32(4, 36 + samples.length * 2, true)
	text(8, "WAVE")
	text(12, "fmt ")
	data.setUint32(16, 16, true)
	data.setUint16(20, 1, true) // uncompressed
	data.setUint16(22, 1, true) // one channel
	data.setUint32(24, sampleRate, true)
	data.setUint32(28, sampleRate * 2, true)
	data.setUint16(32, 2, true)
	data.setUint16(34, 16, true)
	text(36, "data")
	data.setUint32(40, samples.length * 2, true)
	samples.forEach((sample, index) => data.setInt16(44 + index * 2, Math.max(-1, Math.min(1, sample)) * 0x7fff, true))
	return new Blob([data], { type: "audio/wav" })
}
