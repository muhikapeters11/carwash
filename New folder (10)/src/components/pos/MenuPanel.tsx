import { useState, type ReactNode } from "react";
import { cn, formatMoney } from "@/lib/utils";
import type { Product, ProductCategory } from "@/types";
import { useOrderStore } from "@/stores/orderStore";
import { Beer, Wine, GlassWater, Martini, CupSoda, UtensilsCrossed } from "lucide-react";

const CATEGORIES: {
  id: ProductCategory | "all";
  label: string;
  icon?: ReactNode;
}[] = [
  { id: "all", label: "All" },
  { id: "beer", label: "Beer", icon: <Beer size={16} /> },
  { id: "wine", label: "Wine", icon: <Wine size={16} /> },
  { id: "spirits", label: "Spirits", icon: <GlassWater size={16} /> },
  { id: "cocktails", label: "Cocktails", icon: <Martini size={16} /> },
  { id: "soft_drinks", label: "Soft", icon: <CupSoda size={16} /> },
  { id: "food", label: "Food", icon: <UtensilsCrossed size={16} /> },
];

const MOCK_PRODUCTS: Product[] = [
  {
    id: "1",
    name: "Tusker Lager",
    category: "beer",
    price: 30000,
    is_active: true,
    track_inventory: true,
    stock_quantity: 120,
    created_at: "",
    updated_at: "",
  },
  {
    id: "2",
    name: "White Cap",
    category: "beer",
    price: 28000,
    is_active: true,
    track_inventory: true,
    stock_quantity: 80,
    created_at: "",
    updated_at: "",
  },
  {
    id: "3",
    name: "Heineken",
    category: "beer",
    price: 35000,
    is_active: true,
    track_inventory: true,
    stock_quantity: 60,
    created_at: "",
    updated_at: "",
  },
  {
    id: "4",
    name: "Guinness",
    category: "beer",
    price: 32000,
    is_active: true,
    track_inventory: true,
    stock_quantity: 45,
    created_at: "",
    updated_at: "",
  },
  {
    id: "5",
    name: "Johnnie Walker Black",
    category: "spirits",
    price: 45000,
    is_active: true,
    track_inventory: true,
    stock_quantity: 25,
    created_at: "",
    updated_at: "",
  },
  {
    id: "6",
    name: "Captain Morgan",
    category: "spirits",
    price: 25000,
    is_active: true,
    track_inventory: true,
    stock_quantity: 40,
    created_at: "",
    updated_at: "",
  },
  {
    id: "7",
    name: "Jameson",
    category: "spirits",
    price: 40000,
    is_active: true,
    track_inventory: true,
    stock_quantity: 18,
    created_at: "",
    updated_at: "",
  },
  {
    id: "8",
    name: "Mojito",
    category: "cocktails",
    price: 55000,
    is_active: true,
    track_inventory: false,
    created_at: "",
    updated_at: "",
  },
  {
    id: "9",
    name: "Old Fashioned",
    category: "cocktails",
    price: 65000,
    is_active: true,
    track_inventory: false,
    created_at: "",
    updated_at: "",
  },
  {
    id: "10",
    name: "House Red Wine",
    category: "wine",
    price: 40000,
    is_active: true,
    track_inventory: true,
    stock_quantity: 30,
    created_at: "",
    updated_at: "",
  },
  {
    id: "11",
    name: "Coca-Cola",
    category: "soft_drinks",
    price: 10000,
    is_active: true,
    track_inventory: true,
    stock_quantity: 200,
    created_at: "",
    updated_at: "",
  },
  {
    id: "12",
    name: "Still Water",
    category: "soft_drinks",
    price: 8000,
    is_active: true,
    track_inventory: true,
    stock_quantity: 150,
    created_at: "",
    updated_at: "",
  },
  {
    id: "13",
    name: "Chicken Wings",
    category: "food",
    price: 75000,
    is_active: true,
    track_inventory: false,
    created_at: "",
    updated_at: "",
  },
  {
    id: "14",
    name: "Nachos",
    category: "food",
    price: 60000,
    is_active: true,
    track_inventory: false,
    created_at: "",
    updated_at: "",
  },
];

const categoryColors: Record<string, string> = {
  beer: "bg-amber-100 text-amber-800",
  wine: "bg-rose-100 text-rose-800",
  spirits: "bg-purple-100 text-purple-800",
  cocktails: "bg-pink-100 text-pink-800",
  soft_drinks: "bg-sky-100 text-sky-800",
  food: "bg-orange-100 text-orange-800",
  other: "bg-slate-100 text-slate-800",
};

export function MenuPanel() {
  const [activeCategory, setActiveCategory] = useState<ProductCategory | "all">("all");
  const addItem = useOrderStore((s) => s.addItem);

  const filtered =
    activeCategory === "all"
      ? MOCK_PRODUCTS
      : MOCK_PRODUCTS.filter((p) => p.category === activeCategory);

  return (
    <div className="flex flex-col h-full">
      {/* Category tabs */}
      <div className="flex gap-1.5 p-2.5 overflow-x-auto border-b border-slate-200 bg-slate-50 shrink-0">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setActiveCategory(cat.id)}
            className={cn(
              "flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-sm font-semibold whitespace-nowrap transition-all",
              activeCategory === cat.id
                ? "bg-amber-500 text-white shadow-md"
                : "bg-white text-slate-600 hover:bg-slate-100 border border-slate-200"
            )}
          >
            {cat.icon}
            {cat.label}
          </button>
        ))}
      </div>

      {/* Product grid */}
      <div className="flex-1 overflow-y-auto p-3">
        <div className="grid grid-cols-2 gap-2.5">
          {filtered.map((product) => {
            const lowStock =
              product.track_inventory &&
              product.stock_quantity !== undefined &&
              product.stock_quantity < 20;

            return (
              <button
                key={product.id}
                onClick={() => addItem(product)}
                className="group flex flex-col items-stretch p-3.5 rounded-2xl bg-white border border-slate-200 hover:border-amber-400 hover:shadow-md active:scale-[0.97] transition-all text-left"
              >
                <div className="flex items-start justify-between gap-2">
                  <span
                    className={cn(
                      "text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded",
                      categoryColors[product.category] || categoryColors.other
                    )}
                  >
                    {product.category.replace("_", " ")}
                  </span>
                  {lowStock && (
                    <span className="text-[10px] font-bold text-red-500 bg-red-50 px-1.5 py-0.5 rounded">
                      Low
                    </span>
                  )}
                </div>

                <span className="mt-2 font-bold text-slate-800 text-[15px] leading-snug group-hover:text-amber-700">
                  {product.name}
                </span>

                <div className="mt-auto pt-2 flex items-end justify-between">
                  <span className="text-amber-600 font-extrabold text-base">
                    {formatMoney(product.price)}
                  </span>
                  {product.track_inventory && product.stock_quantity !== undefined && (
                    <span
                      className={cn(
                        "text-xs",
                        lowStock ? "text-red-500 font-medium" : "text-slate-400"
                      )}
                    >
                      {product.stock_quantity} left
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
