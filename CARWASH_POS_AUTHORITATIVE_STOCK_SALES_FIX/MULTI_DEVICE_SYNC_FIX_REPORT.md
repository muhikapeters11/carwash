# Multi-device sync fix report

## Changes in this update

- Reduced Realtime debounce from 1.5 seconds to 120 ms to shorten the delay after cloud writes.
- Reduced visible-client fallback polling from 20 seconds to 5 seconds; hidden tabs skip the poll to avoid unnecessary requests.
- Added Realtime subscriptions for credit-payment rows as well as the existing shared tables.
- Expanded the durable local outbox to include expenses, stock-receive records, held-sale creation/deletion, settings, activity logs, and product deletion in addition to sales and product edits.
- Removed the old 150-job queue truncation so older pending writes are not silently discarded.
- Protected the outbox against writes arriving while a flush is running.
- Synced expense category/note, stock-receive barrel/receiver metadata, and business-day/receipt settings that were previously omitted from cloud storage.
- Increased report/history pull limits to keep devices aligned for a larger recent data window.
- Added a Supabase SQL migration for missing metadata columns and Realtime publication membership.
- Added a GitHub Actions build/typecheck workflow.

## Validation

- Modified TypeScript/TSX files passed TypeScript transpilation syntax checks.
- A full `npm run typecheck` and production build could not be completed in this environment because dependency installation timed out; the source tree does not include `node_modules` or a lockfile. GitHub Actions will install dependencies and run both checks on push/PR.

## Deployment steps

1. Back up the Supabase project.
2. Confirm the existing `supabase/schema.sql` and required login/checkout migrations have already been applied.
3. Run `supabase/MULTI_DEVICE_SYNC_MIGRATION.sql` in Supabase SQL Editor.
4. Push the repository to GitHub and deploy the updated web build.
5. Rebuild and reinstall the Electron desktop app from this same repository.
6. Verify a sale, stock receive, audit, expense, held sale, settings change, and activity entry on two devices. Test offline writes by reconnecting the originating device and waiting for its outbox to drain.

## Known boundaries

- A device's offline outbox is local to that device; records cannot appear on other devices until that device reconnects and uploads them.
- Open, unsubmitted carts remain local to the device.
- Simultaneous offline edits to the same product/stock row can conflict; the product snapshot is last-write-wins. Server-side sale stock deduction remains transactional when the sale is uploaded.
- Supabase Realtime and valid RLS/table permissions must be enabled. The client cannot make a rejected database write succeed.
