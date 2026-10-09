import type { CloudConfig } from "@/types/sync";

export function getCloudConfigFromEnv(): Partial<CloudConfig> {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  return {
    supabase_url: url || "",
    supabase_anon_key: key || "",
    enabled: Boolean(url && key),
  };
}

export function isCloudReady(cfg: CloudConfig | null | undefined): boolean {
  return Boolean(
    cfg?.enabled && cfg.supabase_url?.trim() && cfg.supabase_anon_key?.trim()
  );
}

/** REST helper — works without @supabase/supabase-js */
export async function supabaseRest<T = unknown>(
  cfg: CloudConfig,
  path: string,
  options: {
    method?: string;
    body?: unknown;
    prefer?: string;
    query?: string;
    timeoutMs?: number;
  } = {}
): Promise<{ data: T | null; error: string | null; status: number }> {
  const base = cfg.supabase_url.replace(/\/$/, "");
  const url = `${base}/rest/v1/${path}${options.query ? `?${options.query}` : ""}`;
  try {
    const controller = new AbortController();
    const timeoutMs = options.timeoutMs ?? 12000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, {
      method: options.method || "GET",
      headers: {
        apikey: cfg.supabase_anon_key,
        Authorization: `Bearer ${cfg.supabase_anon_key}`,
        "Content-Type": "application/json",
        Prefer: options.prefer || "return=representation",
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
    clearTimeout(timer);
    const text = await res.text();
    if (!res.ok) {
      // Treat unique violations as success (already synced)
      if (
        res.status === 409 ||
        /duplicate|unique|already exists/i.test(text)
      ) {
        return { data: null, error: null, status: res.status };
      }
      return { data: null, error: text || res.statusText, status: res.status };
    }
    if (res.status === 204 || !text) return { data: null, error: null, status: res.status };
    try {
      return { data: JSON.parse(text) as T, error: null, status: res.status };
    } catch {
      return { data: null, error: null, status: res.status };
    }
  } catch (e) {
    return {
      data: null,
      error: e instanceof Error ? e.message : "Network error",
      status: 0,
    };
  }
}

/** Upsert by primary key `id` */
export async function supabaseUpsert(
  cfg: CloudConfig,
  table: string,
  body: Record<string, unknown> | Record<string, unknown>[]
): Promise<{ error: string | null; status: number }> {
  const { error, status } = await supabaseRest(cfg, table, {
    method: "POST",
    body,
    query: "on_conflict=id",
    prefer: "resolution=merge-duplicates,return=minimal",
    timeoutMs: 60000,
  });
  return { error, status };
}

export async function probeCloud(cfg: CloudConfig): Promise<boolean> {
  if (!isCloudReady(cfg)) return false;
  try {
    const { status } = await supabaseRest(cfg, "products", {
      query: "select=id&limit=1",
      timeoutMs: 4000,
    });
    return status > 0 && status < 500;
  } catch {
    return false;
  }
}


const CLOUD_TABLES = [
  "products",
  "sales",
  "stock_receives",
  "stock_audits",
  "credit_events",
  "expenses",
  "suppliers",
  "users",
  "app_settings",
  "product_returns",
] as const;

/**
 * Delete ALL rows in each cloud table (full system reset).
 * PostgREST requires a filter — use id not null.
 */
export async function wipeAllCloudTables(
  cfg: CloudConfig
): Promise<{ ok: boolean; errors: string[] }> {
  if (!isCloudReady(cfg)) {
    return { ok: false, errors: ["Cloud not configured"] };
  }
  const errors: string[] = [];
  for (const table of CLOUD_TABLES) {
    const { error, status } = await supabaseRest(cfg, table, {
      method: "DELETE",
      query: "id=not.is.null",
      prefer: "return=minimal",
    });
    if (error && status !== 200 && status !== 204) {
      errors.push(`${table}: ${error}`);
    }
  }
  return { ok: errors.length === 0, errors };
}
