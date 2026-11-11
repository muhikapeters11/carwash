export type UserRole = 'admin' | 'cashier';

export type Category = 'beer' | 'spirits' | 'soft_drinks';

export interface Product {
  id: string;
  sku: string;
  name: string;
  category: Category;
  price: number;
  cost: number;
  stock: number;
  low_stock_threshold: number;
  image_url?: string;
  is_barrel: boolean;
  barrel_cups?: number;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface CartItem {
  product: Product;
  quantity: number;
}

export interface Sale {
  id: string;
  items: { product_id: string; name: string; qty: number; price: number; cost: number }[];
  total: number;
  cost_total: number;
  payment_method: 'cash' | 'credit' | 'credit_collection';
  creditor_name?: string;
  cashier_id: string;
  cashier_name?: string;
  created_at: string;
  receipt_no: string;
  /** true when this sale row is a credit repayment, not product sales */
  is_credit_collection?: boolean;
}

export interface HeldSale {
  id: string;
  items: CartItem[];
  customer_name: string;
  created_at: string;
  expires_at: string;
}

export interface Credit {
  id: string;
  customer_name: string;
  amount: number;
  paid_amount: number;
  remaining: number;
  sale_id: string;
  created_at: string;
  payments: CreditPayment[];
}

export interface CreditPayment {
  id: string;
  credit_id: string;
  amount: number;
  paid_at: string;
  recorded_by: string;
}

export type ExpenseCategory =
  | 'utilities'
  | 'wages'
  | 'stock'
  | 'rent'
  | 'transport'
  | 'misc';

export interface Expense {
  id: string;
  description: string;
  amount: number;
  category?: ExpenseCategory;
  note?: string;
  created_by: string;
  created_at: string;
}

export interface StockReceive {
  id: string;
  product_id: string;
  product_name: string;
  quantity: number; // units/cups added
  barrels?: number;
  unit_cost: number;
  total_cost: number;
  receipt_no?: string;
  supplier?: string;
  received_by: string;
  received_by_name?: string;
  created_at: string;
}

export interface ActivityLogEntry {
  id: string;
  user_id: string;
  user_name: string;
  action: string;
  details?: string;
  created_at: string;
}

export interface Notification {
  id: string;
  title: string;
  message: string;
  type: 'stock' | 'audit' | 'receive' | 'sale' | 'system';
  is_read: boolean;
  created_at: string;
  related_id?: string;
}

export interface AppSettings {
  pub_name: string;
  logo_url?: string;
  login_bg_url?: string;
  till_number: string;
  receipt_footer: string;
  currency: string;
  factory_reset_at?: string;
  /** Local hour (0–23) when the business day starts. Default 9. */
  business_day_hour?: number;
  /** Show product cost on thermal/browser receipts */
  receipt_show_cost?: boolean;
}

export interface UserProfile {
  id: string;
  email: string;
  /** @deprecated plain PIN — do not persist; prefer pin_hash */
  pin?: string;
  pin_hash?: string;
  role: UserRole;
  full_name: string;
  permissions: string[];
  is_active: boolean;
}

export type TabId =
  | 'dashboard'
  | 'sell'
  | 'receive'
  | 'products'
  | 'inventory'
  | 'credit'
  | 'expenses'
  | 'reports'
  | 'users'
  | 'activity'
  | 'settings';
