export type PendingOpType =
  | "sale"
  | "credit_payment"
  | "stock_receive"
  | "stock_audit"
  | "expense"
  | "product_upsert"
  | "product_delete"
  | "expense_delete"
  | "supplier_upsert"
  | "supplier_delete"
  | "product_return"
  | "user_upsert"
  | "user_delete"
  | "settings_upsert";

export interface PendingOp {
  id: string;
  type: PendingOpType;
  payload: unknown;
  created_at: string;
  device_id: string;
  status: "pending" | "syncing" | "failed";
  last_error?: string;
  retries: number;
}

export interface CloudConfig {
  enabled: boolean;
  supabase_url: string;
  supabase_anon_key: string;
  last_sync_at?: string;
  last_sync_error?: string;
}
