// Icons for buttons made on this device, drawn by the service worker. The same two kinds as
// tools/make-icons.sh photographs for the built-in sounds, redrawn on a canvas from button.css's
// numbers: "floating" (the button and its shadow on nothing) and "filling" (its face filling the
// square, opaque, for platforms that crop icons to a shape of their own)
const ICON_SIZE = 512

async function buttonIcon(hue, kind) {
	const canvas = new OffscreenCanvas(ICON_SIZE, ICON_SIZE)
	const context = canvas.getContext("2d")
	// button.css sizes everything in vmin, a hundredth of the page; the button is 62 of them
	const vmin = ICON_SIZE / 100
	const centre = ICON_SIZE / 2
	if (kind === "floating") drawButton(context, hue, centre, centre - 3.5 * vmin, 1.2 * vmin)
	else drawButton(context, hue, centre, centre, 2.4 * vmin)
	return canvas.convertToBlob({ type: "image/png" })
}

// unit: one of button.css's vmin, at this size
function drawButton(context, hue, x, y, unit) {
	const color = (saturation, lightness, alpha = 1) => `hsl(${hue} ${saturation}% ${lightness}% / ${alpha})`
	const diameter = 62 * unit
	const radius = diameter / 2
	const circle = (centreX, centreY, circleRadius) => {
		context.beginPath()
		context.arc(centreX, centreY, circleRadius, 0, 2 * Math.PI)
	}

	// The rim below the face, casting the drop shadow: box-shadow 0 1.6vmin 0, and 0 3vmin 6vmin
	context.save()
	context.shadowColor = "rgba(0, 0, 0, 0.6)"
	context.shadowBlur = 6 * unit
	context.shadowOffsetY = 1.4 * unit
	circle(x, y + 1.6 * unit, radius)
	context.fillStyle = color(94, 18)
	context.fill()
	context.restore()

	// CSS radial gradients reach from their centre to the box's farthest corner
	const face = context.createRadialGradient(x - 0.12 * diameter, y - 0.18 * diameter, 0, x - 0.12 * diameter, y - 0.18 * diameter, Math.hypot(0.62, 0.68) * diameter)
	face.addColorStop(0, color(100, 68))
	face.addColorStop(0.45, color(83, 46))
	face.addColorStop(1, color(89, 30))
	circle(x, y, radius)
	context.fillStyle = face
	context.fill()
	insetShadow(context, x, y, radius, -1 * unit, 3 * unit, "rgba(0, 0, 0, 0.35)")

	// The knob's dimple at 3 o'clock
	const dotRadius = 0.045 * diameter
	const dotX = x + radius - 0.06 * diameter - dotRadius
	const dimple = context.createRadialGradient(dotX, y + 0.3 * dotRadius, 0, dotX, y + 0.3 * dotRadius, Math.hypot(0.5, 0.65) * 2 * dotRadius)
	dimple.addColorStop(0, color(85, 42))
	dimple.addColorStop(1, color(88, 35))
	circle(dotX, y, dotRadius)
	context.fillStyle = dimple
	context.fill()
	insetShadow(context, dotX, y, dotRadius, 0.5 * unit, 0.8 * unit, color(100, 12, 0.45))
	insetShadow(context, dotX, y, dotRadius, -0.3 * unit, 0.4 * unit, color(100, 70, 0.25))
}

// Like an inset box-shadow: the shadow of everything outside the circle, falling inside it
function insetShadow(context, x, y, radius, offsetY, blur, shadowColor) {
	context.save()
	context.beginPath()
	context.arc(x, y, radius, 0, 2 * Math.PI)
	context.clip()
	context.beginPath()
	context.rect(x - 3 * radius, y - 3 * radius, 6 * radius, 6 * radius)
	context.arc(x, y, radius, 0, 2 * Math.PI)
	context.shadowColor = shadowColor
	context.shadowBlur = blur
	context.shadowOffsetY = offsetY
	context.fill("evenodd")
	context.restore()
}
