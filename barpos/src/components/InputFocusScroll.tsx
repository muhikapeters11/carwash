import { useEffect } from "react";
import { scrollFieldIntoView } from "@/lib/scrollToInput";

/**
 * Global: when any input/textarea is focused or typed into,
 * scroll it into view so the user always sees what they type.
 */
export function InputFocusScroll() {
  useEffect(() => {
    const isField = (t: EventTarget | null): t is HTMLElement =>
      t instanceof HTMLInputElement ||
      t instanceof HTMLTextAreaElement ||
      (t instanceof HTMLElement && t.getAttribute("contenteditable") === "true");

    const onFocusIn = (e: FocusEvent) => {
      if (!isField(e.target)) return;
      e.target.setAttribute("data-kb-active", "true");
      setTimeout(() => scrollFieldIntoView(e.target as HTMLElement), 50);
      setTimeout(() => scrollFieldIntoView(e.target as HTMLElement), 300);
    };

    const onInput = (e: Event) => {
      if (!isField(e.target)) return;
      scrollFieldIntoView(e.target as HTMLElement);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (!isField(e.target)) return;
      // physical keyboard typing
      requestAnimationFrame(() => scrollFieldIntoView(e.target as HTMLElement));
    };

    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("input", onInput, true);
    document.addEventListener("keydown", onKeyDown, true);

    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("input", onInput, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, []);

  return null;
}
