#!/bin/sh
# Draws a sound's icons from its button (tools/icon.html), photographed by headless Chrome.
# Usage: tools/make-icons.sh <folder> <hue> [<hue of the lower-left half, for a split button>]
set -e
folder=$1
hue=$2
split=${3:+&split=$3}
chrome=${CHROME:-"/c/Program Files/Google/Chrome/Application/chrome.exe"}
# Chrome on Windows needs Windows paths
root=$(cd "$(dirname "$0")/.." && (pwd -W 2>/dev/null || pwd))
work=$(mktemp -d)

# Chrome won't make a window narrower than about 500 px, so every icon is photographed at 512
# and scaled down from there
photograph() {
	"$chrome" --headless=new --disable-gpu --hide-scrollbars --allow-file-access-from-files \
		--user-data-dir="$work/profile" --default-background-color=00000000 --window-size=512,512 \
		--screenshot="$2" "file:///$root/tools/icon.html?hue=$hue$split&kind=$1" 2>/dev/null
}
shrink() {
	ffmpeg -v error -y -i "$1" -vf "scale=$3:$3:flags=lanczos" "$2"
}
# iPhones turn anything see-through black, so the icons that fill their square have no alpha at all
flatten() {
	ffmpeg -v error -y -i "$1" -vf "scale=$3:$3:flags=lanczos" -pix_fmt rgb24 "$2"
}

photograph floating "$root/$folder/icon-512.png"
shrink "$root/$folder/icon-512.png" "$root/$folder/icon-192.png" 192
photograph filling "$work/filling.png"
flatten "$work/filling.png" "$root/$folder/maskable-512.png" 512
flatten "$work/filling.png" "$root/$folder/apple-touch-icon.png" 180
rm -rf "$work"
