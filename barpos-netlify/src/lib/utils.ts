import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { Product, ProductCategory } from "@/types";
import { SELL_CATEGORY_ORDER } from "@/types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatMoney(cents: number, symbol = "KSh"): string {
  const amount = (cents / 100).toFixed(2);
  return `${symbol} ${Number(amount).toLocaleString("en-KE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Order number: YYYYMMDD + 3-digit daily sequence e.g. 20261005001 */
export function generateSaleNumber(existingSales: { sale_number?: string; created_at?: string }[] = []): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const prefix = `${y}${m}${d}`;
  let maxSeq = 0;
  for (const s of existingSales) {
    const n = s.sale_number || "";
    if (n.startsWith(prefix) && n.length >= prefix.length + 3) {
      const seq = parseInt(n.slice(prefix.length), 10);
      if (!Number.isNaN(seq) && seq > maxSeq) maxSeq = seq;
    }
  }
  const next = maxSeq + 1;
  return `${prefix}${String(next).padStart(3, "0")}`;
}

export function uid(): string {
  return crypto.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function startOfDay(d = new Date()): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function isSameDay(a: string | Date, b: Date = new Date()): boolean {
  const da = typeof a === "string" ? new Date(a) : a;
  return (
    da.getFullYear() === b.getFullYear() &&
    da.getMonth() === b.getMonth() &&
    da.getDate() === b.getDate()
  );
}

/** Business day starts at 09:00 local time and runs 24 hours. */
export const BUSINESS_DAY_START_HOUR = 9;

/** Start of the current business day (today 09:00, or yesterday 09:00 if now is before 09:00). */
export function getBusinessDayStart(now: Date = new Date()): Date {
  const start = new Date(now);
  start.setHours(BUSINESS_DAY_START_HOUR, 0, 0, 0);
  if (now.getTime() < start.getTime()) {
    start.setDate(start.getDate() - 1);
  }
  return start;
}

/** End of current business day (= next 09:00). */
export function getBusinessDayEnd(now: Date = new Date()): Date {
  const end = getBusinessDayStart(now);
  end.setDate(end.getDate() + 1);
  return end;
}

/** Previous business day window [start, end). */
export function getPreviousBusinessDayRange(now: Date = new Date()): { start: Date; end: Date } {
  const end = getBusinessDayStart(now);
  const start = new Date(end);
  start.setDate(start.getDate() - 1);
  return { start, end };
}

export function isInCurrentBusinessDay(iso: string | Date, now: Date = new Date()): boolean {
  const t = typeof iso === "string" ? new Date(iso).getTime() : iso.getTime();
  const start = getBusinessDayStart(now).getTime();
  const end = getBusinessDayEnd(now).getTime();
  return t >= start && t < end;
}

export function isInPreviousBusinessDay(iso: string | Date, now: Date = new Date()): boolean {
  const t = typeof iso === "string" ? new Date(iso).getTime() : iso.getTime();
  const { start, end } = getPreviousBusinessDayRange(now);
  return t >= start.getTime() && t < end.getTime();
}

export function formatBusinessDayLabel(now: Date = new Date()): string {
  const start = getBusinessDayStart(now);
  const end = getBusinessDayEnd(now);
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" };
  return `${start.toLocaleString(undefined, opts)} → ${end.toLocaleString(undefined, opts)}`;
}

/** Group products by category (all categories), SKU ascending */
export function groupProductsByCategory(products: Product[]): { category: ProductCategory; label: string; items: Product[] }[] {
  const labels: Record<string, string> = {
    beer: "Beer",
    spirits: "Spirits",
    soft_drinks: "Soft Drinks",
    wine: "Wine",
    cocktails: "Cocktails",
    food: "Food",
    other: "Other",
  };
  // Prefer sell order first, then any remaining categories present in the catalog
  const order: ProductCategory[] = [
    ...SELL_CATEGORY_ORDER,
    "wine",
    "cocktails",
    "food",
    "other",
  ];
  const seen = new Set<string>();
  const groups: { category: ProductCategory; label: string; items: Product[] }[] = [];
  for (const cat of order) {
    if (seen.has(cat)) continue;
    seen.add(cat);
    const items = products
      .filter((p) => p.category === cat && p.is_active !== false)
      .sort((a, b) => a.sku.localeCompare(b.sku, undefined, { numeric: true }));
    if (items.length) {
      groups.push({ category: cat, label: labels[cat] || cat, items });
    }
  }
  // Catch any unexpected category strings so nothing is hidden
  for (const p of products) {
    if (p.is_active === false) continue;
    const cat = (p.category || "other") as ProductCategory;
    if (seen.has(cat)) continue;
    seen.add(cat);
    const items = products
      .filter((x) => x.category === cat && x.is_active !== false)
      .sort((a, b) => a.sku.localeCompare(b.sku, undefined, { numeric: true }));
    if (items.length) {
      groups.push({ category: cat, label: labels[cat] || String(cat), items });
    }
  }
  return groups;
}
