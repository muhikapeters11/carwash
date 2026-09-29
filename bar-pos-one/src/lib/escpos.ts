/**
 * ESC/POS helpers for future Tauri thermal printer plugin.
 * Browser path still uses window.print() + CSS mm width.
 */
import type { Sale } from "@/types";
import type { AppSettings } from "@/types";

export function buildEscPosText(sale: Sale, settings: AppSettings): string {
  const w = settings.thermal_width_mm === 58 ? 32 : 42;
  const line = (s: string) => s.slice(0, w);
  const center = (s: string) => {
    const pad = Math.max(0, Math.floor((w - s.length) / 2));
    return " ".repeat(pad) + s;
  };
  const rows: string[] = [];
  rows.push(center(settings.business_name || "Bar"));
  if (settings.till_number) rows.push(center(`Till: ${settings.till_number}`));
  rows.push(center(new Date(sale.created_at).toLocaleString()));
  rows.push(center(`By: ${sale.cashier_name}`));
  rows.push("-".repeat(w));
  for (const i of sale.items) {
    rows.push(line(`${i.quantity}x ${i.product_name}`));
    rows.push(line(`  ${(i.line_total / 100).toFixed(2)}`));
  }
  rows.push("-".repeat(w));
  rows.push(line(`TOTAL  ${(sale.total / 100).toFixed(2)}`));
  rows.push(line(`${sale.payment_method}`));
  rows.push("");
  rows.push(center(settings.receipt_footer || "Thank you!"));
  rows.push("\n\n\n");
  return rows.join("\n");
}

/** Placeholder: send bytes via Tauri plugin when packaged */
export async function printEscPos(_data: string): Promise<{ ok: boolean; message: string }> {
  return {
    ok: false,
    message: "ESC/POS USB print requires Tauri desktop build + printer plugin. Use Print (browser) for now.",
  };
}
