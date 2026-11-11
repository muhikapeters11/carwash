import React, { useRef, useEffect } from 'react';
import { Check, X } from 'lucide-react';
import NumericPad from './NumericPad';
import QwertyKeyboard from './QwertyKeyboard';
import { usePreferNativeKeyboard } from '../hooks/useIsMobile';

interface BaseProps {
  value: string;
  onChange: (v: string) => void;
  onConfirm?: () => void;
  onCancel?: () => void;
  title?: string;
  /** When true, always show virtual pad (e.g. login PIN on kiosk). */
  forceVirtual?: boolean;
}

interface NumericProps extends BaseProps {
  mode: 'numeric';
  allowDecimal?: boolean;
  maxLength?: number;
  large?: boolean;
}

interface TextProps extends BaseProps {
  mode: 'text';
  placeholder?: string;
}

type Props = NumericProps | TextProps;

/**
 * On phones: uses the device keyboard (inputMode numeric / text).
 * On desktop / large touch screens: uses the app's virtual NumericPad / QWERTY.
 */
export default function NativeField(props: Props) {
  const preferNative = usePreferNativeKeyboard();
  const useNative = preferNative && !props.forceVirtual;
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (useNative && inputRef.current) {
      // Focus so the mobile keyboard opens immediately
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [useNative]);

  if (!useNative) {
    if (props.mode === 'numeric') {
      return (
        <NumericPad
          value={props.value}
          onChange={props.onChange}
          onConfirm={props.onConfirm}
          allowDecimal={props.allowDecimal}
          maxLength={props.maxLength}
          large={props.large}
        />
      );
    }
    return (
      <QwertyKeyboard
        value={props.value}
        onChange={props.onChange}
        onConfirm={props.onConfirm}
        onCancel={props.onCancel}
        title={props.title}
      />
    );
  }

  // —— Native mobile keyboard path ——
  const isNumeric = props.mode === 'numeric';

  return (
    <div className="w-full max-w-md mx-auto p-4 space-y-4">
      {props.title && (
        <h3 className="text-lg font-semibold text-center text-gray-800 dark:text-gray-100">
          {props.title}
        </h3>
      )}
      <input
        ref={inputRef}
        type={isNumeric ? 'text' : 'text'}
        inputMode={isNumeric ? (props.allowDecimal === false ? 'numeric' : 'decimal') : 'text'}
        pattern={isNumeric ? (props.allowDecimal === false ? '[0-9]*' : '[0-9]*[.,]?[0-9]*') : undefined}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize={isNumeric ? 'off' : 'sentences'}
        enterKeyHint="done"
        value={props.value}
        onChange={(e) => {
          let v = e.target.value;
          if (isNumeric) {
            v = v.replace(/,/g, '.');
            if (props.allowDecimal === false) v = v.replace(/[^0-9]/g, '');
            else v = v.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
            if (props.maxLength && v.length > props.maxLength) v = v.slice(0, props.maxLength);
          }
          props.onChange(v);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            props.onConfirm?.();
          }
          if (e.key === 'Escape') props.onCancel?.();
        }}
        placeholder={
          isNumeric
            ? props.allowDecimal === false
              ? '0'
              : '0.00'
            : (props as TextProps).placeholder || ''
        }
        className="w-full text-2xl font-mono text-center py-4 px-4 rounded-2xl border-2 border-primary-400 bg-white dark:bg-gray-800 dark:text-white shadow-inner focus:outline-none focus:ring-2 focus:ring-primary-500"
      />
      <div className="flex gap-3">
        {props.onCancel && (
          <button
            type="button"
            onClick={props.onCancel}
            className="flex-1 h-14 rounded-xl bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-100 font-semibold flex items-center justify-center gap-2 active:scale-95"
          >
            <X size={22} /> Cancel
          </button>
        )}
        {props.onConfirm && (
          <button
            type="button"
            onClick={props.onConfirm}
            className="flex-1 h-14 rounded-xl bg-green-600 text-white font-bold flex items-center justify-center gap-2 active:scale-95"
          >
            <Check size={22} /> Confirm
          </button>
        )}
      </div>
    </div>
  );
}
