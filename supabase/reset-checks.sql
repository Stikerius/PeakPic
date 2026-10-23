-- PeakPic: read-only checks for the data reset ("App-Neustart"). NOT part of schema.sql; run by
-- hand in the Supabase SQL editor. Changes nothing. Every row with ok = false needs a look.

select * from (
  -- No client rights on the new tables.
  select 'no client rights: ' || t as check_name,
    not (has_table_privilege('authenticated', 'public.' || t, 'select')
      or has_table_privilege('authenticated', 'public.' || t, 'insert')
      or has_table_privilege('authenticated', 'public.' || t, 'update')
      or has_table_privilege('authenticated', 'public.' || t, 'delete')
      or has_table_privilege('anon', 'public.' || t, 'select')) as ok
  from unnest(array['app_settings', 'protected_accounts', 'reset_jobs', 'reset_job_targets', 'seed_markers']) t

  union all
  -- RLS on, and no policies at all (access only through the functions).
  select 'rls on, no policy: ' || c.relname,
    c.relrowsecurity and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname)
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in ('app_settings', 'protected_accounts', 'reset_jobs', 'reset_job_targets', 'seed_markers')

  union all
  -- Every reset function: security definer with a fixed search_path.
  select 'definer + search_path: ' || p.proname,
    p.prosecdef and coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=%'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and (p.proname like 'admin_reset_%' or p.proname like 'reset_%')
    and p.proname not in ('reset_limits', 'reset_category_keys', 'reset_counts_total', 'reset_counts_sum')

  union all
  -- Internal functions are not callable by clients.
  select 'internal, not for clients: ' || p.proname,
    not has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'reset_%'

  union all
  -- Admin functions: not for anonymous callers (they check is_admin() themselves).
  select 'not for anon: ' || p.proname, not has_function_privilege('anon', p.oid, 'execute')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'admin_reset_%'

  union all
  -- No protected or staff account in a job that hasn't finished.
  select 'no protected account in an open job',
    not exists (
      select 1 from public.reset_job_targets t join public.reset_jobs j on j.id = t.job_id
      where j.status in ('draft', 'confirmed', 'running')
        and (exists (select 1 from public.protected_accounts pa where pa.user_id = t.user_id)
          or exists (select 1 from public.admin_roles r where r.user_id = t.user_id))
    )

  union all
  -- At most one job confirmed or running.
  select 'at most one active job', (select count(*) from public.reset_jobs where status in ('confirmed', 'running')) <= 1

  union all
  -- Finished jobs of whole accounts keep no user ids.
  select 'deleted accounts: only the hash stays',
    not exists (
      select 1 from public.reset_job_targets t join public.reset_jobs j on j.id = t.job_id
      where j.mode = 'full' and t.status = 'done' and t.user_id is not null
    )

  union all
  -- Every confirmed job is in the log.
  select 'every confirmed job is logged',
    not exists (
      select 1 from public.reset_jobs j
      where j.confirmed_at is not null
        and not exists (select 1 from public.moderation_actions m where m.action = 'reset_confirmed' and m.target_id = j.id)
    )
) x
order by ok, check_name;

-- Current switch:
--   select value from public.app_settings where key = 'allow_full_reset';
