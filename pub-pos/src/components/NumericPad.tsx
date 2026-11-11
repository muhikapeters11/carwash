import React, { useRef, useEffect } from 'react';
import { Delete, Check } from 'lucide-react';
import { usePreferNativeKeyboard } from '../hooks/useIsMobile';

interface Props {
  value: string;
  onChange: (v: string) => void;
  onConfirm?: () => void;
  maxLength?: number;
  allowDecimal?: boolean;
  className?: string;
  large?: boolean;
}

export default function NumericPad({
  value,
  onChange,
  onConfirm,
  maxLength = 12,
  allowDecimal = true,
  className = '',
  large = false,
}: Props) {
  const preferNative = usePreferNativeKeyboard();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (preferNative && inputRef.current) {
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [preferNative]);

  // —— Phone: system numeric keyboard ——
  if (preferNative) {
    return (
      <div className={`select-none space-y-3 ${className}`}>
        <input
          ref={inputRef}
          type="text"
          inputMode={allowDecimal ? 'decimal' : 'numeric'}
          pattern={allowDecimal ? '[0-9]*[.,]?[0-9]*' : '[0-9]*'}
          autoComplete="off"
          enterKeyHint="done"
          value={value}
          onChange={(e) => {
            let v = e.target.value.replace(/,/g, '.');
            if (!allowDecimal) v = v.replace(/[^0-9]/g, '');
            else v = v.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
            if (v.length > maxLength) v = v.slice(0, maxLength);
            onChange(v);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onConfirm?.();
            }
          }}
          placeholder="0"
          className="w-full text-3xl font-mono text-right py-4 px-4 rounded-xl bg-gray-900 text-white border border-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
        {onConfirm && (
          <button
            onClick={onConfirm}
            className="w-full h-14 bg-green-600 hover:bg-green-500 text-white text-xl font-bold rounded-xl flex items-center justify-center gap-2 active:scale-95"
          >
            <Check size={24} /> Confirm
          </button>
        )}
      </div>
    );
  }

  // —— Desktop / kiosk: virtual pad ——
  const keys = [
    ['1', '2', '3'],
    ['4', '5', '6'],
    ['7', '8', '9'],
    [allowDecimal ? '.' : '', '0', 'back'],
  ];

  const handleKey = (key: string) => {
    if (key === 'back') {
      onChange(value.slice(0, -1));
      return;
    }
    if (key === '.' && (value.includes('.') || !allowDecimal)) return;
    if (value.length >= maxLength) return;
    onChange(value + key);
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (e.key >= '0' && e.key <= '9') {
        e.preventDefault();
        handleKey(e.key);
      } else if (e.key === '.' || e.key === ',') {
        if (allowDecimal) {
          e.preventDefault();
          handleKey('.');
        }
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        handleKey('back');
      } else if (e.key === 'Enter') {
        e.preventDefault();
        onConfirm?.();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [value, maxLength, allowDecimal, onConfirm]);

  const btnClass = large
    ? 'h-16 text-2xl font-semibold rounded-xl active:scale-95 transition-transform'
    : 'h-14 text-xl font-semibold rounded-lg active:scale-95 transition-transform';

  return (
    <div className={`select-none ${className}`}>
      <div className="bg-gray-900 text-white text-right text-3xl font-mono p-4 rounded-t-xl min-h-[60px] flex items-center justify-end tracking-widest">
        {value || '0'}
      </div>
      <div className="grid grid-cols-3 gap-2 p-2 bg-gray-800 rounded-b-xl">
        {keys.flat().map((k, i) => {
          if (k === '') return <div key={i} />;
          if (k === 'back') {
            return (
              <button
                key={i}
                onClick={() => handleKey('back')}
                className={`${btnClass} bg-red-600 hover:bg-red-500 text-white flex items-center justify-center`}
              >
                <Delete size={large ? 28 : 22} />
              </button>
            );
          }
          return (
            <button
              key={i}
              onClick={() => handleKey(k)}
              className={`${btnClass} bg-gray-700 hover:bg-gray-600 text-white`}
            >
              {k}
            </button>
          );
        })}
      </div>
      {onConfirm && (
        <button
          onClick={onConfirm}
          className="mt-2 w-full h-14 bg-green-600 hover:bg-green-500 text-white text-xl font-bold rounded-xl flex items-center justify-center gap-2"
        >
          <Check size={24} /> Confirm
        </button>
      )}
    </div>
  );
}
