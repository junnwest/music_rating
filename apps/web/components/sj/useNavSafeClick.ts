import { useEffect, useRef } from 'react';

/**
 * Ref for a `<button>` that overlays (or sits inside) a navigating `<Link>`.
 *
 * The problem: a plain React `onClick` is delegated to `document` — the very
 * same node that Next's `<Link>` handler and `nextjs-toploader`'s progress-bar
 * listener live on. Calling `stopPropagation()` from a React handler there is a
 * coin-flip on listener registration order and can't reliably stop those
 * sibling listeners, so clicking the button still fires the top loading gauge
 * (and, absent `preventDefault`, would navigate).
 *
 * The fix: attach a NATIVE `click` listener directly to the button node. It
 * fires at the target, *before* the event bubbles to `document`, so
 * `stopPropagation()` there stops the click from ever reaching Next's router or
 * the toploader — order-independent, guaranteed. The button's own action still
 * runs. Verified against the live toploader: bar never starts, handler still
 * fires.
 */
export function useNavSafeClick<T extends HTMLElement = HTMLButtonElement>(onClick: () => void) {
  const ref = useRef<T>(null);
  const cb = useRef(onClick);
  cb.current = onClick;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handler = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      cb.current();
    };
    el.addEventListener('click', handler);
    return () => el.removeEventListener('click', handler);
  }, []);

  return ref;
}
