-- =============================================================================
-- PeakPic: staff roles (moderator / admin). NOT part of schema.sql and never run
-- automatically. Run single statements by hand in the Supabase SQL editor.
--
-- There is deliberately no UI to grant roles. A role alone is not enough: every staff
-- function also requires a session confirmed with a second factor (TOTP, JWT aal = 'aal2').
-- =============================================================================

-- 1) Prerequisites
--    * schema.sql has been run (admin_roles exists).
--    * Supabase Dashboard -> Authentication -> Multi-Factor: TOTP enabled.
--    * The account already exists (sign up in the app or the dashboard) and its e-mail is confirmed.

-- 2) Give yourself the admin role. Replace the e-mail address.
-- insert into public.admin_roles (user_id, role)
-- select u.id, 'admin' from auth.users u where u.email = 'DEINE-ADRESSE@example.com'
-- on conflict (user_id) do update set role = excluded.role;

-- 3) A moderator (can remove content, warn, suspend up to 7 days, resolve reports; no bans,
--    no restoring, no e-mail addresses, no audit log).
-- insert into public.admin_roles (user_id, role)
-- select u.id, 'moderator' from auth.users u where u.email = 'MODERATOR@example.com'
-- on conflict (user_id) do update set role = excluded.role;

-- 4) Check who has a role.
-- select r.role, p.username, u.email, r.created_at
-- from public.admin_roles r
-- join public.profiles p on p.id = r.user_id
-- join auth.users u on u.id = r.user_id;

-- 5) Remove a role. Staff accounts can't delete themselves in the app: remove the role first.
-- delete from public.admin_roles
-- where user_id = (select u.id from auth.users u where u.email = 'ADRESSE@example.com');

-- Notes
--  * Never put the service_role key into the app, the admin dashboard, logs or the repository.
--  * Roles are never read from user_metadata (users can change it themselves).
--  * Granting or removing a role is not written to moderation_actions (it happens outside the
--    app). Keep your own note of who got which role and when.
