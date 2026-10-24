---
name: add-sound
description: Find a well-known sound on the internet (a meme sound, a sound effect, a famous shout) from a short description, download it, and add it to the soundboard as a new button. Use when the user names or describes a sound they want added, e.g. "/add-sound the vine boom" or "add the windows XP shutdown sound".
---

# Add a sound to the soundboard

The user describes a sound in a few words. Find it, download it, and make it a button of its own,
like KAKEGOE and FAHHH. Only ask the user something if the description could mean several
different sounds.

## How a sound is laid out

Each sound is a folder at the repo root, named after the sound in lowercase, holding:

- `sound.mp3`
- `index.html`, `manifest.webmanifest`
- `icon-192.png`, `icon-512.png`, `maskable-512.png`, `apple-touch-icon.png`

and one entry in `sounds.js`. The home page and the offline cache (`sw.js`) both read `sounds.js`,
so nothing else needs to change.

## Steps

1. **Find the sound.** Search the web for it. myinstants.com is usually the quickest source: its
   pages link straight to an mp3 under `https://www.myinstants.com/media/sounds/`. Prefer the
   cleanest, most recognisable version: the original, with no music or extra noise around it.
   Download it with `curl -L` into a new empty folder in the scratchpad. If the only copy is a
   video (YouTube and the like), install yt-dlp with `python -m pip install yt-dlp` and pull just
   the audio with `python -m yt_dlp -x --audio-format mp3`.

2. **Name it.** An all-capitals name the way people shout or write the sound (`FAHHH`,
   `KAKEGOE`); the folder is the same name in lowercase.

3. **Prepare `sound.mp3`.** With ffmpeg:
   - Cut it to just the sound, with no silence before it: opening the page plays it at once.
   - Match the loudness of the others, a mean volume of about -20 dB
     (`ffmpeg -i in.mp3 -af volumedetect -f null -` to measure).
   - Save as 44.1 kHz stereo mp3.

   Find the place where it changes character, e.g. a sharp attack giving way to a held
   tail. That is its `split`, in seconds: key 0 plays the two parts either side of it. Measure
   it, e.g. from the loudness over time
   (`ffmpeg -i sound.mp3 -af "asetnsamples=2205,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level" -f null -`,
   one reading every 50 ms).

4. **Pick a `hue`** (0–360) that suits the sound and is clearly different from the hues
   already in `sounds.js`.

5. **Make the folder.** Copy `fahhh/index.html` and `fahhh/manifest.webmanifest`, replacing
   FAHHH with the new name. The manifest's description is "One <color> button. <the sound, written
   out>!". Make the icons, photographed from the button itself:

   ```sh
   tools/make-icons.sh <folder> <hue>
   ```

   Look at the result to check it is the colour you meant.

6. **List it in `sounds.js`**, at the end, with a comment above it saying where the split falls,
   like the entries already there.

7. **Check it** by serving the repo (`python -m http.server`) and opening `/<folder>/`: the
   button has the new colour and its `sound.mp3` loads. Then ask the user to give it a listen.

8. **Commit** the folder and `sounds.js` together, with a message in the style of the existing
   history. Don't push unless the user asks.

Finally, tell the user where the sound came from.
