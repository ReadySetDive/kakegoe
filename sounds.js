// Every sound on the soundboard. Each has a folder of the same name holding its page, sound.mp3,
// manifest and icons (see sw.js). hue colors its button; split is how many seconds in key 0
// divides the sound. Names are all capitals, here and in the folder's page title and manifest
const SOUNDS = [
	// Split where the shouted "yo" ends and its ethereal tail takes over (measured)
	{ folder: "kakegoe", name: "KAKEGOE", hue: 3, split: 1.17 },
	// Split where the "f" has long given way to the vowel: the bitten-off "FAH", then the held "AHHH"
	{ folder: "fahhh", name: "FAHHH", hue: 210, split: 0.5 },
]
