# Factory reset / login repair test record

## Automated source checks completed

- TypeScript/TSX transpile syntax checks passed for `src/lib/auth.ts`, `src/pages/Login.tsx`, and `src/pages/Users.tsx`.
- Source invariant check passed: cloud login RPC is attempted before local credential fallback.
- Source invariant check passed: a negative cloud PIN result cannot be overridden by stale local credentials.
- Source invariant check passed: login server/network errors do not increment the wrong-PIN lockout counter.
- Source invariant check passed: reset SQL uses ordered DELETE statements and does not use TRUNCATE CASCADE.
- Source invariant check passed: `set_profile_pin` uses a search path that can resolve pgcrypto in `extensions`.
- Source invariant check passed: cashier PIN creation checks the server RPC result and removes the incomplete profile on failure.

## Tests not possible in this environment

A complete Vite production build could not be run because the npm registry was unreachable and the project dependencies are not installed in this environment. A live Supabase login/factory-reset/login test also cannot be run without authenticated access to the user's Supabase project. These are not represented as passed tests.
