-- PeakPic: test account with two months of history. NOT part of schema.sql; run by hand in the
-- Supabase SQL editor (after schema.sql), test phase only.
--
-- Before: register the test account in the app and upload 3 photos as normal posts. The script
-- uses the photo_path of the 3 oldest posts of that account as the pictures of all test posts
-- and stories (no new files are uploaded).
--
-- What it creates for this ONE account (days = the last 60 days up to yesterday, Europe/Zurich,
-- all timestamps backdated): 35 training days in irregular runs (31 recorded trainings, 30 of
-- them counting, plus 1 too short), 21 posts (some with several photos, 2 only as training
-- proof), 8 expired stories (5 of them in the highlights "Peak" and "Training"), the active plan
-- "Push Pull Legs" from day 22 on (planned rest days, 3 answered deviations, one change of the
-- plan's order on day 45) and the inactive plan "Ganzkörper". Likes and comments come from up to
-- 4 other active accounts, only if there are any; those accounts are not changed otherwise.
--
-- Every created row is listed in public.seed_markers. Running the script again first deletes
-- exactly those rows of this account (other data stays), then creates everything anew, so the
-- days always end yesterday. With remove_only = 'true' it only deletes them.
--
-- Usage statistics: peakpic.skip_usage = 'on' makes the counting triggers skip this transaction,
-- so usage_counters doesn't change.
--
-- All or nothing: if the account or the photos are missing, it stops with a message and writes
-- nothing. At the end it shows the key figures to compare with the app.
--
-- Careful in the app: test posts and stories share the files of your 3 posts. Deleting a test
-- story, or replacing the photos of a test post, deletes that shared file and the picture of
-- the original post is gone. Remove test data with this script (remove_only), not in the app.

begin;

-- >>> Username of the test account (without @):
select set_config('peakpic.seed_username', 'testfit', false);
-- >>> 'true' = only delete the earlier test data of this account, create nothing:
select set_config('peakpic.seed_remove_only', 'false', true);

select set_config('peakpic.skip_usage', 'on', true);

do $seed$
declare
  v_username    text := lower(btrim(current_setting('peakpic.seed_username', true)));
  v_remove_only boolean := current_setting('peakpic.seed_remove_only', true) = 'true';
  -- One token per day, day 1 = 60 days ago, day 60 = yesterday. "-" nothing; Ra / Rb planned
  -- rest day (Ra = the plan's first rest day, Rb = the one added by the change on day 45);
  -- otherwise unit + proof. Unit: G free full-body (no plan), C free core training, M short
  -- mobility (doesn't count), P Push, L Pull, B Beine. Proof: w recorded training, x recorded
  -- training with a linked post, f post only. lib tests read this string
  -- (src/lib/__tests__/seedTestaccount.test.ts).
  v_schedule    text := '
    -  Gx Gf Gf -  -  -  -  Gx Gx
    Gw -  -  -  Gx Gw Gf Gx -  -
    -  Px Bw Lx Ra Pw Lf Bx Ra Pw
    Lw Bx Ra -  Pf Bw Lx Ra Pw Lw
    Mw -  -  Bx Px Lw Rb Bw Ra Lx
    Pw -  -  Cw Bx Ra Px Lw Rb Bx';
  v_plan_day    integer := 22;   -- "Push Pull Legs" created and activated (07:00)
  v_change_day  integer := 45;   -- plan change: a second rest day after Pull (07:00)
  v_gk_day      integer := 20;   -- inactive plan "Ganzkörper" created (21:00)
  -- Deviations from the plan: day, unit that was expected, answer.
  v_dev_days    integer[] := array[23, 36, 50];
  v_dev_expect  text[] := array['L', 'L', 'P'];
  v_dev_status  text[] := array['exception', 'exception', 'reordered'];
  v_feed_off    integer[] := array[17, 27];             -- posts only as training proof
  v_story_days  integer[] := array[9, 18, 24, 28, 37, 45, 50, 58];
  v_hl_training integer[] := array[18, 37];
  v_hl_peak     integer[] := array[24, 45, 58];
  -- One per post, in the order of the days.
  v_captions    text[] := array[
    'Wieder angefangen. Ganzkörper, ruhig rein.',
    'Muskelkater, aber trotzdem hin.',
    'Kniebeuge fühlt sich langsam wieder gut an.',
    'Nach ein paar Tagen Pause wieder da.',
    'Klimmzüge: eine Wiederholung mehr als letzte Woche.',
    'Ganzkörper, alles erledigt.',
    'Nur der Nachweis für heute.',
    'Früh im Gym, fast leer.',
    'Erster Tag mit dem neuen Plan. #pushpulllegs',
    'Pull-Tag. Rudern läuft.',
    null,
    'Beine. Mehr gibt es nicht zu sagen. #beintag',
    'Kniebeuge wieder ein Stück schwerer.',
    'Push, Schultern brennen.',
    'Kreuzheben mit neuer Bestmarke.',
    'Nach drei Tagen Pause wieder Beine.',
    'Neue Reihenfolge im Plan, mehr Erholung. #pushpulllegs',
    'Pull statt Push, die Halle war voll.',
    'Beine nach dem Core-Tag.',
    'Bankdrücken: 72,5 kg für 8 Wiederholungen.',
    null
  ];
  v_comments    text[] := array[
    'Stark, weiter so.',
    'Saubere Technik.',
    'Wie lange trainierst du schon nach dem Plan?',
    'Respekt für die Konstanz.',
    'Morgen zusammen?',
    'Gute Steigerung.'
  ];
  v_visibility  text[] := array['private', 'followers', 'public'];

  v_uid         uuid;
  v_status      text;
  v_today       date := public.app_today();
  v_tokens      text[];
  v_photos      text[];
  v_others      uuid[];
  v_plan        uuid;
  v_gk_plan     uuid;
  v_push        uuid;
  v_pull        uuid;
  v_legs        uuid;
  v_rest_a      uuid;
  v_rest_b      uuid;
  v_gk_a        uuid;
  v_gk_b        uuid;
  v_gk_rest     uuid;

  i             integer;
  k             integer;
  d             date;
  tok           text;
  v_unit        text;
  v_proof       text;
  v_ukey        text;
  v_day_id      uuid;
  v_day_title   text;
  v_title       text;
  v_start       timestamptz;
  v_end         timestamptz;
  v_dur         integer;
  v_active      integer;
  v_workout     uuid;
  v_post        uuid;
  v_ex          uuid;
  v_story       uuid;
  v_hl          uuid;
  v_t           numeric;
  v_set_no      integer;
  v_set_total   integer;
  v_weight      numeric;
  v_reps        integer;
  v_secs        integer;
  v_g_count     integer := 0;
  v_w_count     integer := 0;
  v_p_count     integer := 0;
  v_media       integer;
  v_post_time   timestamptz;
  v_dev         integer;
  v_comment     uuid;
  u             record;
  p             record;
begin
  if v_username is null or v_username = '' or v_username = 'benutzername_testkonto' then
    raise exception 'Bitte oben im Skript den Benutzernamen des Testkontos eintragen.';
  end if;
  select pr.id, pr.account_status into v_uid, v_status
  from public.profiles pr where lower(pr.username) = v_username;
  if v_uid is null then
    raise exception 'Kein Konto mit dem Benutzernamen "%" gefunden. Nichts geändert.', v_username;
  end if;
  if v_status <> 'active' then
    raise exception 'Das Konto "%" ist nicht aktiv (%). Nichts geändert.', v_username, v_status;
  end if;

  -- ------------------------------------------------------------ remove earlier test data
  if exists (
    select 1 from public.seed_markers m
    where m.user_id = v_uid and (
      (m.kind = 'post' and exists (select 1 from public.posts x where x.id::text = m.ref and x.moderation_state is not null))
      or (m.kind = 'story' and exists (select 1 from public.stories x where x.id::text = m.ref and x.moderation_state is not null))
      or (m.kind = 'workout' and exists (select 1 from public.workouts x where x.id::text = m.ref and x.moderation_state is not null))
      or (m.kind = 'training_plan' and exists (select 1 from public.training_plans x where x.id::text = m.ref and x.moderation_state is not null))
    )
  ) then
    raise exception 'Testdaten dieses Kontos wurden moderiert (entfernt oder Quarantäne). Bitte zuerst im Dashboard klären. Nichts geändert.';
  end if;

  delete from public.highlights x using public.seed_markers m
  where m.user_id = v_uid and m.kind = 'highlight' and x.id::text = m.ref and x.user_id = v_uid;
  delete from public.stories x using public.seed_markers m
  where m.user_id = v_uid and m.kind = 'story' and x.id::text = m.ref and x.user_id = v_uid;
  delete from public.workouts x using public.seed_markers m
  where m.user_id = v_uid and m.kind = 'workout' and x.id::text = m.ref and x.user_id = v_uid;
  delete from public.posts x using public.seed_markers m
  where m.user_id = v_uid and m.kind = 'post' and x.id::text = m.ref and x.user_id = v_uid;
  delete from public.planned_rest_uses x using public.seed_markers m
  where m.user_id = v_uid and m.kind = 'planned_rest' and x.day::text = m.ref and x.user_id = v_uid;
  -- Plans go with their days, exercises, rounds and deviations.
  delete from public.training_plans x using public.seed_markers m
  where m.user_id = v_uid and m.kind = 'training_plan' and x.id::text = m.ref and x.user_id = v_uid;
  delete from public.seed_markers m where m.user_id = v_uid;

  if v_remove_only then
    raise notice 'Testdaten von "%" entfernt.', v_username;
    return;
  end if;

  -- ------------------------------------------------------------ checks
  select array_agg(x.photo_path order by x.created_at) into v_photos
  from (
    select distinct on (po.photo_path) po.photo_path, po.created_at
    from public.posts po
    where po.user_id = v_uid and po.moderation_state is null
    order by po.photo_path, po.created_at
  ) x;
  v_photos := v_photos[1:3];
  if coalesce(cardinality(v_photos), 0) < 3 then
    raise exception 'Das Konto "%" braucht 3 eigene Beiträge mit Foto (gefunden: %). Nichts geändert.',
      v_username, coalesce(cardinality(v_photos), 0);
  end if;
  if exists (
    select 1 from unnest(v_photos) ph
    where not exists (select 1 from storage.objects o where o.bucket_id = 'photos' and o.name = ph)
  ) then
    raise exception 'Mindestens ein Foto der 3 Beiträge fehlt im Storage. Nichts geändert.';
  end if;
  if exists (select 1 from public.training_plans tp where tp.user_id = v_uid and tp.is_active) then
    raise exception 'Das Testkonto hat schon einen aktiven Plan. Bitte in der App deaktivieren. Nichts geändert.';
  end if;
  if (select count(*) from public.training_plans tp where tp.user_id = v_uid) > 8 then
    raise exception 'Das Testkonto hat zu viele Pläne (höchstens 10, das Skript legt 2 an). Nichts geändert.';
  end if;
  v_tokens := regexp_split_to_array(btrim(v_schedule, E' \n\r\t'), '\s+');
  if cardinality(v_tokens) <> 60 then
    raise exception 'Ablauf hat % statt 60 Tage.', cardinality(v_tokens);
  end if;

  -- Other active accounts for likes and comments (followers first), none blocked either way.
  select array_agg(x.id) into v_others
  from (
    select pr.id from public.profiles pr
    where pr.id <> v_uid and public.account_is_active(pr.id)
      and not public.is_blocked_between(pr.id, v_uid)
      and not exists (select 1 from public.admin_roles ar where ar.user_id = pr.id)
    order by exists (
      select 1 from public.follows f where f.follower_id = pr.id and f.following_id = v_uid and f.status = 'accepted'
    ) desc, pr.created_at
    limit 4
  ) x;

  -- ------------------------------------------------------------ exercises
  -- Progression per exercise over the 60 days (weight, reps without weight, or seconds).
  drop table if exists pg_temp.seed_prog;
  create temp table seed_prog (
    name text primary key, w0 numeric, w1 numeric, step numeric, r0 integer, r1 integer, s0 integer, s1 integer
  ) on commit drop;
  insert into seed_prog values
    ('Bankdrücken',             60,   72.5, 2.5, null, null, null, null),
    ('Schulterdrücken',         30,   37.5, 2.5, null, null, null, null),
    ('Seitheben',               8,    10,   1,   null, null, null, null),
    ('Dips',                    null, null, null, 8,   12,   null, null),
    ('Kreuzheben',              100,  120,  2.5, null, null, null, null),
    ('Klimmzüge',               null, null, null, 6,   9,    null, null),
    ('Langhantelrudern',        50,   60,   2.5, null, null, null, null),
    ('Bizepscurls',             12,   14,   1,   null, null, null, null),
    ('Kniebeuge',               80,   97.5, 2.5, null, null, null, null),
    ('Rumänisches Kreuzheben',  70,   80,   2.5, null, null, null, null),
    ('Beinpresse',              120,  150,  5,   null, null, null, null),
    ('Plank',                   null, null, null, null, null, 45, 75),
    ('Liegestütze',             null, null, null, 15,  22,   null, null),
    ('Hängendes Beinheben',     null, null, null, 8,   12,   null, null),
    ('Hüftmobilisation',        null, null, null, null, null, 60, 60);

  -- Exercises per unit (sets, target reps for weighted exercises).
  drop table if exists pg_temp.seed_unit;
  create temp table seed_unit (ukey text, pos integer, name text, sets integer, reps integer) on commit drop;
  insert into seed_unit values
    ('P', 0, 'Bankdrücken', 4, 8), ('P', 1, 'Schulterdrücken', 3, 10), ('P', 2, 'Seitheben', 3, 12), ('P', 3, 'Dips', 3, null),
    ('L', 0, 'Kreuzheben', 3, 5), ('L', 1, 'Klimmzüge', 4, null), ('L', 2, 'Langhantelrudern', 3, 10), ('L', 3, 'Bizepscurls', 3, 12),
    ('B', 0, 'Kniebeuge', 4, 6), ('B', 1, 'Rumänisches Kreuzheben', 3, 10), ('B', 2, 'Beinpresse', 3, 12), ('B', 3, 'Plank', 3, null),
    ('GA', 0, 'Kniebeuge', 3, 8), ('GA', 1, 'Bankdrücken', 3, 8), ('GA', 2, 'Klimmzüge', 3, null), ('GA', 3, 'Plank', 2, null),
    ('GB', 0, 'Kreuzheben', 3, 5), ('GB', 1, 'Schulterdrücken', 3, 10), ('GB', 2, 'Langhantelrudern', 3, 10), ('GB', 3, 'Liegestütze', 3, null),
    ('C', 0, 'Plank', 3, null), ('C', 1, 'Hängendes Beinheben', 3, null), ('C', 2, 'Liegestütze', 3, null),
    ('M', 0, 'Hüftmobilisation', 3, null);

  drop table if exists pg_temp.seed_days;
  create temp table seed_days (day_no integer primary key, workout_id uuid, post_id uuid) on commit drop;

  -- ------------------------------------------------------------ the 60 days
  for i in 1 .. 60 loop
    d := v_today - (61 - i);
    tok := v_tokens[i];

    if i = v_gk_day then
      v_start := (d + time '21:00')::timestamp at time zone 'Europe/Zurich';
      insert into public.training_plans (user_id, name, visibility, is_active, created_at, updated_at, sequence_changed_at)
      values (v_uid, 'Ganzkörper', 'private', false, v_start, v_start, v_start)
      returning id into v_gk_plan;
      insert into public.plan_days (plan_id, position, title, day_type, created_at)
      values (v_gk_plan, 0, 'Ganzkörper A', 'training', v_start) returning id into v_gk_a;
      insert into public.plan_days (plan_id, position, title, day_type, created_at)
      values (v_gk_plan, 1, 'Ganzkörper B', 'training', v_start) returning id into v_gk_b;
      insert into public.plan_days (plan_id, position, title, day_type, created_at)
      values (v_gk_plan, 2, 'Ruhetag', 'rest', v_start) returning id into v_gk_rest;
      insert into public.plan_exercises
        (plan_day_id, position, name, sets, reps_min, reps_max, target_seconds, target_weight_kg, created_at)
      select case su.ukey when 'GA' then v_gk_a else v_gk_b end, su.pos, su.name, su.sets,
             coalesce(su.reps, sp.r0), su.reps + 2, sp.s0, sp.w0, v_start
      from seed_unit su join seed_prog sp on sp.name = su.name
      where su.ukey in ('GA', 'GB');
      insert into public.seed_markers (user_id, kind, ref) values (v_uid, 'training_plan', v_gk_plan::text);
    end if;

    if i = v_plan_day then
      v_start := (d + time '07:00')::timestamp at time zone 'Europe/Zurich';
      insert into public.training_plans (user_id, name, visibility, is_active, created_at, updated_at, sequence_changed_at)
      values (v_uid, 'Push Pull Legs', 'followers', true, v_start, v_start, v_start)
      returning id into v_plan;
      insert into public.plan_days (plan_id, position, title, day_type, notes, created_at)
      values (v_plan, 0, 'Push', 'training', 'Brust, Schultern, Trizeps', v_start) returning id into v_push;
      insert into public.plan_days (plan_id, position, title, day_type, notes, created_at)
      values (v_plan, 1, 'Pull', 'training', 'Rücken, Bizeps', v_start) returning id into v_pull;
      insert into public.plan_days (plan_id, position, title, day_type, created_at)
      values (v_plan, 2, 'Beine', 'training', v_start) returning id into v_legs;
      insert into public.plan_days (plan_id, position, title, day_type, created_at)
      values (v_plan, 3, 'Ruhetag', 'rest', v_start) returning id into v_rest_a;
      insert into public.plan_exercises
        (plan_day_id, position, name, sets, reps_min, reps_max, target_seconds, target_weight_kg, created_at)
      select case su.ukey when 'P' then v_push when 'L' then v_pull else v_legs end, su.pos, su.name, su.sets,
             coalesce(su.reps, sp.r0), su.reps + 2, sp.s0, sp.w0, v_start
      from seed_unit su join seed_prog sp on sp.name = su.name
      where su.ukey in ('P', 'L', 'B');
      insert into public.seed_markers (user_id, kind, ref) values (v_uid, 'training_plan', v_plan::text);
    end if;

    if i = v_change_day then
      -- More recovery: a rest day between Pull and Beine. The order changes, so the plan streak
      -- starts again from here (sequence_changed_at).
      v_start := (d + time '07:00')::timestamp at time zone 'Europe/Zurich';
      update public.plan_days set position = 4 where id = v_rest_a;
      update public.plan_days set position = 3 where id = v_legs;
      insert into public.plan_days (plan_id, position, title, day_type, created_at)
      values (v_plan, 2, 'Ruhetag', 'rest', v_start) returning id into v_rest_b;
      update public.plan_exercises set target_weight_kg = 67.5
      where plan_day_id = v_push and name = 'Bankdrücken';
      update public.training_plans set sequence_changed_at = v_start, updated_at = v_start where id = v_plan;
    end if;

    continue when tok = '-';

    if tok in ('Ra', 'Rb') then
      insert into public.planned_rest_uses (user_id, day, plan_id, plan_day_id, created_at)
      values (v_uid, d, v_plan, case tok when 'Ra' then v_rest_a else v_rest_b end,
              (d + time '20:00')::timestamp at time zone 'Europe/Zurich');
      insert into public.seed_markers (user_id, kind, ref) values (v_uid, 'planned_rest', d::text);
      continue;
    end if;

    v_unit := substr(tok, 1, 1);
    v_proof := substr(tok, 2, 1);
    v_t := (i - 1) / 59.0;
    v_day_id := case v_unit when 'P' then v_push when 'L' then v_pull when 'B' then v_legs end;
    v_day_title := case v_unit when 'P' then 'Push' when 'L' then 'Pull' when 'B' then 'Beine' end;
    v_start := (d + make_time(17 + i % 3, (i * 7) % 60, 0))::timestamp at time zone 'Europe/Zurich';
    v_workout := null;
    v_post := null;

    if v_proof in ('w', 'x') then
      if v_unit = 'G' then
        v_g_count := v_g_count + 1;
        v_ukey := case when v_g_count % 2 = 1 then 'GA' else 'GB' end;
        v_title := case v_ukey when 'GA' then 'Ganzkörper A' else 'Ganzkörper B' end;
      else
        v_ukey := v_unit;
        v_title := case v_unit when 'C' then 'Core und Liegestütze' when 'M' then 'Mobilität' end;
      end if;
      v_dur := case v_unit when 'M' then 12 else 45 + (i * 13) % 36 end;
      v_active := case v_unit when 'M' then 480 else v_dur * 60 - 60 * (2 + i % 5) end;
      v_end := v_start + make_interval(mins => v_dur);
      v_w_count := v_w_count + 1;

      insert into public.workouts
        (user_id, client_id, plan_id, plan_day_id, plan_day_title, title, note, started_at, ended_at,
         active_seconds, workout_date, visibility, share_with_post, counts_for_streak, not_counting_reason, created_at)
      values (
        v_uid, gen_random_uuid(),
        case when v_day_id is not null then v_plan end, v_day_id, v_day_title, v_title,
        case v_w_count % 6
          when 1 then 'Gut geschlafen, Kraft war da.'
          when 4 then 'Schulter etwas müde, Gewicht gehalten.'
        end,
        v_start, v_end, v_active, d, v_visibility[1 + v_w_count % 3], false,
        v_unit <> 'M', case when v_unit = 'M' then 'too_short' end,
        v_end + interval '2 minutes'
      )
      returning id into v_workout;
      insert into public.seed_markers (user_id, kind, ref) values (v_uid, 'workout', v_workout::text);

      select coalesce(sum(su.sets), 0) into v_set_total from seed_unit su where su.ukey = v_ukey;
      v_set_no := 0;
      for u in
        select su.pos, su.name, su.sets, su.reps, sp.*
        from seed_unit su join seed_prog sp on sp.name = su.name
        where su.ukey = v_ukey order by su.pos
      loop
        insert into public.workout_exercises (workout_id, position, name, planned_exercise_id)
        values (v_workout, u.pos, u.name,
                (select e.id from public.plan_exercises e where e.plan_day_id = v_day_id and e.name = u.name))
        returning id into v_ex;
        v_weight := case when u.w0 is not null then round((u.w0 + (u.w1 - u.w0) * v_t) / u.step) * u.step end;
        v_secs := case when u.s0 is not null then (round((u.s0 + (u.s1 - u.s0) * v_t) / 5) * 5)::integer end;
        for k in 0 .. u.sets - 1 loop
          v_set_no := v_set_no + 1;
          v_reps := case
            when u.w0 is not null then u.reps - (case when k >= 2 then k - 1 else 0 end)
            when u.r0 is not null then round(u.r0 + (u.r1 - u.r0) * v_t)::integer - (case when k >= 2 then 1 else 0 end)
          end;
          insert into public.workout_sets (workout_exercise_id, position, reps, weight_kg, seconds, rest_seconds, completed_at)
          values (
            v_ex, k, v_reps, v_weight, v_secs,
            case when u.w0 is not null then 120 else 60 end,
            v_start + make_interval(secs => v_set_no * v_dur * 60 / (v_set_total + 1))
          );
        end loop;
      end loop;
    end if;

    if v_proof in ('x', 'f') then
      v_p_count := v_p_count + 1;
      v_post_time := case when v_proof = 'x' then v_end + interval '15 minutes'
                          else v_start + interval '70 minutes' end;
      insert into public.posts
        (user_id, photo_path, caption, workout_date, created_at, in_feed, is_day_post, plan_day_id)
      values (
        v_uid, v_photos[1 + v_p_count % 3], v_captions[v_p_count], d, v_post_time,
        not (i = any (v_feed_off)),
        not exists (select 1 from public.posts q where q.user_id = v_uid and q.workout_date = d and q.is_day_post),
        v_day_id
      )
      returning id into v_post;
      insert into public.seed_markers (user_id, kind, ref) values (v_uid, 'post', v_post::text);
      -- Several photos on some days (carousel / slideshow of the day).
      v_media := case when v_p_count in (1, 9, 13, 17, 21) then 3 when v_p_count in (5, 15) then 2 else 1 end;
      for k in 0 .. v_media - 1 loop
        insert into public.post_media (post_id, user_id, photo_path, original_path, position, created_at)
        values (v_post, v_uid, v_photos[1 + (v_p_count + k) % 3], v_photos[1 + (v_p_count + k) % 3], k, v_post_time);
      end loop;
      if v_workout is not null then
        update public.workouts set post_id = v_post, share_with_post = v_p_count % 2 = 0 where id = v_workout;
      end if;
    end if;

    insert into seed_days (day_no, workout_id, post_id) values (i, v_workout, v_post);

    if i = any (v_story_days) then
      insert into public.stories (user_id, photo_path, created_at, expires_at)
      values (v_uid, v_photos[1 + i % 3], v_start + interval '2 hours', v_start + interval '26 hours')
      returning id into v_story;
      insert into public.seed_markers (user_id, kind, ref) values (v_uid, 'story', v_story::text);
    end if;
  end loop;

  -- ------------------------------------------------------------ highlights
  insert into public.highlights (user_id, title, created_at)
  values (v_uid, 'Training', (v_today - (61 - 37) + time '21:00')::timestamp at time zone 'Europe/Zurich')
  returning id into v_hl;
  insert into public.seed_markers (user_id, kind, ref) values (v_uid, 'highlight', v_hl::text);
  insert into public.highlight_items (highlight_id, story_id, added_at)
  select v_hl, s.id, s.created_at + interval '1 hour'
  from public.stories s join public.seed_markers m on m.kind = 'story' and m.ref = s.id::text and m.user_id = v_uid
  where (s.created_at at time zone 'Europe/Zurich')::date in (select v_today - (61 - x) from unnest(v_hl_training) x);
  update public.highlights h set cover_story_id = (
    select hi.story_id from public.highlight_items hi where hi.highlight_id = h.id order by hi.added_at desc limit 1
  ) where h.id = v_hl;

  insert into public.highlights (user_id, title, created_at)
  values (v_uid, 'Peak', (v_today - (61 - 45) + time '21:00')::timestamp at time zone 'Europe/Zurich')
  returning id into v_hl;
  insert into public.seed_markers (user_id, kind, ref) values (v_uid, 'highlight', v_hl::text);
  insert into public.highlight_items (highlight_id, story_id, added_at)
  select v_hl, s.id, s.created_at + interval '1 hour'
  from public.stories s join public.seed_markers m on m.kind = 'story' and m.ref = s.id::text and m.user_id = v_uid
  where (s.created_at at time zone 'Europe/Zurich')::date in (select v_today - (61 - x) from unnest(v_hl_peak) x);
  update public.highlights h set cover_story_id = (
    select hi.story_id from public.highlight_items hi where hi.highlight_id = h.id order by hi.added_at desc limit 1
  ) where h.id = v_hl;

  -- ------------------------------------------------------------ plan state
  -- The posts trigger already moved the round on and opened questions while the days were
  -- created. Replace that with the intended history: answered deviations only, and the round
  -- computed from the proofs (same rule as the app).
  delete from public.plan_deviations where user_id = v_uid and plan_id = v_plan;
  for v_dev in 1 .. cardinality(v_dev_days) loop
    select sd.* into p from seed_days sd where sd.day_no = v_dev_days[v_dev];
    insert into public.plan_deviations
      (user_id, plan_id, proof_kind, proof_id, done_day_id, expected_day_id, done_title, expected_title,
       status, created_at, resolved_at)
    select v_uid, v_plan,
      case when p.workout_id is not null then 'workout' else 'post' end,
      coalesce(p.workout_id, p.post_id),
      dd.id, ed.id, dd.title, ed.title, v_dev_status[v_dev],
      w.created_at, w.created_at + interval '3 hours'
    from public.workouts w,
      public.plan_days dd,
      public.plan_days ed
    where w.id = p.workout_id
      and dd.id = w.plan_day_id
      and ed.id = case v_dev_expect[v_dev] when 'P' then v_push when 'L' then v_pull else v_legs end;
  end loop;
  delete from public.plan_rounds where user_id = v_uid and plan_id in (v_plan, v_gk_plan);
  perform public.plan_round_load(v_uid, v_plan);

  -- ------------------------------------------------------------ likes and comments
  if coalesce(cardinality(v_others), 0) > 0 then
    k := 0;
    for p in
      select po.id, po.created_at, row_number() over (order by po.created_at) as n
      from public.posts po join seed_days sd on sd.post_id = po.id
      where po.in_feed
    loop
      insert into public.post_likes (post_id, user_id, created_at)
      select p.id, o.id, p.created_at + make_interval(mins => 37 * o.n::integer)
      from unnest(v_others) with ordinality o(id, n)
      where (p.n + o.n) % 3 <> 0;
      if p.n % 3 = 1 then
        k := k + 1;
        insert into public.comments (post_id, user_id, body, created_at)
        values (p.id, v_others[1 + k % cardinality(v_others)], v_comments[1 + k % cardinality(v_comments)],
                p.created_at + interval '50 minutes')
        returning id into v_comment;
        if k % 2 = 1 then
          insert into public.comments (post_id, user_id, body, parent_comment_id, created_at)
          values (p.id, v_uid, 'Danke!', v_comment, p.created_at + interval '2 hours');
        end if;
      end if;
    end loop;
  end if;

  raise notice 'Testdaten für "%" angelegt: % Trainings, % Beiträge.', v_username, v_w_count, v_p_count;
end;
$seed$;

commit;

-- ------------------------------------------------------------ key figures (read-only)
with me as (
  select pr.id from public.profiles pr
  where lower(pr.username) = lower(btrim(current_setting('peakpic.seed_username', true)))
),
seed as (
  select m.kind, m.ref from public.seed_markers m join me on me.id = m.user_id
),
sets as (
  select we.name, s.reps, s.weight_kg, s.seconds
  from public.workouts w
  join seed on seed.kind = 'workout' and seed.ref = w.id::text
  join public.workout_exercises we on we.workout_id = w.id
  join public.workout_sets s on s.workout_exercise_id = we.id
),
best as (
  select s.name,
    max(s.weight_kg) as w,
    max(s.reps) filter (where s.weight_kg = (select max(x.weight_kg) from sets x where x.name = s.name)) as w_reps,
    max(s.reps) filter (where s.weight_kg is null) as reps,
    max(s.seconds) as secs
  from sets s group by s.name
)
select nr, kennzahl, wert from (
  select 1 as nr, 'Trainingstage, letzte 60 Tage bis gestern' as kennzahl,
    (select count(*) from me, generate_series(public.app_today() - 60, public.app_today() - 1, interval '1 day') g(d)
     where public.day_counts_as_workout(me.id, g.d::date))::text as wert
  union all
  select 2, 'Trainingstag heute (eigene Beiträge)',
    (select case when public.day_counts_as_workout(me.id, public.app_today()) then 'ja' else 'nein' end from me)
  union all
  select 3, 'Aktueller Streak', (select sn.current_streak::text from me, public.streak_numbers(me.id) sn)
  union all
  select 4, 'Längster Streak', (select sn.longest_streak::text from me, public.streak_numbers(me.id) sn)
  union all
  select 5, 'Aufgezeichnete Trainings (zählen / gesamt)',
    (select count(*) filter (where w.counts_for_streak) || ' / ' || count(*)
     from public.workouts w join seed on seed.kind = 'workout' and seed.ref = w.id::text)
  union all
  select 6, 'Gesamtvolumen Testtrainings (kg)',
    (select round(sum(s.weight_kg * s.reps), 1)::text from sets s where s.weight_kg is not null and s.reps is not null)
  union all
  select 7, 'Sätze Testtrainings', (select count(*)::text from sets)
  union all
  select 8, 'Beiträge (Test, davon nur Nachweis)',
    (select count(*) || ' (' || count(*) filter (where not po.in_feed) || ')'
     from public.posts po join seed on seed.kind = 'post' and seed.ref = po.id::text)
  union all
  select 9, 'Storys (Test, alle abgelaufen)', (select count(*)::text from seed where kind = 'story')
  union all
  select 10, 'Highlights (Storys darin)',
    (select count(distinct h.id) || ' (' || count(hi.story_id) || ')'
     from public.highlights h join seed on seed.kind = 'highlight' and seed.ref = h.id::text
     left join public.highlight_items hi on hi.highlight_id = h.id)
  union all
  select 11, 'Geplante Ruhetage bestätigt', (select count(*)::text from seed where kind = 'planned_rest')
  union all
  select 12, 'Abweichungen (beantwortet)',
    (select count(*)::text from public.plan_deviations dv join me on me.id = dv.user_id
     join seed on seed.kind = 'training_plan' and seed.ref = dv.plan_id::text)
  union all
  select 13, 'Likes / Kommentare von anderen',
    (select (select count(*) from public.post_likes l join seed on seed.kind = 'post' and seed.ref = l.post_id::text)
            || ' / ' ||
            (select count(*) from public.comments c join seed on seed.kind = 'post' and seed.ref = c.post_id::text
             join me on c.user_id <> me.id))
  union all
  select 20 + row_number() over (order by b.name), 'Bestleistung ' || b.name,
    case
      when b.w is not null then trim(to_char(b.w, 'FM999990.0')) || ' kg × ' || b.w_reps
      when b.reps is not null then b.reps || ' Wiederholungen'
      else b.secs || ' s'
    end
  from best b
) x
order by nr;
