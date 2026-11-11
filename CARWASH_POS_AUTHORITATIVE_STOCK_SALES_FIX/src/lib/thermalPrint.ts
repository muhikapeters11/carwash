/**
 * Thermal / ESC-POS receipt helpers.
 * - Always can fall back to window.print().
 * - Web Serial (Chrome) for USB-serial printers when available.
 */

import type { Sale, AppSettings } from '../types';

function line(text: string, width = 32): string {
  return text.slice(0, width);
}

function money(n: number): string {
  return n.toFixed(0);
}

/** Build plain text receipt (also used for browser print). */
export function buildReceiptText(sale: Sale, settings: AppSettings): string {
  const w = 32;
  const rows: string[] = [];
  rows.push(line(settings.pub_name.toUpperCase(), w));
  rows.push(line(`Till: ${settings.till_number}`, w));
  rows.push(line(`Receipt: ${sale.receipt_no}`, w));
  rows.push(line(new Date(sale.created_at).toLocaleString(), w));
  rows.push(line(`Cashier: ${sale.cashier_name || '—'}`, w));
  rows.push('-'.repeat(w));
  for (const it of sale.items) {
    const name =
      it.product_id === '_discount'
        ? it.name
        : `${it.name} x${it.qty}`;
    const amt = money(it.price * it.qty);
    const left = name.slice(0, w - amt.length - 1);
    rows.push(left + ' '.repeat(Math.max(1, w - left.length - amt.length)) + amt);
  }
  rows.push('-'.repeat(w));
  const total = `TOTAL ${settings.currency} ${money(sale.total)}`;
  rows.push(line(total, w));
  rows.push(line(`Payment: ${sale.payment_method}`, w));
  if (sale.creditor_name) rows.push(line(`Credit: ${sale.creditor_name}`, w));
  if (settings.receipt_footer) {
    rows.push('');
    rows.push(line(settings.receipt_footer, w));
  }
  rows.push('');
  rows.push('');
  return rows.join('\n');
}

/** ESC/POS byte sequence (EPSON-compatible subset). */
export function buildEscPosBytes(sale: Sale, settings: AppSettings): Uint8Array {
  const enc = new TextEncoder();
  const chunks: number[] = [];
  const push = (arr: number[] | Uint8Array) => {
    for (const b of arr) chunks.push(b);
  };
  // Init
  push([0x1b, 0x40]);
  // Center
  push([0x1b, 0x61, 0x01]);
  push(enc.encode(settings.pub_name.toUpperCase() + '\n'));
  // Left
  push([0x1b, 0x61, 0x00]);
  push(enc.encode(buildReceiptText(sale, settings) + '\n'));
  // Cut (partial)
  push([0x1d, 0x56, 0x01]);
  return new Uint8Array(chunks);
}

export type PrintResult = { ok: true; mode: 'serial' | 'browser' } | { ok: false; error: string };

/**
 * Try Web Serial ESC/POS; on failure or unsupported, use window.print().
 */
export async function printReceipt(
  sale: Sale,
  settings: AppSettings,
  preferSerial = true
): Promise<PrintResult> {
  if (preferSerial && 'serial' in navigator) {
    try {
      // @ts-expect-error Web Serial
      const port = await navigator.serial.requestPort();
      await port.open({ baudRate: 9600 });
      const writer = port.writable.getWriter();
      const bytes = buildEscPosBytes(sale, settings);
      await writer.write(bytes);
      writer.releaseLock();
      await port.close();
      return { ok: true, mode: 'serial' };
    } catch (e) {
      // user cancelled or no device — fall through
      console.warn('Serial print failed, using browser print', e);
    }
  }

  // Browser / thermal fallback: open a compact receipt window, print, then close
  // so the print popup does not linger after the user confirms print.
  const text = buildReceiptText(sale, settings);
  const win = window.open('', '_blank', 'width=320,height=600');
  if (!win) {
    window.print();
    return { ok: true, mode: 'browser' };
  }
  win.document.write(`
    <html><head><title>Receipt</title>
    <style>
      @page { size: 80mm auto; margin: 2mm; }
      body { font-family: monospace; font-size: 12px; margin: 8px; white-space: pre-wrap; width: 72mm; }
      @media print { body { margin: 0; } }
    </style></head>
    <body>${text.replace(/</g, '&lt;')}</body></html>
  `);
  win.document.close();
  win.focus();
  const closeSoon = () => {
    try { win.close(); } catch { /* ignore */ }
  };
  // Close after the print dialog is dismissed (or after a short fallback timeout).
  if (typeof win.onafterprint === 'object' || 'onafterprint' in win) {
    win.onafterprint = closeSoon;
  }
  setTimeout(closeSoon, 2500);
  try {
    win.print();
  } catch {
    closeSoon();
  }
  return { ok: true, mode: 'browser' };
}
