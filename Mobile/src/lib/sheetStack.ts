type Listener = (open: boolean) => void;

let count = 0;
const listeners = new Set<Listener>();

function emit(): void {
  const open = count > 0;
  listeners.forEach((l) => l(open));
}

/** Records that an overlay (sheet/modal) is open. */
export function pushOverlay(): void {
  count++;
  emit();
}

/** Records that an overlay closed. */
export function popOverlay(): void {
  count = Math.max(0, count - 1);
  emit();
}

/** Subscription: notifies when at least one overlay is open (to hide
    the dock so it does not cover the sheet's options). */
export function subscribeOverlayOpen(listener: Listener): () => void {
  listeners.add(listener);
  listener(count > 0);
  return () => {
    listeners.delete(listener);
  };
}