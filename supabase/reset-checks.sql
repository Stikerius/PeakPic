-- PeakPic: read-only checks for the data reset ("App-Neustart"), the e-mail notices
-- ("Mitteilungen"), the design (logos, animation presets, colour sets) and the surveys. NOT part of schema.sql; run by
-- hand in the Supabase SQL editor. Changes nothing. Every row with ok = false needs a look.

select * from (
  -- No client rights on the new tables.
  select 'no client rights: ' || t as check_name,
    not (has_table_privilege('authenticated', 'public.' || t, 'select')
      or has_table_privilege('authenticated', 'public.' || t, 'insert')
      or has_table_privilege('authenticated', 'public.' || t, 'update')
      or has_table_privilege('authenticated', 'public.' || t, 'delete')
      or has_table_privilege('anon', 'public.' || t, 'select')) as ok
  from unnest(array['app_settings', 'protected_accounts', 'reset_jobs', 'reset_job_targets', 'seed_markers',
                     'mail_campaigns', 'mail_recipients', 'mail_templates', 'mail_tests',
                     'logo_library', 'animation_presets', 'design_assignments', 'app_design_config', 'logo_import_calls',
                     'brand_colors', 'preset_versions',
                     'official_account', 'surveys', 'survey_questions', 'survey_media', 'survey_participation',
                     'survey_responses', 'survey_answers', 'survey_items', 'survey_counters', 'survey_event_rate']) t

  union all
  -- RLS on, and no policies at all (access only through the functions).
  select 'rls on, no policy: ' || c.relname,
    c.relrowsecurity and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname)
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in ('app_settings', 'protected_accounts', 'reset_jobs', 'reset_job_targets', 'seed_markers',
                      'mail_campaigns', 'mail_recipients', 'mail_templates', 'mail_tests',
                      'logo_library', 'animation_presets', 'design_assignments', 'app_design_config', 'logo_import_calls',
                      'brand_colors', 'preset_versions',
                      'official_account', 'surveys', 'survey_questions', 'survey_media', 'survey_participation',
                      'survey_responses', 'survey_answers', 'survey_items', 'survey_counters', 'survey_event_rate')

  union all
  -- Every reset function: security definer with a fixed search_path.
  select 'definer + search_path: ' || p.proname,
    p.prosecdef and coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=%'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and (p.proname like 'admin_reset_%' or p.proname like 'reset_%')
    and p.proname not in ('reset_limits', 'reset_category_keys', 'reset_counts_total', 'reset_counts_sum',
                          'reset_category_label', 'reset_notice_text', 'reset_target_affected')

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
  -- Mail functions: security definer with a fixed search_path (pure helpers excepted).
  select 'definer + search_path: ' || p.proname,
    p.prosecdef and coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=%'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and (p.proname like 'admin_mail_%' or p.proname like 'mail_%')
    and p.proname not in ('mail_limits', 'mail_category_label', 'mail_check_content', 'mail_check_attachments',
                          'mail_content_hash')

  union all
  -- Logo and design functions: security definer with a fixed search_path; not for anonymous callers.
  select 'definer + search_path, not anon: ' || p.proname,
    p.prosecdef and coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=%'
      and not has_function_privilege('anon', p.oid, 'execute')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and (p.proname like 'admin_logo_%' or p.proname like 'admin_preset_%' or p.proname like 'admin_color_%'
    or p.proname = 'set_app_design_config')

  union all
  -- The checks behind the design tables are internal: no client may call them.
  select 'internal, not for clients: ' || p.proname,
    not has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('brand_animation_problem', 'brand_easing_valid', 'brand_keys_only', 'brand_int_between', 'brand_spec_summary',
                      'brand_color_set_problem', 'brand_preset_params_valid', 'brand_logo_spec_valid')

  union all
  -- Every stored logo passes the structure check (also the built-in ones).
  select 'all logos valid', not exists (select 1 from public.logo_library l where not public.brand_logo_spec_valid(l.spec))

  union all
  -- Every preset is a valid v2 animation, or (older ones) valid v1 parameters.
  select 'all presets valid (v2, or v1 not yet saved again)',
    not exists (
      select 1 from public.animation_presets p
      where not ((p.spec_version = 2 and public.brand_animation_problem(p.spec) is null)
              or (p.spec_version = 1 and public.brand_preset_params_valid(p.params)))
    )

  union all
  select 'built-in presets are v2', not exists (select 1 from public.animation_presets p where p.kind = 'builtin' and p.spec_version <> 2)

  union all
  select 'at most 10 versions per preset',
    not exists (select 1 from public.preset_versions v group by v.preset_id having count(*) > 10)

  union all
  -- A manipulated animation is refused by the same check the save function uses.
  select 'manipulated animation refused: ' || x.label, public.brand_animation_problem(x.spec) is not null
  from (values
    ('unknown field', '{"version":2,"duration":8,"strokeWidth":2,"tracks":[{"kind":"rotate","enabled":true,"target":{"type":"all"},"keyframes":[{"t":0,"v":0,"ease":{"type":"hold"}}],"stagger":{"mode":"none","amount":0,"seed":0},"repeat":1,"script":"x"}]}'::jsonb),
    ('duration 99', '{"version":2,"duration":99,"strokeWidth":2,"tracks":[{"kind":"rotate","enabled":true,"target":{"type":"all"},"keyframes":[{"t":0,"v":0,"ease":{"type":"hold"}}],"stagger":{"mode":"none","amount":0,"seed":0},"repeat":1}]}'::jsonb),
    ('value out of range', '{"version":2,"duration":8,"strokeWidth":2,"tracks":[{"kind":"rotate","enabled":true,"target":{"type":"all"},"keyframes":[{"t":0,"v":999,"ease":{"type":"hold"}}],"stagger":{"mode":"none","amount":0,"seed":0},"repeat":1}]}'::jsonb),
    ('falling times', '{"version":2,"duration":8,"strokeWidth":2,"tracks":[{"kind":"rotate","enabled":true,"target":{"type":"all"},"keyframes":[{"t":0.5,"v":0,"ease":{"type":"hold"}},{"t":0.2,"v":0,"ease":{"type":"hold"}}],"stagger":{"mode":"none","amount":0,"seed":0},"repeat":1}]}'::jsonb),
    ('41 sparks', '{"version":2,"duration":8,"strokeWidth":2,"tracks":[{"kind":"sparks","enabled":true,"target":{"type":"all"},"keyframes":[{"t":0,"v":0,"ease":{"type":"hold"}}],"stagger":{"mode":"none","amount":0,"seed":0},"repeat":1,"count":41,"seed":1,"size":1,"distance":1}]}'::jsonb)
  ) as x(label, spec)

  union all
  -- Surveys: card views are the only survey table with a client right (read own rows).
  select 'survey_item_views: only select, only own rows',
    has_table_privilege('authenticated', 'public.survey_item_views', 'select')
    and not has_table_privilege('authenticated', 'public.survey_item_views', 'insert')
    and not has_table_privilege('authenticated', 'public.survey_item_views', 'update')
    and not has_table_privilege('authenticated', 'public.survey_item_views', 'delete')
    and not has_table_privilege('anon', 'public.survey_item_views', 'select')
    and (select count(*) = 1 and bool_and(p.cmd = 'SELECT' and p.qual like '%auth.uid()%')
         from pg_policies p where p.schemaname = 'public' and p.tablename = 'survey_item_views')

  union all
  -- The anonymous answers hold no reference to a person and no time of day.
  select 'anonymous answers: no person, no time: ' || c.table_name || '.' || c.column_name,
    c.column_name not similar to '%(user|profile|account|created_by)%'
    and c.data_type not like 'time%'
  from information_schema.columns c
  where c.table_schema = 'public' and c.table_name in ('survey_responses', 'survey_answers')

  union all
  select 'survey functions: definer + search_path: ' || p.proname,
    p.prosecdef and coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=%'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and (p.proname like 'admin_survey_%' or p.proname in ('admin_item_withdraw', 'submit_survey_response', 'get_official_feed_items',
         'mark_item_seen', 'dismiss_item', 'get_active_surveys', 'get_official_profile', 'get_official_profile_items',
         'get_survey', 'track_survey_event', 'survey_media_readable'))

  union all
  select 'survey functions: not for anon: ' || p.proname, not has_function_privilege('anon', p.oid, 'execute')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and (p.proname like 'admin_survey_%' or p.proname in ('submit_survey_response', 'get_official_feed_items', 'get_survey',
         'track_survey_event', 'mark_item_seen', 'dismiss_item'))

  union all
  select 'survey internals not for clients: ' || p.proname,
    not has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('survey_answers_problem', 'survey_store_questions', 'survey_item_json', 'survey_item_visible',
                      'survey_bump', 'survey_eligible_count', 'official_visible_to_me', 'official_user_id', 'survey_log_summary')

  union all
  select 'bucket survey-media private', exists (select 1 from storage.buckets b where b.id = 'survey-media' and not b.public)

  union all
  -- Files of survey-media are written only by the Edge Function (service role): no client write policy.
  select 'survey-media: no client write policy',
    not exists (select 1 from pg_policies p where p.schemaname = 'storage' and p.tablename = 'objects'
                and p.cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
                and (coalesce(p.qual, '') || coalesce(p.with_check, '')) like '%survey-media%')

  union all
  select 'at most one official account', (select count(*) from public.official_account) <= 1

  union all
  select 'every published survey is logged',
    not exists (select 1 from public.surveys s where s.published_at is not null
                and not exists (select 1 from public.moderation_actions m where m.action = 'survey_publish' and m.target_id = s.id))

  union all
  select 'survey answers only for published surveys',
    not exists (select 1 from public.survey_responses r join public.surveys s on s.id = r.survey_id where s.published_at is null)

  union all
  -- Every colour set meets the readability rules.
  select 'all colour sets readable',
    not exists (select 1 from public.brand_colors b where public.brand_color_set_problem(b.accent_dark, b.accent_light, b.chart_colors) is not null)

  union all
  select 'colour targets set: ' || t,
    exists (select 1 from public.design_assignments a where a.target = t and a.color_id is not null)
  from unnest(array['dashboard_colors', 'app_login_colors']) t

  union all
  -- Addresses and the queue: only the service role (never clients, never the admin's session).
  select 'service role only: ' || p.proname,
    not has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('mail_claim', 'mail_result', 'mail_campaign_refresh', 'mail_record_test', 'mail_purge',
                      'mail_campaign_for_send')

  union all
  -- The attachment bucket is private.
  select 'bucket mail-attachments private',
    exists (select 1 from storage.buckets b where b.id = 'mail-attachments' and not b.public)

  union all
  -- Texts are not kept once a campaign is done.
  select 'no text kept in finished campaigns',
    not exists (select 1 from public.mail_campaigns c where c.status = 'done' and c.body is not null)

  union all
  -- Every campaign is in the log.
  select 'every mail campaign is logged',
    not exists (
      select 1 from public.mail_campaigns c
      where not exists (select 1 from public.moderation_actions m where m.action = 'mail_send' and m.target_id = c.id)
    )

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
