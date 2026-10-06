/** Bar POS – full domain types */

export type UserRole = "admin" | "manager" | "accountant" | "cashier";

export type AppTab =
  | "dashboard"
  | "sell"
  | "inventory"
  | "receive_stock"
  | "expenses"
  | "credits"
  | "products"
  | "reports"
  | "suppliers"
  | "users"
  | "activity_log"
  | "settings";

export const ALL_TABS: AppTab[] = [
  "dashboard",
  "sell",
  "inventory",
  "receive_stock",
  "expenses",
  "credits",
  "products",
  "reports",
  "suppliers",
  "users",
  "activity_log",
  "settings",
];

export const TAB_LABELS: Record<AppTab, string> = {
  dashboard: "Dashboard",
  sell: "Sell",
  inventory: "Inventory",
  receive_stock: "Receive Stock",
  expenses: "Expenses",
  credits: "Credits",
  products: "Products",
  reports: "Reports",
  suppliers: "Suppliers",
  users: "Users",
  activity_log: "Activity Log",
  settings: "Backup & Settings",
};

/** Category order required by business: beer → spirits → soft drinks */
export type ProductCategory = "beer" | "spirits" | "soft_drinks" | "wine" | "cocktails" | "food" | "other";

export const SELL_CATEGORY_ORDER: ProductCategory[] = ["beer", "spirits", "soft_drinks"];

export interface User {
  id: string;
  full_name: string;
  username: string;
  role: UserRole;
  pin: string;
  allowed_tabs: AppTab[];
  is_active: boolean;
  created_at: string;
  updated_at?: string;
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  category: ProductCategory;
  price: number; // cents – sell price per sell unit (e.g. per cup)
  cost: number; // unit cost per sell unit in cents
  stock_quantity: number; // always in sell units (e.g. cups)
  /** How many sell-units in one receive pack (e.g. 100 cups per barrel). Default 1. */
  units_per_pack: number;
  /** Label for receive unit e.g. "barrel", "crate", "bottle" */
  pack_label?: string;
  image_url?: string;
  /** Alert when stock_quantity <= this (0 = no alert) */
  min_stock: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CartItem {
  id: string;
  product_id: string;
  product_name: string;
  sku: string;
  quantity: number;
  unit_price: number;
  line_total: number;
}

export type PaymentMethod = "cash" | "mpesa" | "card" | "credit";

export interface Sale {
  id: string;
  sale_number: string;
  items: CartItem[];
  subtotal: number;
  total: number;
  payment_method: PaymentMethod;
  amount_paid: number;
  change_given: number;
  credit_customer_name?: string;
  credit_id?: string;
  cashier_id: string;
  cashier_name: string;
  status: "completed" | "held" | "voided";
  is_credit_payment?: boolean; // true when settling an old credit
  created_at: string;
  device_id: string;
}

export interface Credit {
  id: string;
  sale_id: string;
  customer_name: string;
  original_amount: number;
  amount_paid: number;
  balance: number;
  cashier_id: string;
  cashier_name: string;
  created_at: string;
  updated_at: string;
  fully_paid_at?: string;
  payments: { amount: number; method: PaymentMethod; paid_at: string; recorded_by: string }[];
}

export interface Expense {
  id: string;
  description: string;
  amount: number;
  category?: string;
  recorded_by: string;
  recorded_by_name: string;
  created_at: string;
}

export interface Supplier {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  notes?: string;
  created_at: string;
}

export interface StockReceive {
  id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  total_cost: number;
  unit_cost: number;
  supplier_id?: string;
  supplier_name?: string;
  receipt_no?: string;
  received_by: string;
  received_by_name: string;
  created_at: string;
  seen_by_admin: boolean;
}

export interface StockAudit {
  id: string;
  product_id: string;
  product_name: string;
  previous_qty: number;
  new_qty: number;
  difference: number;
  audited_by: string;
  audited_by_name: string;
  note?: string;
  created_at: string;
  seen_by_admin: boolean;
}

export interface ActivityLog {
  id: string;
  user_id: string;
  user_name: string;
  action: string;
  details?: string;
  created_at: string;
}

export interface AppSettings {
  business_name: string;
  business_phone: string;
  business_address: string;
  business_location: string;
  receipt_footer: string;
  thermal_width_mm: number; // 58 or 80
  currency_symbol: string;
  date_format: string;
  theme: "light" | "dark";
  logo_url?: string;
  till_number: string;
  /** Device-local preferred printer name (not synced to cloud) */
  preferred_printer?: string;
  auto_print_receipt?: boolean;
  /**
   * till = only this device sells / changes stock (recommended: one per bar)
   * monitor = view sales, reports, inventory; no stock-changing sales
   */
  device_mode: "till" | "monitor";
}

export interface SessionUser {
  id: string;
  full_name: string;
  role: UserRole;
  allowed_tabs: AppTab[];
}
