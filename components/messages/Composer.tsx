'use client';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';

const HEIGHT_KEY = 'bos-chat-composer-height';
/** Two lines: the height the input starts at. */
export const MIN_HEIGHT = 64;
/** Typing grows the box up to about eight lines; beyond that it scrolls. */
const AUTO_MAX = 190;
const STEP = 24;

/**
 * The composer's height: it grows while typing (up to eight lines), a dragged height is kept per browser,
 * and 放大 opens it over most of the chat for long messages. Returns what the textarea and handle need.
 */
export function useComposerSize(text: string, thread: RefObject<HTMLElement | null>) {
  const input = useRef<HTMLTextAreaElement>(null);
  const [manual, setManual] = useState<number | null>(null);
  const [big, setBig] = useState(false);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ y: number; h: number } | null>(null);

  useEffect(() => {
    try { const saved = Number(localStorage.getItem(HEIGHT_KEY)); if (saved >= MIN_HEIGHT) setManual(saved); } catch { /* storage unavailable: default height */ }
  }, []);
  // Dragging stops a little past half the chat; 放大 takes most of it.
  const limits = useCallback(() => {
    const room = thread.current?.clientHeight ?? 600;
    return { max: Math.max(MIN_HEIGHT, Math.round(room * 0.55)), big: Math.max(MIN_HEIGHT * 2, Math.round(room * 0.62)) };
  }, [thread]);

  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    const { max, big: bigHeight } = limits();
    if (big) { el.style.height = `${bigHeight}px`; return; }
    const floor = Math.min(manual ?? MIN_HEIGHT, max);
    el.style.height = 'auto';
    const content = el.scrollHeight + 2;
    el.style.height = `${Math.min(Math.max(content, floor), Math.max(floor, AUTO_MAX))}px`;
  }, [text, manual, big, limits]);

  const save = (height: number | null) => {
    try { if (height) localStorage.setItem(HEIGHT_KEY, String(height)); else localStorage.removeItem(HEIGHT_KEY); } catch { /* not remembered */ }
  };
  const resize = (height: number) => setManual(Math.round(Math.min(Math.max(height, MIN_HEIGHT), limits().max)));
  const handle = {
    onPointerDown: (e: PointerEvent<HTMLButtonElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { y: e.clientY, h: input.current?.offsetHeight ?? MIN_HEIGHT };
      setBig(false); setDragging(true);
    },
    onPointerMove: (e: PointerEvent<HTMLButtonElement>) => { if (drag.current) resize(drag.current.h + drag.current.y - e.clientY); },
    onPointerUp: () => { drag.current = null; setDragging(false); setManual(h => { save(h); return h; }); },
    onDoubleClick: () => { setManual(null); setBig(false); save(null); },
    onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      const next = Math.round(Math.min(Math.max((manual ?? MIN_HEIGHT) + (e.key === 'ArrowUp' ? STEP : -STEP), MIN_HEIGHT), limits().max));
      setManual(next); save(next);
    },
  };
  return { input, big, setBig, dragging, adjusted: !!manual && manual > MIN_HEIGHT, handle };
}

/** The bar above the composer: drag up for a taller input, down for a shorter one; double-click for the default. */
export function ComposerHandle({ dragging, handle }: { dragging: boolean; handle: ReturnType<typeof useComposerSize>['handle'] }) {
  return <button type="button" className={`bos-chat-resize${dragging ? ' is-dragging' : ''}`} aria-label="拖动调整输入框高度（也可以用上下方向键），双击恢复" title="上下拖动调整高度，双击恢复" {...handle}>
    <span aria-hidden="true" />
  </button>;
}
