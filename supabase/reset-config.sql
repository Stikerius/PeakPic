-- PeakPic: protected accounts for data resets ("App-Neustart"). NOT part of schema.sql; run by
-- hand in the Supabase SQL editor after schema.sql, and again whenever the list changes.
--
-- Protected accounts can never be chosen in a reset job (also not through a hand-made call).
-- Every account with a role in admin_roles and the admin who runs a job are protected anyway;
-- list here the others that must survive, e.g. your main account and the test account.
--
-- Enter the usernames (without @) below. Names that don't exist are listed at the end and change
-- nothing. Running it again adds what is new and keeps what is there.

with wanted (username) as (
  values
    ('BENUTZERNAME_HAUPTKONTO'),
    ('BENUTZERNAME_TESTKONTO')
)
insert into public.protected_accounts (user_id, note)
select p.id, 'reset-config.sql'
from wanted w
join public.profiles p on lower(p.username) = lower(btrim(w.username))
on conflict (user_id) do nothing;

-- To remove one again:
--   delete from public.protected_accounts
--   where user_id = (select id from public.profiles where username = 'BENUTZERNAME');

-- Before the real start (no more deleting whole accounts, only categories):
--   update public.app_settings set value = 'false', updated_at = now() where key = 'allow_full_reset';

-- Overview: everything that is protected now, and why.
select p.username, 'protected_accounts' as why
from public.protected_accounts pa join public.profiles p on p.id = pa.user_id
union all
select p.username, 'admin_roles: ' || r.role
from public.admin_roles r join public.profiles p on p.id = r.user_id
union all
select w.username, 'NICHT GEFUNDEN'
from (values ('BENUTZERNAME_HAUPTKONTO'), ('BENUTZERNAME_TESTKONTO')) w (username)
where not exists (select 1 from public.profiles p where lower(p.username) = lower(btrim(w.username)))
union all
select 'allow_full_reset = ' || s.value::text, 'app_settings'
from public.app_settings s where s.key = 'allow_full_reset'
order by 2, 1;
