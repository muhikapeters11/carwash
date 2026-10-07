import { useState, useRef } from "react";
import { useAppStore } from "@/stores/appStore";
import { formatMoney, groupProductsByCategory } from "@/lib/utils";
import type { Product, ProductCategory } from "@/types";
import { Pencil, Trash2 } from "lucide-react";
import { compressImageDataUrl } from "@/lib/compressImage";

export function ProductsPage() {
  const products = useAppStore((s) => s.products);
  const addProduct = useAppStore((s) => s.addProduct);
  const updateProduct = useAppStore((s) => s.updateProduct);
  const deleteProduct = useAppStore((s) => s.deleteProduct);
  const deleteAllProducts = useAppStore((s) => s.deleteAllProducts);
  const setProducts = useAppStore((s) => s.setProducts);
  const groups = groupProductsByCategory(products);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [category, setCategory] = useState<ProductCategory>("beer");
  const [price, setPrice] = useState("");
  const [cost, setCost] = useState("");
  const [stock, setStock] = useState("0");
  const [unitsPerPack, setUnitsPerPack] = useState("1");
  const [minStock, setMinStock] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [packLabel, setPackLabel] = useState("");
  const [image, setImage] = useState<string | undefined>();
  const fileRef = useRef<HTMLInputElement>(null);

  const openAdd = () => {
    setEditing(null);
    setName(""); setSku(""); setCategory("beer"); setPrice(""); setCost("");
    setStock("0"); setUnitsPerPack("1"); setPackLabel(""); setImage(undefined);
    setShowForm(true);
  };

  const openEdit = (p: Product) => {
    setEditing(p);
    setName(p.name); setSku(p.sku); setCategory(p.category);
    setPrice(String(p.price / 100)); setCost(String(p.cost / 100));
    setStock(String(p.stock_quantity));
    setUnitsPerPack(String(p.units_per_pack || 1));
    setPackLabel(p.pack_label || "");
    setMinStock(p.min_stock ? String(p.min_stock) : "");
    setIsActive(p.is_active !== false);
    setImage(p.image_url);
    setShowForm(true);
  };

  const onImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      alert("Image too large (max 8MB)");
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      const raw = reader.result as string;
      const compressed = await compressImageDataUrl(raw, 320, 0.7);
      setImage(compressed);
    };
    reader.readAsDataURL(file);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !sku || !price) return;
    const skuTaken = products.some(
      (p) => p.sku.trim().toLowerCase() === sku.trim().toLowerCase() && p.id !== editing?.id
    );
    if (skuTaken) {
      alert("A product with this SKU already exists. Use a unique SKU or edit the existing product.");
      return;
    }
    const payload = {
      name,
      sku,
      category,
      price: Math.round(parseFloat(price) * 100),
      cost: Math.round(parseFloat(cost || "0") * 100),
      stock_quantity: parseInt(stock || "0", 10),
      units_per_pack: parseInt(unitsPerPack || "1", 10) || 1,
      pack_label: packLabel || undefined,
      image_url: image,
      min_stock: parseInt(minStock || "0", 10) || 0,
      is_active: isActive,
    };
    if (editing) {
      updateProduct(editing.id, payload);
    } else {
      addProduct(payload);
    }
    setShowForm(false);
  };

  const exportCsv = () => {
    const header = "sku,name,category,price,cost,stock_quantity,units_per_pack,pack_label\n";
    const rows = products
      .map(
        (p) =>
          `${p.sku},${p.name},${p.category},${p.price / 100},${p.cost / 100},${p.stock_quantity},${p.units_per_pack || 1},${p.pack_label || ""}`
      )
      .join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "products.csv";
    a.click();
  };

  const parseCsvLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if ((ch === "," || ch === ";") && !inQuotes) {
        out.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out.map((c) => c.trim().replace(/^\uFEFF/, ""));
  };

  const importCsv = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const lower = file.name.toLowerCase();
    if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
      alert(
        "Excel (.xlsx) is not supported directly. In Excel: File → Save As → CSV (Comma delimited), then import that CSV."
      );
      e.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const raw = (reader.result as string).replace(/^\uFEFF/, "");
      const lines = raw
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      if (!lines.length) {
        alert("File is empty");
        e.target.value = "";
        return;
      }

      // Skip header if first cell looks like "sku"
      let dataLines = lines;
      const firstCells = parseCsvLine(lines[0]);
      if (firstCells[0]?.toLowerCase() === "sku" || firstCells[0]?.toLowerCase() === "name") {
        dataLines = lines.slice(1);
      }

      const validCategories: ProductCategory[] = [
        "beer",
        "spirits",
        "soft_drinks",
        "wine",
        "cocktails",
        "food",
        "other",
      ];

      // Merge by SKU so re-import never creates duplicates
      const bySku = new Map<string, Product>();
      for (const p of useAppStore.getState().products) {
        if (p.sku) bySku.set(p.sku.trim().toLowerCase(), p);
      }

      let updated = 0;
      let added = 0;
      const seenInFile = new Set<string>();

      dataLines.forEach((line, i) => {
        const cols = parseCsvLine(line);
        if (cols.length < 2) return;
        const skuRaw = (cols[0] || "").trim();
        const name = (cols[1] || "").trim();
        if (!skuRaw && !name) return;
        const sku = skuRaw || `SKU${i + 1}`;
        const skuKey = sku.toLowerCase();
        // Same SKU twice in one file → last row wins
        if (seenInFile.has(skuKey)) {
          /* overwrite below */
        }
        seenInFile.add(skuKey);

        let category = (cols[2] || "other").trim().toLowerCase().replace(/\s+/g, "_") as ProductCategory;
        if (!validCategories.includes(category)) category = "other";

        const priceNum = parseFloat((cols[3] || "0").replace(/[^0-9.-]/g, "")) || 0;
        const costNum = parseFloat((cols[4] || "0").replace(/[^0-9.-]/g, "")) || 0;
        const stockNum = parseInt((cols[5] || "0").replace(/[^0-9-]/g, ""), 10) || 0;
        const upp = parseInt((cols[6] || "1").replace(/[^0-9]/g, ""), 10) || 1;
        const pl = (cols[7] || "").trim() || undefined;
        const now = new Date().toISOString();

        const existing = bySku.get(skuKey);
        if (existing) {
          bySku.set(skuKey, {
            ...existing,
            sku,
            name: name || existing.name,
            category,
            price: Math.round(priceNum * 100),
            cost: Math.round(costNum * 100),
            stock_quantity: stockNum,
            units_per_pack: upp,
            pack_label: pl,
            is_active: true,
            updated_at: now,
          });
          updated++;
        } else {
          bySku.set(skuKey, {
            id: `imp-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`,
            sku,
            name: name || "Product",
            category,
            price: Math.round(priceNum * 100),
            cost: Math.round(costNum * 100),
            stock_quantity: stockNum,
            units_per_pack: upp,
            pack_label: pl,
            min_stock: 0,
            is_active: true,
            created_at: now,
            updated_at: now,
          });
          added++;
        }
      });

      const merged = Array.from(bySku.values());
      setProducts(merged);
      alert(`Import done: ${added} added, ${updated} updated. Total products: ${merged.length}`);
      e.target.value = "";
    };
    reader.readAsText(file);
  };

  const onDeleteAll = () => {
    const n = useAppStore.getState().products.length;
    if (!n) {
      alert("No products to delete");
      return;
    }
    if (
      !window.confirm(
        `Delete ALL ${n} products? This cannot be undone. Cloud will be updated if online.`
      )
    ) {
      return;
    }
    if (!window.confirm("Are you sure? Every product will be removed.")) return;
    deleteAllProducts();
  };

  return (
    <div className="h-full overflow-y-auto p-6 bg-[var(--bg)]">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h1 className="text-xl font-bold text-[var(--text)]">Products</h1>
        <div className="flex gap-2">
                    <button onClick={exportCsv} className="px-3 py-2 rounded-lg border border-[var(--border)] text-sm font-medium text-[var(--text)]">Export CSV</button>
          <label className="px-3 py-2 rounded-lg border border-[var(--border)] text-sm font-medium cursor-pointer text-[var(--text)]">
            Import CSV
            <input type="file" accept=".csv,text/csv,.xlsx,.xls" className="hidden" onChange={importCsv} />
          </label>
          <button
            type="button"
            onClick={onDeleteAll}
            className="px-3 py-2 rounded-lg border border-red-300 text-sm font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
          >
            Delete all products
          </button>

          <button onClick={openAdd} className="px-4 py-2 rounded-lg bg-amber-500 text-white text-sm font-bold">Add Product</button>
        </div>
      </div>

      {groups.map((g) => (
        <div key={g.category} className="mb-5">
          <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-muted)] mb-2">{g.label}</h2>
          <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--bg-muted)] text-left text-xs text-[var(--text-muted)]">
                  <th className="px-3 py-2"></th>
                  <th className="px-3 py-2">SKU</th>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2 text-right">Cost/unit</th>
                  <th className="px-3 py-2 text-right">Sell</th>
                  <th className="px-3 py-2 text-right">Stock</th>
                  <th className="px-3 py-2">Pack</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {g.items.map((p) => (
                  <tr key={p.id} className="border-b border-[var(--border)] last:border-0 text-[var(--text)]">
                    <td className="px-3 py-2">
                      <div className="w-10 h-10 rounded-lg bg-[var(--bg-muted)] overflow-hidden flex items-center justify-center">
                        {p.image_url ? <img src={p.image_url} alt="" className="w-full h-full object-cover" /> : <span className="text-xs font-bold">{p.name[0]}</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{p.sku}</td>
                    <td className="px-3 py-2 font-medium">{p.name}</td>
                    <td className="px-3 py-2 text-right">{formatMoney(p.cost)}</td>
                    <td className="px-3 py-2 text-right font-semibold text-amber-600">{formatMoney(p.price)}</td>
                    <td className={`px-3 py-2 text-right font-bold ${p.stock_quantity <= 0 ? "text-red-500" : "text-emerald-600"}`}>{p.stock_quantity}</td>
                    <td className="px-3 py-2 text-xs text-[var(--text-muted)]">
                      {(p.units_per_pack || 1) > 1 ? `1 ${p.pack_label || "pack"} = ${p.units_per_pack}` : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <button onClick={() => openEdit(p)} className="p-2 rounded-lg hover:bg-[var(--bg-muted)] text-amber-600">
                        <Pencil size={16} />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm(`Delete product "${p.name}"?`)) deleteProduct(p.id);
                        }}
                        className="p-2 rounded-lg text-red-600 hover:bg-red-50"
                        title="Delete"
                      >
                        <Trash2 size={18} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form onSubmit={submit} className="bg-[var(--bg-card)] rounded-2xl w-full max-w-md p-5 space-y-3 max-h-[90vh] overflow-y-auto border border-[var(--border)]">
            <h3 className="font-bold text-lg text-[var(--text)]">{editing ? "Edit product" : "Add product"}</h3>
            <div className="flex justify-center">
              <button type="button" onClick={() => fileRef.current?.click()} className="w-28 h-28 rounded-xl bg-[var(--bg-muted)] border-2 border-dashed border-[var(--border)] flex items-center justify-center overflow-hidden">
                {image ? <img src={image} alt="" className="w-full h-full object-cover" /> : <span className="text-xs text-[var(--text-muted)]">Photo</span>}
              </button>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onImage} />
            </div>
            <input placeholder="Name *" value={name} onChange={(e) => setName(e.target.value)} className="w-full px-3 py-2.5 rounded-xl border border-[var(--border)]" required />
            <input placeholder="SKU *" value={sku} onChange={(e) => setSku(e.target.value)} className="w-full px-3 py-2.5 rounded-xl border border-[var(--border)]" required />
            <select value={category} onChange={(e) => setCategory(e.target.value as ProductCategory)} className="w-full px-3 py-2.5 rounded-xl border border-[var(--border)]">
              <option value="beer">Beer</option>
              <option value="spirits">Spirits</option>
              <option value="soft_drinks">Soft Drinks</option>
              <option value="wine">Wine</option>
              <option value="other">Other</option>
            </select>
            <input placeholder="Sell price per unit (KSh) *" type="number" value={price} onChange={(e) => setPrice(e.target.value)} className="w-full px-3 py-2.5 rounded-xl border border-[var(--border)]" required />
            <input placeholder="Cost per unit (KSh)" type="number" value={cost} onChange={(e) => setCost(e.target.value)} className="w-full px-3 py-2.5 rounded-xl border border-[var(--border)]" />
            <input placeholder="Stock (sell units)" type="number" value={stock} onChange={(e) => setStock(e.target.value)} className="w-full px-3 py-2.5 rounded-xl border border-[var(--border)]" />
            <div>
              <label className="text-sm font-medium text-[var(--text)] mb-2 block">Product type</label>
              <div className="flex gap-2">
                <button type="button" onClick={() => { setUnitsPerPack("1"); setPackLabel(""); }}
                  className={`flex-1 py-2.5 rounded-xl border font-semibold text-sm ${unitsPerPack === "1" || !unitsPerPack ? "bg-amber-500 text-white border-amber-500" : "border-[var(--border)] text-[var(--text)]"}`}>
                  Non-barrel (unit)
                </button>
                <button type="button" onClick={() => { if (unitsPerPack === "1") setUnitsPerPack("100"); setPackLabel(packLabel || "barrel"); }}
                  className={`flex-1 py-2.5 rounded-xl border font-semibold text-sm ${parseInt(unitsPerPack||"1") > 1 ? "bg-amber-500 text-white border-amber-500" : "border-[var(--border)] text-[var(--text)]"}`}>
                  Barrel / pack
                </button>
              </div>
            </div>
            {parseInt(unitsPerPack || "1") > 1 && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-[var(--text-muted)]">Units per barrel</label>
                  <input type="number" value={unitsPerPack} onChange={(e) => setUnitsPerPack(e.target.value)} className="mt-1 w-full px-3 py-2.5 rounded-xl border border-[var(--border)]" />
                </div>
                <div>
                  <label className="text-xs text-[var(--text-muted)]">Label</label>
                  <input value={packLabel} onChange={(e) => setPackLabel(e.target.value)} placeholder="barrel" className="mt-1 w-full px-3 py-2.5 rounded-xl border border-[var(--border)]" />
                </div>
              </div>
            )}
            <p className="text-xs text-[var(--text-muted)]">Barrel: receive 1 barrel → stock increases by units per barrel; sell is per cup/unit.</p>
            <div>
              <label className="text-sm text-[var(--text)]">Low stock alert at qty</label>
              <input type="number" value={minStock} onChange={(e) => setMinStock(e.target.value)} placeholder="e.g. 5 — leave empty for no alert" className="mt-1 w-full px-3 py-2.5 rounded-xl border border-[var(--border)]" />
              <p className="text-xs text-[var(--text-muted)] mt-1">Enter your own threshold. Empty or 0 = no low-stock alert.</p>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => setIsActive(true)}
                className={`flex-1 py-2.5 rounded-xl border font-semibold text-sm ${isActive ? "bg-emerald-500 text-white border-emerald-500" : "border-[var(--border)] text-[var(--text)]"}`}>
                Active (on Sell)
              </button>
              <button type="button" onClick={() => setIsActive(false)}
                className={`flex-1 py-2.5 rounded-xl border font-semibold text-sm ${!isActive ? "bg-slate-500 text-white border-slate-500" : "border-[var(--border)] text-[var(--text)]"}`}>
                Deactivated
              </button>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => setShowForm(false)} className="flex-1 py-3 rounded-xl border border-[var(--border)] font-semibold text-[var(--text)]">Cancel</button>
              <button type="submit" className="flex-1 py-3 rounded-xl bg-amber-500 text-white font-bold">Save</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
