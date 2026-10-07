import { useEffect, useState, useRef } from "react";
import { cn } from "@/lib/utils";
import { scrollFieldIntoView, getActiveField } from "@/lib/scrollToInput";

type Mode = "alpha" | "numeric";

interface Props {
  open: boolean;
  mode: Mode;
  onInput: (char: string) => void;
  onBackspace: () => void;
  onClose: () => void;
  onEnter?: () => void;
}

const ALPHA_ROWS = [
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
  ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
  ["A", "S", "D", "F", "G", "H", "J", "K", "L"],
  ["Z", "X", "C", "V", "B", "N", "M", ".", "-", "/"],
];

const NUM_ROWS = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  [".", "0", "⌫"],
];

export function VirtualKeyboard({ open, mode, onInput, onBackspace, onClose, onEnter }: Props) {
  const [shift, setShift] = useState(true);

  useEffect(() => {
    if (!open) {
      setShift(true);
      document.body.classList.remove("kb-open");
      return;
    }
    document.body.classList.add("kb-open");
    const t = window.setTimeout(() => scrollFieldIntoView(getActiveField()), 50);
    const t2 = window.setTimeout(() => scrollFieldIntoView(getActiveField()), 320);
    return () => {
      window.clearTimeout(t);
      window.clearTimeout(t2);
      document.body.classList.remove("kb-open");
    };
  }, [open]);

  if (!open) return null;

  const press = (k: string) => {
    if (k === "⌫") onBackspace();
    else onInput(mode === "numeric" ? k : shift ? k : k.toLowerCase());
  };

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-[80] bg-slate-900 border-t border-slate-700 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-2xl"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between mb-2 px-1">
        <span className="text-slate-400 text-xs font-semibold uppercase tracking-wide">
          {mode === "numeric" ? "Number pad" : "Keyboard"}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="text-lg font-bold text-white px-6 py-3 rounded-2xl bg-slate-700 active:bg-slate-600 min-h-[52px]"
        >
          Close
        </button>
      </div>

      {mode === "numeric" ? (
        <div className="grid grid-cols-3 gap-3 max-w-lg mx-auto">
          {NUM_ROWS.flat().map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => press(k)}
              className="h-20 min-h-[80px] rounded-2xl bg-slate-700 text-white text-4xl font-bold active:bg-amber-500 touch-manipulation"
            >
              {k}
            </button>
          ))}
        </div>
      ) : (
        <div className="space-y-2.5">
          {ALPHA_ROWS.map((row, i) => (
            <div key={i} className="flex justify-center gap-2">
              {row.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => press(k)}
                  className="min-w-[3rem] flex-1 max-w-[4rem] h-16 min-h-[64px] rounded-2xl bg-slate-700 text-white text-2xl font-bold active:bg-amber-500 touch-manipulation"
                >
                  {shift ? k : k.toLowerCase()}
                </button>
              ))}
            </div>
          ))}
          <div className="flex gap-2 justify-center pt-2">
            <button
              type="button"
              onClick={() => setShift((s) => !s)}
              className={cn(
                "px-6 h-16 min-h-[64px] rounded-2xl text-xl font-bold",
                shift ? "bg-amber-500 text-white" : "bg-slate-700 text-white"
              )}
            >
              ABC
            </button>
            <button
              type="button"
              onClick={() => {
                onInput(" ");
                requestAnimationFrame(() => scrollFieldIntoView(getActiveField()));
              }}
              className="flex-1 max-w-md h-16 min-h-[64px] rounded-2xl bg-slate-700 text-white text-xl font-bold"
            >
              Space
            </button>
            <button
              type="button"
              onClick={() => {
                onBackspace();
                requestAnimationFrame(() => scrollFieldIntoView(getActiveField()));
              }}
              className="px-6 h-16 min-h-[64px] rounded-2xl bg-slate-700 text-white text-3xl font-bold"
            >
              ⌫
            </button>
            {onEnter && (
              <button
                type="button"
                onClick={onEnter}
                className="px-8 h-16 min-h-[64px] rounded-2xl bg-amber-500 text-white text-xl font-bold"
              >
                OK
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

type Target = {
  value: string;
  setValue: (v: string) => void;
  el?: HTMLElement | null;
};

/** Touch-friendly keyboard; switching fields works on first tap */
export function useVirtualKeyboard() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("alpha");
  const [target, setTarget] = useState<Target | null>(null);
  const targetRef = useRef<Target | null>(null);

  const openFor = (
    value: string,
    setValue: (v: string) => void,
    keyboardMode: Mode = "alpha",
    el?: HTMLElement | null
  ) => {
    document.querySelectorAll("[data-kb-active]").forEach((n) => {
      n.removeAttribute("data-kb-active");
    });
    const field =
      el ||
      (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    if (field) {
      field.setAttribute("data-kb-active", "true");
      scrollFieldIntoView(field);
    }
    const next: Target = { value: value ?? "", setValue, el: field };
    targetRef.current = next;
    setTarget(next);
    setMode(keyboardMode);
    setOpen(true);
    setTimeout(() => scrollFieldIntoView(field), 80);
    setTimeout(() => scrollFieldIntoView(field), 350);
  };

  const onInput = (ch: string) => {
    const t = targetRef.current;
    if (!t) return;
    const nextVal = t.value + ch;
    t.value = nextVal;
    t.setValue(nextVal);
    targetRef.current = { ...t, value: nextVal };
    setTarget({ ...t, value: nextVal });
    requestAnimationFrame(() => scrollFieldIntoView(t.el || getActiveField()));
  };

  const onBackspace = () => {
    const t = targetRef.current;
    if (!t) return;
    const nextVal = t.value.slice(0, -1);
    t.value = nextVal;
    t.setValue(nextVal);
    targetRef.current = { ...t, value: nextVal };
    setTarget({ ...t, value: nextVal });
  };

  const close = () => {
    setOpen(false);
    targetRef.current = null;
    setTarget(null);
    document.querySelectorAll("[data-kb-active]").forEach((n) => {
      n.removeAttribute("data-kb-active");
    });
  };

  return {
    open,
    mode,
    openFor,
    close,
    onInput,
    onBackspace,
    Keyboard: (
      <VirtualKeyboard
        open={open}
        mode={mode}
        onInput={onInput}
        onBackspace={onBackspace}
        onClose={close}
      />
    ),
  };
}

/** Single-tap field helper for modals */
export function bindKbField(
  kb: ReturnType<typeof useVirtualKeyboard>,
  value: string,
  setValue: (v: string) => void,
  mode: Mode = "numeric"
) {
  return {
    readOnly: true as const,
    value,
    onPointerDown: (e: { preventDefault: () => void; stopPropagation: () => void; currentTarget: HTMLInputElement }) => {
      e.preventDefault();
      e.stopPropagation();
      kb.openFor(value, setValue, mode, e.currentTarget);
    },
  };
}
