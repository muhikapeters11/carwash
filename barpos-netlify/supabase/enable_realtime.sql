-- Run once in Supabase → SQL Editor
-- Makes Realtime mandatory for multi-device live updates

do $$ begin alter publication supabase_realtime add table products; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table sales; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table users; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table expenses; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table suppliers; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table stock_receives; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table stock_audits; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table product_returns; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table app_settings; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table credit_events; exception when duplicate_object then null; end $$;

-- Verify: should list the tables above
select * from pg_publication_tables where pubname = 'supabase_realtime';
