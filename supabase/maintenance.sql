-- =============================================================================
-- PeakPic maintenance (by hand, NOT part of schema.sql)
--
-- Run in Supabase Dashboard → SQL Editor whenever you like. Safe to repeat.
-- =============================================================================

-- Deletes every expired notification of every user (unseen: 14 days after creation; seen: 7 days
-- after it was seen, at the latest 14 days after creation; see notification_expires_at() in
-- schema.sql). The app already hides expired ones and deletes them per person when new ones
-- arrive or the list is opened; this only cleans up accounts that haven't opened the app.
delete from public.notifications
where public.notification_expires_at(created_at, read_at) <= now();

-- Later this could run by itself with pg_cron (Database → Extensions → pg_cron), e.g. daily:
--   select cron.schedule('purge-expired-notifications', '15 3 * * *',
--     $$delete from public.notifications where public.notification_expires_at(created_at, read_at) <= now()$$);
-- Not set up.
