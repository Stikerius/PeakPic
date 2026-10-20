/**
 * Where a point of an edited photo (stored relative to its canvas, 0–1) ends up on screen
 * when the photo is shown with contentFit "cover" in a view of another size.
 */
export function coverPoint(
  relative: { x: number; y: number },
  imageAspect: number,
  view: { width: number; height: number },
): { x: number; y: number } {
  const viewAspect = view.width / view.height;
  // Cover: the image fills the view, the overflowing side is cropped evenly.
  const shownWidth = viewAspect > imageAspect ? view.width : view.height * imageAspect;
  const shownHeight = viewAspect > imageAspect ? view.width / imageAspect : view.height;
  return {
    x: (view.width - shownWidth) / 2 + relative.x * shownWidth,
    y: (view.height - shownHeight) / 2 + relative.y * shownHeight,
  };
}

/**
 * Tap area for an "@username" label drawn on a photo, centred on its stored position.
 * Sizes follow the editor's label (bold 24 pt on a ~400 pt wide canvas) and are generous.
 */
export function mentionTapBox(
  center: { x: number; y: number },
  username: string,
  shownWidth: number,
): { left: number; top: number; width: number; height: number } {
  const scale = shownWidth / 400;
  const width = ((username.length + 1) * 14 + 28) * scale;
  const height = 44 * scale;
  return { left: center.x - width / 2, top: center.y - height / 2, width, height };
}
