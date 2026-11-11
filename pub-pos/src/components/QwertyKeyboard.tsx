import React, { useState, useRef, useEffect } from 'react';
import { Delete, CornerDownLeft, Space, ArrowUp, X, Check } from 'lucide-react';
import { usePreferNativeKeyboard } from '../hooks/useIsMobile';

interface Props {
  value: string;
  onChange: (v: string) => void;
  onConfirm?: () => void;
  onCancel?: () => void;
  placeholder?: string;
  title?: string;
}

const ROWS = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm'],
];

export default function QwertyKeyboard({
  value,
  onChange,
  onConfirm,
  onCancel,
  placeholder = '',
  title,
}: Props) {
  const [shift, setShift] = useState(false);
  const preferNative = usePreferNativeKeyboard();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (preferNative && inputRef.current) {
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [preferNative]);

  // —— Phone: system keyboard ——
  if (preferNative) {
    return (
      <div className="fixed inset-0 z-[100] bg-black/70 flex items-end sm:items-center justify-center p-0 sm:p-4">
        <div className="w-full max-w-lg bg-white dark:bg-gray-900 rounded-t-2xl sm:rounded-2xl shadow-2xl p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              {title || 'Enter text'}
            </h2>
            {onCancel && (
              <button
                onClick={onCancel}
                className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300"
              >
                <X size={24} />
              </button>
            )}
          </div>
          <input
            ref={inputRef}
            type="text"
            inputMode="text"
            autoComplete="off"
            autoCorrect="on"
            autoCapitalize="sentences"
            enterKeyHint="done"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onConfirm?.();
              }
              if (e.key === 'Escape') onCancel?.();
            }}
            placeholder={placeholder}
            className="w-full text-xl py-4 px-4 rounded-xl border-2 border-primary-400 bg-gray-50 dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          <div className="flex gap-3">
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                className="flex-1 h-14 rounded-xl bg-gray-200 dark:bg-gray-700 font-semibold active:scale-95"
              >
                Cancel
              </button>
            )}
            {onConfirm && (
              <button
                type="button"
                onClick={onConfirm}
                className="flex-1 h-14 rounded-xl bg-green-600 text-white font-bold flex items-center justify-center gap-2 active:scale-95"
              >
                <Check size={22} /> Done
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // —— Desktop / kiosk: full virtual QWERTY ——
  const handleKey = (key: string) => {
    const char = shift ? key.toUpperCase() : key;
    onChange(value + char);
    if (shift) setShift(false);
  };

  // Physical keyboard while virtual QWERTY is open
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        onConfirm?.();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel?.();
        return;
      }
      if (e.key === 'Backspace') {
        e.preventDefault();
        onChange(value.slice(0, -1));
        return;
      }
      if (e.key === ' ') {
        e.preventDefault();
        onChange(value + ' ');
        return;
      }
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        onChange(value + e.key);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [value, onChange, onConfirm, onCancel]);

  const keyBase =
    'h-[min(12vw,4.5rem)] flex-1 min-w-0 text-[min(5vw,1.5rem)] font-semibold rounded-xl flex items-center justify-center active:scale-95 transition-transform select-none touch-manipulation';

  return (
    <div className="fixed inset-0 z-[100] bg-gray-950 flex flex-col w-screen h-screen">
      <div className="flex items-center justify-between px-4 py-3 bg-gray-900 border-b border-gray-700 shrink-0">
        <h2 className="text-lg md:text-xl font-semibold text-white truncate">{title || 'Keyboard'}</h2>
        {onCancel && (
          <button onClick={onCancel} className="p-3 rounded-xl hover:bg-gray-700 text-white touch-manipulation">
            <X size={28} />
          </button>
        )}
      </div>

      <div className="px-3 py-3 bg-black/50 shrink-0">
        <div className="bg-gray-800 rounded-xl px-4 py-4 text-2xl md:text-3xl min-h-[3.5rem] border border-gray-600 text-white font-mono break-all">
          {value || <span className="text-gray-500">{placeholder}</span>}
        </div>
      </div>

      <div className="flex-1 flex flex-col justify-end p-2 pb-4 gap-1.5 w-full min-h-0">
        {ROWS.map((row, ri) => (
          <div key={ri} className="flex gap-1.5 w-full flex-1 max-h-[4.75rem]">
            {ri === 3 && (
              <button
                onClick={() => setShift(!shift)}
                className={`${keyBase} max-w-[12%] ${shift ? 'bg-blue-600 text-white' : 'bg-gray-700 text-white'}`}
              >
                <ArrowUp size={28} />
              </button>
            )}
            {row.map((k) => (
              <button
                key={k}
                onClick={() => handleKey(k)}
                className={`${keyBase} bg-gray-700 hover:bg-gray-600 text-white`}
              >
                {shift ? k.toUpperCase() : k}
              </button>
            ))}
            {ri === 3 && (
              <button
                onClick={() => onChange(value.slice(0, -1))}
                className={`${keyBase} max-w-[12%] bg-red-700 text-white`}
              >
                <Delete size={28} />
              </button>
            )}
          </div>
        ))}

        <div className="flex gap-1.5 w-full flex-1 max-h-[4.75rem]">
          <button
            onClick={() => onChange(value + ' ')}
            className={`${keyBase} bg-gray-700 text-white flex-[2]`}
          >
            <Space size={26} className="mr-2 shrink-0" /> Space
          </button>
          {onConfirm && (
            <button
              onClick={onConfirm}
              className={`${keyBase} bg-green-600 hover:bg-green-500 text-white flex-[1.2] gap-2`}
            >
              <CornerDownLeft size={26} className="shrink-0" /> Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
