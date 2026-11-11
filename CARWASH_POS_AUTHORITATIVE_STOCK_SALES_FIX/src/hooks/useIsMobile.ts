import { useState, useEffect } from 'react';

/** True when viewport is phone-sized or coarse pointer (typical phone). */
export function useIsMobile(breakpointPx = 768) {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth < breakpointPx || (window.matchMedia?.('(pointer: coarse)').matches ?? false);
  });

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpointPx - 1}px)`);
    const coarse = window.matchMedia('(pointer: coarse)');
    const update = () => setIsMobile(mq.matches || coarse.matches);
    update();
    mq.addEventListener('change', update);
    coarse.addEventListener('change', update);
    window.addEventListener('resize', update);
    return () => {
      mq.removeEventListener('change', update);
      coarse.removeEventListener('change', update);
      window.removeEventListener('resize', update);
    };
  }, [breakpointPx]);

  return isMobile;
}

/** Prefer native OS keyboard on phones; keep virtual pads on kiosk/desktop touch. */
export function usePreferNativeKeyboard() {
  const isMobile = useIsMobile();
  // Phones/tablets in portrait or small width → native keyboard
  const [preferNative, setPreferNative] = useState(isMobile);

  useEffect(() => {
    const narrow = window.innerWidth < 900;
    const touch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    // Use native keyboard when it looks like a phone (narrow + touch), not large POS tablets
    setPreferNative(narrow && touch && window.innerWidth < 768);
  }, [isMobile]);

  return preferNative;
}
