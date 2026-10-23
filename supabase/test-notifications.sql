-- =============================================================================
-- PeakPic test data: expiring notifications (by hand, NOT part of schema.sql)
--
-- ONLY WITH THROWAWAY TEST ACCOUNTS. Replace both usernames below, then run it in the
-- Supabase SQL Editor. It inserts back-dated "Plan übernommen" notifications for the
-- recipient, sent by the actor:
--   1) unseen, created 13 days ago        -> visible (expires in 1 day)
--   2) unseen, created 15 days ago        -> expired, hidden
--   3) seen 3 days ago, created 5 days ago -> visible (expires in 4 days)
--   4) seen 8 days ago, created 10 days ago -> expired, hidden
--   5) seen 2 days ago, created 13 days ago -> visible (capped at 14 days: 1 day left)
-- Back-dated rows don't trigger the cleanup, so all five exist until the recipient opens the
-- notifications (the app then calls purge_my_expired_notifications()).
--
-- Check afterwards (as the database owner, RLS doesn't apply here):
--   select type, created_at, read_at, public.notification_expires_at(created_at, read_at) > now() as visible
--   from public.notifications where user_id = (select id from public.profiles where username = 'test_empfaenger')
--   order by created_at;
-- In the app (signed in as the recipient): the bell counts 1 unread (row 1), the list shows rows 1, 3
-- and 5. After opening the list, rows 2 and 4 are deleted.
-- Remove the test rows again:
--   delete from public.notifications where payload ->> 'test' = 'expiry';
-- =============================================================================

with recipient as (select id from public.profiles where username = 'test_empfaenger'),
     actor as (select id from public.profiles where username = 'test_absender')
insert into public.notifications (user_id, actor_id, type, payload, created_at, read_at)
select recipient.id, actor.id, 'plan_adopted',
       jsonb_build_object('plan_title', v.title, 'test', 'expiry'),
       now() - v.created_ago, case when v.read_ago is null then null else now() - v.read_ago end
from recipient, actor,
  (values
    ('Test 1: ungesehen, 13 Tage', interval '13 days', null::interval),
    ('Test 2: ungesehen, 15 Tage', interval '15 days', null),
    ('Test 3: gesehen vor 3 Tagen', interval '5 days', interval '3 days'),
    ('Test 4: gesehen vor 8 Tagen', interval '10 days', interval '8 days'),
    ('Test 5: gesehen vor 2 Tagen, 13 Tage alt', interval '13 days', interval '2 days')
  ) as v(title, created_ago, read_ago);
