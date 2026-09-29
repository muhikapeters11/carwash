import type { CloudConfig, PendingOp } from "@/types/sync";
import { supabaseUpsert } from "@/lib/supabase";
import type { Product, Sale, Expense, StockReceive, StockAudit, Supplier, User } from "@/types";
import { toPushFailure, type PushResult } from "@/lib/sync/errors";

function stripUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

type Handler = (cfg: CloudConfig, op: PendingOp) => Promise<PushResult>;

async function upsert(
  cfg: CloudConfig,
  table: string,
  body: Record<string, unknown>
): Promise<PushResult> {
  const r = await supabaseUpsert(cfg, table, body);
  if (r.error) return toPushFailure(r.error, r.status);
  return { ok: true, status: r.status };
}

const handlers: Record<string, Handler> = {
  sale: async (cfg, op) => {
    const sale = op.payload as Sale;
    return upsert(
      cfg,
      "sales",
      stripUndefined({
        id: sale.id,
        sale_number: sale.sale_number,
        items: sale.items,
        subtotal: sale.subtotal,
        total: sale.total,
        payment_method: sale.payment_method,
        amount_paid: sale.amount_paid,
        change_given: sale.change_given,
        credit_customer_name: sale.credit_customer_name ?? null,
        credit_id: sale.credit_id ?? null,
        cashier_id: sale.cashier_id,
        cashier_name: sale.cashier_name,
        status: sale.status,
        is_credit_payment: sale.is_credit_payment ?? false,
        created_at: sale.created_at,
        device_id: sale.device_id || op.device_id,
      })
    );
  },

  stock_receive: async (cfg, op) => {
    const rec = op.payload as StockReceive;
    return upsert(
      cfg,
      "stock_receives",
      stripUndefined({
        id: rec.id,
        product_id: rec.product_id,
        product_name: rec.product_name,
        quantity: rec.quantity,
        total_cost: rec.total_cost,
        unit_cost: rec.unit_cost,
        supplier_name: rec.supplier_name ?? null,
        receipt_no: rec.receipt_no ?? null,
        received_by: rec.received_by,
        received_by_name: rec.received_by_name,
        created_at: rec.created_at,
        seen_by_admin: rec.seen_by_admin ?? false,
      })
    );
  },

  stock_audit: async (cfg, op) => {
    const a = op.payload as StockAudit;
    return upsert(
      cfg,
      "stock_audits",
      stripUndefined({
        id: a.id,
        product_id: a.product_id,
        product_name: a.product_name,
        previous_qty: a.previous_qty,
        new_qty: a.new_qty,
        difference: a.difference,
        audited_by: a.audited_by,
        audited_by_name: a.audited_by_name,
        note: a.note ?? null,
        created_at: a.created_at,
        seen_by_admin: a.seen_by_admin ?? false,
      })
    );
  },

  credit_payment: async (cfg, op) => {
    const payload = op.payload as Record<string, unknown>;
    const id = String(payload.id || op.id);
    return upsert(cfg, "credit_events", {
      id,
      payload,
      created_at: (payload.at as string) || op.created_at,
    });
  },

  expense: async (cfg, op) => {
    const e = op.payload as Expense;
    return upsert(
      cfg,
      "expenses",
      stripUndefined({
        id: e.id,
        description: e.description,
        amount: e.amount,
        category: e.category ?? null,
        recorded_by: e.recorded_by,
        recorded_by_name: e.recorded_by_name,
        created_at: e.created_at,
      })
    );
  },

  product_upsert: async (cfg, op) => {
    const p = op.payload as Product;
    return upsert(
      cfg,
      "products",
      stripUndefined({
        id: p.id,
        sku: p.sku,
        name: p.name,
        category: p.category,
        price: p.price,
        cost: p.cost,
        stock_quantity: p.stock_quantity,
        units_per_pack: p.units_per_pack ?? 1,
        pack_label: p.pack_label ?? null,
        min_stock: p.min_stock ?? 0,
        image_url: p.image_url ?? null,
        is_active: p.is_active !== false,
        updated_at: p.updated_at || new Date().toISOString(),
      })
    );
  },

  settings_upsert: async (cfg, op) => {
    const s = op.payload as Record<string, unknown>;
    return upsert(
      cfg,
      "app_settings",
      stripUndefined({
        id: "app",
        payload: s,
        updated_at: new Date().toISOString(),
      })
    );
  },

  user_upsert: async (cfg, op) => {
    const u = op.payload as User;
    return upsert(
      cfg,
      "users",
      stripUndefined({
        id: u.id,
        full_name: u.full_name,
        username: u.username,
        role: u.role,
        pin: u.pin,
        allowed_tabs: u.allowed_tabs || [],
        is_active: u.is_active !== false,
        created_at: u.created_at,
        updated_at: (u as User & { updated_at?: string }).updated_at || new Date().toISOString(),
      })
    );
  },

  user_delete: async (cfg, op) => {
    const payload = op.payload as { id: string };
    const { supabaseRest } = await import("@/lib/supabase");
    const r = await supabaseRest(cfg, "users", {
      method: "DELETE",
      query: `id=eq.${encodeURIComponent(payload.id)}`,
      prefer: "return=minimal",
    });
    if (r.error) {
      const { toPushFailure } = await import("@/lib/sync/errors");
      return toPushFailure(r.error, r.status);
    }
    return { ok: true, status: r.status };
  },

  supplier_upsert: async (cfg, op) => {
    const s = op.payload as Supplier;
    return upsert(
      cfg,
      "suppliers",
      stripUndefined({
        id: s.id,
        name: s.name,
        phone: s.phone ?? null,
        email: s.email ?? null,
        notes: s.notes ?? null,
        created_at: s.created_at,
      })
    );
  },
};

export async function dispatchPendingOp(
  cfg: CloudConfig,
  op: PendingOp
): Promise<PushResult> {
  const handler = handlers[op.type];
  if (!handler) {
    return {
      ok: false,
      kind: "permanent",
      error: `Unknown op type: ${op.type}`,
    };
  }
  try {
    return await handler(cfg, op);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Push failed";
    return toPushFailure(msg, 0);
  }
}
