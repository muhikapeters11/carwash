/** Keep the active field visible above the virtual keyboard / viewport */

const KEYBOARD_RESERVE_PX = 380; // approx on-screen keyboard height

export function scrollFieldIntoView(el: HTMLElement | null | undefined) {
  if (!el || typeof el.scrollIntoView !== "function") return;

  try {
    el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
  } catch {
    el.scrollIntoView();
  }
  setTimeout(() => {
    try {
      el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    } catch { /* ignore */ }
  }, 280);

  // Extra offset so field sits above fixed virtual keyboard
  requestAnimationFrame(() => {
    const rect = el.getBoundingClientRect();
    const limit = window.innerHeight - KEYBOARD_RESERVE_PX;
    if (rect.bottom > limit || rect.top < 60) {
      const delta = rect.bottom - limit + 24;
      // scroll all scrollable ancestors a bit
      let node: HTMLElement | null = el.parentElement;
      while (node) {
        const style = window.getComputedStyle(node);
        const canScroll =
          /(auto|scroll)/.test(style.overflowY) &&
          node.scrollHeight > node.clientHeight;
        if (canScroll) {
          node.scrollTop += delta;
          break;
        }
        node = node.parentElement;
      }
      if (!node) {
        window.scrollBy({ top: delta, behavior: "smooth" });
      }
    }
  });
}

export function getActiveField(): HTMLElement | null {
  const el = document.activeElement;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return el;
  }
  return document.querySelector<HTMLElement>("[data-kb-active='true']");
}
