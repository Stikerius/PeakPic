-- PeakPic: one-time backfill of the usage counters. NOT part of schema.sql; run by hand in the
-- Supabase SQL editor, once, after schema.sql.
--
-- Fills usage_counters from the existing tables by created_at (day in Europe/Zurich), but only
-- for rows created BEFORE the counting triggers were installed (usage_meta
-- 'triggers_installed_at'), so nothing is counted twice. A second run does nothing
-- (usage_meta 'backfill_done_at').
--
-- What can't be recovered: content that was already deleted before the triggers existed, and
-- accounts deleted before account_deletions existed. Those counters start lower.

do $$
declare
  installed timestamptz;
begin
  select value into installed from public.usage_meta where key = 'triggers_installed_at';
  if installed is null then
    raise exception 'Run supabase/schema.sql first (usage_meta.triggers_installed_at is missing).';
  end if;
  if exists (select 1 from public.usage_meta where key = 'backfill_done_at') then
    raise notice 'Backfill already done, nothing changed.';
    return;
  end if;

  insert into public.usage_counters (day, event, count)
  select (x.created_at at time zone 'Europe/Zurich')::date, x.event, count(*)
  from (
    select created_at, 'account_created' as event from public.profiles
    union all select deleted_at, 'account_deleted' from public.account_deletions
    union all select created_at, 'post_created' from public.posts
    union all select created_at, 'story_created' from public.stories
    union all select created_at, 'highlight_created' from public.highlights
    union all select created_at, 'comment_created' from public.comments
    union all select created_at, 'message_created' from public.messages where kind is null
    union all select created_at, 'like_created' from public.post_likes
    union all select created_at, 'like_created' from public.story_likes
    union all select created_at, 'like_created' from public.comment_likes
    union all select created_at, 'follow_created' from public.follows
    union all select created_at, 'report_created' from public.reports
  ) x
  where x.created_at < installed
  group by 1, 2
  on conflict (day, event) do update set count = public.usage_counters.count + excluded.count;

  insert into public.usage_meta (key, value) values ('backfill_done_at', now());
  raise notice 'Backfill done (rows before %).', installed;
end;
$$;
