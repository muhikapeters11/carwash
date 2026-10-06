/** Keep the active field visible above the real virtual keyboard / viewport. */

const FALLBACK_KEYBOARD_RESERVE_PX = 380;

function getKeyboardHeight() {
  const keyboard = document.querySelector<HTMLElement>("[data-virtual-keyboard=\"true\"]");
  if (keyboard) return Math.max(260, keyboard.getBoundingClientRect().height);
  return FALLBACK_KEYBOARD_RESERVE_PX;
}

export function scrollFieldIntoView(el: HTMLElement | null | undefined) {
  if (!el || typeof el.getBoundingClientRect !== "function") return;
  const keyboardHeight = getKeyboardHeight();
  const bottomLimit = Math.max(80, window.innerHeight - keyboardHeight - 24);

  const move = () => {
    const rect = el.getBoundingClientRect();
    if (rect.bottom > bottomLimit) {
      const delta = rect.bottom - bottomLimit;
      const scroller = findScrollableAncestor(el);
      if (scroller) scroller.scrollTop += delta;
      else window.scrollBy({ top: delta, behavior: "smooth" });
    } else if (rect.top < 64) {
      const delta = rect.top - 64;
      const scroller = findScrollableAncestor(el);
      if (scroller) scroller.scrollTop += delta;
      else window.scrollBy({ top: delta, behavior: "smooth" });
    }
  };

  try {
    el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
  } catch {
    el.scrollIntoView();
  }
  requestAnimationFrame(move);
  window.setTimeout(move, 80);
  window.setTimeout(move, 220);
  window.setTimeout(move, 420);
}

function findScrollableAncestor(el: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = el.parentElement;
  while (node) {
    const style = window.getComputedStyle(node);
    const canScroll = /(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight;
    if (canScroll) return node;
    node = node.parentElement;
  }
  return null;
}

export function getActiveField(): HTMLElement | null {
  const el = document.activeElement;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el;
  return document.querySelector<HTMLElement>("[data-kb-active='true']");
}
