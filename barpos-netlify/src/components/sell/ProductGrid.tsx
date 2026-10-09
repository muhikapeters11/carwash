import { useMemo, useState } from "react";
import { useAppStore } from "@/stores/appStore";
import { groupProductsByCategory, formatMoney, cn } from "@/lib/utils";
import { Search, X } from "lucide-react";
import type { Product } from "@/types";

/** Products column — search by name/SKU + category grid */
export function ProductGrid() {
  const products = useAppStore((s) => s.products);
  const addToCart = useAppStore((s) => s.addToCart);
  const [query, setQuery] = useState("");

  const activeProducts = useMemo(
    () => products.filter((p) => p.is_active !== false),
    [products]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return activeProducts;
    return activeProducts.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.sku || "").toLowerCase().includes(q) ||
        (p.category || "").toLowerCase().includes(q)
    );
  }, [activeProducts, query]);

  const groups = useMemo(() => groupProductsByCategory(filtered), [filtered]);

  const renderCard = (p: Product) => {
    const out = p.stock_quantity <= 0;
    const low = false;
    return (
      <button
        key={p.id}
        type="button"
        disabled={out}
        onClick={() => addToCart(p)}
        className={cn(
          "flex flex-col rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] overflow-hidden text-left transition active:scale-[0.96] touch-manipulation min-h-[120px]",
          out && "opacity-50 cursor-not-allowed",
          low && "ring-2 ring-amber-400"
        )}
      >
        <div className="aspect-square bg-[var(--bg-muted)] flex items-center justify-center relative">
          {p.image_url ? (
            <img src={p.image_url} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="text-2xl font-bold text-[var(--text-muted)] px-1 text-center leading-tight">
              {p.name.slice(0, 12)}
            </span>
          )}
          {out && (
            <span className="absolute inset-0 bg-black/50 flex items-center justify-center text-white text-xs font-bold">
              OUT
            </span>
          )}
        </div>
        <div className="p-2">
          <div className="text-xs font-semibold text-[var(--text)] line-clamp-2 leading-tight">
            {p.name}
          </div>
          <div className="text-sm font-bold text-amber-600 mt-0.5">
            {formatMoney(p.price)}
          </div>
          <div
            className={cn(
              "text-[10px] font-bold mt-0.5",
              out ? "text-red-500" : low ? "text-amber-600" : "text-emerald-600"
            )}
          >
            {out ? "Out of stock" : `Qty ${p.stock_quantity}`}
          </div>
        </div>
      </button>
    );
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[var(--bg)] [contain:content]">
      {/* Search bar */}
      <div className="shrink-0 p-3 border-b border-[var(--border)] bg-[var(--bg-card)]">
        <div className="relative">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
            size={20}
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name or SKU…"
            className="w-full pl-10 pr-10 py-3.5 rounded-xl border-2 border-[var(--border)] bg-[var(--input-bg)] text-[var(--input-text)] text-base font-medium touch-manipulation"
            autoComplete="off"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-lg text-[var(--text-muted)]"
              aria-label="Clear search"
            >
              <X size={18} />
            </button>
          )}
        </div>
        {query.trim() && (
          <p className="text-xs text-[var(--text-muted)] mt-1.5">
            {filtered.length} product{filtered.length === 1 ? "" : "s"} found
          </p>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
{filtered.length === 0 ? (
          <div className="text-center py-16 text-[var(--text-muted)]">
            <p className="font-semibold">No products match</p>
            <p className="text-sm mt-1">Try another name or SKU</p>
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="mt-4 px-4 py-2 rounded-xl bg-amber-500 text-white font-bold"
              >
                Clear search
              </button>
            )}
          </div>
        ) : query.trim() ? (
          /* Flat grid when searching */
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-2">
            {filtered
              .slice()
              .sort((a, b) =>
                (a.sku || "").localeCompare(b.sku || "", undefined, { numeric: true })
              )
              .map(renderCard)}
          </div>
        ) : (
          groups.map((g) => (
            <div key={g.category} className="mb-6">
              <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-muted)] mb-3 border-b border-[var(--border)] pb-1">
                {g.label}
              </h2>
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-2">
                {g.items.map(renderCard)}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
