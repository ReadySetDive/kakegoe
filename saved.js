// Recordings and buttons made on this device, kept in its storage (IndexedDB) and shared by every
// page and the service worker. None of it reaches the site: clearing the browser's data loses it
const RECENT_LIMIT = 10

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

// recordedOn: the name of the button it was recorded on
function saveRecording(samples, sampleRate, recordedOn) {
	// Asks the browser not to clear the site's storage when the device runs short of space
	navigator.storage?.persist()
	return keepRecording({ sound: wav(samples, sampleRate), recordedOn, at: Date.now() })
}

// Into the recent list, which holds only the latest few
async function keepRecording(recording) {
	await saved("recordings", "readwrite", (recordings) => recordings.add(recording))
	for (const old of (await recentRecordings()).slice(RECENT_LIMIT)) await deleteRecording(old.id)
}

// Newest first
async function recentRecordings() {
	return (await saved("recordings", "readonly", (recordings) => recordings.getAll())).reverse()
}

function deleteRecording(id) {
	return saved("recordings", "readwrite", (recordings) => recordings.delete(id))
}

// A recording becomes a button, leaving the recent list
async function promote(recording, name, hue) {
	const id = crypto.randomUUID().slice(0, 8)
	await saved("buttons", "readwrite", (buttons) => buttons.add({ id, name: name.toUpperCase(), hue, sound: recording.sound }))
	await deleteRecording(recording.id)
}

// A button goes back to being a recording, the newest, named after the button
async function demote(button) {
	await keepRecording({ sound: button.sound, recordedOn: button.name, at: Date.now() })
	await saved("buttons", "readwrite", (buttons) => buttons.delete(button.id))
}

function savedButtons() {
	return saved("buttons", "readonly", (buttons) => buttons.getAll())
}

function savedButton(id) {
	return saved("buttons", "readonly", (buttons) => buttons.get(id))
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
