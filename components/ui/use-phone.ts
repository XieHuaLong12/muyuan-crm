'use client';
import { useSyncExternalStore } from 'react';

/** The width up to which the phone layout applies; the same breakpoint as app/mobile-shell.css. */
const PHONE = '(max-width: 760px)';

/**
 * True on a phone-sized screen. Lists use it to render cards instead of a wide table there, so only one of the two is
 * in the page. The server (and the first client render) answers false; use it for content that loads in the browser.
 */
export function usePhone() {
  return useSyncExternalStore(
    onChange => { const media = window.matchMedia(PHONE); media.addEventListener('change', onChange); return () => media.removeEventListener('change', onChange); },
    () => window.matchMedia(PHONE).matches,
    () => false,
  );
}
