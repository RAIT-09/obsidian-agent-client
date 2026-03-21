/**
 * Clamp position so the floating window stays within the viewport.
 */
export function clampPosition(
	x: number,
	y: number,
	width: number,
	height: number,
): { x: number; y: number } {
	return {
		x: Math.max(0, Math.min(x, window.innerWidth - width)),
		y: Math.max(0, Math.min(y, window.innerHeight - height)),
	};
}
