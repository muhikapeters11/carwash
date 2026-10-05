# Local DB (Dexie / IndexedDB)

Database name: `barpos_local_v1`  
Current schema version: **2**

## Migration strategy

| Version | Strategy | What it does |
|---------|----------|----------------|
| **v1** | Initial | Tables + indexes |
| **v0→Dexie** | D (app-level) | `localStorage` `barpos-v2` → Dexie once |
| **v2** | **B** (`upgrade`) | Normalize products/sales/ops defaults; index `min_stock` |

**Do not edit v1.** Add **v3** with `.stores().upgrade()` for the next change.

## Install

```cmd
npm install dexie
```

## Tables

products, sales, heldSales, cart, credits, expenses, stockReceives, stockAudits, suppliers, users, activityLog, pendingOps, settings, meta, session
