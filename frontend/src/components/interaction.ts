export const CLICK_DRAG_THRESHOLD = 2

export function isDrag(event: { delta: number }): boolean {
  return event.delta > CLICK_DRAG_THRESHOLD
}
