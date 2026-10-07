import type { Product } from "@/types";

/** Sample products – sorted by SKU within category later in UI */
export const MOCK_PRODUCTS: Product[] = [
  // Beer
  { id: "p1", sku: "B001", name: "Tusker Lager (cup)", category: "beer", price: 30000, cost: 18000, stock_quantity: 120, units_per_pack: 100, pack_label: "barrel", min_stock: 0, is_active: true, created_at: "", updated_at: "" },
  { id: "p2", sku: "B002", name: "White Cap", category: "beer", price: 28000, cost: 17000, stock_quantity: 80, units_per_pack: 1, min_stock: 0, is_active: true, created_at: "", updated_at: "" },
  { id: "p3", sku: "B003", name: "Heineken", category: "beer", price: 35000, cost: 22000, stock_quantity: 60, units_per_pack: 1, min_stock: 0, is_active: true, created_at: "", updated_at: "" },
  { id: "p4", sku: "B004", name: "Guinness", category: "beer", price: 32000, cost: 20000, stock_quantity: 0, units_per_pack: 1, min_stock: 0, is_active: true, created_at: "", updated_at: "" },
  { id: "p5", sku: "B005", name: "Pilsner", category: "beer", price: 25000, cost: 15000, stock_quantity: 45, units_per_pack: 1, min_stock: 0, is_active: true, created_at: "", updated_at: "" },
  // Spirits
  { id: "p6", sku: "S001", name: "Johnnie Walker Black", category: "spirits", price: 45000, cost: 28000, stock_quantity: 25, units_per_pack: 1, min_stock: 0, is_active: true, created_at: "", updated_at: "" },
  { id: "p7", sku: "S002", name: "Captain Morgan", category: "spirits", price: 25000, cost: 15000, stock_quantity: 40, units_per_pack: 1, min_stock: 0, is_active: true, created_at: "", updated_at: "" },
  { id: "p8", sku: "S003", name: "Jameson", category: "spirits", price: 40000, cost: 25000, stock_quantity: 18, units_per_pack: 1, min_stock: 0, is_active: true, created_at: "", updated_at: "" },
  { id: "p9", sku: "S004", name: "Smirnoff Vodka", category: "spirits", price: 22000, cost: 13000, stock_quantity: 0, units_per_pack: 1, min_stock: 0, is_active: true, created_at: "", updated_at: "" },
  { id: "p10", sku: "S005", name: "Gilbey's Gin", category: "spirits", price: 18000, cost: 10000, stock_quantity: 35, units_per_pack: 1, min_stock: 0, is_active: true, created_at: "", updated_at: "" },
  // Soft drinks
  { id: "p11", sku: "D001", name: "Coca-Cola", category: "soft_drinks", price: 10000, cost: 5000, stock_quantity: 200, units_per_pack: 1, min_stock: 0, is_active: true, created_at: "", updated_at: "" },
  { id: "p12", sku: "D002", name: "Still Water", category: "soft_drinks", price: 8000, cost: 3000, stock_quantity: 150, units_per_pack: 1, min_stock: 0, is_active: true, created_at: "", updated_at: "" },
  { id: "p13", sku: "D003", name: "Fanta", category: "soft_drinks", price: 10000, cost: 5000, stock_quantity: 90, units_per_pack: 1, min_stock: 0, is_active: true, created_at: "", updated_at: "" },
  { id: "p14", sku: "D004", name: "Sprite", category: "soft_drinks", price: 10000, cost: 5000, stock_quantity: 0, units_per_pack: 1, min_stock: 0, is_active: true, created_at: "", updated_at: "" },
  { id: "p15", sku: "D005", name: "Energy Drink", category: "soft_drinks", price: 15000, cost: 8000, stock_quantity: 55, units_per_pack: 1, min_stock: 0, is_active: true, created_at: "", updated_at: "" },
];
