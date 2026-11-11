DESKTOP LOGIN REPAIR

Important: the app's current login screen is PIN-only. Email addresses identify the staff profiles in Supabase; users enter the six-digit PIN at the login screen.

Before building this desktop app:
1. Open the Supabase project configured in .env.
2. Open SQL Editor.
3. Run supabase/REPAIR_LOGIN_CREDENTIALS.sql.
4. Confirm it completes successfully.
5. In this folder, run npm install.
6. Run npm run electron:dist.
7. Install the generated release/Carwash-Setup-1.1.0.exe.

Do not run factory_reset_cloud to fix login. Do not put a Supabase service_role key in .env. The anon key in .env is the client/publishable key and must be protected by appropriate RLS policies.

The repair SQL does not delete sales, products, stock, expenses, or existing user history. It updates the two requested staff profiles and deactivates duplicate profiles for those exact email addresses.
