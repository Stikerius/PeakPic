-- PeakPic: sets the official account (surveys and results are published in its name).
-- NOT part of schema.sql. Run by hand in the Supabase SQL editor, after schema.sql.
--
-- Default: your own admin account. To use another account, replace the username below
-- (lower case, without @). Running it again with another username moves the official role:
-- there is always exactly one official account (the table allows one row).
--
-- What changes for that account:
--   * nobody can start a chat with it or send it messages (neutral message in the app),
--   * it takes no followers and no follow requests, and nobody can block it,
--   * it is protected in the data reset and can't be deleted while it is official,
--   * the app shows it with the badge "Offiziell"; its e-mail address and other account data
--     never leave the server (users only see username, name, picture and the description).

do $$
declare
  -- ↓↓↓ replace with the username of the official account ↓↓↓
  official_username text := 'DEIN_ADMIN_BENUTZERNAME';
  -- Description on the official profile (1 to 300 characters, or null for none).
  official_bio text := 'Umfragen und Neuigkeiten des PeakPic-Teams.';
  target uuid;
begin
  select p.id into target from public.profiles p where p.username = lower(btrim(official_username));
  if target is null then
    raise exception 'Kein Konto mit dem Benutzernamen "%" gefunden.', official_username;
  end if;
  insert into public.official_account (id, user_id, bio, updated_at)
  values (true, target, official_bio, now())
  on conflict (id) do update set user_id = excluded.user_id, bio = excluded.bio, updated_at = now();
  -- Open follow requests to the official account are removed (it takes none), and so are
  -- blocks of it (nobody can block the official account).
  delete from public.follows f where f.following_id = target and f.status = 'pending';
  delete from public.user_blocks b where b.blocked_id = target;
  raise notice 'Offizielles Konto: @% (%)', lower(btrim(official_username)), target;
end;
$$;

-- Check:
--   select p.username, o.bio, o.updated_at from public.official_account o join public.profiles p on p.id = o.user_id;
