-- =============================================================================
-- PeakPic database schema
--
-- Paste this whole file into Supabase Dashboard → SQL Editor and run it.
-- The script is idempotent: running it again updates functions and policies
-- without dropping data.
--
-- Visibility model
--   * profiles      readable by every signed-in user (name, avatar, privacy settings).
--                   username is unique (also case-insensitively) and can change at most
--                   once per 14 days (trigger); display_name is free text, not unique.
--                   Former usernames stay reserved for their owner (username_history),
--                   so old @mentions in texts keep pointing to the same user id.
--                   onboarding_done_at: set once by the user (the trigger stamps the server
--                   time and never clears it); profiles from before the intro count as done.
--   * follows       a follow is 'pending' (request to a private profile) or 'accepted';
--                   only accepted follows count anywhere (is_following). The status is set
--                   by a trigger, only the followed person can accept. Follower lists are
--                   readable for public profiles and accepted followers; counts for everyone
--                   signed in (follow_counts).
--   * public        is_private = false and post_visibility / story_visibility = 'everyone'
--                   makes posts / active stories readable by every signed-in user
--                   (is_public_content); never for anonymous users.
--   * comments      readable (and likeable) exactly when their post is
--   * streak-only   posts with in_feed = false: followers see the training day (row), but
--                   photos, likes, comments and tags only the owner (can_view_post)
--   * posts/stories readable by the owner and by people who follow the owner;
--                   a post shared into a chat is also readable by that chat's members;
--                   tagged people can see a story, and the one post they are tagged in. Owners can hide their posts and/or
--                   stories from specific people (audience_restrictions); that always wins.
--   * highlights    readable by the owner and followers; stories in a highlight stay
--                   readable for them after expiring (other expired stories: owner only)
--   * tagging       who may tag whom is decided by can_tag() (target's setting, an accepted
--                   follow in either direction or public content, max 10 per post / story).
--                   Tags create notifications and chat cards server-side (triggers).
--   * notifications only the recipient reads them and marks them read; rows are created
--                   only by triggers / security definer functions, never by clients. They expire
--                   (notification_expires_at): unseen 14 days after creation, seen 7 days after
--                   read_at, at the latest 14 days after creation; expired rows are invisible and
--                   are deleted on the next insert for that person or by purge_my_expired_notifications()
--   * workout links workout_shares: the post owner asks, only the tagged person accepts or
--                   declines (until the end of the next day); only accepted links count
--   * reposts       readable only if the viewer may read the original post AND the
--                   reposter's posts; only accepted, linked people may repost feed posts
--   * hashtags      tags and use counts readable by every signed-in user; which content uses a
--                   tag only as far as that content is readable. Maintained by triggers only.
--   * chats         only members can read conversations, members and messages. "Für mich löschen"
--                   hides a message for me only (message_hidden, hide_message_for_me()); "Für alle
--                   löschen" removes the row for good, only by its sender and never when moderated
--                   (delete_message_for_everyone()); report_snapshots keep their copies.
--                   "Chat für mich löschen" (clear_chat_for_me()) hides the whole history for me
--                   only; the chat comes back without it when someone writes again. While a block
--                   exists between the members, messages are shown to both only as deleted
--                   (get_chat_messages()) and the table doesn't return them.
--   * training plans up to 10 per user, exactly one active: an ordered cycle of days
--                   (plan_days: training or rest) with exercises (plan_exercises), not tied
--                   to weekdays.
--                   Readable by the owner, and per plan visibility ('private' | 'followers' |
--                   'public', public only while the profile is public; can_view_plan).
--                   Written only through save_plan() / activate_plan() / deactivate_plan() /
--                   duplicate_plan() / delete_plan() / reorder_plan_days() / reorder_plan_exercises().
--                   No plan may be active at all. Progress is stored per person and plan
--                   (plan_rounds: the current round's order and the index of the next unit),
--                   written only by functions. Training another unit than the next one is always
--                   accepted; it opens one question (plan_deviations) that the person answers with
--                   resolve_plan_deviation() ('exception' or 'reordered'), or that becomes an
--                   'auto_exception' after 2 days. The open units of the round can be reordered or
--                   skipped any time (adjust_plan_round(), skip_plan_round_unit()). Reordering,
--                   adding or removing days never resets
--                   progress; sequence_changed_at only moves when a plan is (re)started at day 1.
--   * training stats get_my_training_stats() / get_training_stats(): aggregated numbers only
--                   (per day and exercise, never single trainings), visible per
--                   profiles.training_stats_visibility (default 'private'; can_view_training_stats).
--   * workouts      recorded trainings (workouts, workout_exercises, workout_sets). Written only
--                   by save_workout() (validated, atomic); counts_for_streak is decided there
--                   (plausibility rules, workout_rules()) and never written by clients. A counting
--                   workout is a training proof like a post, with or without a photo.
--                   Readable per can_view_workout (visibility, linked post with share_with_post).
--   * plan on posts posts.plan_day_id: a unit of the poster's own plan (checked by a trigger,
--                   changeable only while the workout day is today or yesterday); title,
--                   position and plan length are copied onto the post so the label survives
--                   plan changes.
--   * rest days     rest_budgets (X per calendar week Mon-Sun, the number changeable every
--                   21 days) and
--                   rest_day_uses: only the owner reads them, nobody writes them directly; all
--                   rules live in set_rest_budget / use_rest_day / undo_rest_day. Others see
--                   rest days with the calendar (rest_days()), never the budget.
--   * blocks        user_blocks: only the blocker sees, adds and removes their blocks. A block
--                   works both ways (is_blocked_between): profiles, posts, stories, highlights,
--                   comments, follow lists, plans and calendars disappear for each other; no
--                   follows, tags, mentions, likes, comments or new messages between the two.
--                   Blocking removes follows and requests in both directions.
--   * accounts      profiles.account_status ('active' | 'suspended' | 'banned' | 'deleting') is
--                   never written by clients (profiles_moderation_guard). Only active accounts
--                   (an expired suspension counts as active) may write anything, and accounts
--                   that are not active are invisible to others (can_see_account). The owner
--                   reads the reason through get_my_account_status().
--   * reports       written only through report_content() / report_message() (visibility,
--                   20 per day, one per target); reporters read their own status through
--                   get_my_reports(). Reported messages are copied with up to 5 messages of
--                   context before and after into report_snapshots (no client access).
--   * staff         admin_roles ('moderator' | 'admin', set by hand, see admin-setup.sql) has no
--                   client access at all. is_moderator() / is_admin() also need a two-factor
--                   session (JWT aal = 'aal2'). All moderation goes through mod_* / admin_*
--                   functions; each action and each look at private content writes an entry
--                   into moderation_actions (append-only, not even admins can change it).
--   * moderation    posts, stories, comments and messages can be 'removed' or 'quarantined'
--                   (moderation_state): hidden from everyone including the owner, never
--                   deleted, files stay. Moderators see chats only through report_snapshots.
--   * legal texts   legal_documents (terms are accepted, privacy policy and guidelines only
--                   acknowledged). Users only ever see published versions; published versions
--                   can't change (corrections are new versions). legal_confirmations are
--                   written only by confirm_legal_documents() (server time, type and hash) and
--                   never changed or deleted, except together with the account. Admins
--                   publish, remind and suspend through admin_legal_* functions (aal2, logged).
--   * mail notices  admins send service notices by e-mail (mail_campaigns, mail_recipients,
--                   mail_templates, mail_tests; bucket mail-attachments). Addresses are read only
--                   by the Edge Function send_admin_mail at sending time and never stored; the
--                   text only while mails wait, permanently only its hash. See the section at the end.
--   * storage       bucket "photos" (private), objects live under {user_id}/{kind}/...;
--                   a photo is readable exactly when its post/story is (avatars: everyone)
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------

create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  username    text not null unique
              check (username ~ '^[a-z0-9_.]{3,20}$'),
  avatar_path text,
  created_at  timestamptz not null default now()
);
-- Everything in the notifications screen newer than this counts as unread.
alter table public.profiles
  add column if not exists notifications_seen_at timestamptz not null default now();
-- Privacy. Existing and new profiles start private (nothing changes until the user opts in).
-- A private profile always behaves like 'followers', whatever the two settings say.
alter table public.profiles add column if not exists is_private boolean not null default true;
alter table public.profiles add column if not exists story_visibility text not null default 'followers';
alter table public.profiles add column if not exists post_visibility text not null default 'followers';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_story_visibility_check') then
    alter table public.profiles
      add constraint profiles_story_visibility_check check (story_visibility in ('everyone', 'followers'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_post_visibility_check') then
    alter table public.profiles
      add constraint profiles_post_visibility_check check (post_visibility in ('everyone', 'followers'));
  end if;
end;
$$;
-- Tagging: who may tag me ('everyone' | 'connections' = people I follow or who follow me |
-- 'nobody'), and whether tags notify me and appear as chat cards.
alter table public.profiles add column if not exists tag_permission text not null default 'everyone';
alter table public.profiles add column if not exists tag_notifications boolean not null default true;
alter table public.profiles add column if not exists tag_chat_messages boolean not null default true;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_tag_permission_check') then
    alter table public.profiles
      add constraint profiles_tag_permission_check check (tag_permission in ('everyone', 'connections', 'nobody'));
  end if;
end;
$$;
-- Names. display_name is shown big on the profile and next to @username in lists; it does not
-- have to be unique. Existing profiles start with their username. username_changed_at is set
-- by the profiles_guard trigger only (clients cannot fake it).
alter table public.profiles add column if not exists display_name text;
update public.profiles set display_name = username where display_name is null;
alter table public.profiles alter column display_name set not null;
alter table public.profiles add column if not exists username_changed_at timestamptz;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_display_name_check') then
    alter table public.profiles
      add constraint profiles_display_name_check
      check (char_length(display_name) between 1 and 30 and display_name = btrim(display_name));
  end if;
end;
$$;
-- When the intro after sign-up was finished or skipped. Added with now() as the default, so
-- every profile that exists when the column is created counts as done; afterwards the default
-- is null, so new sign-ups see the intro. Running the file again changes nothing.
alter table public.profiles add column if not exists onboarding_done_at timestamptz default now();
alter table public.profiles alter column onboarding_done_at set default null;
-- "Ivan" and "ivan" are the same name (usernames are stored lowercase anyway).
create unique index if not exists profiles_username_lower_idx on public.profiles (lower(username));

-- Usernames someone used before. They stay reserved for that user, and old @mentions in
-- captions and comments resolve through this table. No client access (only via functions).
create table if not exists public.username_history (
  username    text primary key,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  released_at timestamptz not null default now()
);
create index if not exists username_history_user_idx on public.username_history (user_id);

create table if not exists public.posts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  photo_path   text not null,
  caption      text check (char_length(caption) <= 200),
  -- Training day in Europe/Zurich; the client sends it, the default is a fallback.
  workout_date date not null default ((now() at time zone 'Europe/Zurich')::date),
  created_at   timestamptz not null default now()
);
create index if not exists posts_user_created_idx on public.posts (user_id, created_at desc);
create index if not exists posts_created_idx on public.posts (created_at desc);
create index if not exists posts_photo_path_idx on public.posts (photo_path);
-- false = only a training proof for streak and calendar, not shown in the feed.
alter table public.posts add column if not exists in_feed boolean not null default true;
-- The day's slideshow: the first proof of a training day; later photos of that day can be
-- added to it. At most one per person and day. photo_path stays its cover photo.
alter table public.posts add column if not exists is_day_post boolean not null default false;
-- Existing data: the first post of every day becomes that day's slideshow.
update public.posts p
set is_day_post = true
where p.id in (
    select distinct on (user_id, workout_date) id
    from public.posts
    order by user_id, workout_date, created_at
  )
  and not exists (
    select 1 from public.posts q
    where q.user_id = p.user_id and q.workout_date = p.workout_date and q.is_day_post
  );
create unique index if not exists posts_one_day_post_idx
  on public.posts (user_id, workout_date) where is_day_post;
-- Shown in the profile grid (only posts that are also in the feed appear there).
alter table public.posts add column if not exists show_in_profile boolean not null default true;

-- All photos of a post in carousel order (a single photo is one row).
create table if not exists public.post_media (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.posts (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  photo_path text not null,
  position   integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists post_media_post_idx on public.post_media (post_id, position);
-- Non-destructive editing: the unedited photo and the edits (filter, texts, mentions as
-- JSON) are kept, photo_path is the rendered result shown to others. Without edits both
-- paths are the same file. The original is only readable by its owner (own folder).
alter table public.post_media add column if not exists original_path text;
alter table public.post_media add column if not exists edits jsonb;
create index if not exists post_media_photo_path_idx on public.post_media (photo_path);
-- Existing posts: their single photo becomes their only media row.
insert into public.post_media (post_id, user_id, photo_path, position)
select p.id, p.user_id, p.photo_path, 0
from public.posts p
where not exists (select 1 from public.post_media m where m.post_id = p.id);

-- People tagged in a post. They may see that post even if they don't follow the author.
create table if not exists public.post_tags (
  post_id    uuid not null references public.posts (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create index if not exists post_tags_user_idx on public.post_tags (user_id);

create table if not exists public.post_likes (
  post_id    uuid not null references public.posts (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create index if not exists post_likes_user_idx on public.post_likes (user_id);

create table if not exists public.comments (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.posts (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);
create index if not exists comments_post_created_idx on public.comments (post_id, created_at);
-- Replies are one level deep: parent_comment_id points at a top-level comment of the same
-- post (enforced by the insert policy). Deleting a comment deletes its replies.
alter table public.comments
  add column if not exists parent_comment_id uuid references public.comments (id) on delete cascade;
create index if not exists comments_parent_idx on public.comments (parent_comment_id)
  where parent_comment_id is not null;

create table if not exists public.comment_likes (
  comment_id uuid not null references public.comments (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);
create index if not exists comment_likes_user_idx on public.comment_likes (user_id);

create table if not exists public.follows (
  follower_id  uuid not null references public.profiles (id) on delete cascade,
  following_id uuid not null references public.profiles (id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (follower_id, following_id),
  check (follower_id <> following_id)
);
create index if not exists follows_following_idx on public.follows (following_id);
-- Existing follows become 'accepted' (column default when added); new rows get their status
-- from the follows_set_status trigger, never from the client.
alter table public.follows add column if not exists status text not null default 'accepted';
alter table public.follows alter column status set default 'pending';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'follows_status_check') then
    alter table public.follows add constraint follows_status_check check (status in ('pending', 'accepted'));
  end if;
end;
$$;
create index if not exists follows_following_status_idx on public.follows (following_id, status);

create table if not exists public.stories (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  photo_path text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);
create index if not exists stories_user_expires_idx on public.stories (user_id, expires_at desc);
-- People tagged in the story; they may see it even if they don't follow the author.
alter table public.stories add column if not exists mentioned_user_ids uuid[] not null default '{}';
create index if not exists stories_mentions_idx on public.stories using gin (mentioned_user_ids);
create index if not exists stories_photo_path_idx on public.stories (photo_path);
-- Where the @mentions sit on the story photo ([{user_id, x, y}], 0-1 of the canvas) and the
-- canvas aspect ratio, so the viewer can make them tappable. overlay_text = the text added
-- on the photo (for hashtags).
alter table public.stories add column if not exists mention_positions jsonb not null default '[]';
alter table public.stories add column if not exists canvas_aspect real;
alter table public.stories add column if not exists overlay_text text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'stories_overlay_text_length') then
    alter table public.stories
      add constraint stories_overlay_text_length check (char_length(overlay_text) <= 2000);
  end if;
end;
$$;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'stories_mentions_limit') then
    alter table public.stories
      add constraint stories_mentions_limit check (cardinality(mentioned_user_ids) <= 10);
  end if;
end;
$$;

create table if not exists public.story_likes (
  story_id   uuid not null references public.stories (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (story_id, user_id)
);

-- Who has seen which story (drives the "unseen" ring in the story bar).
create table if not exists public.story_views (
  story_id  uuid not null references public.stories (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (story_id, user_id)
);
create index if not exists story_views_user_idx on public.story_views (user_id);

-- Story highlights on the profile. The cover is one of the owner's stories.
create table if not exists public.highlights (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles (id) on delete cascade,
  title          text not null check (char_length(title) between 1 and 30),
  cover_story_id uuid references public.stories (id) on delete set null,
  created_at     timestamptz not null default now()
);
create index if not exists highlights_user_idx on public.highlights (user_id, created_at);

create table if not exists public.highlight_items (
  highlight_id uuid not null references public.highlights (id) on delete cascade,
  story_id     uuid not null references public.stories (id) on delete cascade,
  added_at     timestamptz not null default now(),
  primary key (highlight_id, story_id)
);
create index if not exists highlight_items_story_idx on public.highlight_items (story_id);

-- "Hide my stories / posts from this person". Only the owner can read or change it.
create table if not exists public.audience_restrictions (
  owner_id       uuid not null references public.profiles (id) on delete cascade,
  hidden_user_id uuid not null references public.profiles (id) on delete cascade,
  scope          text not null check (scope in ('stories', 'posts')),
  created_at     timestamptz not null default now(),
  primary key (owner_id, hidden_user_id, scope),
  check (owner_id <> hidden_user_id)
);
create index if not exists audience_restrictions_hidden_idx
  on public.audience_restrictions (hidden_user_id, scope);

create table if not exists public.conversations (
  id         uuid primary key default gen_random_uuid(),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
-- Deleting the account of whoever started a chat must not delete the chat of the others.
alter table public.conversations alter column created_by drop not null;
alter table public.conversations drop constraint if exists conversations_created_by_fkey;
alter table public.conversations add constraint conversations_created_by_fkey
  foreign key (created_by) references public.profiles (id) on delete set null;

create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  joined_at       timestamptz not null default now(),
  last_read_at    timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index if not exists conversation_members_user_idx on public.conversation_members (user_id);
-- "Chat für mich löschen": everything older is gone for me (not for the others); the chat is out
-- of my list until someone writes again. Set only by clear_chat_for_me(); nobody else can read it
-- (column privileges below), so the other person doesn't find out.
alter table public.conversation_members add column if not exists cleared_at timestamptz;

create table if not exists public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id       uuid not null references public.profiles (id) on delete cascade,
  body            text check (char_length(body) between 1 and 2000),
  -- Shared post. If the post is deleted later, the message stays as an empty
  -- "post no longer available" card. "Text or post" is enforced by the insert policy.
  post_id         uuid references public.posts (id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists messages_conversation_created_idx
  on public.messages (conversation_id, created_at desc);
create index if not exists messages_post_idx on public.messages (post_id) where post_id is not null;
-- Shared comment. Always sent together with its post_id (so the recipient can open the
-- post); if the comment is deleted later, the message falls back to the post card.
alter table public.messages
  add column if not exists comment_id uuid references public.comments (id) on delete set null;
-- Reply to another message of the same chat (enforced by the insert policy).
alter table public.messages
  add column if not exists reply_to_id uuid references public.messages (id) on delete set null;
-- Pinned messages, per chat. Only changed through set_message_pinned(), never directly.
alter table public.messages add column if not exists pinned_at timestamptz;
alter table public.messages
  add column if not exists pinned_by uuid references public.profiles (id) on delete set null;
create index if not exists messages_pinned_idx
  on public.messages (conversation_id, pinned_at desc) where pinned_at is not null;
-- Server-made messages: kind 'tag' = "X hat dich markiert" card (post, story or comment).
-- Clients can't insert them (messages insert policy requires kind and story_id to be null).
alter table public.messages add column if not exists kind text;
alter table public.messages
  add column if not exists story_id uuid references public.stories (id) on delete set null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'messages_kind_check') then
    alter table public.messages add constraint messages_kind_check check (kind is null or kind = 'tag');
  end if;
end;
$$;

-- One reaction per person and message. Removing a reaction sets emoji to null instead of
-- deleting the row: Realtime delivers updates with RLS and per-chat filters, deletes not.
-- conversation_id is copied from the message (checked by the policies) so Realtime can
-- filter by chat.
create table if not exists public.message_reactions (
  message_id      uuid not null references public.messages (id) on delete cascade,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  emoji           text check (emoji is null or char_length(emoji) between 1 and 32),
  updated_at      timestamptz not null default now(),
  primary key (message_id, user_id)
);
create index if not exists message_reactions_conversation_idx
  on public.message_reactions (conversation_id);

-- "Für mich löschen": messages I hid for myself; the others still see them. Written only by
-- hide_message_for_me(); goes with the message ("Für alle löschen") and with my account.
create table if not exists public.message_hidden (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  message_id uuid not null references public.messages (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, message_id)
);
create index if not exists message_hidden_message_idx on public.message_hidden (message_id);

-- "Auch fürs Workout verlinken": the post owner asks a tagged person; only that person
-- answers. An accepted link counts as their training day (workout_days()).
create table if not exists public.workout_shares (
  id             uuid primary key default gen_random_uuid(),
  post_id        uuid not null references public.posts (id) on delete cascade,
  tagged_user_id uuid not null references public.profiles (id) on delete cascade,
  status         text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at     timestamptz not null default now(),
  responded_at   timestamptz,
  unique (post_id, tagged_user_id)
);
create index if not exists workout_shares_tagged_idx on public.workout_shares (tagged_user_id, status);

-- Reposts point at the original post; no files are copied.
create table if not exists public.post_reposts (
  id               uuid primary key default gen_random_uuid(),
  original_post_id uuid not null references public.posts (id) on delete cascade,
  reposter_id      uuid not null references public.profiles (id) on delete cascade,
  caption          text check (char_length(caption) <= 200),
  created_at       timestamptz not null default now(),
  unique (original_post_id, reposter_id)
);
create index if not exists post_reposts_reposter_idx on public.post_reposts (reposter_id, created_at desc);
create index if not exists post_reposts_original_idx on public.post_reposts (original_post_id);

-- Hashtags with their use count (one use per post / comment / story that contains the tag).
create table if not exists public.hashtags (
  id         uuid primary key default gen_random_uuid(),
  tag        text not null unique check (tag ~ '^[a-z0-9_äöüß]{1,50}$'),
  use_count  integer not null default 0 check (use_count >= 0),
  created_at timestamptz not null default now()
);
create index if not exists hashtags_use_count_idx on public.hashtags (use_count desc);

-- Which content uses which tag. source_id points at posts / comments / stories by `source`.
create table if not exists public.content_hashtags (
  hashtag_id uuid not null references public.hashtags (id) on delete cascade,
  source     text not null check (source in ('post', 'comment', 'story')),
  source_id  uuid not null,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (source, source_id, hashtag_id)
);
create index if not exists content_hashtags_tag_idx on public.content_hashtags (hashtag_id, source, created_at desc);

-- In-app notifications that need their own row (tags, workout links, follow requests).
-- Written only by triggers / security definer functions; recipients read and mark them read.
create table if not exists public.notifications (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles (id) on delete cascade,
  actor_id         uuid not null references public.profiles (id) on delete cascade,
  type             text not null
                   check (type in ('tag', 'workout_tag_request', 'workout_tag_accepted', 'follow_request')),
  post_id          uuid references public.posts (id) on delete cascade,
  story_id         uuid references public.stories (id) on delete cascade,
  comment_id       uuid references public.comments (id) on delete cascade,
  workout_share_id uuid references public.workout_shares (id) on delete cascade,
  payload          jsonb not null default '{}',
  read_at          timestamptz,
  created_at       timestamptz not null default now()
);
create index if not exists notifications_user_created_idx on public.notifications (user_id, created_at desc);
-- (notifications_user_expiry_idx, for the expiry checks, is created after notification_expires_at.)

-- Training plans: an ordered cycle of days (e.g. Push, Pull, Beine, Ruhetag), repeated, not
-- tied to weekdays. Up to 10 per user, exactly one of them active (the one Home, the camera
-- and the plan streak use). Written only through save_plan / activate_plan / duplicate_plan /
-- delete_plan.
create table if not exists public.training_plans (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.profiles (id) on delete cascade,
  name                text not null check (char_length(name) between 1 and 40 and name = btrim(name)),
  show_in_profile     boolean not null default true,
  -- Set when units are added, removed or reordered (not for renames or notes).
  sequence_changed_at timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table if not exists public.plan_days (
  id         uuid primary key default gen_random_uuid(),
  plan_id    uuid not null references public.training_plans (id) on delete cascade,
  position   integer not null check (position >= 0),
  title      text not null check (char_length(title) between 1 and 30 and title = btrim(title)),
  notes      text check (char_length(notes) <= 300),
  created_at timestamptz not null default now(),
  unique (plan_id, position)
);

-- Several plans per user (the first version allowed one): the existing plan stays and is the
-- active one. visibility replaces show_in_profile (kept, no longer used): a shown plan becomes
-- 'followers', or 'public' when the owner's posts are public; a hidden one 'private'.
alter table public.training_plans drop constraint if exists training_plans_user_id_key;
create index if not exists training_plans_user_idx on public.training_plans (user_id);
alter table public.training_plans add column if not exists is_active boolean not null default false;
alter table public.training_plans add column if not exists allow_adopt boolean not null default true;
alter table public.training_plans
  add column if not exists adopted_from_plan_id uuid references public.training_plans (id) on delete set null;
alter table public.training_plans
  add column if not exists adopted_from_user_id uuid references public.profiles (id) on delete set null;
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'training_plans' and column_name = 'visibility'
  ) then
    alter table public.training_plans add column visibility text not null default 'private'
      check (visibility in ('private', 'followers', 'public'));
    update public.training_plans tp
    set visibility = case
          when not tp.show_in_profile then 'private'
          when exists (select 1 from public.profiles p
                       where p.id = tp.user_id and not p.is_private and p.post_visibility = 'everyone') then 'public'
          else 'followers'
        end,
        is_active = true;
  end if;
end;
$$;
create unique index if not exists training_plans_one_active_idx on public.training_plans (user_id) where is_active;

-- A plan day is a training day or a planned rest day (no exercises).
alter table public.plan_days add column if not exists day_type text not null default 'training';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'plan_days_day_type_check') then
    alter table public.plan_days add constraint plan_days_day_type_check check (day_type in ('training', 'rest'));
  end if;
end;
$$;

-- Exercises of a training day: sets and either a number of reps (or a range) or a time.
create table if not exists public.plan_exercises (
  id               uuid primary key default gen_random_uuid(),
  plan_day_id      uuid not null references public.plan_days (id) on delete cascade,
  position         integer not null check (position >= 0),
  name             text not null check (char_length(name) between 1 and 60 and name = btrim(name)),
  sets             integer not null check (sets between 1 and 20),
  reps_min         integer check (reps_min between 1 and 999),
  reps_max         integer check (reps_max between 1 and 999),
  target_seconds   integer check (target_seconds between 1 and 3600),
  target_weight_kg numeric(6, 2) check (target_weight_kg between 0 and 1000),
  notes            text check (char_length(notes) <= 300),
  created_at       timestamptz not null default now(),
  unique (plan_day_id, position),
  check (reps_min is not null or target_seconds is not null),
  check (reps_max is null or (reps_min is not null and reps_max >= reps_min))
);

-- Positions are unique per plan / per day, checked at the end of the transaction, so a reorder
-- can move every row in one update without duplicate positions in between.
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'plan_days_plan_id_position_key' and not condeferrable) then
    alter table public.plan_days drop constraint plan_days_plan_id_position_key;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'plan_days_plan_id_position_key') then
    alter table public.plan_days add constraint plan_days_plan_id_position_key
      unique (plan_id, position) deferrable initially deferred;
  end if;
  if exists (select 1 from pg_constraint where conname = 'plan_exercises_plan_day_id_position_key' and not condeferrable) then
    alter table public.plan_exercises drop constraint plan_exercises_plan_day_id_position_key;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'plan_exercises_plan_day_id_position_key') then
    alter table public.plan_exercises add constraint plan_exercises_plan_day_id_position_key
      unique (plan_day_id, position) deferrable initially deferred;
  end if;
end;
$$;

-- Progress through the current round of a plan: the round's order (day ids) and the index of
-- the unit due next; everything before it is done. After the last unit a new round starts in the
-- plan's order. One row per person and plan, written only by the plan functions (no client
-- writes). last_day: day of the last completed plan entry (for planned rest days).
-- skipped: units left out of this round ("Überspringen, entfällt"); they don't count as done and
-- come back with the next round.
create table if not exists public.plan_rounds (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  plan_id    uuid not null references public.training_plans (id) on delete cascade,
  day_order  uuid[] not null default '{}' check (cardinality(day_order) <= 30),
  next_index integer not null default 0 check (next_index >= 0),
  last_day   date,
  updated_at timestamptz not null default now(),
  primary key (user_id, plan_id)
);

alter table public.plan_rounds add column if not exists skipped uuid[] not null default '{}';

-- A proof (recorded training or post) of another unit than the one due next: always accepted,
-- the person decides how the plan goes on. At most one open ('pending') question per person;
-- further deviations update it (the latest one counts). proof_id is a plain uuid (the proof may
-- be deleted later); the titles are kept for the question and the notice.
create table if not exists public.plan_deviations (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles (id) on delete cascade,
  plan_id         uuid not null references public.training_plans (id) on delete cascade,
  proof_kind      text not null check (proof_kind in ('workout', 'post')),
  proof_id        uuid not null,
  done_day_id     uuid references public.plan_days (id) on delete set null,
  expected_day_id uuid references public.plan_days (id) on delete set null,
  done_title      text check (char_length(done_title) <= 30),
  expected_title  text check (char_length(expected_title) <= 30),
  status          text not null default 'pending' check (status in ('pending', 'exception', 'reordered', 'auto_exception')),
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz
);
create unique index if not exists plan_deviations_one_pending_idx on public.plan_deviations (user_id) where status = 'pending';
create index if not exists plan_deviations_user_idx on public.plan_deviations (user_id, created_at desc);

-- When the plan was deactivated ("Plan deaktivieren"); set again on activation. Only a plan
-- deactivated this way can be resumed where it stopped (activate_plan(p_resume)).
alter table public.training_plans add column if not exists deactivated_at timestamptz;

-- Adopted copies: when, and from whom (adopted_from_user_id becomes null when that account is
-- deleted; adopted_at stays, so the app can show "Gelöschtes Konto").
alter table public.training_plans add column if not exists adopted_at timestamptz;

-- Every adoption (for the daily limit and "one notification per adopter and plan"). No client
-- access; the plan owner never sees a list of adopters.
create table if not exists public.plan_adoptions (
  id             uuid primary key default gen_random_uuid(),
  adopter_id     uuid not null references public.profiles (id) on delete cascade,
  source_plan_id uuid references public.training_plans (id) on delete set null,
  owner_id       uuid references public.profiles (id) on delete set null,
  copy_plan_id   uuid references public.training_plans (id) on delete set null,
  created_at     timestamptz not null default now()
);
create index if not exists plan_adoptions_adopter_idx on public.plan_adoptions (adopter_id, created_at desc);
create index if not exists plan_adoptions_source_idx on public.plan_adoptions (source_plan_id, adopter_id);

-- "Benachrichtigen, wenn jemand meinen Plan übernimmt" (default on).
alter table public.profiles add column if not exists notify_plan_adopted boolean not null default true;

-- Planned rest days that were confirmed ("Ruhetag bestätigen"). Like rest_day_uses they keep
-- the streak alive without counting as a training day. Only use_planned_rest_day writes here.
-- The rows stay when the plan is deleted (the streak history doesn't change).
create table if not exists public.planned_rest_uses (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  day         date not null,
  plan_id     uuid references public.training_plans (id) on delete set null,
  plan_day_id uuid references public.plan_days (id) on delete set null,
  created_at  timestamptz not null default now(),
  primary key (user_id, day)
);

-- Default visibility of new activities (recorded trainings).
alter table public.profiles add column if not exists default_activity_visibility text not null default 'private';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_default_activity_visibility_check') then
    alter table public.profiles add constraint profiles_default_activity_visibility_check
      check (default_activity_visibility in ('private', 'followers', 'public'));
  end if;
end;
$$;

-- Recorded trainings ("Training aufzeichnen"). Only save_workout() writes them. workout_date is
-- the start day in Europe/Zurich (server side); counts_for_streak and not_counting_reason come
-- from the plausibility rules (workout_rules()). client_id makes saving repeatable (a retry
-- returns the same workout instead of a second one).
create table if not exists public.workouts (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.profiles (id) on delete cascade,
  client_id           uuid not null,
  plan_id             uuid references public.training_plans (id) on delete set null,
  plan_day_id         uuid references public.plan_days (id) on delete set null,
  -- Label of the plan day at the time of the training (kept when the plan changes).
  plan_day_title      text check (char_length(plan_day_title) <= 30),
  title               text check (char_length(title) between 1 and 60 and title = btrim(title)),
  note                text check (char_length(note) <= 1000),
  started_at          timestamptz not null,
  ended_at            timestamptz not null,
  active_seconds      integer not null check (active_seconds between 0 and 86400),
  workout_date        date not null,
  visibility          text not null default 'private' check (visibility in ('private', 'followers', 'public')),
  share_with_post     boolean not null default false,
  post_id             uuid references public.posts (id) on delete set null,
  counts_for_streak   boolean not null default false,
  not_counting_reason text check (not_counting_reason in ('too_short', 'too_few_sets', 'too_old', 'daily_limit')),
  proof               text not null default 'workout' check (proof = 'workout'),
  created_at          timestamptz not null default now(),
  unique (user_id, client_id),
  check (ended_at > started_at and ended_at - started_at <= interval '24 hours')
);
create index if not exists workouts_user_date_idx on public.workouts (user_id, workout_date desc);
create index if not exists workouts_post_idx on public.workouts (post_id) where post_id is not null;

create table if not exists public.workout_exercises (
  id                  uuid primary key default gen_random_uuid(),
  workout_id          uuid not null references public.workouts (id) on delete cascade,
  position            integer not null check (position between 0 and 29),
  name                text not null check (char_length(name) between 1 and 60 and name = btrim(name)),
  planned_exercise_id uuid references public.plan_exercises (id) on delete set null,
  unique (workout_id, position)
);

create table if not exists public.workout_sets (
  id                  uuid primary key default gen_random_uuid(),
  workout_exercise_id uuid not null references public.workout_exercises (id) on delete cascade,
  position            integer not null check (position between 0 and 39),
  reps                integer check (reps between 0 and 1000),
  weight_kg           numeric(6, 2) check (weight_kg between 0 and 1000),
  seconds             integer check (seconds between 0 and 86400),
  rest_seconds        integer check (rest_seconds between 0 and 3600),
  completed_at        timestamptz,
  unique (workout_exercise_id, position),
  check (reps is not null or seconds is not null)
);

-- Which unit of the poster's plan a training proof belongs to. The snapshot columns are
-- filled by the posts_plan_day trigger (never trusted from the client) and keep the label
-- ("Pull · Einheit 2 von 6") even if the unit or the plan is removed later.
alter table public.posts
  add column if not exists plan_day_id uuid references public.plan_days (id) on delete set null;
alter table public.posts add column if not exists plan_day_title text;
alter table public.posts add column if not exists plan_day_position integer;
alter table public.posts add column if not exists plan_length integer;
create index if not exists posts_plan_day_idx on public.posts (plan_day_id) where plan_day_id is not null;

-- Rest days: "X rest days per week" (calendar week Mon-Sun, Europe/Zurich, nothing carries
-- over). cycle_start is the day the number was set; it can change again 21 days later
-- (set_rest_budget).
create table if not exists public.rest_budgets (
  user_id         uuid primary key references public.profiles (id) on delete cascade,
  rests_per_cycle integer not null,
  cycle_start     date not null,
  updated_at      timestamptz not null default now()
);
-- Per week: at most 6 (first version allowed 0-9 per 21 days).
update public.rest_budgets set rests_per_cycle = least(rests_per_cycle, 6) where rests_per_cycle > 6;
alter table public.rest_budgets drop constraint if exists rest_budgets_rests_per_cycle_check;
alter table public.rest_budgets
  add constraint rest_budgets_rests_per_cycle_check check (rests_per_cycle between 0 and 6);

-- A rest day keeps the streak alive on a day without training. Only use_rest_day /
-- undo_rest_day write here.
create table if not exists public.rest_day_uses (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  day        date not null,
  created_at timestamptz not null default now(),
  primary key (user_id, day)
);


-- Moderation status of an account. Written only by moderation functions (never by clients,
-- see profiles_moderation_guard). A suspension ends by itself once suspended_until is past.
alter table public.profiles add column if not exists account_status text not null default 'active';
alter table public.profiles add column if not exists suspended_until timestamptz;
alter table public.profiles add column if not exists suspension_reason_code text;
-- Text the user may read on the "Konto gesperrt" screen.
alter table public.profiles add column if not exists moderation_message text;
alter table public.profiles add column if not exists moderation_updated_at timestamptz;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_account_status_check') then
    alter table public.profiles
      add constraint profiles_account_status_check
      check (account_status in ('active', 'suspended', 'banned', 'deleting'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_moderation_message_length') then
    alter table public.profiles
      add constraint profiles_moderation_message_length check (char_length(moderation_message) <= 1000);
  end if;
end;
$$;

-- Blocks. Only the blocker can see their own rows; the blocked person never finds out.
create table if not exists public.user_blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index if not exists user_blocks_blocked_idx on public.user_blocks (blocked_id);

-- Reports. Written only through report_content() / report_message(). The reporter becomes
-- null when their account is deleted; target_user_id and handled_by are plain uuids (no
-- foreign key), so reports never block deleting an account.
create table if not exists public.reports (
  id              uuid primary key default gen_random_uuid(),
  reporter_id     uuid references public.profiles (id) on delete set null,
  target_type     text not null check (target_type in ('post', 'story', 'comment', 'message', 'profile', 'sound')),
  target_id       uuid not null,
  target_user_id  uuid,
  reason          text not null check (reason in (
                    'spam', 'harassment', 'nudity', 'violence', 'hate', 'copyright',
                    'self_harm', 'non_consensual', 'other')),
  details         text check (char_length(details) <= 500),
  status          text not null default 'open' check (status in ('open', 'in_review', 'resolved', 'dismissed')),
  resolution_note text,
  handled_by      uuid,
  handled_at      timestamptz,
  created_at      timestamptz not null default now()
);
create unique index if not exists reports_one_per_target_idx on public.reports (reporter_id, target_type, target_id);
alter table public.reports drop constraint if exists reports_target_type_check;
alter table public.reports add constraint reports_target_type_check
  check (target_type in ('post', 'story', 'comment', 'message', 'profile', 'sound', 'plan', 'workout'));
create index if not exists reports_status_created_idx on public.reports (status, created_at);
create index if not exists reports_target_user_idx on public.reports (target_user_id);

-- Copies of a reported message and its context (up to 5 messages before and after), taken
-- when it is reported. Moderators see chats only through these rows. No client access.
create table if not exists public.report_snapshots (
  id              uuid primary key default gen_random_uuid(),
  report_id       uuid not null references public.reports (id) on delete cascade,
  message_id      uuid not null,
  conversation_id uuid not null,
  sender_id       uuid,
  body            text,
  post_id         uuid,
  comment_id      uuid,
  story_id        uuid,
  kind            text,
  sent_at         timestamptz not null,
  is_reported     boolean not null default false,
  created_at      timestamptz not null default now()
);
create index if not exists report_snapshots_report_idx on public.report_snapshots (report_id, sent_at);

-- Staff roles. No client access at all (not even reading); set by hand (supabase/admin-setup.sql).
create table if not exists public.admin_roles (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  role       text not null check (role in ('moderator', 'admin')),
  created_at timestamptz not null default now()
);

-- Append-only log of every moderation action and every look at private content. Ids are plain
-- uuids without foreign keys, so deleting an account never touches or blocks the log.
create table if not exists public.moderation_actions (
  id             uuid primary key default gen_random_uuid(),
  actor_id       uuid,
  action         text not null,
  target_type    text,
  target_id      uuid,
  target_user_id uuid,
  report_id      uuid,
  reason         text not null check (char_length(btrim(reason)) >= 10),
  user_message   text check (char_length(user_message) <= 1000),
  details        jsonb not null default '{}',
  created_at     timestamptz not null default now()
);
create index if not exists moderation_actions_created_idx on public.moderation_actions (created_at desc);
create index if not exists moderation_actions_target_user_idx on public.moderation_actions (target_user_id, created_at desc);

-- Messages from the moderation team the affected person may read (warnings, removals).
create table if not exists public.moderation_notices (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  action_id  uuid,
  kind       text not null check (kind in ('warning', 'removal', 'suspension', 'ban', 'info')),
  message    text not null check (char_length(message) between 1 and 1000),
  created_at timestamptz not null default now(),
  read_at    timestamptz
);
create index if not exists moderation_notices_user_idx on public.moderation_notices (user_id, created_at desc);

-- Legal texts. Every type ('terms' | 'privacy' | 'guidelines') has numbered versions; the newest
-- published version is the current one. Published versions are frozen (legal_documents_guard).
create table if not exists public.legal_documents (
  id                    uuid primary key default gen_random_uuid(),
  doc_type              text not null check (doc_type in ('terms', 'privacy', 'guidelines')),
  version               integer not null check (version >= 1),
  title                 text not null check (char_length(title) between 1 and 120),
  body_md               text not null check (char_length(body_md) between 1 and 200000),
  change_summary        text check (char_length(change_summary) <= 2000),
  status                text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  -- Terms are accepted; the privacy policy and guidelines are only acknowledged (information,
  -- not consent).
  confirmation_type     text not null check (confirmation_type in ('accept', 'acknowledge')),
  requires_confirmation boolean not null default true,
  blocking              boolean not null default false,
  grace_days            integer not null default 5 check (grace_days between 0 and 60),
  content_hash          text,
  published_at          timestamptz,
  announced_at          timestamptz,
  created_by            uuid,
  created_at            timestamptz not null default now(),
  unique (doc_type, version)
);

-- Who confirmed which version. Only confirm_legal_documents() writes here; nothing changes or
-- deletes rows, except deleting the account (cascade). No IP addresses, no device ids.
create table if not exists public.legal_confirmations (
  user_id                 uuid not null references public.profiles (id) on delete cascade,
  document_id             uuid not null references public.legal_documents (id),
  confirmation_type       text not null check (confirmation_type in ('accept', 'acknowledge')),
  confirmed_at            timestamptz not null default now(),
  app_version             text check (char_length(app_version) <= 32),
  content_hash_at_confirm text not null,
  primary key (user_id, document_id)
);
create index if not exists legal_confirmations_document_idx on public.legal_confirmations (document_id);

-- Reminder rhythm per user and version (every 5 days until confirmed; computed when read).
create table if not exists public.confirmation_followups (
  user_id        uuid not null references public.profiles (id) on delete cascade,
  document_id    uuid not null references public.legal_documents (id) on delete cascade,
  last_action    text,
  last_action_at timestamptz,
  next_review_at timestamptz not null,
  action_count   integer not null default 0,
  note           text check (char_length(note) <= 500),
  primary key (user_id, document_id)
);
create index if not exists confirmation_followups_due_idx on public.confirmation_followups (document_id, next_review_at);

-- Legal update notices have no sender: notifications may come without an actor.
alter table public.notifications alter column actor_id drop not null;
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check
  check (type in ('tag', 'workout_tag_request', 'workout_tag_accepted', 'follow_request', 'legal_update',
                  'plan_adopted'));

-- Removed instead of deleted: content stays as evidence, files stay in storage.
-- moderation_state: null = visible, 'removed' or 'quarantined' (possibly illegal, admins only).
do $$
declare
  t text;
begin
  foreach t in array array['posts', 'stories', 'comments', 'messages', 'training_plans', 'workouts'] loop
    execute format('alter table public.%I add column if not exists moderation_state text', t);
    execute format('alter table public.%I add column if not exists removed_at timestamptz', t);
    execute format('alter table public.%I add column if not exists removed_by uuid', t);
    execute format('alter table public.%I add column if not exists removed_reason text', t);
    if not exists (select 1 from pg_constraint where conname = t || '_moderation_state_check') then
      execute format(
        'alter table public.%I add constraint %I check (moderation_state in (''removed'', ''quarantined''))',
        t, t || '_moderation_state_check'
      );
    end if;
  end loop;
end;
$$;


-- -----------------------------------------------------------------------------
-- Helper functions
-- security definer + empty search_path: they bypass RLS on purpose (to avoid
-- recursive policies) and only ever answer for the calling user (auth.uid()).
-- -----------------------------------------------------------------------------

create or replace function public.is_following(target uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.follows
    where follower_id = (select auth.uid()) and following_id = target and status = 'accepted'
  );
$$;

-- ---------------------------------------------------------------- blocks and account status
-- Has either of the two blocked the other? Internal; policies use can_see_account().
create or replace function public.is_blocked_between(a uuid, b uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.user_blocks ub
    where (ub.blocker_id = a and ub.blocked_id = b) or (ub.blocker_id = b and ub.blocked_id = a)
  );
$$;

-- Active, or a suspension whose end has passed (checked at query time, no cron).
create or replace function public.account_is_active(target uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = target
      and (
        p.account_status = 'active'
        or (p.account_status = 'suspended' and p.suspended_until is not null and p.suspended_until <= now())
      )
  );
$$;

-- May the caller write anything? Every write policy and write function asks this.
create or replace function public.is_account_active()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.account_is_active((select auth.uid()));
$$;

-- Does `target` exist for the caller at all? Not for accounts that aren't active and not
-- across a block in either direction. The caller always sees themself; a caller whose own
-- account isn't active sees nobody else (so the session of a banned account is useless).
create or replace function public.can_see_account(target uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select target = (select auth.uid())
    or (
      public.is_account_active()
      and public.account_is_active(target)
      and not public.is_blocked_between((select auth.uid()), target)
    );
$$;

-- ---------------------------------------------------------------- official account
-- The one account official posts (surveys, results) come from. Set by hand with
-- supabase/official-account-setup.sql (not part of this file). Nobody can write to it or follow
-- it; it is protected in the data reset and can't be deleted while it is the official account.
-- Its e-mail address and account data never leave the server (only public profile fields do).
create table if not exists public.official_account (
  id         boolean primary key default true check (id),
  user_id    uuid not null unique references public.profiles (id) on delete cascade,
  -- "Beschreibung" on the official profile (public).
  bio        text check (bio is null or char_length(btrim(bio)) between 1 and 300),
  updated_at timestamptz not null default now()
);
alter table public.official_account enable row level security;
revoke all on public.official_account from public, anon, authenticated;

create or replace function public.official_user_id()
returns uuid
language sql stable security definer set search_path = ''
as $$
  select o.user_id from public.official_account o where o.id;
$$;

create or replace function public.is_official(p_user uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_user is not null and exists (select 1 from public.official_account o where o.id and o.user_id = p_user);
$$;

-- True if `owner`'s posts or active stories ('posts' / 'stories') are open to every
-- signed-in user: public profile and the setting is 'everyone'.
create or replace function public.is_public_content(owner uuid, scope text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = owner
      and not p.is_private
      and (case is_public_content.scope when 'posts' then p.post_visibility else p.story_visibility end) = 'everyone'
  );
$$;

-- Follower / following lists of `target` are readable for: target, accepted followers,
-- everyone if the profile is public.
create or replace function public.can_view_follow_lists(target uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select target = (select auth.uid())
    or (
      public.can_see_account(target)
      and (public.is_following(target) or exists (select 1 from public.profiles p where p.id = target and not p.is_private))
    );
$$;

-- Follower and following counts (accepted only); visible for every profile, also private ones.
create or replace function public.follow_counts(target uuid)
returns table (followers bigint, following bigint)
language sql stable security definer set search_path = ''
as $$
  select
    (select count(*) from public.follows f where f.following_id = target and f.status = 'accepted'),
    (select count(*) from public.follows f where f.follower_id = target and f.status = 'accepted');
$$;

-- Follows: the status is decided here, from the followed profile, never by the client.
create or replace function public.handle_follow_insert()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  -- The official account takes no followers and no requests (neutral message).
  if public.is_official(new.following_id) then
    raise exception 'follow_not_possible';
  end if;
  new.status := case
    when exists (select 1 from public.profiles p where p.id = new.following_id and not p.is_private)
      then 'accepted'
    else 'pending'
  end;
  new.created_at := now();
  return new;
end;
$$;

-- Only the status may change, and only from 'pending' to 'accepted'.
create or replace function public.handle_follow_update()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.follower_id <> old.follower_id
    or new.following_id <> old.following_id
    or new.created_at <> old.created_at then
    raise exception 'only the status of a follow can change';
  end if;
  if new.status <> old.status and not (old.status = 'pending' and new.status = 'accepted') then
    raise exception 'follow requests can only be accepted';
  end if;
  return new;
end;
$$;

-- Going from private to public accepts all open requests.
create or replace function public.handle_profile_privacy_change()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if old.is_private and not new.is_private then
    update public.follows set status = 'accepted' where following_id = new.id and status = 'pending';
  end if;
  return new;
end;
$$;

-- True if `owner` has hidden their `scope` ('stories' or 'posts') from the caller.
create or replace function public.is_hidden_from_me(owner uuid, scope text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.audience_restrictions r
    where r.owner_id = owner and r.hidden_user_id = (select auth.uid()) and r.scope = is_hidden_from_me.scope
  );
$$;

-- True if the caller follows every user in `ids` (an empty list is allowed).
create or replace function public.follows_all(ids uuid[])
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(bool_and(public.is_following(id)), true) from unnest(ids) as id;
$$;

create or replace function public.can_see_user_content(owner uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select owner = (select auth.uid()) or public.is_following(owner);
$$;

create or replace function public.is_conversation_member(conversation uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.conversation_members
    where conversation_id = conversation and user_id = (select auth.uid())
  );
$$;

-- True if the post was shared into a chat the caller is a member of.
create or replace function public.is_post_shared_with_me(post uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.messages m
    where m.post_id = post and public.is_conversation_member(m.conversation_id)
  );
$$;

-- True if the caller is tagged in the post.
create or replace function public.is_tagged_in_post(post uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.post_tags t where t.post_id = post and t.user_id = (select auth.uid())
  );
$$;

-- True if the caller owns the post.
create or replace function public.is_my_post(post uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.posts p where p.id = post and p.user_id = (select auth.uid()));
$$;

-- For policies on OTHER tables (likes, comments, messages) that reference an existing post.
-- Don't use it in the posts policy itself: it looks the post up again, and inside
-- INSERT ... RETURNING that lookup can't see the row being inserted yet.
create or replace function public.can_view_post(post uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.posts p
    where p.id = post
      and p.moderation_state is null
      and (
        p.user_id = (select auth.uid())
        or (
          -- Streak-only proofs: photos, likes, comments only for the owner.
          p.in_feed
          and public.can_see_account(p.user_id)
          and (
            public.is_following(p.user_id)
            or public.is_post_shared_with_me(p.id)
            or public.is_tagged_in_post(p.id)
            or public.is_public_content(p.user_id, 'posts')
          )
          and not public.is_hidden_from_me(p.user_id, 'posts')
        )
      )
  );
$$;

-- A comment is visible exactly when its post is.
create or replace function public.can_view_comment(comment uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.comments c
    where c.id = comment and c.moderation_state is null
      and public.can_view_post(c.post_id) and public.can_see_account(c.user_id)
  );
$$;

-- True if `parent` is a top-level comment on `post` (replies are only one level deep).
create or replace function public.is_top_level_comment_on(parent uuid, post uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.comments c
    where c.id = parent and c.post_id = post and c.parent_comment_id is null
  );
$$;

-- True if `comment` belongs to `post`; a shared comment must travel with its own post.
create or replace function public.comment_belongs_to_post(comment uuid, post uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.comments c where c.id = comment and c.post_id = post);
$$;

create or replace function public.is_my_story(story uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.stories s where s.id = story and s.user_id = (select auth.uid()));
$$;

create or replace function public.is_my_highlight(highlight uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.highlights h where h.id = highlight and h.user_id = (select auth.uid()));
$$;

-- Highlights are for the owner and followers, unless the owner hid their stories from the caller.
create or replace function public.can_view_highlight(highlight uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.highlights h
    where h.id = highlight
      and (
        h.user_id = (select auth.uid())
        or (
          public.can_see_account(h.user_id)
          and (public.is_following(h.user_id) or public.is_public_content(h.user_id, 'stories'))
          and not public.is_hidden_from_me(h.user_id, 'stories')
        )
      )
  );
$$;

-- True if the story is in a highlight the caller may see. Only this keeps expired stories
-- readable; stories can only be added to their owner's highlights (insert policy).
create or replace function public.is_in_visible_highlight(story uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.highlight_items hi
    where hi.story_id = story and public.can_view_highlight(hi.highlight_id)
  );
$$;

create or replace function public.can_view_story(story uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.stories s
    where s.id = story
      and s.moderation_state is null
      and (
        s.user_id = (select auth.uid())
        or (
          s.expires_at > now()
          and public.can_see_account(s.user_id)
          and (
            public.is_following(s.user_id)
            or (select auth.uid()) = any (s.mentioned_user_ids)
            or public.is_public_content(s.user_id, 'stories')
          )
          and not public.is_hidden_from_me(s.user_id, 'stories')
        )
        or public.is_in_visible_highlight(s.id)
      )
  );
$$;

-- Storage objects are named "{owner_id}/{kind}/{file}".
create or replace function public.can_view_photo(object_name text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select
    (storage.foldername(object_name))[1] = (select auth.uid())::text
    -- Avatars are visible to every signed-in user (search results, chats).
    or (storage.foldername(object_name))[2] = 'avatar'
    -- Post and story photos follow the visibility of their post/story exactly.
    or exists (
      select 1 from public.posts p
      where p.photo_path = object_name and public.can_view_post(p.id)
    )
    or exists (
      select 1 from public.post_media m
      where m.photo_path = object_name and public.can_view_post(m.post_id)
    )
    or exists (
      select 1 from public.stories s
      where s.photo_path = object_name and public.can_view_story(s.id)
    );
$$;

-- True if `message` belongs to `conversation`.
create or replace function public.message_in_conversation(message uuid, conversation uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.messages m where m.id = message and m.conversation_id = conversation
  );
$$;

-- Pins or unpins a message. Any member of its chat may do that.
create or replace function public.set_message_pinned(message uuid, pinned boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  conversation uuid;
begin
  if not public.is_account_active() then
    raise exception 'account_inactive';
  end if;
  select m.conversation_id into conversation from public.messages m where m.id = message;
  if conversation is null or not public.is_conversation_member(conversation) then
    raise exception 'message not found';
  end if;
  update public.messages
  set pinned_at = case when pinned then now() end,
      pinned_by = case when pinned then auth.uid() end
  where id = message;
end;
$$;

-- Has the caller hidden this message for themself ("Für mich löschen")?
create or replace function public.is_message_hidden_for_me(message uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.message_hidden h where h.message_id = message and h.user_id = (select auth.uid())
  );
$$;

-- Since when I see the messages of a chat ("Chat für mich löschen"); -infinity if never cleared.
create or replace function public.my_chat_cleared_at(conversation uuid)
returns timestamptz
language sql stable security definer set search_path = ''
as $$
  select coalesce((
    select m.cleared_at from public.conversation_members m
    where m.conversation_id = conversation and m.user_id = (select auth.uid())
  ), '-infinity'::timestamptz);
$$;

-- Is there a block between me and another member of the chat (in either direction)? Then the
-- messages of the chat are shown to both only as "Nachricht gelöscht" (get_chat_messages) and
-- can't be read through the table at all.
create or replace function public.conversation_blocked_pair(conversation uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.conversation_members m
    where m.conversation_id = conversation and m.user_id <> (select auth.uid())
      and public.is_blocked_between((select auth.uid()), m.user_id)
  );
$$;

-- "Für mich löschen": hides a message of one of my chats for me only. Any message of the chat,
-- also someone else's or a tag card. Repeating it is fine.
create or replace function public.hide_message_for_me(p_message_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  conversation uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if not public.is_account_active() then
    raise exception 'account_inactive';
  end if;
  select m.conversation_id into conversation from public.messages m where m.id = p_message_id;
  if conversation is null or not public.is_conversation_member(conversation) then
    raise exception 'message_not_found';
  end if;
  insert into public.message_hidden (user_id, message_id) values (auth.uid(), p_message_id)
  on conflict do nothing;
end;
$$;

-- "Für alle löschen": deletes my own message for good, without any trace in the chat. Only the
-- sender (for tag cards: whoever the sender column names), only while my account is active,
-- I'm still a member, and the message isn't moderated (removed or quarantined messages stay as
-- evidence). Reactions and hidden marks go with it (cascade), replies lose the quote (reply_to_id
-- set null); a shared post or comment stays. report_snapshots keep their copies (no foreign key).
create or replace function public.delete_message_for_everyone(p_message_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  target public.messages%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if not public.is_account_active() then
    raise exception 'account_inactive';
  end if;
  select * into target from public.messages m where m.id = p_message_id for update;
  if not found or not public.is_conversation_member(target.conversation_id) then
    raise exception 'message_not_found';
  end if;
  if target.sender_id is distinct from auth.uid() then
    raise exception 'message_not_own';
  end if;
  if target.moderation_state is not null or target.removed_at is not null then
    raise exception 'message_moderated';
  end if;
  delete from public.messages where id = p_message_id;
end;
$$;

-- "Chat für mich löschen": the whole history of one of my chats goes for me only. The others
-- notice nothing. The chat leaves my list and comes back, without the old messages, as soon as
-- someone writes again.
create or replace function public.clear_chat_for_me(p_conversation_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if not public.is_conversation_member(p_conversation_id) then
    raise exception 'chat_not_found';
  end if;
  update public.conversation_members
  set cleared_at = now(), last_read_at = now()
  where conversation_id = p_conversation_id and user_id = auth.uid();
  -- "Für mich gelöscht" marks of the old messages aren't needed any more.
  delete from public.message_hidden h
  using public.messages m
  where h.user_id = auth.uid() and m.id = h.message_id and m.conversation_id = p_conversation_id;
end;
$$;

-- My chats I cleared ("Chat für mich löschen"), for the chat list: only my own rows.
create or replace function public.get_my_cleared_conversations()
returns table (conversation_id uuid, cleared_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select m.conversation_id, m.cleared_at from public.conversation_members m
  where m.user_id = (select auth.uid()) and m.cleared_at is not null;
$$;

-- Messages of one of my chats, newest first (p_before for older pages, at most 100). The same
-- rows the table shows me, plus, while a block exists between us, every message as "masked":
-- without text, post, comment, story or quote, so neither side can read them any more.
create or replace function public.get_chat_messages(p_conversation_id uuid, p_before timestamptz, p_limit integer)
returns table (
  id uuid, conversation_id uuid, sender_id uuid, body text, post_id uuid, comment_id uuid, reply_to_id uuid,
  pinned_at timestamptz, kind text, story_id uuid, created_at timestamptz, masked boolean
)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  blocked boolean;
begin
  if auth.uid() is null or not public.is_account_active() or not public.is_conversation_member(p_conversation_id) then
    return;
  end if;
  blocked := public.conversation_blocked_pair(p_conversation_id);
  return query
  select m.id, m.conversation_id, m.sender_id,
         case when blocked then null else m.body end,
         case when blocked then null else m.post_id end,
         case when blocked then null else m.comment_id end,
         case when blocked then null else m.reply_to_id end,
         case when blocked then null else m.pinned_at end,
         m.kind,
         case when blocked then null else m.story_id end,
         m.created_at, blocked
  from public.messages m
  where m.conversation_id = p_conversation_id
    and m.moderation_state is null
    and not public.is_message_hidden_for_me(m.id)
    and m.created_at > public.my_chat_cleared_at(p_conversation_id)
    and (p_before is null or m.created_at < p_before)
  order by m.created_at desc
  limit least(greatest(coalesce(p_limit, 30), 1), 100);
end;
$$;

-- Clients may only move their own read marker: when they cleared a chat and when they joined it
-- stays as the server set it (same idea as guard_content_moderation).
create or replace function public.guard_conversation_member()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.cleared_at := old.cleared_at;
    new.joined_at := old.joined_at;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------- tagging
-- Accepted follow in either direction. Internal (revoked from clients).
create or replace function public.are_connected(a uuid, b uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.follows f
    where f.status = 'accepted'
      and ((f.follower_id = a and f.following_id = b) or (f.follower_id = b and f.following_id = a))
  );
$$;

-- The tagging rule: the target's setting allows it, and (against spam) there is an accepted
-- follow in either direction, or the tagged content is public anyway. Internal.
create or replace function public.tag_allowed(actor uuid, target uuid, content_public boolean)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select actor is not null and target is not null and actor <> target
    and not public.is_blocked_between(actor, target)
    and public.account_is_active(target)
    and exists (
      select 1 from public.profiles p
      where p.id = target
        and (
          p.tag_permission = 'everyone'
          or (p.tag_permission = 'connections' and public.are_connected(actor, target))
        )
    )
    and (public.are_connected(actor, target) or content_public);
$$;

-- For policies and the app: may I tag `target` in my posts / stories ('posts' | 'stories')?
create or replace function public.can_tag(target uuid, scope text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.tag_allowed((select auth.uid()), target, public.is_public_content((select auth.uid()), scope));
$$;

-- The subset of `ids` I may tag (the app checks before adding a tag).
create or replace function public.taggable_user_ids(ids uuid[], scope text)
returns uuid[]
language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(id), '{}') from unnest(ids) as id where public.can_tag(id, scope);
$$;

-- Story mentions: at most 10, each one taggable.
create or replace function public.mentions_allowed(ids uuid[])
returns boolean
language sql stable security definer set search_path = ''
as $$
  select cardinality(ids) <= 10 and coalesce(bool_and(public.can_tag(id, 'stories')), true)
  from unnest(ids) as id;
$$;

-- Could `viewer` read the post (follower, tagged, public; not hidden)? Used for comment
-- mentions, so a tag never leads someone to a post they couldn't see. Internal.
create or replace function public.user_can_see_post(viewer uuid, post uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.posts p
    where p.id = post
      and (
        p.user_id = viewer
        or (
          p.in_feed
          and not public.is_blocked_between(viewer, p.user_id)
          and public.account_is_active(p.user_id)
          and (
            exists (
              select 1 from public.follows f
              where f.follower_id = viewer and f.following_id = p.user_id and f.status = 'accepted'
            )
            or exists (select 1 from public.post_tags t where t.post_id = p.id and t.user_id = viewer)
            or public.is_public_content(p.user_id, 'posts')
          )
          and not exists (
            select 1 from public.audience_restrictions r
            where r.owner_id = p.user_id and r.hidden_user_id = viewer and r.scope = 'posts'
          )
        )
      )
  );
$$;

-- ---------------------------------------------------------------- workouts
-- THE place that decides whether a post counts as a training proof (for its owner and for
-- linked people). Every post that wasn't removed by moderation counts, except the photos of a
-- recorded training (posted after that training was saved): the training itself is the proof
-- for its day, and its photos never make another day (or a training that didn't pass the
-- plausibility rules) count. An older slideshow they were added to keeps counting. A later
-- automatic check plugs in here.
create or replace function public.post_counts_as_workout(post uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  -- Removed or quarantined posts don't count.
  select exists (
    select 1 from public.posts p
    where p.id = post and p.moderation_state is null
      and not exists (
        select 1 from public.workouts w
        where w.post_id = p.id and w.created_at <= p.created_at
      )
  );
$$;

-- Workout links can be answered until the end of the day after the workout (Europe/Zurich).
create or replace function public.workout_share_deadline(day date)
returns timestamptz
language sql stable set search_path = ''
as $$
  select ((day + 2)::timestamp at time zone 'Europe/Zurich');
$$;

-- May the caller see `target`'s calendar (own, follower or public posts; not hidden)?
create or replace function public.can_view_calendar(target uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select target = (select auth.uid())
    or (
      public.can_see_account(target)
      and (public.is_following(target) or public.is_public_content(target, 'posts'))
      and not public.is_hidden_from_me(target, 'posts')
    );
$$;

-- Training days of `target`: own posts that count, accepted workout links (shared_by = the post
-- owner) and recorded trainings that count (workout_id). proof is the basis ('photo' or
-- 'workout'). Duplicate days are fine; the streak counts each day once.
drop function if exists public.workout_days(uuid);
create or replace function public.workout_days(target uuid)
returns table (day date, post_id uuid, shared_by uuid, proof text, workout_id uuid)
language sql stable security definer set search_path = ''
as $$
  select p.workout_date, p.id, null::uuid, 'photo'::text, null::uuid
  from public.posts p
  where p.user_id = target and public.can_view_calendar(target) and public.post_counts_as_workout(p.id)
  union all
  select p.workout_date, p.id, p.user_id, 'photo', null
  from public.workout_shares ws
  join public.posts p on p.id = ws.post_id
  where ws.tagged_user_id = target
    and ws.status = 'accepted'
    and public.can_view_calendar(target)
    and public.post_counts_as_workout(p.id)
  union all
  select w.workout_date, null, null, 'workout', w.id
  from public.workouts w
  where w.user_id = target and public.can_view_calendar(target)
    and w.counts_for_streak and w.moderation_state is null;
$$;

-- The owner may ask a tagged person to link a counting workout, before the deadline.
create or replace function public.can_request_workout_link(post uuid, target uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.posts p
    join public.post_tags t on t.post_id = p.id and t.user_id = target
    where p.id = post
      and p.user_id = (select auth.uid())
      and public.is_account_active()
      and public.can_see_account(target)
      and public.post_counts_as_workout(p.id)
      and now() < public.workout_share_deadline(p.workout_date)
  );
$$;

-- Only an accepted, linked person may repost, and only posts that are in the feed.
create or replace function public.can_repost(post uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.workout_shares ws
    join public.posts p on p.id = ws.post_id
    where ws.post_id = post
      and ws.tagged_user_id = (select auth.uid())
      and ws.status = 'accepted'
      and p.in_feed
  );
$$;

-- ---------------------------------------------------------------- server-side writers
-- 1:1 conversation between a and b, created if needed. Internal: callers check the chat rules.
create or replace function public.direct_conversation_between(a uuid, b uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  conversation uuid;
begin
  select cm.conversation_id into conversation
  from public.conversation_members cm
  join public.conversation_members other
    on other.conversation_id = cm.conversation_id and other.user_id = b
  where cm.user_id = a
    and (select count(*) from public.conversation_members all_m
         where all_m.conversation_id = cm.conversation_id) = 2
  limit 1;

  if conversation is null then
    insert into public.conversations (created_by) values (a) returning id into conversation;
    insert into public.conversation_members (conversation_id, user_id) values (conversation, a), (conversation, b);
  end if;
  return conversation;
end;
$$;

-- Internal: the only way notifications are created.
create or replace function public.create_notification(
  n_recipient uuid,
  n_actor uuid,
  n_type text,
  n_post uuid,
  n_story uuid,
  n_comment uuid,
  n_share uuid
)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if n_recipient is null or n_actor is null or n_recipient = n_actor then
    return;
  end if;
  insert into public.notifications (user_id, actor_id, type, post_id, story_id, comment_id, workout_share_id)
  values (n_recipient, n_actor, n_type, n_post, n_story, n_comment, n_share);
end;
$$;

-- Internal: a tag notifies the tagged person and, where a chat is allowed by the existing
-- rules (the tagger follows them, accepted), adds a "hat dich markiert" card to their chat.
-- Both respect the tagged person's settings.
create or replace function public.handle_tag(t_actor uuid, t_target uuid, t_post uuid, t_story uuid, t_comment uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  wants_notification boolean;
  wants_chat boolean;
begin
  if t_actor is null or t_target is null or t_actor = t_target then
    return;
  end if;
  -- Same tag again (e.g. tagged on the photo AND @mentioned in the caption, or a caption
  -- edited later): no second notification or chat card.
  if exists (
    select 1 from public.notifications n
    where n.type = 'tag' and n.user_id = t_target and n.actor_id = t_actor
      and n.post_id is not distinct from t_post and n.story_id is not distinct from t_story
      and n.comment_id is not distinct from t_comment
  ) or exists (
    select 1 from public.messages m
    join public.conversation_members cm on cm.conversation_id = m.conversation_id and cm.user_id = t_target
    where m.kind = 'tag' and m.sender_id = t_actor
      and m.post_id is not distinct from t_post and m.story_id is not distinct from t_story
      and m.comment_id is not distinct from t_comment
  ) then
    return;
  end if;
  select p.tag_notifications, p.tag_chat_messages into wants_notification, wants_chat
  from public.profiles p where p.id = t_target;
  if not found then
    return;
  end if;
  if wants_notification then
    perform public.create_notification(t_target, t_actor, 'tag', t_post, t_story, t_comment, null);
  end if;
  if wants_chat and exists (
    select 1 from public.follows f
    where f.follower_id = t_actor and f.following_id = t_target and f.status = 'accepted'
  ) then
    insert into public.messages (conversation_id, sender_id, post_id, story_id, comment_id, kind)
    values (public.direct_conversation_between(t_actor, t_target), t_actor, t_post, t_story, t_comment, 'tag');
  end if;
end;
$$;

-- ---------------------------------------------------------------- triggers
create or replace function public.on_post_tag_created()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  -- After the statement's rows are in: at most 10 tags per post.
  if (select count(*) from public.post_tags t where t.post_id = new.post_id) > 10 then
    raise exception 'too many tags (max 10 per post)';
  end if;
  perform public.handle_tag(
    (select p.user_id from public.posts p where p.id = new.post_id), new.user_id, new.post_id, null, null
  );
  return null;
end;
$$;

create or replace function public.on_story_created()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  mentioned uuid;
begin
  foreach mentioned in array new.mentioned_user_ids loop
    perform public.handle_tag(new.user_id, mentioned, null, new.id, null);
  end loop;
  perform public.sync_hashtags('story', new.id, new.user_id, new.overlay_text);
  return null;
end;
$$;

-- @username in a comment tags that person, if they may be tagged and could see the post.
create or replace function public.on_comment_created()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  mentioned uuid;
  post_public boolean;
begin
  perform public.sync_hashtags('comment', new.id, new.user_id, new.body);
  select public.is_public_content(p.user_id, 'posts') into post_public
  from public.posts p where p.id = new.post_id;
  for mentioned in
    select distinct pr.id
    from regexp_matches(new.body, '@([a-z0-9_.]{3,20})', 'gi') as m(parts)
    join public.profiles pr on pr.id = public.user_id_for_username(m.parts[1])
    limit 10
  loop
    if public.tag_allowed(new.user_id, mentioned, coalesce(post_public, false))
      and public.user_can_see_post(mentioned, new.post_id) then
      perform public.handle_tag(new.user_id, mentioned, new.post_id, null, new.id);
    end if;
  end loop;
  return null;
end;
$$;

-- ---------------------------------------------------------------- hashtags
-- #tags in a text, lowercased; letters (incl. äöüß), digits, _; same rule as lib/taggedText.ts.
create or replace function public.extract_hashtags(content text)
returns text[]
language sql immutable set search_path = ''
as $$
  select coalesce(array_agg(distinct lower(m[1])), '{}')
  from regexp_matches(
    coalesce(content, ''), '(?:^|[^a-zA-Z0-9_.@#äöüßÄÖÜ])#([a-zA-Z0-9_äöüßÄÖÜ]{1,50})', 'g'
  ) as m;
$$;

-- Text of a post that can contain hashtags: caption plus texts drawn on its photos. Internal.
create or replace function public.post_tag_text(post uuid)
returns text
language sql stable security definer set search_path = ''
as $$
  select coalesce(p.caption, '') || ' ' || coalesce((
    select string_agg(item ->> 'text', ' ')
    from public.post_media m
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(m.edits -> 'items') = 'array' then m.edits -> 'items' else '[]'::jsonb end
    ) as item
    where m.post_id = p.id and item ->> 'kind' = 'text'
  ), '')
  from public.posts p
  where p.id = post;
$$;

-- Makes the content's hashtag links match its text; counters follow via triggers. Internal.
create or replace function public.sync_hashtags(h_source text, h_source_id uuid, h_user uuid, h_text text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  tags text[] := public.extract_hashtags(h_text);
begin
  delete from public.content_hashtags ch
  using public.hashtags h
  where ch.source = h_source and ch.source_id = h_source_id and h.id = ch.hashtag_id
    and not (h.tag = any (tags));
  if h_user is null or cardinality(tags) = 0 then
    return;
  end if;
  insert into public.hashtags (tag) select unnest(tags) on conflict (tag) do nothing;
  insert into public.content_hashtags (hashtag_id, source, source_id, user_id)
  select h.id, h_source, h_source_id, h_user from public.hashtags h where h.tag = any (tags)
  on conflict do nothing;
end;
$$;

create or replace function public.on_content_hashtag_change()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.hashtags set use_count = use_count + 1 where id = new.hashtag_id;
  else
    update public.hashtags set use_count = greatest(use_count - 1, 0) where id = old.hashtag_id;
  end if;
  return null;
end;
$$;

create or replace function public.on_post_text_change()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  mentioned uuid;
  post_public boolean := public.is_public_content(new.user_id, 'posts');
begin
  perform public.sync_hashtags('post', new.id, new.user_id, public.post_tag_text(new.id));
  -- @mentions in the caption notify like tags (once; handle_tag skips repeats).
  for mentioned in
    select distinct pr.id
    from regexp_matches(coalesce(new.caption, ''), '@([a-z0-9_.]{3,20})', 'gi') as m(parts)
    join public.profiles pr on pr.id = public.user_id_for_username(rtrim(m.parts[1], '.'))
    limit 10
  loop
    if public.tag_allowed(new.user_id, mentioned, post_public) and public.user_can_see_post(mentioned, new.id) then
      perform public.handle_tag(new.user_id, mentioned, new.id, null, null);
    end if;
  end loop;
  return null;
end;
$$;

-- Texts on photos are part of the post's hashtags too.
create or replace function public.on_post_media_change()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  changed_post uuid := coalesce(new.post_id, old.post_id);
begin
  perform public.sync_hashtags(
    'post', changed_post, (select p.user_id from public.posts p where p.id = changed_post),
    public.post_tag_text(changed_post)
  );
  return null;
end;
$$;

create or replace function public.on_tagged_content_deleted()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.content_hashtags where source = tg_argv[0] and source_id = old.id;
  return null;
end;
$$;

-- Workout links: always created as 'pending', whatever the client sends.
create or replace function public.on_workout_share_insert()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  new.status := 'pending';
  new.created_at := now();
  new.responded_at := null;
  return new;
end;
$$;

-- Answered once, pending -> accepted / declined, before the deadline; nothing else changes.
create or replace function public.on_workout_share_update()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  workout_day date;
begin
  if new.post_id <> old.post_id or new.tagged_user_id <> old.tagged_user_id or new.created_at <> old.created_at then
    raise exception 'only the status of a workout link can change';
  end if;
  if old.status <> 'pending' or new.status not in ('accepted', 'declined') then
    raise exception 'a workout link can only be answered once';
  end if;
  select p.workout_date into workout_day from public.posts p where p.id = new.post_id;
  if now() >= public.workout_share_deadline(workout_day) then
    raise exception 'this workout link has expired';
  end if;
  new.responded_at := now();
  return new;
end;
$$;

create or replace function public.on_workout_share_created()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.create_notification(
    new.tagged_user_id, (select p.user_id from public.posts p where p.id = new.post_id),
    'workout_tag_request', new.post_id, null, null, new.id
  );
  return null;
end;
$$;

-- Answer: the request counts as read; acceptance notifies the owner, declining doesn't.
create or replace function public.on_workout_share_answered()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  update public.notifications set read_at = coalesce(read_at, now())
  where workout_share_id = new.id and type = 'workout_tag_request';
  if new.status = 'accepted' then
    perform public.create_notification(
      (select p.user_id from public.posts p where p.id = new.post_id), new.tagged_user_id,
      'workout_tag_accepted', new.post_id, null, null, new.id
    );
  end if;
  return null;
end;
$$;

-- Follow requests (phase F) as notifications; they disappear once answered or withdrawn.
create or replace function public.on_follow_created()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.status = 'pending' then
    perform public.create_notification(new.following_id, new.follower_id, 'follow_request', null, null, null, null);
  end if;
  return null;
end;
$$;

create or replace function public.on_follow_request_closed()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.notifications
  where type = 'follow_request' and user_id = old.following_id and actor_id = old.follower_id;
  return null;
end;
$$;

-- When a notification expires: unseen 14 days after it was created; seen 7 days after it was
-- seen (read_at), but never later than 14 days after creation. Counted in hours (336 / 168), so
-- daylight saving time doesn't move it. Same as lib/notificationExpiry.ts.
create or replace function public.notification_expires_at(p_created_at timestamptz, p_read_at timestamptz)
returns timestamptz
language sql immutable set search_path = ''
as $$
  select case
    when p_read_at is null then p_created_at + interval '336 hours'
    else least(p_created_at + interval '336 hours', p_read_at + interval '168 hours')
  end;
$$;

-- A new notification clears the recipient's expired ones (no background job needed). Rows that
-- are inserted already back-dated (only the test script does that) don't trigger the cleanup.
create or replace function public.on_notification_created()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.created_at >= now() - interval '1 minute' then
    delete from public.notifications n
    where n.user_id = new.user_id and public.notification_expires_at(n.created_at, n.read_at) <= now();
  end if;
  return null;
end;
$$;

-- Deletes my expired notifications (called by the app when the notifications are loaded).
create or replace function public.purge_my_expired_notifications()
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  removed integer;
begin
  if auth.uid() is null or not public.is_account_active() then
    return 0;
  end if;
  delete from public.notifications n
  where n.user_id = auth.uid() and public.notification_expires_at(n.created_at, n.read_at) <= now();
  get diagnostics removed = row_count;
  return removed;
end;
$$;

-- Recipients may only mark notifications as read.
create or replace function public.on_notification_update()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.user_id <> old.user_id or new.actor_id <> old.actor_id or new.type <> old.type
    or new.post_id is distinct from old.post_id or new.story_id is distinct from old.story_id
    or new.comment_id is distinct from old.comment_id
    or new.workout_share_id is distinct from old.workout_share_id
    or new.payload <> old.payload or new.created_at <> old.created_at then
    raise exception 'notifications can only be marked as read';
  end if;
  return new;
end;
$$;

-- Lets the sign-up screen check a username before an account exists, and the profile editor
-- before a rename. Case-insensitive; your own current or former names count as available.
create or replace function public.username_available(name text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select not exists (
      select 1 from public.profiles p
      where lower(p.username) = lower(btrim(name)) and p.id is distinct from auth.uid()
    )
    and not exists (
      select 1 from public.username_history h
      where h.username = lower(btrim(name)) and h.user_id is distinct from auth.uid()
    );
$$;

-- Current owner of a username, falling back to whoever used it before (username_history).
-- Internal: used by the mention triggers and resolve_usernames.
create or replace function public.user_id_for_username(name text)
returns uuid
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select p.id from public.profiles p where p.username = lower(name)),
    (select h.user_id from public.username_history h where h.username = lower(name))
  );
$$;

-- User ids for @usernames in texts, including former names, so mentions survive renames.
create or replace function public.resolve_usernames(names text[])
returns table (username text, user_id uuid)
language sql stable security definer set search_path = ''
as $$
  select r.name, r.id
  from (
    select n.name, public.user_id_for_username(n.name) as id
    from unnest(names[1:100]) as n(name)
  ) r
  where r.id is not null;
$$;

-- Normalizes names and enforces the rename rules on every insert / update of a profile:
-- a username may change at most once per 14 days, never to a name someone else used before,
-- and username_changed_at can only be set here. onboarding_done_at can only go from empty to
-- "now" (server time), never back or to another time.
create or replace function public.on_profile_write()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  next_change timestamptz;
begin
  new.username := lower(btrim(new.username));
  new.display_name := coalesce(nullif(btrim(new.display_name), ''), new.username);
  if exists (
    select 1 from public.username_history h where h.username = new.username and h.user_id <> new.id
  ) then
    raise exception 'username_taken' using errcode = '23505';
  end if;

  if tg_op = 'INSERT' then
    new.username_changed_at := null;
    new.onboarding_done_at := null;
    return new;
  end if;

  if old.onboarding_done_at is not null then
    new.onboarding_done_at := old.onboarding_done_at;
  elsif new.onboarding_done_at is not null then
    new.onboarding_done_at := now();
  end if;

  if new.username = old.username then
    new.username_changed_at := old.username_changed_at;
    return new;
  end if;

  next_change := old.username_changed_at + interval '14 days';
  if next_change is not null and next_change > now() then
    raise exception 'username_change_too_soon'
      using errcode = 'P0001', hint = to_char(next_change at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  end if;
  insert into public.username_history (username, user_id, released_at)
  values (old.username, old.id, now())
  on conflict (username) do update set released_at = excluded.released_at
    where public.username_history.user_id = excluded.user_id;
  -- Taking back one of your own former names.
  delete from public.username_history where username = new.username and user_id = new.id;
  new.username_changed_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------- training plan
-- Who may read a plan (with its days and exercises): the owner always (also a plan removed by
-- the moderation). Others only when the plan isn't removed, the owner's account is visible to
-- them (active, no block), the plan isn't private and they are not hidden from the owner's posts; 'followers' for confirmed followers, 'public' also for
-- everyone signed in, but only while the owner's profile is public (otherwise followers only).
create or replace function public.can_view_plan(plan uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.training_plans tp
    join public.profiles owner_profile on owner_profile.id = tp.user_id
    where tp.id = plan
      and (
        tp.user_id = (select auth.uid())
        or (
          tp.visibility <> 'private'
          and tp.moderation_state is null
          and public.can_see_account(tp.user_id)
          and not public.is_hidden_from_me(tp.user_id, 'posts')
          and (
            public.is_following(tp.user_id)
            or (tp.visibility = 'public' and not owner_profile.is_private)
          )
        )
      )
  );
$$;

-- The first version had one plan per user (save_training_plan / delete_training_plan).
drop function if exists public.save_training_plan(text, boolean, jsonb);
drop function if exists public.delete_training_plan();

-- Limits of plans, also used by the app (lib/planRepo.ts).
create or replace function public.plan_limits()
returns jsonb
language sql immutable set search_path = ''
as $$
  select jsonb_build_object('plans', 10, 'days', 30, 'exercises_per_day', 20);
$$;

-- Creates (p_plan_id null) or updates one of my plans in one go. p_days is the full ordered
-- list: [{"id": <existing day id or null>, "type": "training" | "rest", "title": "...",
-- "notes": "...", "exercises": [{"id": ..., "name": "...", "sets": 3, "reps_min": 8,
-- "reps_max": 12, "target_seconds": null, "target_weight_kg": null, "notes": "..."}]}].
-- Existing days and exercises keep their id (posts stay assigned), the rest is removed.
-- 1 to 30 days, at most 20 exercises per training day, at most 10 plans. My very first plan is
-- active at once. Changing the order, adding or removing days resets nothing: progress is kept
-- per day id (plan_round_next()).
create or replace function public.save_plan(
  p_plan_id uuid, p_name text, p_visibility text, p_allow_adopt boolean, p_days jsonb
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  plan uuid := p_plan_id;
  day_ids uuid[] := '{}';
  day_item jsonb;
  ex_item jsonb;
  day_id uuid;
  ex_id uuid;
  ex_ids uuid[];
  day_kind text;
  idx integer := 0;
  ex_idx integer;
begin
  if me is null then
    raise exception 'not authenticated';
  end if;
  if not public.is_account_active() then
    raise exception 'account_inactive';
  end if;
  if p_visibility not in ('private', 'followers', 'public') then
    raise exception 'invalid_visibility';
  end if;
  if jsonb_typeof(p_days) is distinct from 'array' or jsonb_array_length(p_days) not between 1 and 30 then
    raise exception 'plan_length' using hint = 'A plan has 1 to 30 days.';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(p_days) d where coalesce(d ->> 'type', 'training') = 'training'
  ) then
    raise exception 'plan_needs_training_day';
  end if;

  if plan is null then
    -- Serialises plan creation per user (the limit of 10).
    perform 1 from public.profiles pr where pr.id = me for update;
    if (select count(*) from public.training_plans tp where tp.user_id = me) >= 10 then
      raise exception 'plan_limit' using hint = '10';
    end if;
    insert into public.training_plans (user_id, name, show_in_profile, visibility, allow_adopt, is_active)
    values (me, btrim(p_name), p_visibility <> 'private', p_visibility, coalesce(p_allow_adopt, true),
            not exists (select 1 from public.training_plans tp where tp.user_id = me))
    returning id into plan;
  else
    update public.training_plans
    set name = btrim(p_name), visibility = p_visibility, show_in_profile = p_visibility <> 'private',
        allow_adopt = coalesce(p_allow_adopt, true), updated_at = now()
    where id = plan and user_id = me;
    if not found then
      raise exception 'plan_not_found';
    end if;
  end if;

  -- Out of the way of the new positions (unique per plan).
  update public.plan_days set position = position + 1000 where plan_id = plan;

  for day_item in select value from jsonb_array_elements(p_days) loop
    day_kind := coalesce(day_item ->> 'type', 'training');
    if day_kind not in ('training', 'rest') then
      raise exception 'invalid_day_type';
    end if;
    day_id := nullif(day_item ->> 'id', '')::uuid;
    if day_id is not null
      and not (day_id = any (day_ids))
      and exists (select 1 from public.plan_days d where d.id = day_id and d.plan_id = plan) then
      update public.plan_days
      set position = idx, day_type = day_kind, title = btrim(day_item ->> 'title'),
          notes = nullif(btrim(coalesce(day_item ->> 'notes', '')), '')
      where id = day_id;
    else
      insert into public.plan_days (plan_id, position, day_type, title, notes)
      values (plan, idx, day_kind, btrim(day_item ->> 'title'), nullif(btrim(coalesce(day_item ->> 'notes', '')), ''))
      returning id into day_id;
    end if;
    day_ids := day_ids || day_id;

    -- Exercises: rest days have none.
    if day_kind = 'rest' then
      delete from public.plan_exercises where plan_day_id = day_id;
    else
      if jsonb_typeof(coalesce(day_item -> 'exercises', '[]'::jsonb)) <> 'array'
        or jsonb_array_length(coalesce(day_item -> 'exercises', '[]'::jsonb)) > 20 then
        raise exception 'too_many_exercises' using hint = '20';
      end if;
      update public.plan_exercises set position = position + 1000 where plan_day_id = day_id;
      ex_ids := '{}';
      ex_idx := 0;
      for ex_item in select value from jsonb_array_elements(coalesce(day_item -> 'exercises', '[]'::jsonb)) loop
        ex_id := nullif(ex_item ->> 'id', '')::uuid;
        if ex_id is not null
          and not (ex_id = any (ex_ids))
          and exists (select 1 from public.plan_exercises e where e.id = ex_id and e.plan_day_id = day_id) then
          update public.plan_exercises
          set position = ex_idx, name = btrim(ex_item ->> 'name'), sets = (ex_item ->> 'sets')::integer,
              reps_min = nullif(ex_item ->> 'reps_min', '')::integer,
              reps_max = nullif(ex_item ->> 'reps_max', '')::integer,
              target_seconds = nullif(ex_item ->> 'target_seconds', '')::integer,
              target_weight_kg = nullif(ex_item ->> 'target_weight_kg', '')::numeric,
              notes = nullif(btrim(coalesce(ex_item ->> 'notes', '')), '')
          where id = ex_id;
        else
          insert into public.plan_exercises
            (plan_day_id, position, name, sets, reps_min, reps_max, target_seconds, target_weight_kg, notes)
          values (
            day_id, ex_idx, btrim(ex_item ->> 'name'), (ex_item ->> 'sets')::integer,
            nullif(ex_item ->> 'reps_min', '')::integer, nullif(ex_item ->> 'reps_max', '')::integer,
            nullif(ex_item ->> 'target_seconds', '')::integer, nullif(ex_item ->> 'target_weight_kg', '')::numeric,
            nullif(btrim(coalesce(ex_item ->> 'notes', '')), '')
          )
          returning id into ex_id;
        end if;
        ex_ids := ex_ids || ex_id;
        ex_idx := ex_idx + 1;
      end loop;
      delete from public.plan_exercises where plan_day_id = day_id and not (id = any (ex_ids));
    end if;
    idx := idx + 1;
  end loop;

  delete from public.plan_days where plan_id = plan and not (id = any (day_ids));
  -- The template changed: the open part of the current round follows its order (done stays done).
  perform public.plan_round_template_changed(plan);
  return plan;
end;
$$;

-- Makes one of my plans the active one. Normally the order starts again at day 1 and the plan
-- streak runs anew (posts keep their assignment). p_resume: a plan I deactivated myself
-- continues where I stopped (its progress since the last start stays). Another plan that was
-- active is simply replaced.
drop function if exists public.activate_plan(uuid);
create or replace function public.activate_plan(p_plan_id uuid, p_resume boolean default false)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  target public.training_plans%rowtype;
begin
  if me is null then
    raise exception 'not authenticated';
  end if;
  if not public.is_account_active() then
    raise exception 'account_inactive';
  end if;
  select * into target from public.training_plans tp where tp.id = p_plan_id and tp.user_id = me for update;
  if not found then
    raise exception 'plan_not_found';
  end if;
  update public.training_plans set is_active = false, deactivated_at = null
  where user_id = me and is_active and id <> p_plan_id;
  -- An open question about another plan doesn't apply any more.
  update public.plan_deviations set status = 'auto_exception', resolved_at = now()
  where user_id = me and status = 'pending' and plan_id <> p_plan_id;
  if coalesce(p_resume, false) and target.deactivated_at is not null then
    update public.training_plans set is_active = true, deactivated_at = null, updated_at = now() where id = p_plan_id;
  else
    update public.training_plans set is_active = true, deactivated_at = null, sequence_changed_at = now(), updated_at = now()
    where id = p_plan_id;
    -- Day 1: a fresh round in the plan's order.
    delete from public.plan_rounds where user_id = me and plan_id = p_plan_id;
    update public.plan_deviations set status = 'auto_exception', resolved_at = now()
    where user_id = me and status = 'pending';
  end if;
end;
$$;

-- "Plan deaktivieren": afterwards no plan is active (also when it is my only one). The app then
-- behaves as without a plan, the rest day budget applies again, the plan streak ends; trainings
-- and posts keep their assignment. Nothing to do without an active plan.
create or replace function public.deactivate_plan()
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if not public.is_account_active() then
    raise exception 'account_inactive';
  end if;
  update public.training_plans set is_active = false, deactivated_at = now(), updated_at = now()
  where user_id = auth.uid() and is_active;
end;
$$;

-- New order of a plan's days: p_ordered_ids must be exactly the plan's day ids (each once).
-- One update, positions 0..n-1 without gaps. Resets nothing (progress is kept per day id).
create or replace function public.reorder_plan_days(p_plan_id uuid, p_ordered_ids uuid[])
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  existing uuid[];
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if not public.is_account_active() then
    raise exception 'account_inactive';
  end if;
  perform 1 from public.training_plans tp where tp.id = p_plan_id and tp.user_id = auth.uid() for update;
  if not found then
    raise exception 'plan_not_found';
  end if;
  if p_ordered_ids is null or cardinality(p_ordered_ids) not between 1 and 30 then
    raise exception 'invalid_order';
  end if;
  select array_agg(d.id) into existing from public.plan_days d where d.plan_id = p_plan_id;
  if cardinality(p_ordered_ids) <> coalesce(cardinality(existing), 0)
    or (select count(distinct x) from unnest(p_ordered_ids) x) <> cardinality(p_ordered_ids)
    or exists (select 1 from unnest(p_ordered_ids) x where not (x = any (existing))) then
    raise exception 'invalid_order';
  end if;
  update public.plan_days d set position = o.ord - 1
  from unnest(p_ordered_ids) with ordinality as o(id, ord)
  where d.id = o.id and d.plan_id = p_plan_id;
  update public.training_plans set updated_at = now() where id = p_plan_id;
  perform public.plan_round_template_changed(p_plan_id);
end;
$$;

-- New order of the exercises of one of my training days (same checks, at most 20).
create or replace function public.reorder_plan_exercises(p_day_id uuid, p_ordered_ids uuid[])
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  existing uuid[];
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if not public.is_account_active() then
    raise exception 'account_inactive';
  end if;
  perform 1 from public.plan_days d
  join public.training_plans tp on tp.id = d.plan_id
  where d.id = p_day_id and tp.user_id = auth.uid()
  for update of d;
  if not found then
    raise exception 'plan_day_not_found';
  end if;
  if p_ordered_ids is null or cardinality(p_ordered_ids) not between 1 and 20 then
    raise exception 'invalid_order';
  end if;
  select array_agg(e.id) into existing from public.plan_exercises e where e.plan_day_id = p_day_id;
  if cardinality(p_ordered_ids) <> coalesce(cardinality(existing), 0)
    or (select count(distinct x) from unnest(p_ordered_ids) x) <> cardinality(p_ordered_ids)
    or exists (select 1 from unnest(p_ordered_ids) x where not (x = any (existing))) then
    raise exception 'invalid_order';
  end if;
  update public.plan_exercises e set position = o.ord - 1
  from unnest(p_ordered_ids) with ordinality as o(id, ord)
  where e.id = o.id and e.plan_day_id = p_day_id;
end;
$$;

-- Copies one of my plans (with exercises, weights and notes) as an inactive plan.
create or replace function public.duplicate_plan(p_plan_id uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  source public.training_plans%rowtype;
  copy_id uuid;
  source_day record;
  new_day uuid;
begin
  if me is null then
    raise exception 'not authenticated';
  end if;
  if not public.is_account_active() then
    raise exception 'account_inactive';
  end if;
  select * into source from public.training_plans tp where tp.id = p_plan_id and tp.user_id = me;
  if not found then
    raise exception 'plan_not_found';
  end if;
  perform 1 from public.profiles pr where pr.id = me for update;
  if (select count(*) from public.training_plans tp where tp.user_id = me) >= 10 then
    raise exception 'plan_limit' using hint = '10';
  end if;
  insert into public.training_plans (user_id, name, show_in_profile, visibility, allow_adopt, is_active)
  values (me, left('Kopie von ' || source.name, 40), source.show_in_profile, source.visibility, source.allow_adopt, false)
  returning id into copy_id;
  for source_day in select * from public.plan_days d where d.plan_id = p_plan_id order by d.position loop
    insert into public.plan_days (plan_id, position, day_type, title, notes)
    values (copy_id, source_day.position, source_day.day_type, source_day.title, source_day.notes)
    returning id into new_day;
    insert into public.plan_exercises
      (plan_day_id, position, name, sets, reps_min, reps_max, target_seconds, target_weight_kg, notes)
    select new_day, e.position, e.name, e.sets, e.reps_min, e.reps_max, e.target_seconds, e.target_weight_kg, e.notes
    from public.plan_exercises e where e.plan_day_id = source_day.id;
  end loop;
  return copy_id;
end;
$$;

-- Deletes one of my plans (days and exercises go with it; posts and rest days stay).
create or replace function public.delete_plan(p_plan_id uuid)
returns void
language sql security definer set search_path = ''
as $$
  delete from public.training_plans
  where id = p_plan_id and user_id = (select auth.uid()) and public.is_account_active();
$$;

-- Copies a plan I may see into my plans ("Plan übernehmen"): days, exercises with sets, reps
-- and times, but without target weights and without notes. Private, origin "Übernommen von".
-- The original never changes. Checks: visible, adopting allowed, at most 10 own plans and 10
-- adoptions per day. Optionally activated right away (the order starts at day 1). The owner
-- gets one notification per adopter and plan, if they want it; none for my own plans.
create or replace function public.adopt_plan(p_plan_id uuid, p_activate boolean)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  source public.training_plans%rowtype;
  copy_id uuid;
  source_day record;
  new_day uuid;
  first_time boolean;
begin
  if me is null then
    raise exception 'not authenticated';
  end if;
  if not public.is_account_active() then
    raise exception 'account_inactive';
  end if;
  select * into source from public.training_plans tp where tp.id = p_plan_id;
  if not found or not public.can_view_plan(p_plan_id) or source.moderation_state is not null then
    raise exception 'plan_not_found';
  end if;
  if source.user_id <> me and (source.visibility = 'private' or not source.allow_adopt) then
    raise exception 'plan_not_adoptable';
  end if;
  -- Serialises per adopter (limits).
  perform 1 from public.profiles pr where pr.id = me for update;
  if (select count(*) from public.training_plans tp where tp.user_id = me) >= 10 then
    raise exception 'plan_limit' using hint = '10';
  end if;
  if (
    select count(*) from public.plan_adoptions a
    where a.adopter_id = me and a.created_at >= (public.app_today()::timestamp at time zone 'Europe/Zurich')
  ) >= 10 then
    raise exception 'adopt_limit' using hint = '10';
  end if;
  first_time := not exists (
    select 1 from public.plan_adoptions a where a.adopter_id = me and a.source_plan_id = source.id
  );

  insert into public.training_plans
    (user_id, name, show_in_profile, visibility, allow_adopt, is_active,
     adopted_from_plan_id, adopted_from_user_id, adopted_at)
  values (me, source.name, false, 'private', true, false, source.id, source.user_id, now())
  returning id into copy_id;
  for source_day in select * from public.plan_days d where d.plan_id = source.id order by d.position loop
    insert into public.plan_days (plan_id, position, day_type, title, notes)
    values (copy_id, source_day.position, source_day.day_type, source_day.title, null)
    returning id into new_day;
    insert into public.plan_exercises (plan_day_id, position, name, sets, reps_min, reps_max, target_seconds)
    select new_day, e.position, e.name, e.sets, e.reps_min, e.reps_max, e.target_seconds
    from public.plan_exercises e where e.plan_day_id = source_day.id;
  end loop;
  insert into public.plan_adoptions (adopter_id, source_plan_id, owner_id, copy_plan_id)
  values (me, source.id, source.user_id, copy_id);

  if coalesce(p_activate, false)
    or not exists (select 1 from public.training_plans tp where tp.user_id = me and tp.id <> copy_id) then
    update public.training_plans set is_active = false, deactivated_at = null where user_id = me and is_active;
    update public.training_plans set is_active = true, sequence_changed_at = now() where id = copy_id;
  end if;

  if source.user_id <> me and first_time
    and exists (select 1 from public.profiles pr where pr.id = source.user_id and pr.notify_plan_adopted) then
    insert into public.notifications (user_id, actor_id, type, payload)
    values (source.user_id, me, 'plan_adopted', jsonb_build_object('plan_id', source.id, 'plan_title', source.name));
  end if;
  return copy_id;
end;
$$;

-- Exercise names I used before, for suggestions (most used first).
create or replace function public.my_exercise_names()
returns table (name text)
language sql stable security definer set search_path = ''
as $$
  select x.name
  from (
    select e.name
    from public.plan_exercises e
    join public.plan_days d on d.id = e.plan_day_id
    join public.training_plans tp on tp.id = d.plan_id
    where tp.user_id = (select auth.uid())
    union all
    select we.name
    from public.workout_exercises we
    join public.workouts w on w.id = we.workout_id
    where w.user_id = (select auth.uid())
  ) x
  group by lower(x.name), x.name
  order by count(*) desc, x.name
  limit 200;
$$;

-- ---------------------------------------------------------------- recorded trainings
-- Plausibility rules (the app shows the same, lib/workout.ts). A training counts for the streak
-- only with at least 10 minutes of active time and 3 sets, started today or yesterday
-- (Europe/Zurich), and while the day has fewer than 2 counting trainings. Hard limits: 30
-- exercises, 40 sets per exercise, 24 hours, not in the future, 20 trainings per day.
create or replace function public.workout_rules()
returns jsonb
language sql immutable set search_path = ''
as $$
  select jsonb_build_object(
    'min_active_seconds', 600, 'min_sets', 3, 'max_days_back', 1, 'max_counting_per_day', 2,
    'max_per_day', 20, 'max_exercises', 30, 'max_sets_per_exercise', 40, 'max_hours', 24
  );
$$;

-- Saves one recorded training of the caller, all or nothing. payload:
-- {"client_id": uuid, "plan_day_id": uuid|null, "title": text|null, "note": text|null,
--  "started_at": iso, "ended_at": iso, "active_seconds": int, "visibility": text|null,
--  "share_with_post": bool, "exercises": [{"name": text, "planned_exercise_id": uuid|null,
--  "sets": [{"reps": int|null, "weight_kg": num|null, "seconds": int|null,
--            "rest_seconds": int|null, "completed_at": iso|null}]}]}
-- Returns {id, counts_for_streak, reason, workout_date}. Saving the same client_id again
-- returns the stored training.
create or replace function public.save_workout(payload jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  rules jsonb := public.workout_rules();
  client uuid;
  existing public.workouts%rowtype;
  started timestamptz;
  ended timestamptz;
  active integer;
  wday date;
  day_id uuid;
  plan uuid;
  day_title text;
  vis text;
  ex record;
  st record;
  ex_id uuid;
  planned uuid;
  total_sets integer := 0;
  new_id uuid;
  counting_today integer;
  reason text;
  done_at timestamptz;
  deviation uuid;
begin
  if me is null then
    raise exception 'not authenticated';
  end if;
  if not public.is_account_active() then
    raise exception 'account_inactive';
  end if;
  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'invalid_payload';
  end if;
  client := nullif(payload ->> 'client_id', '')::uuid;
  if client is null then
    raise exception 'invalid_payload' using hint = 'client_id';
  end if;
  select * into existing from public.workouts w where w.user_id = me and w.client_id = client;
  if found then
    return jsonb_build_object('id', existing.id, 'counts_for_streak', existing.counts_for_streak,
                              'reason', existing.not_counting_reason, 'workout_date', existing.workout_date);
  end if;

  started := (payload ->> 'started_at')::timestamptz;
  ended := (payload ->> 'ended_at')::timestamptz;
  active := (payload ->> 'active_seconds')::integer;
  if started is null or ended is null or active is null then
    raise exception 'invalid_times';
  end if;
  if started > now() + interval '1 minute' or ended > now() + interval '1 minute' then
    raise exception 'workout_in_future';
  end if;
  if ended <= started then
    raise exception 'workout_end_before_start';
  end if;
  if ended - started > make_interval(hours => (rules ->> 'max_hours')::integer) then
    raise exception 'workout_too_long';
  end if;
  if active < 0 or active > extract(epoch from ended - started) + 60 then
    raise exception 'invalid_active_time';
  end if;
  vis := coalesce(nullif(payload ->> 'visibility', ''),
                  (select p.default_activity_visibility from public.profiles p where p.id = me));
  if vis not in ('private', 'followers', 'public') then
    raise exception 'invalid_visibility';
  end if;
  if jsonb_typeof(coalesce(payload -> 'exercises', '[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(payload -> 'exercises', '[]'::jsonb)) > (rules ->> 'max_exercises')::integer then
    raise exception 'too_many_exercises' using hint = rules ->> 'max_exercises';
  end if;
  wday := (started at time zone 'Europe/Zurich')::date;

  -- One training at a time per person (limits).
  perform 1 from public.profiles pr where pr.id = me for update;
  if (select count(*) from public.workouts w where w.user_id = me and w.workout_date = wday)
     >= (rules ->> 'max_per_day')::integer then
    raise exception 'workout_daily_limit';
  end if;

  day_id := nullif(payload ->> 'plan_day_id', '')::uuid;
  if day_id is not null then
    select d.plan_id, d.title into plan, day_title
    from public.plan_days d
    join public.training_plans tp on tp.id = d.plan_id
    where d.id = day_id and tp.user_id = me and d.day_type = 'training';
    if not found then
      raise exception 'plan_day_not_yours';
    end if;
  end if;

  insert into public.workouts
    (user_id, client_id, plan_id, plan_day_id, plan_day_title, title, note, started_at, ended_at,
     active_seconds, workout_date, visibility, share_with_post)
  values (
    me, client, plan, day_id, day_title,
    nullif(btrim(coalesce(payload ->> 'title', '')), ''),
    nullif(btrim(coalesce(payload ->> 'note', '')), ''),
    started, ended, active, wday, vis, coalesce((payload ->> 'share_with_post')::boolean, false)
  )
  returning id into new_id;

  for ex in
    select value, ordinality - 1 as idx from jsonb_array_elements(coalesce(payload -> 'exercises', '[]'::jsonb)) with ordinality
  loop
    if jsonb_typeof(coalesce(ex.value -> 'sets', '[]'::jsonb)) <> 'array'
      or jsonb_array_length(coalesce(ex.value -> 'sets', '[]'::jsonb)) > (rules ->> 'max_sets_per_exercise')::integer then
      raise exception 'too_many_sets' using hint = rules ->> 'max_sets_per_exercise';
    end if;
    planned := nullif(ex.value ->> 'planned_exercise_id', '')::uuid;
    if planned is not null and (day_id is null or not exists (
      select 1 from public.plan_exercises e where e.id = planned and e.plan_day_id = day_id
    )) then
      planned := null;
    end if;
    insert into public.workout_exercises (workout_id, position, name, planned_exercise_id)
    values (new_id, ex.idx, btrim(coalesce(ex.value ->> 'name', '')), planned)
    returning id into ex_id;
    for st in
      select value, ordinality - 1 as idx from jsonb_array_elements(coalesce(ex.value -> 'sets', '[]'::jsonb)) with ordinality
    loop
      done_at := nullif(st.value ->> 'completed_at', '')::timestamptz;
      if done_at is not null and (done_at < started - interval '1 minute' or done_at > ended + interval '1 minute') then
        done_at := null;
      end if;
      insert into public.workout_sets (workout_exercise_id, position, reps, weight_kg, seconds, rest_seconds, completed_at)
      values (
        ex_id, st.idx,
        nullif(st.value ->> 'reps', '')::integer,
        nullif(st.value ->> 'weight_kg', '')::numeric,
        nullif(st.value ->> 'seconds', '')::integer,
        nullif(st.value ->> 'rest_seconds', '')::integer,
        done_at
      );
      total_sets := total_sets + 1;
    end loop;
  end loop;

  select count(*) into counting_today from public.workouts w
  where w.user_id = me and w.workout_date = wday and w.counts_for_streak and w.moderation_state is null
    and w.id <> new_id;
  reason := case
    when active < (rules ->> 'min_active_seconds')::integer then 'too_short'
    when total_sets < (rules ->> 'min_sets')::integer then 'too_few_sets'
    when wday < public.app_today() - (rules ->> 'max_days_back')::integer then 'too_old'
    when counting_today >= (rules ->> 'max_counting_per_day')::integer then 'daily_limit'
  end;
  update public.workouts set counts_for_streak = reason is null, not_counting_reason = reason where id = new_id;
  -- A counting training on a rest day makes the rest day unnecessary.
  if reason is null then
    delete from public.rest_day_uses where user_id = me and day = wday;
    delete from public.planned_rest_uses where user_id = me and day = wday;
    -- The plan's round: on to the next unit, or (another unit) one open question. Never refused.
    deviation := public.plan_record_proof(me, day_id, 'workout', new_id, wday);
  end if;
  return jsonb_build_object('id', new_id, 'counts_for_streak', reason is null, 'reason', reason, 'workout_date', wday,
                            'plan_deviation_id', deviation);
end;
$$;

-- Links a post (the photos of a recorded training) to that training. Both must be mine;
-- share_with_post: show the training report with the post.
create or replace function public.link_workout_post(p_workout_id uuid, p_post_id uuid, p_share boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if not public.is_account_active() then
    raise exception 'account_inactive';
  end if;
  if not exists (select 1 from public.posts p where p.id = p_post_id and p.user_id = auth.uid()) then
    raise exception 'post_not_found';
  end if;
  if exists (
    select 1 from public.workouts w
    where w.id = p_workout_id and w.post_id is not null and w.post_id <> p_post_id
  ) then
    raise exception 'workout_has_post';
  end if;
  update public.workouts
  set post_id = p_post_id, share_with_post = coalesce(p_share, false)
  where id = p_workout_id and user_id = auth.uid() and moderation_state is null;
  if not found then
    raise exception 'workout_not_found';
  end if;
end;
$$;

-- Who may see a recorded training (report, sets, times): the owner always. Others only when it
-- isn't removed, the owner's account is visible to them (active, no block) and they aren't
-- hidden from the owner's posts; then 'followers' for confirmed followers, 'public' for
-- everyone signed in while the owner's profile is public (otherwise followers only), and
-- anyone who may see the linked post when "Trainingsbericht beim Beitrag zeigen" is on.
create or replace function public.can_view_workout(workout uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.workouts w
    join public.profiles owner_profile on owner_profile.id = w.user_id
    where w.id = workout
      and w.moderation_state is null
      and (
        w.user_id = (select auth.uid())
        or (
          public.can_see_account(w.user_id)
          and not public.is_hidden_from_me(w.user_id, 'posts')
          and (
            (w.visibility = 'followers' and public.is_following(w.user_id))
            or (w.visibility = 'public' and (public.is_following(w.user_id) or not owner_profile.is_private))
            or (w.share_with_post and w.post_id is not null and public.can_view_post(w.post_id))
          )
        )
      )
  );
$$;

-- Changes who sees one of my activities.
create or replace function public.set_workout_visibility(p_workout_id uuid, p_visibility text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if not public.is_account_active() then
    raise exception 'account_inactive';
  end if;
  if p_visibility not in ('private', 'followers', 'public') then
    raise exception 'invalid_visibility';
  end if;
  update public.workouts set visibility = p_visibility
  where id = p_workout_id and user_id = auth.uid() and moderation_state is null;
  if not found then
    raise exception 'workout_not_found';
  end if;
end;
$$;

-- ---------------------------------------------------------------- streak inputs
-- Today in the app's time zone.
create or replace function public.app_today()
returns date
language sql stable set search_path = ''
as $$
  select (now() at time zone 'Europe/Zurich')::date;
$$;

-- THE place that decides whether `target` has a training proof on `d`, and on what it rests:
-- 'photo' (own post that counts, or an accepted workout link) or 'workout' (a recorded training
-- that counts, without photo). null: no proof. A later photo check only concerns 'photo' days.
-- Removed or deleted posts and workouts don't count. Internal.
create or replace function public.day_proof(target uuid, d date)
returns text
language sql stable security definer set search_path = ''
as $$
  select case
    when exists (
      select 1 from public.posts p
      where p.user_id = target and p.workout_date = d and public.post_counts_as_workout(p.id)
    ) or exists (
      select 1 from public.workout_shares ws
      join public.posts p on p.id = ws.post_id
      where ws.tagged_user_id = target and ws.status = 'accepted' and p.workout_date = d
        and public.post_counts_as_workout(p.id)
    ) then 'photo'
    when exists (
      select 1 from public.workouts w
      where w.user_id = target and w.workout_date = d and w.counts_for_streak and w.moderation_state is null
    ) then 'workout'
  end;
$$;

-- Does `target` count `d` as a training day (any proof)? Internal.
create or replace function public.day_counts_as_workout(target uuid, d date)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.day_proof(target, d) is not null;
$$;

-- Kept for the rest day functions: same as day_counts_as_workout.
create or replace function public.is_training_day(target uuid, d date)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.day_counts_as_workout(target, d);
$$;

-- Replaced by rest_week_start (rest days are budgeted per week now).
drop function if exists public.rest_period_start(date, date);

-- Monday of the calendar week that contains `d`.
create or replace function public.rest_week_start(d date)
returns date
language sql immutable set search_path = ''
as $$
  select date_trunc('week', d)::date;
$$;

-- Sets "n rest days per week" (0-6). Allowed the first time, and again 21 days after the
-- last change.
create or replace function public.set_rest_budget(n integer)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  current_start date;
begin
  if me is null then
    raise exception 'not authenticated';
  end if;
  if not public.is_account_active() then
    raise exception 'account_inactive';
  end if;
  if n is null or n not between 0 and 6 then
    raise exception 'rest_budget_invalid' using hint = '0 to 6';
  end if;
  select b.cycle_start into current_start from public.rest_budgets b where b.user_id = me for update;
  if found and public.app_today() < current_start + 21 then
    raise exception 'rest_budget_locked' using hint = (current_start + 21)::text;
  end if;
  insert into public.rest_budgets (user_id, rests_per_cycle, cycle_start, updated_at)
  values (me, n, public.app_today(), now())
  on conflict (user_id) do update
    set rests_per_cycle = excluded.rests_per_cycle, cycle_start = excluded.cycle_start, updated_at = now();
end;
$$;

-- Uses a rest day for today or yesterday (Europe/Zurich): only on a day without training,
-- within the budget of that day's calendar week (nothing carries over).
create or replace function public.use_rest_day(d date)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  budget public.rest_budgets%rowtype;
  period_start date;
  used integer;
begin
  if me is null then
    raise exception 'not authenticated';
  end if;
  if not public.is_account_active() then
    raise exception 'account_inactive';
  end if;
  if d is null or d not in (public.app_today(), public.app_today() - 1) then
    raise exception 'rest_day_not_allowed' using hint = 'only today or yesterday';
  end if;
  -- An active plan with rest days plans them itself (use_planned_rest_day), no budget.
  if exists (
    select 1 from public.training_plans tp join public.plan_days d on d.plan_id = tp.id
    where tp.user_id = me and tp.is_active and d.day_type = 'rest'
  ) then
    raise exception 'rest_day_planned';
  end if;
  -- Locks the budget row, so parallel calls can't both take the last rest day.
  select * into budget from public.rest_budgets b where b.user_id = me for update;
  if not found or budget.rests_per_cycle = 0 then
    raise exception 'rest_day_no_budget';
  end if;
  if public.is_training_day(me, d) then
    raise exception 'rest_day_is_training_day';
  end if;
  if exists (select 1 from public.rest_day_uses r where r.user_id = me and r.day = d) then
    return;
  end if;
  period_start := public.rest_week_start(d);
  select count(*) into used from public.rest_day_uses r
  where r.user_id = me and r.day >= period_start and r.day < period_start + 7;
  if used >= budget.rests_per_cycle then
    raise exception 'rest_day_no_budget';
  end if;
  insert into public.rest_day_uses (user_id, day) values (me, d);
end;
$$;

-- Takes a rest day back, while that day is today or yesterday.
create or replace function public.undo_rest_day(d date)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if not public.is_account_active() then
    raise exception 'account_inactive';
  end if;
  if d is null or d not in (public.app_today(), public.app_today() - 1) then
    raise exception 'rest_day_not_allowed' using hint = 'only today or yesterday';
  end if;
  delete from public.rest_day_uses where user_id = auth.uid() and day = d;
  -- A planned rest day taken back: if it was the last step of the round, the round goes back.
  update public.plan_rounds pr
  set next_index = pr.next_index - 1, updated_at = now()
  from public.planned_rest_uses u
  where u.user_id = auth.uid() and u.day = d and pr.user_id = u.user_id and pr.plan_id = u.plan_id
    and pr.next_index > 0 and pr.day_order[pr.next_index] = u.plan_day_id;
  delete from public.planned_rest_uses where user_id = auth.uid() and day = d;
end;
$$;

-- Plan entries completed since the active plan's order last changed, oldest first: training
-- proofs assigned to a day of the plan and confirmed planned rest days. Internal; the same
-- list the app gets from plan_proofs().
create or replace function public.plan_progress(p_user uuid)
returns table (day date, created_at timestamptz, plan_day_id uuid, kind text)
language sql stable security definer set search_path = ''
as $$
  select x.day, x.created_at, x.plan_day_id, x.kind
  from (
    select p.workout_date as day, p.created_at, p.plan_day_id, 'training'::text as kind
    from public.posts p
    join public.training_plans tp on tp.user_id = p.user_id and tp.is_active
    where p.user_id = p_user
      and p.created_at >= tp.sequence_changed_at
      and public.post_counts_as_workout(p.id)
      -- A photo of a recorded training is the same proof as the training (counted there).
      and not exists (
        select 1 from public.workouts w
        where w.post_id = p.id and w.counts_for_streak and w.moderation_state is null
      )
    union all
    select w.workout_date, w.created_at, w.plan_day_id, 'training'
    from public.workouts w
    join public.training_plans tp on tp.user_id = w.user_id and tp.is_active
    where w.user_id = p_user
      and w.created_at >= tp.sequence_changed_at
      and w.counts_for_streak and w.moderation_state is null
    union all
    select r.day, r.created_at, r.plan_day_id, 'rest'
    from public.planned_rest_uses r
    join public.training_plans tp on tp.id = r.plan_id and tp.is_active
    where r.user_id = p_user and r.created_at >= tp.sequence_changed_at
  ) x
  order by x.day, x.created_at;
$$;

-- The first version computed the round from the proofs each time.
drop function if exists public.plan_round_next(uuid);

-- The plan's days in its order. Internal.
create or replace function public.plan_template_order(p_plan uuid)
returns uuid[]
language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(d.id order by d.position), '{}') from public.plan_days d where d.plan_id = p_plan;
$$;

-- Days done in the current round, computed from the proofs (only used to start a stored round
-- for people who trained with the plan before rounds were stored; same rule as planRound() in
-- lib/streak.ts). Internal.
create or replace function public.plan_round_from_proofs(p_user uuid, p_plan uuid)
returns table (done uuid[], last_done date)
language plpgsql stable security definer set search_path = ''
as $$
declare
  ids uuid[];
  types text[];
  done_ids uuid[] := '{}';
  entry record;
  pos integer;
  i integer;
  only_rest boolean;
  last_seen date;
begin
  select array_agg(d.id order by d.position), array_agg(d.day_type order by d.position) into ids, types
  from public.plan_days d where d.plan_id = p_plan;
  if ids is null or not exists (select 1 from public.training_plans tp where tp.id = p_plan and tp.is_active) then
    return query select '{}'::uuid[], null::date;
    return;
  end if;
  for entry in select * from public.plan_progress(p_user) loop
    pos := array_position(ids, entry.plan_day_id);
    continue when pos is null;
    -- A proof saved in this same transaction is recorded by the caller, not here.
    continue when entry.created_at >= now();
    if entry.kind = 'training' and not (ids[pos] = any (done_ids)) then
      only_rest := true;
      for i in 1 .. pos - 1 loop
        if not (ids[i] = any (done_ids)) and types[i] <> 'rest' then
          only_rest := false;
        end if;
      end loop;
      if only_rest then
        for i in 1 .. pos - 1 loop
          if not (ids[i] = any (done_ids)) then
            done_ids := done_ids || ids[i];
          end if;
        end loop;
      end if;
    end if;
    if not (ids[pos] = any (done_ids)) then
      done_ids := done_ids || ids[pos];
    end if;
    last_seen := entry.day;
    if cardinality(done_ids) >= cardinality(ids) then
      done_ids := '{}';
    end if;
  end loop;
  return query select done_ids, last_seen;
end;
$$;

-- The stored round of a person's plan, created if missing and brought in line with the plan's
-- days: days that are gone drop out, new days join the open part at the end, and after the last
-- unit a new round starts in the plan's order. Locks the row. Internal.
create or replace function public.plan_round_load(p_user uuid, p_plan uuid)
returns public.plan_rounds
language plpgsql security definer set search_path = ''
as $$
declare
  r public.plan_rounds%rowtype;
  template uuid[] := public.plan_template_order(p_plan);
  done_part uuid[];
  open_part uuid[];
  started record;
begin
  select * into r from public.plan_rounds pr where pr.user_id = p_user and pr.plan_id = p_plan for update;
  if not found then
    select * into started from public.plan_round_from_proofs(p_user, p_plan);
    done_part := array(select x from unnest(template) x where x = any (started.done));
    open_part := array(select x from unnest(template) x where not (x = any (started.done)));
    insert into public.plan_rounds (user_id, plan_id, day_order, next_index, last_day)
    values (p_user, p_plan, done_part || open_part, cardinality(done_part), started.last_done)
    on conflict (user_id, plan_id) do nothing;
    select * into r from public.plan_rounds pr where pr.user_id = p_user and pr.plan_id = p_plan for update;
    return r;
  end if;
  done_part := array(select x from unnest(r.day_order[1:r.next_index]) x where x = any (template));
  open_part := array(select x from unnest(r.day_order[r.next_index + 1:]) x where x = any (template));
  open_part := open_part || array(
    select x from unnest(template) with ordinality t(x, n)
    where not (x = any (done_part)) and not (x = any (open_part)) and not (x = any (r.skipped)) order by n
  );
  if cardinality(open_part) = 0 then
    done_part := '{}';
    open_part := template;
    r.skipped := '{}';
  end if;
  if done_part || open_part is distinct from r.day_order or cardinality(done_part) <> r.next_index then
    update public.plan_rounds
    set day_order = done_part || open_part, next_index = cardinality(done_part), skipped = r.skipped, updated_at = now()
    where user_id = p_user and plan_id = p_plan
    returning * into r;
  end if;
  return r;
end;
$$;

-- The plan's order was changed (editor or "Plan dauerhaft ändern"): the open part of every round
-- of this plan follows the new order; what is done stays done. Internal.
create or replace function public.plan_round_template_changed(p_plan uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  template uuid[] := public.plan_template_order(p_plan);
  r record;
  done_part uuid[];
  open_part uuid[];
begin
  for r in select * from public.plan_rounds pr where pr.plan_id = p_plan for update loop
    done_part := array(select x from unnest(r.day_order[1:r.next_index]) x where x = any (template));
    open_part := array(select x from unnest(template) x where not (x = any (done_part)) and not (x = any (r.skipped)));
    if cardinality(open_part) = 0 then
      update public.plan_rounds
      set day_order = template, next_index = 0, skipped = '{}', updated_at = now()
      where user_id = r.user_id and plan_id = p_plan;
    else
      update public.plan_rounds
      set day_order = done_part || open_part, next_index = cardinality(done_part), updated_at = now()
      where user_id = r.user_id and plan_id = p_plan;
    end if;
  end loop;
end;
$$;

-- Moves the round on by `steps` units (and starts a new round after the last one). Internal.
create or replace function public.plan_round_advance(p_user uuid, p_plan uuid, p_steps integer, p_day date)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  r public.plan_rounds%rowtype := public.plan_round_load(p_user, p_plan);
begin
  if r.next_index + p_steps >= cardinality(r.day_order) then
    update public.plan_rounds
    set day_order = public.plan_template_order(p_plan), next_index = 0, skipped = '{}',
        last_day = greatest(r.last_day, p_day), updated_at = now()
    where user_id = p_user and plan_id = p_plan;
  else
    update public.plan_rounds
    set next_index = r.next_index + p_steps, last_day = greatest(r.last_day, p_day), updated_at = now()
    where user_id = p_user and plan_id = p_plan;
  end if;
end;
$$;

-- A proof with a unit of the active plan (counting recorded training or post). The unit due next:
-- the round moves on. Any other unit: accepted all the same, the round stays as it is and one
-- question opens (or the open one is updated: the latest deviation counts). The same unit twice on
-- the same day (e.g. a recorded training and its photos) counts once. Returns the open
-- question's id, or null. Internal (save_workout and the posts trigger).
create or replace function public.plan_record_proof(p_user uuid, p_day uuid, p_kind text, p_proof uuid, p_date date)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  active_plan uuid;
  r public.plan_rounds%rowtype;
  expected uuid;
  deviation uuid;
begin
  if p_day is null then
    return null;
  end if;
  select tp.id into active_plan
  from public.training_plans tp join public.plan_days d on d.plan_id = tp.id
  where d.id = p_day and tp.user_id = p_user and tp.is_active and d.day_type = 'training';
  if active_plan is null then
    return null;
  end if;
  if exists (
    select 1 from public.workouts w
    where w.user_id = p_user and w.workout_date = p_date and w.plan_day_id = p_day
      and w.counts_for_streak and w.moderation_state is null and w.id <> p_proof
  ) or exists (
    select 1 from public.posts po
    where po.user_id = p_user and po.workout_date = p_date and po.plan_day_id = p_day
      and po.moderation_state is null and po.id <> p_proof
  ) then
    return null;
  end if;
  perform 1 from public.profiles pr where pr.id = p_user for update;
  r := public.plan_round_load(p_user, active_plan);
  expected := r.day_order[r.next_index + 1];
  if expected = p_day then
    perform public.plan_round_advance(p_user, active_plan, 1, p_date);
    return null;
  end if;
  update public.plan_rounds set last_day = greatest(last_day, p_date), updated_at = now()
  where user_id = p_user and plan_id = active_plan;
  update public.plan_deviations
  set proof_kind = p_kind, proof_id = p_proof, done_day_id = p_day,
      done_title = (select d.title from public.plan_days d where d.id = p_day),
      expected_day_id = expected,
      expected_title = (select d.title from public.plan_days d where d.id = expected)
  where user_id = p_user and status = 'pending'
  returning id into deviation;
  if deviation is null then
    insert into public.plan_deviations
      (user_id, plan_id, proof_kind, proof_id, done_day_id, expected_day_id, done_title, expected_title)
    values (
      p_user, active_plan, p_kind, p_proof, p_day, expected,
      (select d.title from public.plan_days d where d.id = p_day),
      (select d.title from public.plan_days d where d.id = expected)
    )
    returning id into deviation;
  end if;
  return deviation;
end;
$$;

-- Posts with a unit of the plan are proofs for the round (also when the unit is set later).
create or replace function public.on_post_plan_proof()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.plan_day_id is not null
    and (tg_op = 'INSERT' or new.plan_day_id is distinct from old.plan_day_id)
    and public.post_counts_as_workout(new.id) then
    perform public.plan_record_proof(new.user_id, new.plan_day_id, 'post', new.id, new.workout_date);
  end if;
  return null;
end;
$$;

-- My active plan's round and the open question, for Home, Training and the profile. Questions
-- older than 2 days become an 'auto_exception' here (listed once in auto_resolved, for a short
-- notice). {plan_id: null} without an active plan.
create or replace function public.get_my_plan_round()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  active_plan uuid;
  r public.plan_rounds%rowtype;
  auto jsonb;
begin
  if me is null then
    raise exception 'not authenticated';
  end if;
  with resolved as (
    update public.plan_deviations set status = 'auto_exception', resolved_at = now()
    where user_id = me and status = 'pending' and created_at < now() - interval '2 days'
    returning done_title, expected_title
  )
  select coalesce(jsonb_agg(jsonb_build_object('done_title', done_title, 'expected_title', expected_title)), '[]'::jsonb)
  into auto from resolved;
  select tp.id into active_plan from public.training_plans tp where tp.user_id = me and tp.is_active;
  if active_plan is null then
    return jsonb_build_object('plan_id', null, 'auto_resolved', auto);
  end if;
  if public.is_account_active() then
    r := public.plan_round_load(me, active_plan);
  else
    select * into r from public.plan_rounds pr where pr.user_id = me and pr.plan_id = active_plan;
  end if;
  return jsonb_build_object(
    'plan_id', active_plan,
    'day_order', to_jsonb(coalesce(r.day_order, public.plan_template_order(active_plan))),
    'next_index', coalesce(r.next_index, 0),
    'skipped', to_jsonb(coalesce(r.skipped, '{}'::uuid[])),
    'last_day', r.last_day,
    'pending', (
      select jsonb_build_object(
        'id', dv.id, 'done_day_id', dv.done_day_id, 'expected_day_id', dv.expected_day_id,
        'done_title', dv.done_title, 'expected_title', dv.expected_title, 'created_at', dv.created_at
      )
      from public.plan_deviations dv
      where dv.user_id = me and dv.status = 'pending' and dv.plan_id = active_plan
    ),
    'auto_resolved', auto
  );
end;
$$;

-- Answers the open question. 'exception': the unit due next stays, the round is unchanged (the
-- trained unit was an extra and comes again later). 'reordered': the trained unit counts as done
-- and p_new_order (jsonb array of day ids) is the order of the remaining open units, exactly
-- those; p_scope 'round' for this round only, 'plan' also writes it into the plan. Idempotent:
-- the same answer again changes nothing.
create or replace function public.resolve_plan_deviation(
  p_deviation_id uuid, p_decision text, p_new_order jsonb, p_scope text
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  dev public.plan_deviations%rowtype;
  r public.plan_rounds%rowtype;
  done_part uuid[];
  open_part uuid[];
  remaining uuid[];
  new_open uuid[];
  in_open boolean;
  full_order uuid[];
  new_next integer;
begin
  if me is null then
    raise exception 'not authenticated';
  end if;
  if not public.is_account_active() then
    raise exception 'account_inactive';
  end if;
  if p_decision not in ('exception', 'reordered') then
    raise exception 'invalid_decision';
  end if;
  select * into dev from public.plan_deviations dv where dv.id = p_deviation_id and dv.user_id = me for update;
  if not found then
    raise exception 'deviation_not_found';
  end if;
  if dev.status <> 'pending' then
    if dev.status = p_decision then
      return;
    end if;
    raise exception 'deviation_resolved';
  end if;
  if not exists (select 1 from public.training_plans tp where tp.id = dev.plan_id and tp.user_id = me and tp.is_active) then
    raise exception 'plan_not_active';
  end if;

  if p_decision = 'reordered' then
    if p_scope is null or p_scope not in ('round', 'plan') then
      raise exception 'invalid_scope';
    end if;
    r := public.plan_round_load(me, dev.plan_id);
    done_part := r.day_order[1:r.next_index];
    open_part := r.day_order[r.next_index + 1:];
    in_open := dev.done_day_id is not null and dev.done_day_id = any (open_part);
    remaining := array(select x from unnest(open_part) x where x is distinct from dev.done_day_id);
    if jsonb_typeof(p_new_order) is distinct from 'array' then
      raise exception 'invalid_order';
    end if;
    new_open := array(select (v #>> '{}')::uuid from jsonb_array_elements(p_new_order) v);
    if cardinality(new_open) <> cardinality(remaining)
      or (select count(distinct x) from unnest(new_open) x) <> cardinality(new_open)
      or exists (select 1 from unnest(new_open) x where not (x = any (remaining))) then
      raise exception 'invalid_order';
    end if;
    full_order := done_part || (case when in_open then array[dev.done_day_id] else '{}'::uuid[] end) || new_open;
    new_next := cardinality(done_part) + (case when in_open then 1 else 0 end);
    if new_next >= cardinality(full_order) then
      update public.plan_rounds
      set day_order = public.plan_template_order(dev.plan_id), next_index = 0, skipped = '{}', updated_at = now()
      where user_id = me and plan_id = dev.plan_id;
    else
      update public.plan_rounds set day_order = full_order, next_index = new_next, updated_at = now()
      where user_id = me and plan_id = dev.plan_id;
    end if;
    if p_scope = 'plan' then
      update public.plan_days d set position = o.ord - 1
      from unnest(full_order) with ordinality as o(id, ord)
      where d.id = o.id and d.plan_id = dev.plan_id;
      update public.training_plans set updated_at = now() where id = dev.plan_id;
    end if;
  end if;

  update public.plan_deviations set status = p_decision, resolved_at = now() where id = dev.id;
end;
$$;

-- "Aktueller Durchlauf": new order of the open units of my active plan's round (the next one and
-- the ones after it), exactly those ids. Done units stay where they are. Resets nothing.
create or replace function public.adjust_plan_round(p_ordered_open_ids uuid[])
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  active_plan uuid;
  r public.plan_rounds%rowtype;
  open_part uuid[];
begin
  if me is null then
    raise exception 'not authenticated';
  end if;
  if not public.is_account_active() then
    raise exception 'account_inactive';
  end if;
  select tp.id into active_plan from public.training_plans tp where tp.user_id = me and tp.is_active;
  if active_plan is null then
    raise exception 'plan_not_active';
  end if;
  perform 1 from public.profiles pr where pr.id = me for update;
  r := public.plan_round_load(me, active_plan);
  open_part := r.day_order[r.next_index + 1:];
  if p_ordered_open_ids is null or cardinality(p_ordered_open_ids) <> cardinality(open_part)
    or (select count(distinct x) from unnest(p_ordered_open_ids) x) <> cardinality(p_ordered_open_ids)
    or exists (select 1 from unnest(p_ordered_open_ids) x where not (x = any (open_part))) then
    raise exception 'invalid_order';
  end if;
  update public.plan_rounds
  set day_order = r.day_order[1:r.next_index] || p_ordered_open_ids, updated_at = now()
  where user_id = me and plan_id = active_plan;
end;
$$;

-- Skips an open unit of my active plan's round: 'end' moves it to the end of the round, 'drop'
-- leaves it out of this round (it doesn't count as done and comes back with the next round).
-- Dropping the last open unit starts the next round.
create or replace function public.skip_plan_round_unit(p_day_id uuid, p_mode text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  active_plan uuid;
  r public.plan_rounds%rowtype;
  open_part uuid[];
  rest uuid[];
begin
  if me is null then
    raise exception 'not authenticated';
  end if;
  if not public.is_account_active() then
    raise exception 'account_inactive';
  end if;
  if p_mode is null or p_mode not in ('end', 'drop') then
    raise exception 'invalid_mode';
  end if;
  select tp.id into active_plan from public.training_plans tp where tp.user_id = me and tp.is_active;
  if active_plan is null then
    raise exception 'plan_not_active';
  end if;
  perform 1 from public.profiles pr where pr.id = me for update;
  r := public.plan_round_load(me, active_plan);
  open_part := r.day_order[r.next_index + 1:];
  if p_day_id is null or not (p_day_id = any (open_part)) then
    raise exception 'unit_not_open';
  end if;
  rest := array(select x from unnest(open_part) x where x <> p_day_id);
  if p_mode = 'end' then
    update public.plan_rounds
    set day_order = r.day_order[1:r.next_index] || rest || p_day_id, updated_at = now()
    where user_id = me and plan_id = active_plan;
  elsif cardinality(rest) = 0 then
    update public.plan_rounds
    set day_order = public.plan_template_order(active_plan), next_index = 0, skipped = '{}', updated_at = now()
    where user_id = me and plan_id = active_plan;
  else
    update public.plan_rounds
    set day_order = r.day_order[1:r.next_index] || rest, skipped = r.skipped || p_day_id, updated_at = now()
    where user_id = me and plan_id = active_plan;
  end if;
end;
$$;

-- Confirms the planned rest day of the active plan for `d` (today or yesterday). Allowed when the
-- unit due next in the stored round is a rest day and the last completed entry (training day or
-- planned rest day) was on the day before `d`. Not on a day with training, not twice. Keeps the
-- streak alive, doesn't count as a training day; the round moves on.
create or replace function public.use_planned_rest_day(d date)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  plan public.training_plans%rowtype;
  r public.plan_rounds%rowtype;
  next_day uuid;
begin
  if me is null then
    raise exception 'not authenticated';
  end if;
  if not public.is_account_active() then
    raise exception 'account_inactive';
  end if;
  if d is null or d not in (public.app_today(), public.app_today() - 1) then
    raise exception 'rest_day_not_allowed' using hint = 'only today or yesterday';
  end if;
  select * into plan from public.training_plans tp where tp.user_id = me and tp.is_active for update;
  if not found then
    raise exception 'planned_rest_no_plan';
  end if;
  if public.is_training_day(me, d) then
    raise exception 'rest_day_is_training_day';
  end if;
  if exists (select 1 from public.planned_rest_uses r where r.user_id = me and r.day = d)
    or exists (select 1 from public.rest_day_uses r where r.user_id = me and r.day = d) then
    raise exception 'planned_rest_already_used';
  end if;
  r := public.plan_round_load(me, plan.id);
  next_day := r.day_order[r.next_index + 1];
  if r.last_day is null then
    raise exception 'planned_rest_not_due' using hint = 'no completed plan day before';
  end if;
  if r.last_day <> d - 1 then
    raise exception 'planned_rest_not_due' using hint = 'the previous plan day was not done the day before';
  end if;
  if not exists (select 1 from public.plan_days pd where pd.id = next_day and pd.day_type = 'rest') then
    raise exception 'planned_rest_not_due' using hint = 'the next plan day is a training day';
  end if;
  insert into public.planned_rest_uses (user_id, day, plan_id, plan_day_id)
  values (me, d, plan.id, next_day);
  perform public.plan_round_advance(me, plan.id, 1, d);
end;
$$;

-- Rest days of `target` (from the budget and confirmed planned rest days), for whoever may
-- see their calendar (the budget and the plan stay private).
create or replace function public.rest_days(target uuid)
returns table (day date)
language sql stable security definer set search_path = ''
as $$
  select r.day from public.rest_day_uses r
  where r.user_id = target and public.can_view_calendar(target)
  union
  select r.day from public.planned_rest_uses r
  where r.user_id = target and public.can_view_calendar(target);
$$;

-- My completed plan entries since the active plan's order last changed, for the plan streak:
-- training proofs (kind 'training', with their plan day if assigned) and confirmed planned
-- rest days (kind 'rest'). Same notion of "counts" as the normal streak.
drop function if exists public.plan_proofs();
create or replace function public.plan_proofs()
returns table (day date, created_at timestamptz, plan_day_id uuid, kind text)
language sql stable security definer set search_path = ''
as $$
  select pp.day, pp.created_at, pp.plan_day_id, pp.kind from public.plan_progress((select auth.uid())) pp;
$$;

-- posts.plan_day_id must be a unit of the poster's own plan, and can only change while the
-- workout day is today or yesterday (no rewriting the plan streak later). Copies title,
-- position and plan length onto the post.
create or replace function public.on_post_plan_day()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  unit_title text;
  unit_position integer;
  unit_count integer;
begin
  if tg_op = 'UPDATE' and new.plan_day_id is not distinct from old.plan_day_id then
    new.plan_day_title := old.plan_day_title;
    new.plan_day_position := old.plan_day_position;
    new.plan_length := old.plan_length;
    return new;
  end if;
  -- The unit was removed from the plan (foreign key set null): keep the label.
  if tg_op = 'UPDATE' and new.plan_day_id is null
    and not exists (select 1 from public.plan_days d where d.id = old.plan_day_id) then
    new.plan_day_title := old.plan_day_title;
    new.plan_day_position := old.plan_day_position;
    new.plan_length := old.plan_length;
    return new;
  end if;
  if tg_op = 'UPDATE' and old.workout_date < public.app_today() - 1 then
    raise exception 'plan_day_locked';
  end if;
  if new.plan_day_id is null then
    new.plan_day_title := null;
    new.plan_day_position := null;
    new.plan_length := null;
    return new;
  end if;
  select d.title, d.position, (select count(*) from public.plan_days all_d where all_d.plan_id = d.plan_id)
  into unit_title, unit_position, unit_count
  from public.plan_days d
  join public.training_plans tp on tp.id = d.plan_id
  where d.id = new.plan_day_id and tp.user_id = new.user_id and d.day_type = 'training';
  if not found then
    raise exception 'plan_day_not_yours';
  end if;
  new.plan_day_title := unit_title;
  new.plan_day_position := unit_position;
  new.plan_length := unit_count;
  return new;
end;
$$;

-- A training proof on a rest day makes the rest day unnecessary: it is given back.
create or replace function public.on_training_added()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_table_name = 'posts' then
    delete from public.rest_day_uses where user_id = new.user_id and day = new.workout_date;
    delete from public.planned_rest_uses where user_id = new.user_id and day = new.workout_date;
  elsif new.status = 'accepted' then
    delete from public.rest_day_uses r
    using public.posts p
    where p.id = new.post_id and r.user_id = new.tagged_user_id and r.day = p.workout_date;
    delete from public.planned_rest_uses r
    using public.posts p
    where p.id = new.post_id and r.user_id = new.tagged_user_id and r.day = p.workout_date;
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------- blocks, reports, status
-- Is there a block between the caller and another member of the chat, or is nobody else left
-- (the partner deleted their account)? Then nobody writes in it.
create or replace function public.conversation_has_block(conversation uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id = conversation
      and cm.user_id <> (select auth.uid())
      and public.is_blocked_between((select auth.uid()), cm.user_id)
  ) or not exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id = conversation and cm.user_id <> (select auth.uid())
  );
$$;

-- A block ends follows and follow requests in both directions (unblocking doesn't restore them).
create or replace function public.on_user_blocked()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.follows
  where (follower_id = new.blocker_id and following_id = new.blocked_id)
     or (follower_id = new.blocked_id and following_id = new.blocker_id);
  return null;
end;
$$;

-- Protects the moderation columns of profiles from clients: a direct update by a signed-in
-- user keeps the old values, a new profile always starts active. Not security definer on
-- purpose: current_user is then the caller's role ('authenticated' for app requests) and
-- the function owner when a moderation function (security definer) does the update.
create or replace function public.guard_profile_moderation()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.account_status := 'active';
    new.suspended_until := null;
    new.suspension_reason_code := null;
    new.moderation_message := null;
    new.moderation_updated_at := null;
  elsif current_user in ('authenticated', 'anon') then
    new.account_status := old.account_status;
    new.suspended_until := old.suspended_until;
    new.suspension_reason_code := old.suspension_reason_code;
    new.moderation_message := old.moderation_message;
    new.moderation_updated_at := old.moderation_updated_at;
  end if;
  return new;
end;
$$;

-- What the "Konto gesperrt" screen shows. Callable by every signed-in account, also when it
-- is suspended, banned or being deleted; returns only the caller's own status.
create or replace function public.get_my_account_status()
returns table (status text, suspended_until timestamptz, reason_code text, message text)
language sql stable security definer set search_path = ''
as $$
  select
    case
      when p.account_status = 'suspended' and p.suspended_until is not null and p.suspended_until <= now()
        then 'active'
      else p.account_status
    end,
    p.suspended_until,
    p.suspension_reason_code,
    p.moderation_message
  from public.profiles p
  where p.id = (select auth.uid());
$$;

-- Internal: checks shared by both report functions (active account, daily limit).
create or replace function public.check_report_allowed()
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if not public.is_account_active() then
    raise exception 'account_inactive';
  end if;
  if (
    select count(*) from public.reports r
    where r.reporter_id = auth.uid() and r.created_at > now() - interval '24 hours'
  ) >= 20 then
    raise exception 'report_limit';
  end if;
end;
$$;

-- Reports a post, story, comment, profile, plan or activity (workout). Only what the caller may see, never their own,
-- one report per target. The owner of the target is looked up here, not taken from the app.
create or replace function public.report_content(p_target_type text, p_target_id uuid, p_reason text, p_details text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  target_owner uuid;
  report uuid;
begin
  perform public.check_report_allowed();
  case p_target_type
    when 'post' then
      if not public.can_view_post(p_target_id) then raise exception 'report_target_not_found'; end if;
      select p.user_id into target_owner from public.posts p where p.id = p_target_id;
    when 'story' then
      if not public.can_view_story(p_target_id) then raise exception 'report_target_not_found'; end if;
      select s.user_id into target_owner from public.stories s where s.id = p_target_id;
    when 'comment' then
      if not public.can_view_comment(p_target_id) then raise exception 'report_target_not_found'; end if;
      select c.user_id into target_owner from public.comments c where c.id = p_target_id;
    when 'profile' then
      if not public.can_see_account(p_target_id) or not exists (select 1 from public.profiles p where p.id = p_target_id) then
        raise exception 'report_target_not_found';
      end if;
      target_owner := p_target_id;
    when 'plan' then
      if not public.can_view_plan(p_target_id)
        or exists (select 1 from public.training_plans tp where tp.id = p_target_id and tp.moderation_state is not null) then
        raise exception 'report_target_not_found';
      end if;
      select tp.user_id into target_owner from public.training_plans tp where tp.id = p_target_id;
    when 'workout' then
      if not public.can_view_workout(p_target_id) then
        raise exception 'report_target_not_found';
      end if;
      select w.user_id into target_owner from public.workouts w where w.id = p_target_id;
    else
      -- Messages go through report_message(); there are no sounds yet.
      raise exception 'report_type_not_supported';
  end case;
  if target_owner = auth.uid() then
    raise exception 'report_own_content';
  end if;
  insert into public.reports (reporter_id, target_type, target_id, target_user_id, reason, details)
  values (auth.uid(), p_target_type, p_target_id, target_owner, p_reason, nullif(btrim(coalesce(p_details, '')), ''))
  on conflict (reporter_id, target_type, target_id) do nothing
  returning id into report;
  if report is null then
    raise exception 'report_exists';
  end if;
  return report;
end;
$$;

-- Reports a chat message (members only, not your own). Copies it and up to 5 messages before
-- and after into report_snapshots: moderators see chats only through these copies.
create or replace function public.report_message(message_id uuid, reason text, details text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  reported public.messages%rowtype;
  report uuid;
begin
  perform public.check_report_allowed();
  select * into reported from public.messages m where m.id = report_message.message_id;
  if not found or not public.is_conversation_member(reported.conversation_id) then
    raise exception 'report_target_not_found';
  end if;
  if reported.sender_id = auth.uid() then
    raise exception 'report_own_content';
  end if;
  insert into public.reports (reporter_id, target_type, target_id, target_user_id, reason, details)
  values (auth.uid(), 'message', reported.id, reported.sender_id, report_message.reason,
          nullif(btrim(coalesce(report_message.details, '')), ''))
  on conflict (reporter_id, target_type, target_id) do nothing
  returning id into report;
  if report is null then
    raise exception 'report_exists';
  end if;
  insert into public.report_snapshots
    (report_id, message_id, conversation_id, sender_id, body, post_id, comment_id, story_id, kind, sent_at, is_reported)
  select report, m.id, m.conversation_id, m.sender_id, m.body, m.post_id, m.comment_id, m.story_id, m.kind,
         m.created_at, m.id = reported.id
  from (
    (select * from public.messages b
     where b.conversation_id = reported.conversation_id
       and (b.created_at, b.id) < (reported.created_at, reported.id)
     order by b.created_at desc, b.id desc limit 5)
    union all
    (select * from public.messages r where r.id = reported.id)
    union all
    (select * from public.messages a
     where a.conversation_id = reported.conversation_id
       and (a.created_at, a.id) > (reported.created_at, reported.id)
     order by a.created_at, a.id limit 5)
  ) m;
  return report;
end;
$$;

-- "Blockierte Konten": the people I blocked, with name and avatar (their profiles are
-- otherwise hidden from me by the block). Only my own blocks.
create or replace function public.get_my_blocked_accounts()
returns table (id uuid, username text, display_name text, avatar_path text, blocked_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select p.id, p.username, p.display_name, p.avatar_path, ub.created_at
  from public.user_blocks ub
  join public.profiles p on p.id = ub.blocked_id
  where ub.blocker_id = (select auth.uid())
  order by ub.created_at desc;
$$;

-- "Meine Meldungen": status of my own reports, without the decision notes.
create or replace function public.get_my_reports()
returns table (id uuid, target_type text, reason text, status text, created_at timestamptz, handled_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select r.id, r.target_type, r.reason, r.status, r.created_at, r.handled_at
  from public.reports r
  where r.reporter_id = (select auth.uid())
  order by r.created_at desc
  limit 200;
$$;

-- ---------------------------------------------------------------- staff and moderation
-- Staff checks. Both need a role in admin_roles AND a session confirmed with a second factor
-- (TOTP, JWT claim aal = 'aal2'). admin includes moderator.
create or replace function public.is_moderator()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2'
    and exists (
      select 1 from public.admin_roles r
      where r.user_id = (select auth.uid()) and r.role in ('moderator', 'admin')
    );
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2'
    and exists (select 1 from public.admin_roles r where r.user_id = (select auth.uid()) and r.role = 'admin');
$$;

-- For the dashboard: my own role (or null) and whether this session has the second factor.
create or replace function public.admin_whoami()
returns table (role text, has_aal2 boolean)
language sql stable security definer set search_path = ''
as $$
  select
    (select r.role from public.admin_roles r where r.user_id = (select auth.uid())),
    coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2';
$$;

-- Internal helpers for the mod_* / admin_* functions.
create or replace function public.require_moderator()
returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_moderator() then
    raise exception 'not_authorized';
  end if;
end;
$$;

create or replace function public.require_admin()
returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'not_authorized';
  end if;
end;
$$;

-- A written reason is required for every action (at least 10 characters).
create or replace function public.checked_reason(p_reason text)
returns text
language plpgsql immutable set search_path = ''
as $$
begin
  if p_reason is null or char_length(btrim(p_reason)) < 10 then
    raise exception 'reason_too_short' using hint = 'at least 10 characters';
  end if;
  return btrim(p_reason);
end;
$$;

create or replace function public.log_moderation_action(
  p_action text, p_target_type text, p_target_id uuid, p_target_user uuid, p_report uuid,
  p_reason text, p_user_message text, p_details jsonb
)
returns uuid
language sql security definer set search_path = ''
as $$
  insert into public.moderation_actions
    (actor_id, action, target_type, target_id, target_user_id, report_id, reason, user_message, details)
  values (
    auth.uid(), p_action, p_target_type, p_target_id, p_target_user, p_report, p_reason,
    nullif(btrim(coalesce(p_user_message, '')), ''), coalesce(p_details, '{}')
  )
  returning id;
$$;

-- moderation_actions can't be changed or deleted, not even by admins or the service role.
create or replace function public.forbid_change()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  raise exception '% is append-only', tg_table_name;
end;
$$;

-- The one change ever allowed on moderation_actions: when an account is deleted,
-- finish_account_deletion() removes plain text about that person (text to the user, names in
-- the reason). It marks the person for its own transaction (peakpic.pseudonymize); every other
-- column has to stay exactly as it was. Deleting rows stays impossible.
create or replace function public.guard_moderation_actions()
returns trigger
language plpgsql set search_path = ''
as $$
declare
  marked text := coalesce(current_setting('peakpic.pseudonymize', true), '');
begin
  if tg_op = 'UPDATE' and marked <> '' and old.target_user_id::text = marked
    and new.id = old.id
    and new.actor_id is not distinct from old.actor_id
    and new.action = old.action
    and new.target_type is not distinct from old.target_type
    and new.target_id is not distinct from old.target_id
    and new.target_user_id is not distinct from old.target_user_id
    and new.report_id is not distinct from old.report_id
    and new.details = old.details
    and new.created_at = old.created_at
    and new.user_message is null then
    return new;
  end if;
  raise exception '% is append-only', tg_table_name;
end;
$$;

-- Keeps the moderation fields of content away from clients (same idea as
-- guard_profile_moderation: not security definer, so current_user is the caller's role).
create or replace function public.guard_content_moderation()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.moderation_state := null;
    new.removed_at := null;
    new.removed_by := null;
    new.removed_reason := null;
  elsif current_user in ('authenticated', 'anon') then
    new.moderation_state := old.moderation_state;
    new.removed_at := old.removed_at;
    new.removed_by := old.removed_by;
    new.removed_reason := old.removed_reason;
  end if;
  return new;
end;
$$;

-- Removed content and its files stay as evidence: owners can't delete them.
create or replace function public.is_moderated_post(post uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.posts p where p.id = post and p.moderation_state is not null);
$$;

create or replace function public.is_moderated_photo(object_name text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
      select 1 from public.posts p
      where p.moderation_state is not null
        and (p.photo_path = object_name
             or exists (select 1 from public.post_media m
                        where m.post_id = p.id and (m.photo_path = object_name or m.original_path = object_name)))
    )
    or exists (select 1 from public.stories s where s.moderation_state is not null and s.photo_path = object_name);
$$;

-- Moderators may open (signed URL) only photos of reported or moderated posts and stories;
-- quarantined ones only admins. Opening the report itself is logged (admin_report_detail).
create or replace function public.can_moderate_photo(object_name text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.is_moderator() and (
    exists (
      select 1 from public.posts p
      where (p.photo_path = object_name
             or exists (select 1 from public.post_media m where m.post_id = p.id and m.photo_path = object_name))
        and (p.moderation_state is distinct from 'quarantined' or public.is_admin())
        and (
          p.moderation_state is not null
          or exists (select 1 from public.reports r where r.target_type = 'post' and r.target_id = p.id)
          or exists (select 1 from public.report_snapshots rs where rs.post_id = p.id)
        )
    )
    or exists (
      select 1 from public.stories s
      where s.photo_path = object_name
        and (s.moderation_state is distinct from 'quarantined' or public.is_admin())
        and (
          s.moderation_state is not null
          or exists (select 1 from public.reports r where r.target_type = 'story' and r.target_id = s.id)
          or exists (select 1 from public.report_snapshots rs where rs.story_id = s.id)
        )
    )
  );
$$;

-- Owner of a piece of content (raises if it doesn't exist). Internal.
create or replace function public.moderation_target_owner(p_type text, p_id uuid)
returns uuid
language plpgsql stable security definer set search_path = ''
as $$
declare
  target_owner uuid;
begin
  case p_type
    when 'post' then select p.user_id into target_owner from public.posts p where p.id = p_id;
    when 'story' then select s.user_id into target_owner from public.stories s where s.id = p_id;
    when 'comment' then select c.user_id into target_owner from public.comments c where c.id = p_id;
    when 'message' then select m.sender_id into target_owner from public.messages m where m.id = p_id;
    when 'plan' then select tp.user_id into target_owner from public.training_plans tp where tp.id = p_id;
    when 'workout' then select w.user_id into target_owner from public.workouts w where w.id = p_id;
    else raise exception 'unsupported_target_type';
  end case;
  if target_owner is null then
    raise exception 'target_not_found';
  end if;
  return target_owner;
end;
$$;

create or replace function public.moderation_state_of(p_type text, p_id uuid)
returns text
language plpgsql stable security definer set search_path = ''
as $$
declare
  state text;
begin
  case p_type
    when 'post' then select p.moderation_state into state from public.posts p where p.id = p_id;
    when 'story' then select s.moderation_state into state from public.stories s where s.id = p_id;
    when 'comment' then select c.moderation_state into state from public.comments c where c.id = p_id;
    when 'message' then select m.moderation_state into state from public.messages m where m.id = p_id;
    when 'plan' then select tp.moderation_state into state from public.training_plans tp where tp.id = p_id;
    when 'workout' then select w.moderation_state into state from public.workouts w where w.id = p_id;
    else raise exception 'unsupported_target_type';
  end case;
  return state;
end;
$$;

-- Internal: sets or clears the moderation state of one piece of content.
create or replace function public.set_moderation_state(p_type text, p_id uuid, p_state text, p_reason text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  removed timestamptz := case when p_state is null then null else now() end;
  remover uuid := case when p_state is null then null else auth.uid() end;
  why text := case when p_state is null then null else p_reason end;
begin
  case p_type
    when 'post' then
      update public.posts set moderation_state = p_state, removed_at = removed, removed_by = remover, removed_reason = why where id = p_id;
    when 'story' then
      update public.stories set moderation_state = p_state, removed_at = removed, removed_by = remover, removed_reason = why where id = p_id;
    when 'comment' then
      update public.comments set moderation_state = p_state, removed_at = removed, removed_by = remover, removed_reason = why where id = p_id;
    when 'message' then
      update public.messages set moderation_state = p_state, removed_at = removed, removed_by = remover, removed_reason = why where id = p_id;
    when 'plan' then
      update public.training_plans set moderation_state = p_state, removed_at = removed, removed_by = remover, removed_reason = why where id = p_id;
    when 'workout' then
      update public.workouts set moderation_state = p_state, removed_at = removed, removed_by = remover, removed_reason = why where id = p_id;
    else raise exception 'unsupported_target_type';
  end case;
end;
$$;

-- Staff can't be targeted by moderation, and nobody targets themself.
create or replace function public.check_moderation_target(p_user uuid)
returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if p_user = auth.uid() then
    raise exception 'cannot_target_self';
  end if;
  if exists (select 1 from public.admin_roles r where r.user_id = p_user) then
    raise exception 'cannot_target_staff';
  end if;
end;
$$;

create or replace function public.add_moderation_notice(p_user uuid, p_action uuid, p_kind text, p_message text)
returns void
language sql security definer set search_path = ''
as $$
  insert into public.moderation_notices (user_id, action_id, kind, message)
  select p_user, p_action, p_kind, btrim(p_message)
  where nullif(btrim(coalesce(p_message, '')), '') is not null;
$$;

-- Removes a post, story, comment or message (hidden, not deleted). Moderator.
create or replace function public.mod_remove_content(
  p_type text, p_id uuid, p_reason text, p_user_message text default null, p_report_id uuid default null
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  why text := public.checked_reason(p_reason);
  target_owner uuid;
  action uuid;
begin
  perform public.require_moderator();
  target_owner := public.moderation_target_owner(p_type, p_id);
  if public.moderation_state_of(p_type, p_id) = 'quarantined' and not public.is_admin() then
    raise exception 'quarantined_admin_only';
  end if;
  perform public.set_moderation_state(p_type, p_id, 'removed', why);
  action := public.log_moderation_action('remove_content', p_type, p_id, target_owner, p_report_id, why, p_user_message, '{}');
  perform public.add_moderation_notice(target_owner, action, 'removal', p_user_message);
  return action;
end;
$$;

-- Possibly illegal content: hidden from everyone except admins, nothing is deleted. Moderator.
create or replace function public.mod_quarantine_content(p_type text, p_id uuid, p_reason text, p_report_id uuid default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  why text := public.checked_reason(p_reason);
  target_owner uuid;
begin
  perform public.require_moderator();
  target_owner := public.moderation_target_owner(p_type, p_id);
  perform public.set_moderation_state(p_type, p_id, 'quarantined', why);
  return public.log_moderation_action('quarantine_content', p_type, p_id, target_owner, p_report_id, why, null, '{}');
end;
$$;

-- Makes removed or quarantined content visible again. Admin only.
create or replace function public.mod_restore_content(p_type text, p_id uuid, p_reason text, p_report_id uuid default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  why text := public.checked_reason(p_reason);
  target_owner uuid;
  previous text;
begin
  perform public.require_admin();
  target_owner := public.moderation_target_owner(p_type, p_id);
  previous := public.moderation_state_of(p_type, p_id);
  perform public.set_moderation_state(p_type, p_id, null, null);
  return public.log_moderation_action(
    'restore_content', p_type, p_id, target_owner, p_report_id, why, null, jsonb_build_object('previous_state', previous)
  );
end;
$$;

-- A warning the user sees (moderation_notices). Moderator.
create or replace function public.mod_warn_user(p_user_id uuid, p_reason text, p_user_message text, p_report_id uuid default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  why text := public.checked_reason(p_reason);
  action uuid;
begin
  perform public.require_moderator();
  perform public.check_moderation_target(p_user_id);
  if nullif(btrim(coalesce(p_user_message, '')), '') is null then
    raise exception 'user_message_required';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_user_id) then
    raise exception 'user_not_found';
  end if;
  action := public.log_moderation_action('warn_user', 'profile', p_user_id, p_user_id, p_report_id, why, p_user_message, '{}');
  perform public.add_moderation_notice(p_user_id, action, 'warning', p_user_message);
  return action;
end;
$$;

-- Suspends an account until p_until (null = until lifted, admins only). Moderators: at most
-- 7 days and only reason code 'moderation'. 'terms_pending' (missing legal confirmation) is
-- for admins and is lifted automatically once the user confirms.
create or replace function public.mod_suspend_user(
  p_user_id uuid, p_until timestamptz, p_reason text, p_user_message text,
  p_reason_code text default 'moderation', p_report_id uuid default null
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  why text := public.checked_reason(p_reason);
  current_status text;
  action uuid;
begin
  perform public.require_moderator();
  perform public.check_moderation_target(p_user_id);
  if p_reason_code is null or p_reason_code not in ('moderation', 'terms_pending') then
    raise exception 'invalid_reason_code';
  end if;
  if not public.is_admin() then
    if p_reason_code <> 'moderation' then
      raise exception 'not_authorized';
    end if;
    if p_until is null or p_until > now() + interval '7 days' then
      raise exception 'suspension_too_long' using hint = 'moderators: at most 7 days';
    end if;
  end if;
  if p_until is not null and p_until <= now() then
    raise exception 'suspension_in_past';
  end if;
  select p.account_status into current_status from public.profiles p where p.id = p_user_id for update;
  if not found then
    raise exception 'user_not_found';
  end if;
  if current_status in ('banned', 'deleting') then
    raise exception 'user_not_suspendable';
  end if;
  update public.profiles
  set account_status = 'suspended', suspended_until = p_until, suspension_reason_code = p_reason_code,
      moderation_message = nullif(btrim(coalesce(p_user_message, '')), ''), moderation_updated_at = now()
  where id = p_user_id;
  action := public.log_moderation_action(
    'suspend_user', 'profile', p_user_id, p_user_id, p_report_id, why, p_user_message,
    jsonb_build_object('until', p_until, 'reason_code', p_reason_code)
  );
  return action;
end;
$$;

-- Bans an account for good (visible reason on the "Konto gesperrt" screen). Admin only.
create or replace function public.mod_ban_user(p_user_id uuid, p_reason text, p_user_message text, p_report_id uuid default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  why text := public.checked_reason(p_reason);
  current_status text;
begin
  perform public.require_admin();
  perform public.check_moderation_target(p_user_id);
  select p.account_status into current_status from public.profiles p where p.id = p_user_id for update;
  if not found then
    raise exception 'user_not_found';
  end if;
  if current_status = 'deleting' then
    raise exception 'user_not_suspendable';
  end if;
  update public.profiles
  set account_status = 'banned', suspended_until = null, suspension_reason_code = 'moderation',
      moderation_message = nullif(btrim(coalesce(p_user_message, '')), ''), moderation_updated_at = now()
  where id = p_user_id;
  return public.log_moderation_action('ban_user', 'profile', p_user_id, p_user_id, p_report_id, why, p_user_message, '{}');
end;
$$;

-- Lifts a ban or a suspension. Admin only.
create or replace function public.mod_unban_user(p_user_id uuid, p_reason text, p_report_id uuid default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  why text := public.checked_reason(p_reason);
  previous text;
begin
  perform public.require_admin();
  perform public.check_moderation_target(p_user_id);
  select p.account_status into previous from public.profiles p where p.id = p_user_id for update;
  if not found then
    raise exception 'user_not_found';
  end if;
  if previous not in ('suspended', 'banned') then
    raise exception 'user_not_suspended';
  end if;
  update public.profiles
  set account_status = 'active', suspended_until = null, suspension_reason_code = null,
      moderation_message = null, moderation_updated_at = now()
  where id = p_user_id;
  return public.log_moderation_action(
    'unban_user', 'profile', p_user_id, p_user_id, p_report_id, why, null, jsonb_build_object('previous_status', previous)
  );
end;
$$;

-- Sets a report to in review, resolved or dismissed, with a note (at least 10 characters).
create or replace function public.mod_resolve_report(p_report_id uuid, p_status text, p_resolution_note text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  why text := public.checked_reason(p_resolution_note);
  report public.reports%rowtype;
begin
  perform public.require_moderator();
  if p_status is null or p_status not in ('in_review', 'resolved', 'dismissed') then
    raise exception 'invalid_status';
  end if;
  select * into report from public.reports r where r.id = p_report_id for update;
  if not found then
    raise exception 'report_not_found';
  end if;
  update public.reports
  set status = p_status, resolution_note = why, handled_by = auth.uid(), handled_at = now()
  where id = p_report_id;
  return public.log_moderation_action(
    'resolve_report', report.target_type, report.target_id, report.target_user_id, p_report_id, why, null,
    jsonb_build_object('status', p_status, 'previous_status', report.status)
  );
end;
$$;

-- ---------------------------------------------------------------- staff reads
-- Report queue: metadata only (no content), so it isn't logged. Moderator.
create or replace function public.admin_report_queue(
  p_status text default 'open', p_target_type text default null, p_reason text default null,
  p_min_age_hours integer default null, p_newest_first boolean default false,
  p_limit integer default 50, p_offset integer default 0
)
returns table (
  id uuid, target_type text, target_id uuid, target_user_id uuid, target_username text,
  reporter_username text, reason text, status text, created_at timestamptz, reports_on_target bigint
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.require_moderator();
  return query
  select r.id, r.target_type, r.target_id, r.target_user_id, tp.username, rp.username, r.reason, r.status, r.created_at,
         (select count(*) from public.reports o where o.target_type = r.target_type and o.target_id = r.target_id)
  from public.reports r
  left join public.profiles tp on tp.id = r.target_user_id
  left join public.profiles rp on rp.id = r.reporter_id
  where (p_status is null or r.status = p_status)
    and (p_target_type is null or r.target_type = p_target_type)
    and (p_reason is null or r.reason = p_reason)
    and (p_min_age_hours is null or r.created_at <= now() - make_interval(hours => p_min_age_hours))
  order by case when p_newest_first then r.created_at end desc, r.created_at
  limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

-- One report with the reported content (message reports: only the stored snapshots), the
-- reporter and the affected account. Opening it is logged and moves an open report to
-- 'in_review'. Quarantined content only for admins. Moderator.
create or replace function public.admin_report_detail(p_report_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  report public.reports%rowtype;
  content jsonb;
  hidden boolean := false;
begin
  perform public.require_moderator();
  select * into report from public.reports r where r.id = p_report_id;
  if not found then
    raise exception 'report_not_found';
  end if;

  if report.target_type in ('post', 'story', 'comment', 'message', 'plan', 'workout')
    and public.moderation_state_of(report.target_type, report.target_id) = 'quarantined'
    and not public.is_admin() then
    hidden := true;
  elsif report.target_type = 'post' then
    select jsonb_build_object(
      'id', p.id, 'caption', p.caption, 'workout_date', p.workout_date, 'created_at', p.created_at,
      'in_feed', p.in_feed, 'moderation_state', p.moderation_state, 'removed_reason', p.removed_reason,
      'photos', coalesce((select jsonb_agg(m.photo_path order by m.position) from public.post_media m where m.post_id = p.id),
                         jsonb_build_array(p.photo_path))
    ) into content from public.posts p where p.id = report.target_id;
  elsif report.target_type = 'story' then
    select jsonb_build_object(
      'id', s.id, 'photo_path', s.photo_path, 'overlay_text', s.overlay_text, 'created_at', s.created_at,
      'expires_at', s.expires_at, 'moderation_state', s.moderation_state, 'removed_reason', s.removed_reason
    ) into content from public.stories s where s.id = report.target_id;
  elsif report.target_type = 'comment' then
    select jsonb_build_object(
      'id', c.id, 'body', c.body, 'post_id', c.post_id, 'created_at', c.created_at,
      'moderation_state', c.moderation_state, 'removed_reason', c.removed_reason
    ) into content from public.comments c where c.id = report.target_id;
  elsif report.target_type = 'message' then
    select jsonb_build_object(
      'moderation_state', public.moderation_state_of('message', report.target_id),
      -- The sender may have deleted it for everyone since; the snapshots stay.
      'original_exists', exists (select 1 from public.messages om where om.id = report.target_id),
      'snapshots', coalesce(jsonb_agg(jsonb_build_object(
        'message_id', rs.message_id, 'sender_id', rs.sender_id, 'sender_username', sp.username,
        'body', rs.body, 'post_id', rs.post_id, 'comment_id', rs.comment_id, 'story_id', rs.story_id,
        'kind', rs.kind, 'sent_at', rs.sent_at, 'is_reported', rs.is_reported,
        'post_photo_path', (select p.photo_path from public.posts p where p.id = rs.post_id)
      ) order by rs.sent_at), '[]'::jsonb)
    ) into content
    from public.report_snapshots rs
    left join public.profiles sp on sp.id = rs.sender_id
    where rs.report_id = report.id;
  elsif report.target_type = 'profile' then
    select jsonb_build_object(
      'id', p.id, 'username', p.username, 'display_name', p.display_name, 'avatar_path', p.avatar_path,
      'created_at', p.created_at
    ) into content from public.profiles p where p.id = report.target_id;
  elsif report.target_type = 'plan' then
    select jsonb_build_object(
      'id', tp.id, 'name', tp.name, 'visibility', tp.visibility, 'created_at', tp.created_at,
      'moderation_state', tp.moderation_state, 'removed_reason', tp.removed_reason,
      'days', coalesce((
        select jsonb_agg(jsonb_build_object(
          'type', d.day_type, 'title', d.title, 'notes', d.notes,
          'exercises', coalesce((
            select jsonb_agg(jsonb_build_object('name', e.name, 'sets', e.sets, 'reps_min', e.reps_min,
                                                'reps_max', e.reps_max, 'target_seconds', e.target_seconds,
                                                'notes', e.notes) order by e.position)
            from public.plan_exercises e where e.plan_day_id = d.id), '[]'::jsonb)
        ) order by d.position)
        from public.plan_days d where d.plan_id = tp.id), '[]'::jsonb)
    ) into content from public.training_plans tp where tp.id = report.target_id;
  elsif report.target_type = 'workout' then
    select jsonb_build_object(
      'id', w.id, 'title', w.title, 'plan_day_title', w.plan_day_title, 'note', w.note,
      'workout_date', w.workout_date, 'active_seconds', w.active_seconds, 'visibility', w.visibility,
      'post_id', w.post_id, 'moderation_state', w.moderation_state, 'removed_reason', w.removed_reason,
      'exercises', coalesce((
        select jsonb_agg(jsonb_build_object(
          'name', e.name,
          'sets', (select count(*) from public.workout_sets s where s.workout_exercise_id = e.id)
        ) order by e.position)
        from public.workout_exercises e where e.workout_id = w.id), '[]'::jsonb)
    ) into content from public.workouts w where w.id = report.target_id;
  end if;

  if report.status = 'open' then
    update public.reports set status = 'in_review' where id = report.id;
  end if;
  perform public.log_moderation_action(
    'view_report', report.target_type, report.target_id, report.target_user_id, report.id,
    'Meldung im Dashboard geöffnet', null, jsonb_build_object('quarantined_hidden', hidden)
  );

  return jsonb_build_object(
    'report', jsonb_build_object(
      'id', report.id, 'target_type', report.target_type, 'target_id', report.target_id,
      'reason', report.reason, 'details', report.details,
      'status', case when report.status = 'open' then 'in_review' else report.status end,
      'resolution_note', report.resolution_note, 'handled_at', report.handled_at, 'created_at', report.created_at
    ),
    'reporter', (select jsonb_build_object('id', p.id, 'username', p.username, 'display_name', p.display_name)
                 from public.profiles p where p.id = report.reporter_id),
    'target_user', (select jsonb_build_object('id', p.id, 'username', p.username, 'display_name', p.display_name,
                                              'account_status', p.account_status, 'suspended_until', p.suspended_until)
                    from public.profiles p where p.id = report.target_user_id),
    'content', content,
    'content_hidden_quarantine', hidden,
    'other_reports', (select count(*) from public.reports o
                      where o.target_type = report.target_type and o.target_id = report.target_id and o.id <> report.id)
  );
end;
$$;

-- History of one account: status, reports against it, actions and warnings. Logged. Moderator.
create or replace function public.admin_user_detail(p_user_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  result jsonb;
begin
  perform public.require_moderator();
  select jsonb_build_object(
    'profile', jsonb_build_object(
      'id', p.id, 'username', p.username, 'display_name', p.display_name, 'avatar_path', p.avatar_path,
      'created_at', p.created_at, 'is_private', p.is_private, 'account_status', p.account_status,
      'suspended_until', p.suspended_until, 'suspension_reason_code', p.suspension_reason_code,
      'moderation_message', p.moderation_message, 'moderation_updated_at', p.moderation_updated_at,
      'staff_role', (select r.role from public.admin_roles r where r.user_id = p.id)
    ),
    'reports_against', coalesce((
      select jsonb_agg(x order by x.created_at desc) from (
        select r.id, r.target_type, r.reason, r.status, r.created_at
        from public.reports r where r.target_user_id = p.id order by r.created_at desc limit 100
      ) x), '[]'::jsonb),
    'actions', coalesce((
      select jsonb_agg(x order by x.created_at desc) from (
        select a.id, a.action, a.target_type, a.target_id, a.reason, a.user_message, a.details, a.created_at,
               (select ap.username from public.profiles ap where ap.id = a.actor_id) as actor_username
        from public.moderation_actions a
        where a.target_user_id = p.id and a.action not like 'view_%'
        order by a.created_at desc limit 100
      ) x), '[]'::jsonb),
    'reports_filed', (select count(*) from public.reports r where r.reporter_id = p.id)
  ) into result
  from public.profiles p where p.id = p_user_id;
  if result is null then
    raise exception 'user_not_found';
  end if;
  perform public.log_moderation_action('view_user', 'profile', p_user_id, p_user_id, null, 'Konto-Verlauf im Dashboard geöffnet', null, '{}');
  return result;
end;
$$;

-- Search by username, display name or exact id (public profile data, not logged). Moderator.
create or replace function public.admin_search_users(p_query text)
returns table (id uuid, username text, display_name text, account_status text, created_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
declare
  q text := btrim(coalesce(p_query, ''));
  pattern text;
begin
  perform public.require_moderator();
  if char_length(q) < 2 then
    return;
  end if;
  pattern := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return query
  select p.id, p.username, p.display_name, p.account_status, p.created_at
  from public.profiles p
  where p.id::text = q or p.username ilike pattern or p.display_name ilike pattern
  order by (p.username = lower(q)) desc, p.username
  limit 50;
end;
$$;

-- E-mail of an account: admins only, every call is logged.
create or replace function public.admin_get_user_email(p_user_id uuid, p_reason text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  why text := public.checked_reason(p_reason);
  address text;
begin
  perform public.require_admin();
  select u.email into address from auth.users u where u.id = p_user_id;
  if not found then
    raise exception 'user_not_found';
  end if;
  perform public.log_moderation_action('view_email', 'profile', p_user_id, p_user_id, null, why, null, '{}');
  return address;
end;
$$;

-- The audit log, read only. Admin.
create or replace function public.admin_audit_log(
  p_query text default null, p_action text default null, p_target_user uuid default null,
  p_limit integer default 100, p_offset integer default 0
)
returns table (
  id uuid, created_at timestamptz, actor_id uuid, actor_username text, action text, target_type text,
  target_id uuid, target_user_id uuid, report_id uuid, reason text, user_message text, details jsonb
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.require_admin();
  return query
  select a.id, a.created_at, a.actor_id, ap.username, a.action, a.target_type, a.target_id, a.target_user_id,
         a.report_id, a.reason, a.user_message, a.details
  from public.moderation_actions a
  left join public.profiles ap on ap.id = a.actor_id
  where (p_action is null or a.action = p_action)
    and (p_target_user is null or a.target_user_id = p_target_user)
    and (p_query is null or a.reason ilike '%' || p_query || '%' or a.action ilike '%' || p_query || '%'
         or ap.username ilike '%' || p_query || '%')
  order by a.created_at desc
  limit least(greatest(coalesce(p_limit, 100), 1), 500) offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

-- Numbers for the dashboard overview. Moderator.
create or replace function public.admin_overview()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.require_moderator();
  return jsonb_build_object(
    'open_reports', (select count(*) from public.reports r where r.status = 'open'),
    'in_review_reports', (select count(*) from public.reports r where r.status = 'in_review'),
    'oldest_open_at', (select min(r.created_at) from public.reports r where r.status = 'open'),
    'quarantined', (select count(*) from public.posts p where p.moderation_state = 'quarantined')
                 + (select count(*) from public.stories s where s.moderation_state = 'quarantined')
                 + (select count(*) from public.comments c where c.moderation_state = 'quarantined')
                 + (select count(*) from public.messages m where m.moderation_state = 'quarantined')
                 + (select count(*) from public.training_plans tp where tp.moderation_state = 'quarantined')
                 + (select count(*) from public.workouts w where w.moderation_state = 'quarantined')
  );
end;
$$;

-- For the app: my notices from the moderation team, and marking them read.
create or replace function public.mark_moderation_notices_read()
returns void
language sql security definer set search_path = ''
as $$
  update public.moderation_notices set read_at = now()
  where user_id = (select auth.uid()) and read_at is null;
$$;

-- ---------------------------------------------------------------- legal texts
-- SHA-256 of a text (hex). Used for the hash of a published version and of each confirmation.
create or replace function public.legal_hash(content text)
returns text
language sql immutable set search_path = ''
as $$
  select encode(pg_catalog.sha256(convert_to(content, 'UTF8')), 'hex');
$$;

-- Published versions are frozen: only published -> archived and setting announced_at once.
-- Drafts change only through the admin functions (clients have no table rights).
create or replace function public.guard_legal_document()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'published legal documents can not be deleted';
    end if;
    return old;
  end if;
  if old.status = 'draft' then
    return new;
  end if;
  if new.doc_type is distinct from old.doc_type or new.version is distinct from old.version
    or new.title is distinct from old.title or new.body_md is distinct from old.body_md
    or new.change_summary is distinct from old.change_summary
    or new.confirmation_type is distinct from old.confirmation_type
    or new.requires_confirmation is distinct from old.requires_confirmation
    or new.blocking is distinct from old.blocking or new.grace_days is distinct from old.grace_days
    or new.content_hash is distinct from old.content_hash or new.published_at is distinct from old.published_at
    or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at
    or (old.announced_at is not null and new.announced_at is distinct from old.announced_at)
    or (new.status <> old.status and not (old.status = 'published' and new.status = 'archived')) then
    raise exception 'published legal documents are immutable; publish a new version instead';
  end if;
  return new;
end;
$$;

-- Confirmations: never changed; deleted only together with the account (the profile row is
-- already gone when the cascade reaches this table).
create or replace function public.guard_legal_confirmation()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'legal confirmations can not be changed';
  end if;
  if exists (select 1 from public.profiles p where p.id = old.user_id) then
    raise exception 'legal confirmations are deleted only together with the account';
  end if;
  return old;
end;
$$;

-- The current version of each type (newest published).
create or replace function public.current_legal_documents()
returns setof public.legal_documents
language sql stable security definer set search_path = ''
as $$
  select distinct on (d.doc_type) d.*
  from public.legal_documents d
  where d.status = 'published'
  order by d.doc_type, d.version desc;
$$;

-- For everyone, also without login and for suspended accounts: the current published texts.
create or replace function public.get_current_legal_documents()
returns table (
  id uuid, doc_type text, version integer, title text, body_md text, change_summary text,
  confirmation_type text, requires_confirmation boolean, blocking boolean, grace_days integer,
  published_at timestamptz, content_hash text
)
language sql stable security definer set search_path = ''
as $$
  select d.id, d.doc_type, d.version, d.title, d.body_md, d.change_summary, d.confirmation_type,
         d.requires_confirmation, d.blocking, d.grace_days, d.published_at, d.content_hash
  from public.current_legal_documents() d
  order by array_position(array['terms', 'privacy', 'guidelines'], d.doc_type);
$$;

-- Older versions of one type, read-only (published and archived; never drafts).
create or replace function public.get_legal_document_versions(p_doc_type text)
returns table (id uuid, version integer, title text, published_at timestamptz, status text)
language sql stable security definer set search_path = ''
as $$
  select d.id, d.version, d.title, d.published_at, d.status
  from public.legal_documents d
  where d.doc_type = p_doc_type and d.status in ('published', 'archived')
  order by d.version desc;
$$;

create or replace function public.get_legal_document(p_id uuid)
returns table (
  id uuid, doc_type text, version integer, title text, body_md text, change_summary text,
  confirmation_type text, published_at timestamptz, status text
)
language sql stable security definer set search_path = ''
as $$
  select d.id, d.doc_type, d.version, d.title, d.body_md, d.change_summary, d.confirmation_type, d.published_at, d.status
  from public.legal_documents d
  where d.id = p_id and d.status in ('published', 'archived');
$$;

-- My status per current document: confirmed (this version) or not, my last confirmation of
-- this type, and whether "Später" is possible (only for an update of a text I confirmed in an
-- earlier version, and only if the version isn't blocking). Also for suspended accounts.
create or replace function public.get_my_legal_status()
returns table (
  document_id uuid, doc_type text, version integer, title text, requires_confirmation boolean,
  confirmation_type text, confirmed_at timestamptz, last_confirmed_version integer,
  last_confirmed_at timestamptz, can_postpone boolean
)
language sql stable security definer set search_path = ''
as $$
  select d.id, d.doc_type, d.version, d.title, d.requires_confirmation, d.confirmation_type,
         mine.confirmed_at, prev.version, prev.confirmed_at,
         not d.blocking and prev.version is not null
  from public.current_legal_documents() d
  left join public.legal_confirmations mine
    on mine.document_id = d.id and mine.user_id = (select auth.uid())
  left join lateral (
    select od.version, c.confirmed_at
    from public.legal_confirmations c
    join public.legal_documents od on od.id = c.document_id
    where c.user_id = (select auth.uid()) and od.doc_type = d.doc_type
    order by od.version desc limit 1
  ) prev on true
  where (select auth.uid()) is not null
  order by array_position(array['terms', 'privacy', 'guidelines'], d.doc_type);
$$;

-- Confirms current versions for the caller (also while suspended). The server sets time, type
-- and hash. A suspension with reason 'terms_pending' ends once nothing required is missing
-- (logged); suspensions for other reasons stay.
create or replace function public.confirm_legal_documents(p_document_ids uuid[], p_app_version text default null)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  doc public.legal_documents%rowtype;
  added integer := 0;
  profile_status text;
  profile_reason text;
begin
  if me is null then
    raise exception 'not authenticated';
  end if;
  if p_document_ids is null or cardinality(p_document_ids) = 0 or cardinality(p_document_ids) > 10 then
    raise exception 'invalid_documents';
  end if;
  for doc in
    select d.* from public.current_legal_documents() d where d.id = any (p_document_ids)
  loop
    insert into public.legal_confirmations (user_id, document_id, confirmation_type, confirmed_at, app_version, content_hash_at_confirm)
    values (me, doc.id, doc.confirmation_type, now(), left(btrim(coalesce(p_app_version, '')), 32), doc.content_hash)
    on conflict (user_id, document_id) do nothing;
    if found then
      added := added + 1;
    end if;
    delete from public.confirmation_followups where user_id = me and document_id = doc.id;
  end loop;
  if added = 0 and not exists (
    select 1 from public.current_legal_documents() d where d.id = any (p_document_ids)
  ) then
    raise exception 'documents_not_current';
  end if;
  update public.notifications set read_at = coalesce(read_at, now())
  where user_id = me and type = 'legal_update';

  select p.account_status, p.suspension_reason_code into profile_status, profile_reason
  from public.profiles p where p.id = me for update;
  if profile_status = 'suspended' and profile_reason = 'terms_pending' and not exists (
    select 1 from public.current_legal_documents() d
    where d.requires_confirmation
      and not exists (select 1 from public.legal_confirmations c where c.user_id = me and c.document_id = d.id)
  ) then
    update public.profiles
    set account_status = 'active', suspended_until = null, suspension_reason_code = null,
        moderation_message = null, moderation_updated_at = now()
    where id = me;
    perform public.log_moderation_action(
      'auto_unsuspend_terms', 'profile', me, me, null,
      'Rechtstexte bestätigt, Sperre terms_pending automatisch aufgehoben', null, '{}'
    );
  end if;
  return added;
end;
$$;

-- Accounts that count for announcements and reminders: active (or an expired suspension).
-- Internal.
create or replace function public.legal_due_at(doc public.legal_documents, f_next timestamptz)
returns timestamptz
language sql immutable set search_path = ''
as $$
  select coalesce(f_next, doc.announced_at + make_interval(days => doc.grace_days));
$$;

-- Announces a published version: in-app notice for every active account and a reminder entry
-- due after grace_days. Runs once per version. Admin, logged.
create or replace function public.admin_announce_legal_update(p_document_id uuid)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  doc public.legal_documents%rowtype;
  affected integer;
begin
  perform public.require_admin();
  select * into doc from public.legal_documents d where d.id = p_document_id for update;
  if not found or doc.status <> 'published' then
    raise exception 'document_not_published';
  end if;
  if doc.announced_at is not null then
    raise exception 'already_announced';
  end if;
  update public.legal_documents set announced_at = now() where id = doc.id returning * into doc;
  if doc.requires_confirmation then
    insert into public.notifications (user_id, actor_id, type, payload)
    select p.id, null, 'legal_update',
           jsonb_build_object('document_id', doc.id, 'doc_type', doc.doc_type, 'version', doc.version)
    from public.profiles p
    where public.account_is_active(p.id)
      and not exists (select 1 from public.legal_confirmations c where c.user_id = p.id and c.document_id = doc.id);
    get diagnostics affected = row_count;
    insert into public.confirmation_followups (user_id, document_id, next_review_at)
    select p.id, doc.id, doc.announced_at + make_interval(days => doc.grace_days)
    from public.profiles p
    where public.account_is_active(p.id)
      and not exists (select 1 from public.legal_confirmations c where c.user_id = p.id and c.document_id = doc.id)
    on conflict (user_id, document_id) do nothing;
  else
    affected := 0;
  end if;
  perform public.log_moderation_action(
    'legal_announce', 'legal_document', doc.id, null, null,
    format('Version %s von %s angekündigt', doc.version, doc.doc_type), null,
    jsonb_build_object('doc_type', doc.doc_type, 'version', doc.version, 'affected_users', affected)
  );
  return affected;
end;
$$;

-- Creates (p_id null: next version number) or updates a draft. Admin, logged.
create or replace function public.admin_legal_save_draft(
  p_id uuid, p_doc_type text, p_title text, p_body_md text, p_change_summary text,
  p_confirmation_type text, p_requires_confirmation boolean, p_blocking boolean, p_grace_days integer
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  draft uuid;
  next_version integer;
begin
  perform public.require_admin();
  if p_id is null then
    select coalesce(max(d.version), 0) + 1 into next_version from public.legal_documents d where d.doc_type = p_doc_type;
    insert into public.legal_documents
      (doc_type, version, title, body_md, change_summary, confirmation_type, requires_confirmation, blocking, grace_days, created_by)
    values (p_doc_type, next_version, btrim(p_title), p_body_md, nullif(btrim(coalesce(p_change_summary, '')), ''),
            p_confirmation_type, coalesce(p_requires_confirmation, true), coalesce(p_blocking, false),
            coalesce(p_grace_days, 5), auth.uid())
    returning id into draft;
  else
    update public.legal_documents
    set title = btrim(p_title), body_md = p_body_md, change_summary = nullif(btrim(coalesce(p_change_summary, '')), ''),
        confirmation_type = p_confirmation_type, requires_confirmation = coalesce(p_requires_confirmation, true),
        blocking = coalesce(p_blocking, false), grace_days = coalesce(p_grace_days, 5)
    where id = p_id and status = 'draft'
    returning id into draft;
    if draft is null then
      raise exception 'draft_not_found';
    end if;
  end if;
  perform public.log_moderation_action(
    'legal_save_draft', 'legal_document', draft, null, null, 'Entwurf eines Rechtstexts gespeichert', null,
    jsonb_build_object('doc_type', p_doc_type)
  );
  return draft;
end;
$$;

create or replace function public.admin_legal_delete_draft(p_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  why text := public.checked_reason(p_reason);
begin
  perform public.require_admin();
  delete from public.legal_documents where id = p_id and status = 'draft';
  if not found then
    raise exception 'draft_not_found';
  end if;
  perform public.log_moderation_action('legal_delete_draft', 'legal_document', p_id, null, null, why, null, '{}');
end;
$$;

-- How many accounts a publication concerns (active accounts), for the publish dialog.
create or replace function public.admin_legal_affected_count()
returns integer
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.require_admin();
  return (select count(*) from public.profiles p where public.account_is_active(p.id));
end;
$$;

-- Publishes a draft: hash, published_at, the previous version is archived, and the version is
-- announced right away (notices and reminders). New sign-ups need it immediately. Admin, logged.
create or replace function public.admin_legal_publish(p_id uuid, p_reason text)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  why text := public.checked_reason(p_reason);
  doc public.legal_documents%rowtype;
begin
  perform public.require_admin();
  select * into doc from public.legal_documents d where d.id = p_id for update;
  if not found or doc.status <> 'draft' then
    raise exception 'draft_not_found';
  end if;
  if exists (
    select 1 from public.legal_documents d
    where d.doc_type = doc.doc_type and d.status in ('published', 'archived') and d.version > doc.version
  ) then
    raise exception 'newer_version_exists';
  end if;
  update public.legal_documents set status = 'archived'
  where doc_type = doc.doc_type and status = 'published';
  update public.legal_documents
  set status = 'published', published_at = now(), content_hash = public.legal_hash(body_md)
  where id = doc.id;
  perform public.log_moderation_action(
    'legal_publish', 'legal_document', doc.id, null, null, why, null,
    jsonb_build_object('doc_type', doc.doc_type, 'version', doc.version,
                       'requires_confirmation', doc.requires_confirmation, 'blocking', doc.blocking)
  );
  return public.admin_announce_legal_update(doc.id);
end;
$$;

-- All versions with numbers (confirmed, pending, overdue). Admin.
create or replace function public.admin_legal_list()
returns table (
  id uuid, doc_type text, version integer, title text, status text, confirmation_type text,
  requires_confirmation boolean, blocking boolean, grace_days integer, change_summary text,
  published_at timestamptz, announced_at timestamptz, created_at timestamptz, content_hash text,
  confirmed bigint, pending bigint, overdue bigint
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.require_admin();
  return query
  select d.id, d.doc_type, d.version, d.title, d.status, d.confirmation_type, d.requires_confirmation,
         d.blocking, d.grace_days, d.change_summary, d.published_at, d.announced_at, d.created_at, d.content_hash,
         (select count(*) from public.legal_confirmations c where c.document_id = d.id),
         case when d.status = 'published' and d.requires_confirmation then
           (select count(*) from public.profiles p
            where public.account_is_active(p.id)
              and not exists (select 1 from public.legal_confirmations c where c.user_id = p.id and c.document_id = d.id))
         else 0 end,
         case when d.status = 'published' and d.requires_confirmation and d.announced_at is not null then
           (select count(*) from public.profiles p
            left join public.confirmation_followups f on f.user_id = p.id and f.document_id = d.id
            where p.account_status = 'active'
              and not exists (select 1 from public.legal_confirmations c where c.user_id = p.id and c.document_id = d.id)
              and public.legal_due_at(d, f.next_review_at) <= now())
         else 0 end
  from public.legal_documents d
  order by d.doc_type, d.version desc;
end;
$$;

-- One version including its text (also drafts). Admin.
create or replace function public.admin_legal_document(p_id uuid)
returns setof public.legal_documents
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.require_admin();
  return query select * from public.legal_documents d where d.id = p_id;
end;
$$;

-- "Offene Bestätigungen": active accounts (not suspended, banned or deleting) that haven't
-- confirmed a current, required version and whose review date has come. Computed now. Admin.
create or replace function public.admin_legal_pending(p_limit integer default 100, p_offset integer default 0)
returns table (
  user_id uuid, username text, display_name text, document_id uuid, doc_type text, version integer,
  announced_at timestamptz, days_since_announce integer, action_count integer, last_action text,
  last_action_at timestamptz, due_at timestamptz, note text
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.require_admin();
  return query
  select p.id, p.username, p.display_name, d.id, d.doc_type, d.version, d.announced_at,
         floor(extract(epoch from now() - d.announced_at) / 86400)::integer,
         coalesce(f.action_count, 0), f.last_action, f.last_action_at,
         public.legal_due_at(d, f.next_review_at), f.note
  from public.current_legal_documents() d
  join public.profiles p on p.account_status = 'active'
  left join public.confirmation_followups f on f.user_id = p.id and f.document_id = d.id
  where d.requires_confirmation and d.announced_at is not null
    and not exists (select 1 from public.legal_confirmations c where c.user_id = p.id and c.document_id = d.id)
    and public.legal_due_at(d, f.next_review_at) <= now()
  order by public.legal_due_at(d, f.next_review_at), p.username
  limit least(greatest(coalesce(p_limit, 100), 1), 500) offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

-- Internal: records a reminder step and moves the next review 5 days ahead.
create or replace function public.legal_followup_step(p_user uuid, p_document uuid, p_action text, p_note text)
returns void
language sql security definer set search_path = ''
as $$
  insert into public.confirmation_followups (user_id, document_id, last_action, last_action_at, next_review_at, action_count, note)
  values (p_user, p_document, p_action, now(), now() + interval '5 days', 1, nullif(btrim(coalesce(p_note, '')), ''))
  on conflict (user_id, document_id) do update
    set last_action = excluded.last_action, last_action_at = excluded.last_action_at,
        next_review_at = excluded.next_review_at,
        action_count = public.confirmation_followups.action_count + 1,
        note = coalesce(excluded.note, public.confirmation_followups.note);
$$;

-- Is this user still missing this current, required version? Internal.
create or replace function public.legal_is_pending(p_user uuid, p_document uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.current_legal_documents() d
    where d.id = p_document and d.requires_confirmation
      and not exists (select 1 from public.legal_confirmations c where c.user_id = p_user and c.document_id = d.id)
  );
$$;

-- One reminder step for one user: 'notify' (new in-app notice), 'email' (recorded by the
-- e-mail Edge Function after sending) or 'defer' (with a note). Admin, logged.
create or replace function public.admin_legal_followup(p_user_id uuid, p_document_id uuid, p_action text, p_note text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  doc public.legal_documents%rowtype;
begin
  perform public.require_admin();
  if p_action not in ('notify', 'email', 'defer') then
    raise exception 'invalid_action';
  end if;
  if p_action = 'defer' and nullif(btrim(coalesce(p_note, '')), '') is null then
    raise exception 'note_required';
  end if;
  if not public.legal_is_pending(p_user_id, p_document_id) then
    raise exception 'not_pending';
  end if;
  select * into doc from public.legal_documents d where d.id = p_document_id;
  if p_action = 'notify' then
    insert into public.notifications (user_id, actor_id, type, payload)
    values (p_user_id, null, 'legal_update',
            jsonb_build_object('document_id', doc.id, 'doc_type', doc.doc_type, 'version', doc.version, 'reminder', true));
  end if;
  perform public.legal_followup_step(p_user_id, p_document_id, p_action, p_note);
  perform public.log_moderation_action(
    'legal_' || p_action, 'legal_document', p_document_id, p_user_id, null,
    case p_action when 'notify' then 'Erinnerung an Rechtstext in der App'
                  when 'email' then 'Erinnerung an Rechtstext per E-Mail'
                  else 'Erinnerung an Rechtstext zurückgestellt' end,
    null, jsonb_build_object('doc_type', doc.doc_type, 'version', doc.version, 'note', nullif(btrim(coalesce(p_note, '')), ''))
  );
end;
$$;

-- Reminders for a selection of overdue users (the only bulk action), at most 200. Admin, logged.
create or replace function public.admin_legal_bulk_notify(p_user_ids uuid[], p_document_id uuid)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  target uuid;
  done integer := 0;
begin
  perform public.require_admin();
  if p_user_ids is null or cardinality(p_user_ids) = 0 or cardinality(p_user_ids) > 200 then
    raise exception 'invalid_selection';
  end if;
  foreach target in array p_user_ids loop
    if public.legal_is_pending(target, p_document_id)
      and exists (select 1 from public.profiles p where p.id = target and p.account_status = 'active') then
      perform public.admin_legal_followup(target, p_document_id, 'notify', null);
      done := done + 1;
    end if;
  end loop;
  return done;
end;
$$;

-- Suspends one user until they confirm (reason code 'terms_pending'; lifted automatically by
-- confirm_legal_documents). Single users only. Admin, logged.
create or replace function public.admin_legal_suspend(p_user_id uuid, p_document_id uuid, p_reason text, p_user_message text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  action uuid;
begin
  perform public.require_admin();
  if not public.legal_is_pending(p_user_id, p_document_id) then
    raise exception 'not_pending';
  end if;
  if nullif(btrim(coalesce(p_user_message, '')), '') is null then
    raise exception 'user_message_required';
  end if;
  action := public.mod_suspend_user(p_user_id, null, p_reason, p_user_message, 'terms_pending', null);
  perform public.legal_followup_step(p_user_id, p_document_id, 'suspend', null);
  return action;
end;
$$;

-- For the e-mail Edge Function: which of these users are still pending and active (at most 50).
create or replace function public.admin_legal_email_targets(p_user_ids uuid[], p_document_id uuid)
returns table (user_id uuid)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.require_admin();
  if p_user_ids is null or cardinality(p_user_ids) > 50 then
    raise exception 'invalid_selection';
  end if;
  return query
  select p.id from public.profiles p
  where p.id = any (p_user_ids) and p.account_status = 'active' and public.legal_is_pending(p.id, p_document_id);
end;
$$;

-- Overview card: overdue accounts and the oldest overdue date. Admin.
create or replace function public.admin_legal_overview()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.require_admin();
  return (
    select jsonb_build_object('overdue', count(*), 'oldest_due_at', min(public.legal_due_at(d, f.next_review_at)))
    from public.current_legal_documents() d
    join public.profiles p on p.account_status = 'active'
    left join public.confirmation_followups f on f.user_id = p.id and f.document_id = d.id
    where d.requires_confirmation and d.announced_at is not null
      and not exists (select 1 from public.legal_confirmations c where c.user_id = p.id and c.document_id = d.id)
      and public.legal_due_at(d, f.next_review_at) <= now()
  );
end;
$$;

-- Confirmation history and reminders of one user. Admin, logged.
create or replace function public.admin_legal_user_history(p_user_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  result jsonb;
begin
  perform public.require_admin();
  result := jsonb_build_object(
    'confirmations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'doc_type', d.doc_type, 'version', d.version, 'confirmation_type', c.confirmation_type,
        'confirmed_at', c.confirmed_at, 'content_hash', c.content_hash_at_confirm, 'app_version', c.app_version
      ) order by c.confirmed_at desc)
      from public.legal_confirmations c join public.legal_documents d on d.id = c.document_id
      where c.user_id = p_user_id), '[]'::jsonb),
    'followups', coalesce((
      select jsonb_agg(jsonb_build_object(
        'doc_type', d.doc_type, 'version', d.version, 'last_action', f.last_action, 'last_action_at', f.last_action_at,
        'next_review_at', f.next_review_at, 'action_count', f.action_count, 'note', f.note
      ) order by d.doc_type)
      from public.confirmation_followups f join public.legal_documents d on d.id = f.document_id
      where f.user_id = p_user_id), '[]'::jsonb)
  );
  perform public.log_moderation_action('view_legal_history', 'profile', p_user_id, p_user_id, null,
    'Bestätigungs-Historie im Dashboard geöffnet', null, '{}');
  return result;
end;
$$;

-- Returns the 1:1 conversation with `other_user`, creating it if needed.
-- Only allowed with people you follow. Conversations and members are created
-- exclusively through this function.
create or replace function public.get_or_create_direct_conversation(other_user uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  conversation uuid;
begin
  if me is null then
    raise exception 'not authenticated';
  end if;
  if other_user = me then
    raise exception 'cannot start a chat with yourself';
  end if;
  if not public.is_account_active() then
    raise exception 'account_inactive';
  end if;
  if not public.can_see_account(other_user) then
    raise exception 'chat_not_possible';
  end if;
  -- The official account can't be written to (neutral message, nothing about why).
  if public.is_official(other_user) then
    raise exception 'chat_not_possible';
  end if;
  if not public.is_following(other_user) then
    raise exception 'you can only start chats with people you follow';
  end if;
  return public.direct_conversation_between(me, other_user);
end;
$$;

-- Create a profile for every new auth user, using the username from sign-up metadata.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, username, display_name)
  values (
    new.id,
    coalesce(
      lower(new.raw_user_meta_data ->> 'username'),
      'user_' || substr(replace(new.id::text, '-', ''), 1, 12)
    ),
    -- Empty or missing: on_profile_write falls back to the username.
    btrim(left(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), 30))
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

drop trigger if exists follows_set_status on public.follows;
create trigger follows_set_status
  before insert on public.follows
  for each row execute function public.handle_follow_insert();

drop trigger if exists follows_guard_update on public.follows;
create trigger follows_guard_update
  before update on public.follows
  for each row execute function public.handle_follow_update();

drop trigger if exists post_tags_created on public.post_tags;
create trigger post_tags_created
  after insert on public.post_tags
  for each row execute function public.on_post_tag_created();

drop trigger if exists stories_created on public.stories;
create trigger stories_created
  after insert on public.stories
  for each row execute function public.on_story_created();

drop trigger if exists posts_text_changed on public.posts;
create trigger posts_text_changed
  after insert or update of caption on public.posts
  for each row execute function public.on_post_text_change();

drop trigger if exists post_media_changed on public.post_media;
create trigger post_media_changed
  after insert or update or delete on public.post_media
  for each row execute function public.on_post_media_change();

drop trigger if exists posts_deleted_hashtags on public.posts;
create trigger posts_deleted_hashtags
  after delete on public.posts
  for each row execute function public.on_tagged_content_deleted('post');

drop trigger if exists comments_deleted_hashtags on public.comments;
create trigger comments_deleted_hashtags
  after delete on public.comments
  for each row execute function public.on_tagged_content_deleted('comment');

drop trigger if exists stories_deleted_hashtags on public.stories;
create trigger stories_deleted_hashtags
  after delete on public.stories
  for each row execute function public.on_tagged_content_deleted('story');

drop trigger if exists content_hashtags_count on public.content_hashtags;
create trigger content_hashtags_count
  after insert or delete on public.content_hashtags
  for each row execute function public.on_content_hashtag_change();

drop trigger if exists comments_created on public.comments;
create trigger comments_created
  after insert on public.comments
  for each row execute function public.on_comment_created();

drop trigger if exists workout_shares_force_pending on public.workout_shares;
create trigger workout_shares_force_pending
  before insert on public.workout_shares
  for each row execute function public.on_workout_share_insert();

drop trigger if exists workout_shares_guard_update on public.workout_shares;
create trigger workout_shares_guard_update
  before update on public.workout_shares
  for each row execute function public.on_workout_share_update();

drop trigger if exists workout_shares_created on public.workout_shares;
create trigger workout_shares_created
  after insert on public.workout_shares
  for each row execute function public.on_workout_share_created();

drop trigger if exists workout_shares_answered on public.workout_shares;
create trigger workout_shares_answered
  after update on public.workout_shares
  for each row execute function public.on_workout_share_answered();

drop trigger if exists follows_created on public.follows;
create trigger follows_created
  after insert on public.follows
  for each row execute function public.on_follow_created();

drop trigger if exists follows_request_accepted on public.follows;
create trigger follows_request_accepted
  after update on public.follows
  for each row execute function public.on_follow_request_closed();

drop trigger if exists follows_request_removed on public.follows;
create trigger follows_request_removed
  after delete on public.follows
  for each row execute function public.on_follow_request_closed();

drop trigger if exists notifications_purge_expired on public.notifications;
create trigger notifications_purge_expired
  after insert on public.notifications
  for each row execute function public.on_notification_created();

drop trigger if exists notifications_guard_update on public.notifications;
create trigger notifications_guard_update
  before update on public.notifications
  for each row execute function public.on_notification_update();

drop trigger if exists posts_plan_day on public.posts;
create trigger posts_plan_day
  before insert or update on public.posts
  for each row execute function public.on_post_plan_day();

drop trigger if exists posts_plan_proof on public.posts;
create trigger posts_plan_proof
  after insert or update of plan_day_id on public.posts
  for each row execute function public.on_post_plan_proof();

drop trigger if exists posts_training_added on public.posts;
create trigger posts_training_added
  after insert or update of workout_date on public.posts
  for each row execute function public.on_training_added();

drop trigger if exists workout_shares_training_added on public.workout_shares;
create trigger workout_shares_training_added
  after update of status on public.workout_shares
  for each row execute function public.on_training_added();

drop trigger if exists legal_documents_guard on public.legal_documents;
create trigger legal_documents_guard
  before update or delete on public.legal_documents
  for each row execute function public.guard_legal_document();

drop trigger if exists legal_confirmations_guard on public.legal_confirmations;
create trigger legal_confirmations_guard
  before update or delete on public.legal_confirmations
  for each row execute function public.guard_legal_confirmation();

drop trigger if exists moderation_actions_append_only on public.moderation_actions;
create trigger moderation_actions_append_only
  before update or delete on public.moderation_actions
  for each row execute function public.guard_moderation_actions();
drop trigger if exists moderation_actions_no_truncate on public.moderation_actions;
create trigger moderation_actions_no_truncate
  before truncate on public.moderation_actions
  for each statement execute function public.forbid_change();

do $$
declare
  t text;
begin
  foreach t in array array['posts', 'stories', 'comments', 'messages', 'training_plans', 'workouts'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_moderation_guard', t);
    execute format(
      'create trigger %I before insert or update on public.%I for each row execute function public.guard_content_moderation()',
      t || '_moderation_guard', t
    );
  end loop;
end;
$$;

drop trigger if exists profiles_moderation_guard on public.profiles;
create trigger profiles_moderation_guard
  before insert or update on public.profiles
  for each row execute function public.guard_profile_moderation();

drop trigger if exists user_blocks_created on public.user_blocks;
create trigger user_blocks_created
  after insert on public.user_blocks
  for each row execute function public.on_user_blocked();

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard
  before insert or update on public.profiles
  for each row execute function public.on_profile_write();

drop trigger if exists profiles_privacy_changed on public.profiles;
create trigger profiles_privacy_changed
  after update of is_private on public.profiles
  for each row execute function public.handle_profile_privacy_change();

revoke all on function public.get_or_create_direct_conversation(uuid) from public, anon;
grant execute on function public.get_or_create_direct_conversation(uuid) to authenticated;
grant execute on function public.username_available(text) to anon, authenticated;
revoke all on function public.resolve_usernames(text[]) from public, anon;
grant execute on function public.resolve_usernames(text[]) to authenticated;
revoke all on function public.user_id_for_username(text) from public, anon, authenticated;
revoke all on function public.on_profile_write() from public, anon, authenticated;
revoke all on function public.set_message_pinned(uuid, boolean) from public, anon;
grant execute on function public.set_message_pinned(uuid, boolean) to authenticated;
revoke all on function public.is_message_hidden_for_me(uuid) from public, anon;
grant execute on function public.is_message_hidden_for_me(uuid) to authenticated;
revoke all on function public.hide_message_for_me(uuid) from public, anon;
grant execute on function public.hide_message_for_me(uuid) to authenticated;
revoke all on function public.delete_message_for_everyone(uuid) from public, anon;
grant execute on function public.delete_message_for_everyone(uuid) to authenticated;
revoke all on function public.my_chat_cleared_at(uuid) from public, anon;
grant execute on function public.my_chat_cleared_at(uuid) to authenticated;
revoke all on function public.conversation_blocked_pair(uuid) from public, anon;
grant execute on function public.conversation_blocked_pair(uuid) to authenticated;
revoke all on function public.clear_chat_for_me(uuid) from public, anon;
grant execute on function public.clear_chat_for_me(uuid) to authenticated;
revoke all on function public.get_my_cleared_conversations() from public, anon;
grant execute on function public.get_my_cleared_conversations() to authenticated;
revoke all on function public.get_chat_messages(uuid, timestamptz, integer) from public, anon;
grant execute on function public.get_chat_messages(uuid, timestamptz, integer) to authenticated;
revoke all on function public.guard_conversation_member() from public, anon, authenticated;
drop trigger if exists conversation_members_guard on public.conversation_members;
create trigger conversation_members_guard
  before update on public.conversation_members
  for each row execute function public.guard_conversation_member();
-- New in the privacy model: nothing of it for anonymous users.
revoke all on function public.follow_counts(uuid) from public, anon;
grant execute on function public.follow_counts(uuid) to authenticated;
revoke all on function public.is_public_content(uuid, text) from public, anon;
grant execute on function public.is_public_content(uuid, text) to authenticated;
revoke all on function public.can_view_follow_lists(uuid) from public, anon;
grant execute on function public.can_view_follow_lists(uuid) to authenticated;
-- Phase G. Internal helpers: only callable from other security definer functions.
revoke all on function public.are_connected(uuid, uuid) from public, anon, authenticated;
revoke all on function public.tag_allowed(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.user_can_see_post(uuid, uuid) from public, anon, authenticated;
revoke all on function public.direct_conversation_between(uuid, uuid) from public, anon, authenticated;
revoke all on function public.create_notification(uuid, uuid, text, uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.handle_tag(uuid, uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.post_tag_text(uuid) from public, anon, authenticated;
revoke all on function public.sync_hashtags(text, uuid, uuid, text) from public, anon, authenticated;
-- Used by policies and the app; signed-in users only.
revoke all on function public.can_tag(uuid, text) from public, anon;
grant execute on function public.can_tag(uuid, text) to authenticated;
revoke all on function public.taggable_user_ids(uuid[], text) from public, anon;
grant execute on function public.taggable_user_ids(uuid[], text) to authenticated;
revoke all on function public.mentions_allowed(uuid[]) from public, anon;
grant execute on function public.mentions_allowed(uuid[]) to authenticated;
revoke all on function public.workout_days(uuid) from public, anon;
grant execute on function public.workout_days(uuid) to authenticated;
revoke all on function public.can_view_calendar(uuid) from public, anon;
grant execute on function public.can_view_calendar(uuid) to authenticated;
revoke all on function public.can_request_workout_link(uuid, uuid) from public, anon;
grant execute on function public.can_request_workout_link(uuid, uuid) to authenticated;
revoke all on function public.can_repost(uuid) from public, anon;
grant execute on function public.can_repost(uuid) to authenticated;
revoke all on function public.can_view_plan(uuid) from public, anon;
grant execute on function public.can_view_plan(uuid) to authenticated;
revoke all on function public.save_plan(uuid, text, text, boolean, jsonb) from public, anon;
grant execute on function public.save_plan(uuid, text, text, boolean, jsonb) to authenticated;
revoke all on function public.activate_plan(uuid, boolean) from public, anon;
grant execute on function public.activate_plan(uuid, boolean) to authenticated;
revoke all on function public.deactivate_plan() from public, anon;
grant execute on function public.deactivate_plan() to authenticated;
revoke all on function public.reorder_plan_days(uuid, uuid[]) from public, anon;
grant execute on function public.reorder_plan_days(uuid, uuid[]) to authenticated;
revoke all on function public.reorder_plan_exercises(uuid, uuid[]) from public, anon;
grant execute on function public.reorder_plan_exercises(uuid, uuid[]) to authenticated;
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.plan_template_order(uuid)', 'public.plan_round_from_proofs(uuid, uuid)',
    'public.plan_round_load(uuid, uuid)', 'public.plan_round_template_changed(uuid)',
    'public.plan_round_advance(uuid, uuid, integer, date)',
    'public.plan_record_proof(uuid, uuid, text, uuid, date)', 'public.on_post_plan_proof()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end;
$$;
revoke all on function public.get_my_plan_round() from public, anon;
grant execute on function public.get_my_plan_round() to authenticated;
revoke all on function public.resolve_plan_deviation(uuid, text, jsonb, text) from public, anon;
grant execute on function public.resolve_plan_deviation(uuid, text, jsonb, text) to authenticated;
revoke all on function public.adjust_plan_round(uuid[]) from public, anon;
grant execute on function public.adjust_plan_round(uuid[]) to authenticated;
revoke all on function public.skip_plan_round_unit(uuid, text) from public, anon;
grant execute on function public.skip_plan_round_unit(uuid, text) to authenticated;
revoke all on function public.duplicate_plan(uuid) from public, anon;
grant execute on function public.duplicate_plan(uuid) to authenticated;
revoke all on function public.delete_plan(uuid) from public, anon;
grant execute on function public.delete_plan(uuid) to authenticated;
revoke all on function public.can_view_workout(uuid) from public, anon;
grant execute on function public.can_view_workout(uuid) to authenticated;
revoke all on function public.set_workout_visibility(uuid, text) from public, anon;
grant execute on function public.set_workout_visibility(uuid, text) to authenticated;
revoke all on function public.save_workout(jsonb) from public, anon;
grant execute on function public.save_workout(jsonb) to authenticated;
revoke all on function public.link_workout_post(uuid, uuid, boolean) from public, anon;
grant execute on function public.link_workout_post(uuid, uuid, boolean) to authenticated;
revoke all on function public.workout_rules() from public, anon;
grant execute on function public.workout_rules() to authenticated;
revoke all on function public.day_proof(uuid, date) from public, anon, authenticated;
revoke all on function public.day_counts_as_workout(uuid, date) from public, anon, authenticated;
revoke all on function public.adopt_plan(uuid, boolean) from public, anon;
grant execute on function public.adopt_plan(uuid, boolean) to authenticated;
revoke all on function public.my_exercise_names() from public, anon;
grant execute on function public.my_exercise_names() to authenticated;
revoke all on function public.plan_limits() from public, anon;
grant execute on function public.plan_limits() to authenticated;
revoke all on function public.use_planned_rest_day(date) from public, anon;
grant execute on function public.use_planned_rest_day(date) to authenticated;
revoke all on function public.plan_progress(uuid) from public, anon, authenticated;
revoke all on function public.is_training_day(uuid, date) from public, anon, authenticated;
revoke all on function public.on_post_plan_day() from public, anon, authenticated;
revoke all on function public.on_training_added() from public, anon, authenticated;
revoke all on function public.set_rest_budget(integer) from public, anon;
grant execute on function public.set_rest_budget(integer) to authenticated;
revoke all on function public.use_rest_day(date) from public, anon;
grant execute on function public.use_rest_day(date) to authenticated;
revoke all on function public.undo_rest_day(date) from public, anon;
grant execute on function public.undo_rest_day(date) to authenticated;
revoke all on function public.rest_days(uuid) from public, anon;
grant execute on function public.rest_days(uuid) to authenticated;
revoke all on function public.plan_proofs() from public, anon;
grant execute on function public.plan_proofs() to authenticated;
revoke all on function public.is_blocked_between(uuid, uuid) from public, anon, authenticated;
revoke all on function public.account_is_active(uuid) from public, anon, authenticated;
revoke all on function public.on_user_blocked() from public, anon, authenticated;
revoke all on function public.guard_profile_moderation() from public, anon, authenticated;
revoke all on function public.check_report_allowed() from public, anon, authenticated;
revoke all on function public.is_account_active() from public, anon;
grant execute on function public.is_account_active() to authenticated;
revoke all on function public.can_see_account(uuid) from public, anon;
grant execute on function public.can_see_account(uuid) to authenticated;
revoke all on function public.conversation_has_block(uuid) from public, anon;
grant execute on function public.conversation_has_block(uuid) to authenticated;
revoke all on function public.get_my_account_status() from public, anon;
grant execute on function public.get_my_account_status() to authenticated;
revoke all on function public.report_content(text, uuid, text, text) from public, anon;
grant execute on function public.report_content(text, uuid, text, text) to authenticated;
revoke all on function public.report_message(uuid, text, text) from public, anon;
grant execute on function public.report_message(uuid, text, text) to authenticated;
revoke all on function public.get_my_blocked_accounts() from public, anon;
grant execute on function public.get_my_blocked_accounts() to authenticated;
-- Staff functions: callable when signed in; each checks the role and aal2 itself.
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.is_moderator()', 'public.is_admin()', 'public.admin_whoami()',
    'public.mod_remove_content(text, uuid, text, text, uuid)',
    'public.mod_quarantine_content(text, uuid, text, uuid)',
    'public.mod_restore_content(text, uuid, text, uuid)',
    'public.mod_warn_user(uuid, text, text, uuid)',
    'public.mod_suspend_user(uuid, timestamptz, text, text, text, uuid)',
    'public.mod_ban_user(uuid, text, text, uuid)',
    'public.mod_unban_user(uuid, text, uuid)',
    'public.mod_resolve_report(uuid, text, text)',
    'public.admin_report_queue(text, text, text, integer, boolean, integer, integer)',
    'public.admin_report_detail(uuid)',
    'public.admin_user_detail(uuid)',
    'public.admin_search_users(text)',
    'public.admin_get_user_email(uuid, text)',
    'public.admin_audit_log(text, text, uuid, integer, integer)',
    'public.admin_overview()',
    'public.mark_moderation_notices_read()'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  -- Internal only.
  foreach f in array array[
    'public.require_moderator()', 'public.require_admin()', 'public.checked_reason(text)',
    'public.log_moderation_action(text, text, uuid, uuid, uuid, text, text, jsonb)',
    'public.forbid_change()', 'public.guard_moderation_actions()', 'public.guard_content_moderation()',
    'public.moderation_target_owner(text, uuid)', 'public.moderation_state_of(text, uuid)',
    'public.set_moderation_state(text, uuid, text, text)', 'public.check_moderation_target(uuid)',
    'public.add_moderation_notice(uuid, uuid, text, text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  -- Used inside policies.
  foreach f in array array[
    'public.is_moderated_post(uuid)', 'public.is_moderated_photo(text)', 'public.can_moderate_photo(text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;
-- Legal texts: published texts for everyone (also signed out); the rest for signed-in users.
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.get_current_legal_documents()', 'public.get_legal_document_versions(text)', 'public.get_legal_document(uuid)'
  ] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
  foreach f in array array[
    'public.get_my_legal_status()', 'public.confirm_legal_documents(uuid[], text)',
    'public.admin_announce_legal_update(uuid)',
    'public.admin_legal_save_draft(uuid, text, text, text, text, text, boolean, boolean, integer)',
    'public.admin_legal_delete_draft(uuid, text)', 'public.admin_legal_affected_count()',
    'public.admin_legal_publish(uuid, text)', 'public.admin_legal_list()', 'public.admin_legal_document(uuid)',
    'public.admin_legal_pending(integer, integer)', 'public.admin_legal_followup(uuid, uuid, text, text)',
    'public.admin_legal_bulk_notify(uuid[], uuid)', 'public.admin_legal_suspend(uuid, uuid, text, text)',
    'public.admin_legal_email_targets(uuid[], uuid)', 'public.admin_legal_overview()',
    'public.admin_legal_user_history(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  foreach f in array array[
    'public.legal_hash(text)', 'public.guard_legal_document()', 'public.guard_legal_confirmation()',
    'public.current_legal_documents()', 'public.legal_due_at(public.legal_documents, timestamptz)',
    'public.legal_followup_step(uuid, uuid, text, text)', 'public.legal_is_pending(uuid, uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end;
$$;
revoke all on function public.on_notification_created() from public, anon, authenticated;
revoke all on function public.purge_my_expired_notifications() from public, anon;
grant execute on function public.purge_my_expired_notifications() to authenticated;
revoke all on function public.get_my_reports() from public, anon;
grant execute on function public.get_my_reports() to authenticated;


-- -----------------------------------------------------------------------------
-- Table privileges (RLS below decides which rows)
-- -----------------------------------------------------------------------------

grant select, insert, update, delete on
  public.profiles, public.posts, public.post_media, public.post_tags, public.post_likes, public.comments, public.comment_likes, public.follows,
  public.stories, public.story_likes, public.story_views, public.audience_restrictions,
  public.highlights, public.highlight_items,
  public.conversations, public.conversation_members, public.messages, public.message_reactions,
  public.workout_shares, public.post_reposts
to authenticated;
-- Chat members: every column except cleared_at (nobody learns that someone cleared a chat).
revoke select on public.conversation_members from authenticated;
grant select (conversation_id, user_id, joined_at, last_read_at) on public.conversation_members to authenticated;
-- Messages hidden for me: read and remove my own rows; set only through hide_message_for_me().
revoke all on public.message_hidden from anon, authenticated;
grant select, delete on public.message_hidden to authenticated;
-- Hashtags: read only; rows and counters are maintained by triggers.
revoke all on public.hashtags, public.content_hashtags from anon, authenticated;
grant select on public.hashtags, public.content_hashtags to authenticated;
-- Training plans: read only; written through save_plan / activate_plan / duplicate_plan / delete_plan.
revoke all on public.training_plans, public.plan_days, public.plan_exercises from anon, authenticated;
grant select on public.training_plans, public.plan_days, public.plan_exercises to authenticated;
revoke all on public.planned_rest_uses from anon, authenticated;
grant select on public.planned_rest_uses to authenticated;
-- Plan progress and open questions: read own rows; all writes go through the plan functions.
revoke all on public.plan_rounds, public.plan_deviations from anon, authenticated;
grant select on public.plan_rounds, public.plan_deviations to authenticated;
-- Adoptions: no client access (the daily limit and notifications are handled in adopt_plan).
revoke all on public.plan_adoptions from anon, authenticated;
-- Recorded trainings: written only by save_workout / link_workout_post; owners may delete.
revoke all on public.workouts, public.workout_exercises, public.workout_sets from anon, authenticated;
grant select, delete on public.workouts to authenticated;
grant select on public.workout_exercises, public.workout_sets to authenticated;
-- Rest days: owners read their own; all writes go through the rest-day functions.
revoke all on public.rest_budgets, public.rest_day_uses from anon, authenticated;
grant select on public.rest_budgets, public.rest_day_uses to authenticated;
-- Blocks: the blocker reads, adds and removes their own (RLS below). No updates.
revoke all on public.user_blocks from anon, authenticated;
grant select, insert, delete on public.user_blocks to authenticated;
-- Legal texts, confirmations, reminders: no table rights (functions only).
revoke all on public.legal_documents, public.legal_confirmations, public.confirmation_followups from anon, authenticated;
-- Staff tables: no client access at all (functions only). Notices: owners read their own.
revoke all on public.admin_roles, public.moderation_actions from anon, authenticated;
revoke all on public.moderation_notices from anon, authenticated;
grant select on public.moderation_notices to authenticated;
-- Reports and snapshots: no direct access (report_content / report_message / get_my_reports).
revoke all on public.reports, public.report_snapshots from anon, authenticated;
-- Former usernames: no direct access at all (resolve_usernames / username_available only).
revoke all on public.username_history from anon, authenticated;
-- Notifications: read and mark as read only; inserts come from security definer functions.
revoke all on public.notifications from anon, authenticated;
grant select, update on public.notifications to authenticated;


-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------

alter table public.profiles             enable row level security;
alter table public.posts                enable row level security;
alter table public.post_media           enable row level security;
alter table public.post_tags            enable row level security;
alter table public.post_likes           enable row level security;
alter table public.comments             enable row level security;
alter table public.comment_likes        enable row level security;
alter table public.follows              enable row level security;
alter table public.stories              enable row level security;
alter table public.story_likes          enable row level security;
alter table public.story_views          enable row level security;
alter table public.audience_restrictions enable row level security;
alter table public.highlights           enable row level security;
alter table public.highlight_items      enable row level security;
alter table public.conversations        enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages             enable row level security;
alter table public.message_reactions    enable row level security;
alter table public.message_hidden       enable row level security;
alter table public.workout_shares       enable row level security;
alter table public.post_reposts         enable row level security;
alter table public.notifications        enable row level security;
alter table public.username_history     enable row level security;
alter table public.training_plans       enable row level security;
alter table public.plan_days            enable row level security;
alter table public.plan_exercises       enable row level security;
alter table public.planned_rest_uses    enable row level security;
alter table public.plan_rounds          enable row level security;
alter table public.plan_deviations      enable row level security;
alter table public.plan_adoptions       enable row level security;
alter table public.workouts             enable row level security;
alter table public.workout_exercises    enable row level security;
alter table public.workout_sets         enable row level security;
alter table public.rest_budgets         enable row level security;
alter table public.rest_day_uses        enable row level security;
alter table public.user_blocks          enable row level security;
alter table public.reports              enable row level security;
alter table public.report_snapshots     enable row level security;
alter table public.admin_roles          enable row level security;
alter table public.moderation_actions   enable row level security;
alter table public.moderation_notices   enable row level security;
alter table public.legal_documents      enable row level security;
alter table public.legal_confirmations  enable row level security;
alter table public.confirmation_followups enable row level security;
alter table public.hashtags             enable row level security;
alter table public.content_hashtags     enable row level security;

-- profiles: everyone signed in can read, only you can change your own row.
-- Rows are created by the handle_new_user trigger.
drop policy if exists "profiles: read" on public.profiles;
create policy "profiles: read" on public.profiles
  for select to authenticated using (public.can_see_account(id));

drop policy if exists "profiles: update own" on public.profiles;
create policy "profiles: update own" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()) and public.is_account_active())
  with check (id = (select auth.uid()));

-- posts
-- Checks the row's own columns instead of looking the post up again, so the owner
-- can always read their posts, including the new row returned by insert().select().
-- Tagged people see exactly the post they are tagged in (is_tagged_in_post checks the
-- caller only), and not if the owner has hidden their posts from them.
-- Public posts (is_public_content) are readable by every signed-in user.
drop policy if exists "posts: read own, followed or shared" on public.posts;
create policy "posts: read own, followed or shared" on public.posts
  for select to authenticated
  using (
    moderation_state is null
    and user_id = (select auth.uid())
    or moderation_state is null and (
      public.can_see_account(user_id)
      and (
        public.is_following(user_id)
        or public.is_post_shared_with_me(id)
        or public.is_tagged_in_post(id)
        or public.is_public_content(user_id, 'posts')
      )
      and not public.is_hidden_from_me(user_id, 'posts')
    )
  );

drop policy if exists "posts: insert own" on public.posts;
create policy "posts: insert own" on public.posts
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.is_account_active()
    and (storage.foldername(photo_path))[1] = (select auth.uid())::text
  );

drop policy if exists "posts: update own" on public.posts;
create policy "posts: update own" on public.posts
  for update to authenticated
  using (user_id = (select auth.uid()) and public.is_account_active())
  with check (user_id = (select auth.uid()));

drop policy if exists "posts: delete own" on public.posts;
create policy "posts: delete own" on public.posts
  for delete to authenticated
  using (user_id = (select auth.uid()) and public.is_account_active() and moderation_state is null);

-- post_media: visible with its post; only the post owner adds, reorders or removes photos.
drop policy if exists "post_media: read on visible posts" on public.post_media;
create policy "post_media: read on visible posts" on public.post_media
  for select to authenticated using (public.can_view_post(post_id));

drop policy if exists "post_media: add to own post" on public.post_media;
create policy "post_media: add to own post" on public.post_media
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.is_account_active()
    and public.is_my_post(post_id)
    and (storage.foldername(photo_path))[1] = (select auth.uid())::text
    and (original_path is null or (storage.foldername(original_path))[1] = (select auth.uid())::text)
  );

drop policy if exists "post_media: reorder own" on public.post_media;
create policy "post_media: reorder own" on public.post_media
  for update to authenticated
  using (user_id = (select auth.uid()) and public.is_account_active())
  with check (user_id = (select auth.uid()) and public.is_my_post(post_id));

drop policy if exists "post_media: delete own" on public.post_media;
create policy "post_media: delete own" on public.post_media
  for delete to authenticated
  using (user_id = (select auth.uid()) and public.is_account_active() and not public.is_moderated_post(post_id));

-- post_tags: the owner tags people they follow; a tagged person can remove themselves.
drop policy if exists "post_tags: read on visible posts" on public.post_tags;
create policy "post_tags: read on visible posts" on public.post_tags
  for select to authenticated using (public.can_view_post(post_id));

-- Tagging follows can_tag (the person's setting, a connection or public posts); the limit of
-- 10 per post is checked by the post_tags_created trigger.
drop policy if exists "post_tags: owner tags people they follow" on public.post_tags;
drop policy if exists "post_tags: owner tags taggable people" on public.post_tags;
create policy "post_tags: owner tags taggable people" on public.post_tags
  for insert to authenticated
  with check (public.is_account_active() and public.is_my_post(post_id) and public.can_tag(user_id, 'posts'));

drop policy if exists "post_tags: owner or tagged person removes" on public.post_tags;
create policy "post_tags: owner or tagged person removes" on public.post_tags
  for delete to authenticated
  using (public.is_account_active() and (user_id = (select auth.uid()) or public.is_my_post(post_id)));

-- post_likes
drop policy if exists "post_likes: read on visible posts" on public.post_likes;
create policy "post_likes: read on visible posts" on public.post_likes
  for select to authenticated using (public.can_view_post(post_id) and public.can_see_account(user_id));

drop policy if exists "post_likes: like visible posts" on public.post_likes;
create policy "post_likes: like visible posts" on public.post_likes
  for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_account_active() and public.can_view_post(post_id));

drop policy if exists "post_likes: unlike own" on public.post_likes;
create policy "post_likes: unlike own" on public.post_likes
  for delete to authenticated using (user_id = (select auth.uid()) and public.is_account_active());

-- comments
drop policy if exists "comments: read on visible posts" on public.comments;
create policy "comments: read on visible posts" on public.comments
  for select to authenticated
  using (moderation_state is null and public.can_view_post(post_id) and public.can_see_account(user_id));

drop policy if exists "comments: write on visible posts" on public.comments;
create policy "comments: write on visible posts" on public.comments
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.is_account_active()
    and public.can_view_post(post_id)
    and (parent_comment_id is null or public.is_top_level_comment_on(parent_comment_id, post_id))
  );

drop policy if exists "comments: delete own or on own post" on public.comments;
create policy "comments: delete own or on own post" on public.comments
  for delete to authenticated
  using (
    public.is_account_active()
    and moderation_state is null
    and (
      user_id = (select auth.uid())
      or exists (
        select 1 from public.posts p
        where p.id = post_id and p.user_id = (select auth.uid())
      )
    )
  );

-- comment_likes: same rules as post_likes, via the comment's post.
drop policy if exists "comment_likes: read on visible comments" on public.comment_likes;
create policy "comment_likes: read on visible comments" on public.comment_likes
  for select to authenticated using (public.can_view_comment(comment_id));

drop policy if exists "comment_likes: like visible comments" on public.comment_likes;
create policy "comment_likes: like visible comments" on public.comment_likes
  for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_account_active() and public.can_view_comment(comment_id));

drop policy if exists "comment_likes: unlike own" on public.comment_likes;
create policy "comment_likes: unlike own" on public.comment_likes
  for delete to authenticated using (user_id = (select auth.uid()) and public.is_account_active());

-- follows
-- Your own follows and requests (both directions) are always readable; other people's
-- only when accepted and one side's lists are visible to you (public or you follow them).
drop policy if exists "follows: read" on public.follows;
create policy "follows: read" on public.follows
  for select to authenticated
  using (
    follower_id = (select auth.uid())
    or following_id = (select auth.uid())
    or (
      status = 'accepted'
      and public.can_see_account(follower_id)
      and public.can_see_account(following_id)
      and (public.can_view_follow_lists(follower_id) or public.can_view_follow_lists(following_id))
    )
  );

-- The status is set by follows_set_status, whatever the client sends.
drop policy if exists "follows: follow as yourself" on public.follows;
create policy "follows: follow as yourself" on public.follows
  for insert to authenticated
  with check (follower_id = (select auth.uid()) and public.is_account_active() and public.can_see_account(following_id));

-- Only the followed person accepts a request (pending -> accepted, see follows_guard_update).
drop policy if exists "follows: accept requests to me" on public.follows;
create policy "follows: accept requests to me" on public.follows
  for update to authenticated
  using (following_id = (select auth.uid()) and status = 'pending' and public.is_account_active())
  with check (following_id = (select auth.uid()) and status = 'accepted' and public.can_see_account(follower_id));

-- Unfollow / withdraw a request yourself, or remove a follower / decline a request to you.
drop policy if exists "follows: unfollow as yourself" on public.follows;
drop policy if exists "follows: unfollow, remove follower or decline" on public.follows;
create policy "follows: unfollow, remove follower or decline" on public.follows
  for delete to authenticated
  using (public.is_account_active() and (follower_id = (select auth.uid()) or following_id = (select auth.uid())));

-- stories: expired stories are invisible to everyone but their owner, except stories in a
-- highlight the caller may see (owner and followers, see can_view_highlight).
drop policy if exists "stories: read active from followed, own always" on public.stories;
create policy "stories: read active from followed, own always" on public.stories
  for select to authenticated
  using (
    moderation_state is null and user_id = (select auth.uid())
    or moderation_state is null and (
      expires_at > now()
      and public.can_see_account(user_id)
      and (
        public.is_following(user_id)
        or (select auth.uid()) = any (mentioned_user_ids)
        or public.is_public_content(user_id, 'stories')
      )
      and not public.is_hidden_from_me(user_id, 'stories')
    )
    or moderation_state is null and public.is_in_visible_highlight(id)
  );

-- Mentions follow can_tag, at most 10.
drop policy if exists "stories: insert own" on public.stories;
create policy "stories: insert own" on public.stories
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.is_account_active()
    and (storage.foldername(photo_path))[1] = (select auth.uid())::text
    and public.mentions_allowed(mentioned_user_ids)
  );

drop policy if exists "stories: delete own" on public.stories;
create policy "stories: delete own" on public.stories
  for delete to authenticated
  using (user_id = (select auth.uid()) and public.is_account_active() and moderation_state is null);

-- story_likes: the liker and the story owner can see a like.
drop policy if exists "story_likes: read own or on own story" on public.story_likes;
create policy "story_likes: read own or on own story" on public.story_likes
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.stories s
      where s.id = story_id and s.user_id = (select auth.uid())
    )
  );

drop policy if exists "story_likes: like visible stories" on public.story_likes;
create policy "story_likes: like visible stories" on public.story_likes
  for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_account_active() and public.can_view_story(story_id));

drop policy if exists "story_likes: unlike own" on public.story_likes;
create policy "story_likes: unlike own" on public.story_likes
  for delete to authenticated using (user_id = (select auth.uid()) and public.is_account_active());

-- story_views: you record your own views; you and the story owner can read them.
drop policy if exists "story_views: read own or on own story" on public.story_views;
create policy "story_views: read own or on own story" on public.story_views
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.stories s
      where s.id = story_id and s.user_id = (select auth.uid())
    )
  );

drop policy if exists "story_views: record own view" on public.story_views;
create policy "story_views: record own view" on public.story_views
  for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_account_active() and public.can_view_story(story_id));

-- highlights: owner manages them; owner and followers read them.
-- Same rule as can_view_highlight, but on the row's own columns: inside
-- INSERT ... RETURNING a lookup of the new row by id can't see it yet.
drop policy if exists "highlights: read" on public.highlights;
create policy "highlights: read" on public.highlights
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (
      public.can_see_account(user_id)
      and (public.is_following(user_id) or public.is_public_content(user_id, 'stories'))
      and not public.is_hidden_from_me(user_id, 'stories')
    )
  );

drop policy if exists "highlights: create own" on public.highlights;
create policy "highlights: create own" on public.highlights
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.is_account_active()
    and (cover_story_id is null or public.is_my_story(cover_story_id))
  );

drop policy if exists "highlights: update own" on public.highlights;
create policy "highlights: update own" on public.highlights
  for update to authenticated
  using (user_id = (select auth.uid()) and public.is_account_active())
  with check (
    user_id = (select auth.uid())
    and (cover_story_id is null or public.is_my_story(cover_story_id))
  );

drop policy if exists "highlights: delete own" on public.highlights;
create policy "highlights: delete own" on public.highlights
  for delete to authenticated using (user_id = (select auth.uid()) and public.is_account_active());

-- highlight_items: only own stories into own highlights.
drop policy if exists "highlight_items: read" on public.highlight_items;
create policy "highlight_items: read" on public.highlight_items
  for select to authenticated using (public.can_view_highlight(highlight_id));

drop policy if exists "highlight_items: add own story" on public.highlight_items;
create policy "highlight_items: add own story" on public.highlight_items
  for insert to authenticated
  with check (public.is_account_active() and public.is_my_highlight(highlight_id) and public.is_my_story(story_id));

drop policy if exists "highlight_items: remove own" on public.highlight_items;
create policy "highlight_items: remove own" on public.highlight_items
  for delete to authenticated using (public.is_account_active() and public.is_my_highlight(highlight_id));

-- audience_restrictions: private to the owner (the hidden person must not find out).
drop policy if exists "audience_restrictions: owner reads" on public.audience_restrictions;
create policy "audience_restrictions: owner reads" on public.audience_restrictions
  for select to authenticated using (owner_id = (select auth.uid()));

drop policy if exists "audience_restrictions: owner adds" on public.audience_restrictions;
create policy "audience_restrictions: owner adds" on public.audience_restrictions
  for insert to authenticated with check (owner_id = (select auth.uid()) and public.is_account_active());

drop policy if exists "audience_restrictions: owner removes" on public.audience_restrictions;
create policy "audience_restrictions: owner removes" on public.audience_restrictions
  for delete to authenticated using (owner_id = (select auth.uid()) and public.is_account_active());

-- conversations / members: read for members only. Inserts happen through
-- get_or_create_direct_conversation(), so there are no insert policies.
drop policy if exists "conversations: members read" on public.conversations;
create policy "conversations: members read" on public.conversations
  for select to authenticated using (public.is_conversation_member(id));

drop policy if exists "conversation_members: members read" on public.conversation_members;
create policy "conversation_members: members read" on public.conversation_members
  for select to authenticated using (public.is_conversation_member(conversation_id));

drop policy if exists "conversation_members: update own read marker" on public.conversation_members;
create policy "conversation_members: update own read marker" on public.conversation_members
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "conversation_members: leave" on public.conversation_members;
create policy "conversation_members: leave" on public.conversation_members
  for delete to authenticated using (user_id = (select auth.uid()));

-- messages
drop policy if exists "messages: members read" on public.messages;
create policy "messages: members read" on public.messages
  for select to authenticated
  using (
    moderation_state is null
    and public.is_account_active()
    and public.is_conversation_member(conversation_id)
    and not public.is_message_hidden_for_me(id)
    -- "Chat für mich löschen": older messages are gone for me.
    and created_at > public.my_chat_cleared_at(conversation_id)
    -- Blocked in either direction: not readable (get_chat_messages shows them as deleted).
    and not public.conversation_blocked_pair(conversation_id)
  );

drop policy if exists "messages: members send" on public.messages;
create policy "messages: members send" on public.messages
  for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and public.is_account_active()
    and public.is_conversation_member(conversation_id)
    -- No new messages in either direction across a block (the old ones stay readable).
    and not public.conversation_has_block(conversation_id)
    and (body is not null or post_id is not null)
    and (post_id is null or public.can_view_post(post_id))
    and (comment_id is null or (post_id is not null and public.comment_belongs_to_post(comment_id, post_id)))
    and (reply_to_id is null or public.message_in_conversation(reply_to_id, conversation_id))
    and pinned_at is null
    and pinned_by is null
    -- tag cards are made by the server only
    and kind is null
    and story_id is null
  );

-- No delete policy: deleting goes only through delete_message_for_everyone() (checks and no
-- trace); the first version let senders delete directly.
drop policy if exists "messages: delete own" on public.messages;
-- No update policy: pins change only through set_message_pinned().

-- message_hidden: only my own rows; set only through hide_message_for_me().
drop policy if exists "message_hidden: owner reads" on public.message_hidden;
create policy "message_hidden: owner reads" on public.message_hidden
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "message_hidden: owner removes" on public.message_hidden;
create policy "message_hidden: owner removes" on public.message_hidden
  for delete to authenticated using (user_id = (select auth.uid()) and public.is_account_active());

-- message_reactions: members of the chat read them; you only set or remove your own.
drop policy if exists "message_reactions: members read" on public.message_reactions;
create policy "message_reactions: members read" on public.message_reactions
  for select to authenticated using (public.is_conversation_member(conversation_id));

drop policy if exists "message_reactions: react as yourself" on public.message_reactions;
create policy "message_reactions: react as yourself" on public.message_reactions
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.is_account_active()
    and not public.conversation_has_block(conversation_id)
    and public.is_conversation_member(conversation_id)
    and public.message_in_conversation(message_id, conversation_id)
  );

drop policy if exists "message_reactions: change own" on public.message_reactions;
create policy "message_reactions: change own" on public.message_reactions
  for update to authenticated
  using (user_id = (select auth.uid()) and public.is_account_active())
  with check (
    user_id = (select auth.uid())
    and not public.conversation_has_block(conversation_id)
    and public.is_conversation_member(conversation_id)
    and public.message_in_conversation(message_id, conversation_id)
  );

drop policy if exists "message_reactions: delete own" on public.message_reactions;
create policy "message_reactions: delete own" on public.message_reactions
  for delete to authenticated using (user_id = (select auth.uid()) and public.is_account_active());

-- workout_shares: the post owner and the tagged person see it.
drop policy if exists "workout_shares: owner and tagged read" on public.workout_shares;
create policy "workout_shares: owner and tagged read" on public.workout_shares
  for select to authenticated
  using (tagged_user_id = (select auth.uid()) or public.is_my_post(post_id));

-- Only the owner asks (the person must be tagged in the post; status forced to 'pending').
drop policy if exists "workout_shares: owner requests" on public.workout_shares;
create policy "workout_shares: owner requests" on public.workout_shares
  for insert to authenticated
  with check (public.can_request_workout_link(post_id, tagged_user_id));

-- Only the tagged person answers (pending -> accepted / declined, before the deadline).
drop policy if exists "workout_shares: tagged person answers" on public.workout_shares;
create policy "workout_shares: tagged person answers" on public.workout_shares
  for update to authenticated
  using (tagged_user_id = (select auth.uid()) and status = 'pending' and public.is_account_active())
  with check (tagged_user_id = (select auth.uid()) and status in ('accepted', 'declined'));

-- The owner may withdraw a request while it is still open.
drop policy if exists "workout_shares: owner withdraws pending" on public.workout_shares;
create policy "workout_shares: owner withdraws pending" on public.workout_shares
  for delete to authenticated
  using (public.is_account_active() and public.is_my_post(post_id) and status = 'pending');

-- post_reposts: readable when the viewer may read the original post AND the reposter's posts
-- (so a repost never shows the original to anyone else); the reposter and the original's
-- owner always see it.
drop policy if exists "post_reposts: read" on public.post_reposts;
create policy "post_reposts: read" on public.post_reposts
  for select to authenticated
  using (
    reposter_id = (select auth.uid())
    or public.is_my_post(original_post_id)
    or (
      public.can_view_post(original_post_id)
      and public.can_see_account(reposter_id)
      and (public.is_following(reposter_id) or public.is_public_content(reposter_id, 'posts'))
      and not public.is_hidden_from_me(reposter_id, 'posts')
    )
  );

drop policy if exists "post_reposts: linked person reposts" on public.post_reposts;
create policy "post_reposts: linked person reposts" on public.post_reposts
  for insert to authenticated
  with check (reposter_id = (select auth.uid()) and public.is_account_active() and public.can_repost(original_post_id));

drop policy if exists "post_reposts: reposter edits caption" on public.post_reposts;
create policy "post_reposts: reposter edits caption" on public.post_reposts
  for update to authenticated
  using (reposter_id = (select auth.uid()) and public.is_account_active())
  with check (reposter_id = (select auth.uid()) and public.can_repost(original_post_id));

drop policy if exists "post_reposts: reposter deletes" on public.post_reposts;
create policy "post_reposts: reposter deletes" on public.post_reposts
  for delete to authenticated using (reposter_id = (select auth.uid()) and public.is_account_active());

-- hashtags: names and counts for every signed-in user.
drop policy if exists "hashtags: read" on public.hashtags;
create policy "hashtags: read" on public.hashtags
  for select to authenticated using (true);

-- content_hashtags: which content uses a tag, only as far as that content is readable.
drop policy if exists "content_hashtags: read with content" on public.content_hashtags;
create policy "content_hashtags: read with content" on public.content_hashtags
  for select to authenticated
  using (
    (source = 'post' and public.can_view_post(source_id))
    or (source = 'comment' and public.can_view_comment(source_id))
    or (source = 'story' and public.can_view_story(source_id))
  );

-- training_plans / plan_days: see can_view_plan. No write policies (functions only).
-- The plan policy checks the row's own columns, like the posts policy.
drop policy if exists "training_plans: read" on public.training_plans;
create policy "training_plans: read" on public.training_plans
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (
      visibility <> 'private'
      and moderation_state is null
      and public.can_see_account(user_id)
      and not public.is_hidden_from_me(user_id, 'posts')
      and (
        public.is_following(user_id)
        or (visibility = 'public' and exists (
          select 1 from public.profiles pr where pr.id = user_id and not pr.is_private
        ))
      )
    )
  );

drop policy if exists "plan_days: read with plan" on public.plan_days;
create policy "plan_days: read with plan" on public.plan_days
  for select to authenticated using (public.can_view_plan(plan_id));

drop policy if exists "plan_exercises: read with plan" on public.plan_exercises;
create policy "plan_exercises: read with plan" on public.plan_exercises
  for select to authenticated
  using (exists (
    select 1 from public.plan_days d where d.id = plan_day_id and public.can_view_plan(d.plan_id)
  ));

-- workouts: the owner reads and deletes (the linked post stays); others per can_view_workout,
-- checked on the row's own columns like the posts policy.
drop policy if exists "workouts: owner reads" on public.workouts;
drop policy if exists "workouts: read" on public.workouts;
create policy "workouts: read" on public.workouts
  for select to authenticated
  using (
    moderation_state is null
    and (
      user_id = (select auth.uid())
      or (
        public.can_see_account(user_id)
        and not public.is_hidden_from_me(user_id, 'posts')
        and (
          (visibility = 'followers' and public.is_following(user_id))
          or (visibility = 'public' and (
            public.is_following(user_id)
            or exists (select 1 from public.profiles pr where pr.id = user_id and not pr.is_private)
          ))
          or (share_with_post and post_id is not null and public.can_view_post(post_id))
        )
      )
    )
  );

drop policy if exists "workouts: owner deletes" on public.workouts;
create policy "workouts: owner deletes" on public.workouts
  for delete to authenticated
  using (user_id = (select auth.uid()) and public.is_account_active() and moderation_state is null);

drop policy if exists "workout_exercises: read with workout" on public.workout_exercises;
create policy "workout_exercises: read with workout" on public.workout_exercises
  for select to authenticated
  using (public.can_view_workout(workout_id));

drop policy if exists "workout_sets: read with exercise" on public.workout_sets;
create policy "workout_sets: read with exercise" on public.workout_sets
  for select to authenticated
  using (exists (
    select 1 from public.workout_exercises we
    where we.id = workout_exercise_id and public.can_view_workout(we.workout_id)
  ));

-- plan_rounds / plan_deviations: only the owner reads; written only by the plan functions.
drop policy if exists "plan_rounds: owner reads" on public.plan_rounds;
create policy "plan_rounds: owner reads" on public.plan_rounds
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "plan_deviations: owner reads" on public.plan_deviations;
create policy "plan_deviations: owner reads" on public.plan_deviations
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "planned_rest_uses: owner reads" on public.planned_rest_uses;
create policy "planned_rest_uses: owner reads" on public.planned_rest_uses
  for select to authenticated using (user_id = (select auth.uid()));

-- rest_budgets / rest_day_uses: only the owner reads; no write policies (functions only).
drop policy if exists "rest_budgets: owner reads" on public.rest_budgets;
create policy "rest_budgets: owner reads" on public.rest_budgets
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "rest_day_uses: owner reads" on public.rest_day_uses;
create policy "rest_day_uses: owner reads" on public.rest_day_uses
  for select to authenticated using (user_id = (select auth.uid()));

-- user_blocks: only the blocker; the blocked person can't see that a block exists.
drop policy if exists "user_blocks: blocker reads" on public.user_blocks;
create policy "user_blocks: blocker reads" on public.user_blocks
  for select to authenticated using (blocker_id = (select auth.uid()));

drop policy if exists "user_blocks: blocker adds" on public.user_blocks;
create policy "user_blocks: blocker adds" on public.user_blocks
  for insert to authenticated
  with check (blocker_id = (select auth.uid()) and blocked_id <> (select auth.uid()));

drop policy if exists "user_blocks: blocker removes" on public.user_blocks;
create policy "user_blocks: blocker removes" on public.user_blocks
  for delete to authenticated using (blocker_id = (select auth.uid()));

-- reports: reporters read their own rows (the app uses get_my_reports, which leaves out the
-- decision notes; table access is revoked anyway). Inserts only through the report functions.
drop policy if exists "reports: reporter reads own" on public.reports;
create policy "reports: reporter reads own" on public.reports
  for select to authenticated using (reporter_id = (select auth.uid()));
-- report_snapshots: no policies, no client access.

-- legal_documents, legal_confirmations, confirmation_followups: no policies, no table rights;
-- everything goes through the legal functions.
-- admin_roles, moderation_actions: no policies, no client access (staff use the functions).
-- moderation_notices: the affected person reads their own; marking read via function.
drop policy if exists "moderation_notices: owner reads" on public.moderation_notices;
create policy "moderation_notices: owner reads" on public.moderation_notices
  for select to authenticated using (user_id = (select auth.uid()));

-- notifications: only the recipient, only reading and marking as read; expired ones are gone.
create index if not exists notifications_user_expiry_idx
  on public.notifications (user_id, public.notification_expires_at(created_at, read_at));
drop policy if exists "notifications: recipient reads" on public.notifications;
create policy "notifications: recipient reads" on public.notifications
  for select to authenticated
  using (
    user_id = (select auth.uid())
    and (actor_id is null or public.can_see_account(actor_id))
    and public.notification_expires_at(created_at, read_at) > now()
  );

drop policy if exists "notifications: recipient marks read" on public.notifications;
create policy "notifications: recipient marks read" on public.notifications
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));


-- -----------------------------------------------------------------------------
-- Realtime: new messages, pins (updates of messages) and reactions
-- -----------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'message_reactions'
  ) then
    alter publication supabase_realtime add table public.message_reactions;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end;
$$;


-- -----------------------------------------------------------------------------
-- Storage: private bucket "photos", objects under {user_id}/...
-- -----------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 10485760, array['image/jpeg', 'image/png', 'image/heic'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "photos: read visible" on storage.objects;
create policy "photos: read visible" on storage.objects
  for select to authenticated
  using (bucket_id = 'photos' and (public.can_view_photo(name) or public.can_moderate_photo(name)));

drop policy if exists "photos: upload to own folder" on storage.objects;
create policy "photos: upload to own folder" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and public.is_account_active()
  );

drop policy if exists "photos: update own" on storage.objects;
create policy "photos: update own" on storage.objects
  for update to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text and public.is_account_active())
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "photos: delete own" on storage.objects;
create policy "photos: delete own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and public.is_account_active()
    and not public.is_moderated_photo(name)
  );

-- ================================================================ account deletion
-- Deleting an account is final and immediate (no grace period). It runs in the Edge Function
-- delete_account, step by step and safe to repeat:
--   1) request_account_deletion() / admin_request_account_deletion(): checks, then
--      account_status = 'deleting' (the account is hidden at once and can't write anything)
--   2) the function deletes all files under {user_id}/ in every storage bucket
--   3) finish_account_deletion(): removes plain text about the person from the logs and writes
--      the pseudonymous entry in account_deletions
--   4) the function deletes the auth user; profiles and everything that belongs to the account
--      go with it (on delete cascade). Logs keep plain uuids without foreign keys.
-- If a step fails the status stays 'deleting' and the app offers "Erneut versuchen".

-- Pseudonymous record of deletions: no name, no e-mail, only a hash of the old id.
create table if not exists public.account_deletions (
  id           uuid primary key default gen_random_uuid(),
  user_hash    text not null unique check (user_hash ~ '^[0-9a-f]{64}$'),
  deleted_at   timestamptz not null default now(),
  initiated_by text not null check (initiated_by in ('self', 'admin')),
  admin_id     uuid
);
alter table public.account_deletions enable row level security;
revoke all on public.account_deletions from public, anon, authenticated;
grant select on public.account_deletions to authenticated;
drop policy if exists "account_deletions: admins read" on public.account_deletions;
create policy "account_deletions: admins read" on public.account_deletions
  for select to authenticated using (public.is_admin());

drop trigger if exists account_deletions_append_only on public.account_deletions;
create trigger account_deletions_append_only
  before update or delete on public.account_deletions
  for each row execute function public.forbid_change();
drop trigger if exists account_deletions_no_truncate on public.account_deletions;
create trigger account_deletions_no_truncate
  before truncate on public.account_deletions
  for each statement execute function public.forbid_change();

-- Why an account can't delete itself right now, or null. Suspended (still running) and banned
-- accounts, and accounts with content in quarantine, go through an admin; staff accounts need
-- their role removed by hand first (supabase/admin-setup.sql).
create or replace function public.account_deletion_blocker(p_user uuid)
returns text
language plpgsql stable security definer set search_path = ''
as $$
declare
  target public.profiles%rowtype;
begin
  select * into target from public.profiles p where p.id = p_user;
  if not found then
    return 'not_found';
  end if;
  if exists (select 1 from public.admin_roles r where r.user_id = p_user) then
    return 'staff';
  end if;
  if public.is_official(p_user) then
    return 'official';
  end if;
  if target.account_status = 'banned' then
    return 'banned';
  end if;
  if target.account_status = 'suspended' and (target.suspended_until is null or target.suspended_until > now()) then
    return 'suspended';
  end if;
  if exists (select 1 from public.posts x where x.user_id = p_user and x.moderation_state = 'quarantined')
    or exists (select 1 from public.stories x where x.user_id = p_user and x.moderation_state = 'quarantined')
    or exists (select 1 from public.comments x where x.user_id = p_user and x.moderation_state = 'quarantined')
    or exists (select 1 from public.messages x where x.sender_id = p_user and x.moderation_state = 'quarantined')
    or exists (select 1 from public.training_plans x where x.user_id = p_user and x.moderation_state = 'quarantined')
    or exists (select 1 from public.workouts x where x.user_id = p_user and x.moderation_state = 'quarantined') then
    return 'quarantined';
  end if;
  return null;
end;
$$;

-- Step 1 of deleting my own account (called by the Edge Function with my session). Repeating
-- it while the status is already 'deleting' is fine.
create or replace function public.request_account_deletion()
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  blocker text;
begin
  if me is null then
    raise exception 'not authenticated';
  end if;
  perform 1 from public.profiles p where p.id = me for update;
  blocker := public.account_deletion_blocker(me);
  if blocker is not null then
    raise exception 'deletion_not_allowed' using detail = blocker;
  end if;
  update public.profiles
  set account_status = 'deleting', suspended_until = null, suspension_reason_code = null,
      moderation_updated_at = now()
  where id = me and account_status <> 'deleting';
end;
$$;

-- Step 1 of an admin deleting someone else's account (dashboard). Admin with two-factor,
-- written reason, the username typed as confirmation. Never the own account, never staff.
create or replace function public.admin_request_account_deletion(p_user_id uuid, p_username text, p_reason text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  why text := public.checked_reason(p_reason);
  target_name text;
begin
  perform public.require_admin();
  if p_user_id is null or p_user_id = auth.uid() then
    raise exception 'cannot_delete_self';
  end if;
  select p.username into target_name from public.profiles p where p.id = p_user_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  if exists (select 1 from public.admin_roles r where r.user_id = p_user_id) then
    raise exception 'cannot_delete_staff';
  end if;
  -- First assign another official account (official-account-setup.sql).
  if public.is_official(p_user_id) then
    raise exception 'cannot_delete_official';
  end if;
  if lower(btrim(coalesce(p_username, ''))) <> target_name then
    raise exception 'username_mismatch';
  end if;
  update public.profiles
  set account_status = 'deleting', suspended_until = null, suspension_reason_code = null,
      moderation_updated_at = now()
  where id = p_user_id;
  perform public.log_moderation_action('delete_account', 'profile', p_user_id, p_user_id, null, why, null, '{}');
end;
$$;

-- Replaces the given names (whole words, with or without @) in a text.
create or replace function public.redact_names(p_text text, p_names text[])
returns text
language plpgsql immutable set search_path = ''
as $$
declare
  result text := p_text;
  n text;
begin
  if result is null then
    return null;
  end if;
  foreach n in array coalesce(p_names, '{}') loop
    if char_length(btrim(n)) >= 3 then
      result := regexp_replace(
        result,
        '(?<![[:alnum:]_.])@?' || regexp_replace(btrim(n), '([.*+?^${}()|\[\]\\])', '\\\1', 'g') || '(?![[:alnum:]_])',
        '[gelöschtes Konto]',
        'gi'
      );
    end if;
  end loop;
  return result;
end;
$$;

-- Step 3 (service role only, from the Edge Function): pseudonymise what stays, write the
-- deletion record. Repeatable; does nothing once the profile is gone.
create or replace function public.finish_account_deletion(p_user_id uuid, p_initiated_by text, p_admin_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  target_name text;
  target_display text;
  names text[];
begin
  if p_initiated_by not in ('self', 'admin') then
    raise exception 'invalid_initiator';
  end if;
  select p.username, p.display_name into target_name, target_display
  from public.profiles p where p.id = p_user_id and p.account_status = 'deleting' for update;
  if not found then
    if not exists (select 1 from public.profiles p where p.id = p_user_id) then
      return;
    end if;
    raise exception 'not_marked_for_deletion';
  end if;
  names := array(select h.username from public.username_history h where h.user_id = p_user_id)
    || array[target_name, target_display];

  -- Logs keep the plain uuid but lose every text about the person.
  perform set_config('peakpic.pseudonymize', p_user_id::text, true);
  update public.moderation_actions m
  set user_message = null, reason = public.redact_names(m.reason, names)
  where m.target_user_id = p_user_id;
  perform set_config('peakpic.pseudonymize', '', true);

  update public.reports r
  set details = public.redact_names(r.details, names),
      resolution_note = public.redact_names(r.resolution_note, names)
  where r.target_user_id = p_user_id;
  update public.report_snapshots s
  set body = public.redact_names(s.body, names)
  where s.body is not null
    and (s.sender_id = p_user_id
      or s.report_id in (select r.id from public.reports r where r.target_user_id = p_user_id));

  -- Mentions in other people's stories point at nobody any more.
  update public.stories st
  set mentioned_user_ids = array_remove(st.mentioned_user_ids, p_user_id),
      mention_positions = coalesce((
        select jsonb_agg(e) from jsonb_array_elements(st.mention_positions) e
        where e ->> 'user_id' is distinct from p_user_id::text
      ), '[]'::jsonb)
  where p_user_id = any (st.mentioned_user_ids);

  insert into public.account_deletions (user_hash, initiated_by, admin_id)
  values (encode(pg_catalog.sha256(convert_to(p_user_id::text, 'UTF8')), 'hex'), p_initiated_by, p_admin_id)
  on conflict (user_hash) do nothing;
end;
$$;

revoke all on function public.request_account_deletion() from public, anon;
grant execute on function public.request_account_deletion() to authenticated;
revoke all on function public.admin_request_account_deletion(uuid, text, text) from public, anon;
grant execute on function public.admin_request_account_deletion(uuid, text, text) to authenticated;
revoke all on function public.account_deletion_blocker(uuid) from public, anon, authenticated;
revoke all on function public.redact_names(text, text[]) from public, anon, authenticated;
revoke all on function public.finish_account_deletion(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.finish_account_deletion(uuid, text, uuid) to service_role;

-- ================================================================ usage statistics
-- Anonymous usage numbers for the admin dashboard. Only daily counters are stored: never single
-- events, never user ids, session or device ids, never free text.
--   * usage_counters     (day in Europe/Zurich, event) -> count. No client access at all.
--   * usage_event_types  fixed list of allowed events with their area; source 'server' events
--                        are counted by triggers only, 'client' events come from track_events().
--   * usage_meta         when the counting triggers were installed (for the one-time backfill,
--                        supabase/backfill-usage.sql).
-- Counters stay when content or accounts are deleted, so "published so far" stays right.

create table if not exists public.usage_event_types (
  name   text primary key check (name ~ '^[a-z][a-z0-9_]{2,47}$'),
  area   text not null check (area in ('home', 'feed', 'stories', 'camera', 'chat', 'profile', 'plans',
                                       'workout', 'stats', 'search', 'settings', 'notifications', 'moderation')),
  source text not null check (source in ('server', 'client'))
);

create table if not exists public.usage_counters (
  day   date not null,
  event text not null references public.usage_event_types (name) on delete cascade,
  count bigint not null default 0 check (count >= 0),
  primary key (day, event)
);
create index if not exists usage_counters_event_day_idx on public.usage_counters (event, day);

create table if not exists public.usage_meta (
  key   text primary key check (key in ('triggers_installed_at', 'backfill_done_at')),
  value timestamptz not null
);

alter table public.usage_event_types enable row level security;
alter table public.usage_counters enable row level security;
alter table public.usage_meta enable row level security;
revoke all on public.usage_event_types, public.usage_counters, public.usage_meta from public, anon, authenticated;

-- Seed: the allowed events. Later features add theirs here.
insert into public.usage_event_types (name, area, source) values
  ('account_created', 'profile', 'server'),
  ('account_deleted', 'settings', 'server'),
  ('post_created', 'feed', 'server'),
  ('story_created', 'stories', 'server'),
  ('highlight_created', 'stories', 'server'),
  ('comment_created', 'feed', 'server'),
  ('message_created', 'chat', 'server'),
  ('like_created', 'feed', 'server'),
  ('follow_created', 'profile', 'server'),
  ('report_created', 'moderation', 'server'),
  ('plan_created', 'plans', 'server'),
  ('plan_adopted', 'plans', 'server'),
  ('workout_completed', 'workout', 'server'),
  ('screen_home', 'home', 'client'),
  ('screen_feed', 'feed', 'client'),
  ('screen_post', 'feed', 'client'),
  ('screen_comments', 'feed', 'client'),
  ('post_like_double_tap', 'feed', 'client'),
  ('screen_repost', 'feed', 'client'),
  ('screen_share', 'feed', 'client'),
  ('screen_post_links', 'feed', 'client'),
  ('screen_stories', 'stories', 'client'),
  ('screen_highlight', 'stories', 'client'),
  ('screen_story_create', 'stories', 'client'),
  ('screen_camera', 'camera', 'client'),
  ('screen_post_create', 'camera', 'client'),
  ('screen_chats', 'chat', 'client'),
  ('screen_chat', 'chat', 'client'),
  ('screen_chat_new', 'chat', 'client'),
  ('message_deleted_for_me', 'chat', 'client'),
  ('message_deleted_for_all', 'chat', 'client'),
  ('chat_background_changed', 'chat', 'client'),
  ('chat_background_reset', 'chat', 'client'),
  ('screen_profile', 'profile', 'client'),
  ('screen_user_profile', 'profile', 'client'),
  ('screen_follows', 'profile', 'client'),
  ('screen_profile_edit', 'profile', 'client'),
  ('screen_day', 'profile', 'client'),
  ('screen_plan_edit', 'plans', 'client'),
  ('screen_plan_editor', 'plans', 'client'),
  ('plan_activated', 'plans', 'client'),
  ('planned_rest_confirmed', 'plans', 'client'),
  ('plan_adopt_opened', 'plans', 'client'),
  ('plan_deactivated', 'plans', 'client'),
  ('plan_days_reordered', 'plans', 'client'),
  ('plan_deviation_exception', 'plans', 'client'),
  ('plan_deviation_reordered', 'plans', 'client'),
  ('plan_round_adjusted', 'plans', 'client'),
  ('plan_round_unit_skipped', 'plans', 'client'),
  ('screen_plan_round', 'plans', 'client'),
  ('screen_training', 'workout', 'client'),
  ('screen_workout_session', 'workout', 'client'),
  ('screen_workout_finish', 'workout', 'client'),
  ('workout_started', 'workout', 'client'),
  ('workout_discarded', 'workout', 'client'),
  ('workout_photo_added', 'workout', 'client'),
  ('screen_workout_report', 'workout', 'client'),
  ('screen_activities', 'workout', 'client'),
  ('activity_visibility_changed', 'workout', 'client'),
  ('activity_deleted', 'workout', 'client'),
  ('screen_training_stats', 'stats', 'client'),
  ('training_stats_range_changed', 'stats', 'client'),
  ('training_stats_exercise_selected', 'stats', 'client'),
  ('profile_tab_posts', 'profile', 'client'),
  ('profile_tab_activities', 'profile', 'client'),
  ('profile_tab_stats', 'profile', 'client'),
  ('profile_tab_reposts', 'profile', 'client'),
  ('profile_tab_tagged', 'profile', 'client'),
  ('screen_search', 'search', 'client'),
  ('screen_hashtag', 'search', 'client'),
  ('screen_settings', 'settings', 'client'),
  ('screen_privacy', 'settings', 'client'),
  ('screen_blocked', 'settings', 'client'),
  ('screen_app_icon', 'settings', 'client'),
  ('screen_delete_account', 'settings', 'client'),
  ('screen_notifications', 'notifications', 'client'),
  ('screen_follow_requests', 'notifications', 'client'),
  ('screen_my_reports', 'moderation', 'client'),
  ('report_opened', 'moderation', 'client')
on conflict (name) do update set area = excluded.area, source = excluded.source;

insert into public.usage_meta (key, value) values ('triggers_installed_at', now())
on conflict (key) do nothing;

-- Today in Europe/Zurich (the day of a counter).
create or replace function public.usage_today()
returns date
language sql stable set search_path = ''
as $$
  select (now() at time zone 'Europe/Zurich')::date;
$$;

-- Adds to today's counter of an event. Internal (triggers and track_events).
create or replace function public.bump_usage(p_event text, p_count bigint default 1)
returns void
language sql security definer set search_path = ''
as $$
  insert into public.usage_counters (day, event, count)
  values (public.usage_today(), p_event, p_count)
  on conflict (day, event) do update set count = public.usage_counters.count + excluded.count;
$$;

-- Trigger: count the row (event name as trigger argument). Never fails the insert/delete.
-- Test data scripts run by hand (supabase/seed-testaccount.sql) set peakpic.skip_usage = 'on'
-- for their transaction, so backdated test rows don't count as today's use. Clients can't set
-- it (PostgREST runs no SET from requests, and no function sets it).
create or replace function public.on_usage_event()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if current_setting('peakpic.skip_usage', true) = 'on' then
    return null;
  end if;
  -- Only messages written by people (not server-made tag cards).
  if tg_table_name = 'messages' then
    if new.kind is not null then
      return null;
    end if;
  end if;
  -- Adoptions are plans with an origin.
  if tg_argv[0] = 'plan_adopted' then
    if new.adopted_from_plan_id is null then
      return null;
    end if;
  end if;
  begin
    perform public.bump_usage(tg_argv[0]);
  exception when others then
    null; -- statistics must never block the app
  end;
  return null;
end;
$$;

do $$
declare
  t record;
begin
  for t in
    select * from (values
      ('profiles', 'insert', 'account_created'),
      ('profiles', 'delete', 'account_deleted'),
      ('posts', 'insert', 'post_created'),
      ('stories', 'insert', 'story_created'),
      ('highlights', 'insert', 'highlight_created'),
      ('comments', 'insert', 'comment_created'),
      ('messages', 'insert', 'message_created'),
      ('post_likes', 'insert', 'like_created'),
      ('story_likes', 'insert', 'like_created'),
      ('comment_likes', 'insert', 'like_created'),
      ('follows', 'insert', 'follow_created'),
      ('reports', 'insert', 'report_created'),
      ('training_plans', 'insert', 'plan_created'),
      ('training_plans', 'insert', 'plan_adopted'),
      ('workouts', 'insert', 'workout_completed')
    ) as v(tbl, op, event)
  loop
    -- Trigger names per event (one table can count several events); the first version named
    -- them per operation.
    execute format('drop trigger if exists %I on public.%I', t.tbl || '_usage_' || t.op, t.tbl);
    execute format('drop trigger if exists %I on public.%I', t.tbl || '_usage_' || t.event, t.tbl);
    execute format(
      'create trigger %I after %s on public.%I for each row execute function public.on_usage_event(%L)',
      t.tbl || '_usage_' || t.event, t.op, t.tbl, t.event
    );
  end loop;
end;
$$;

-- Client: screen views counted locally in the app and sent in batches, e.g.
-- {"screen_feed": 4, "screen_chat": 2}. Stores nothing about the caller. Unknown names,
-- server events, non-integers and counts outside 1..50 are ignored; at most 40 names per call.
create or replace function public.track_events(events jsonb)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  item record;
  amount integer;
  accepted integer := 0;
begin
  if auth.uid() is null or not public.is_account_active() then
    return 0;
  end if;
  if events is null or jsonb_typeof(events) <> 'object' then
    return 0;
  end if;
  if (select count(*) from jsonb_object_keys(events)) > 40 then
    raise exception 'too_many_events';
  end if;
  for item in select key, value from jsonb_each(events) loop
    continue when jsonb_typeof(item.value) <> 'number';
    continue when item.value::text !~ '^[0-9]{1,2}$';
    amount := item.value::text::integer;
    continue when amount < 1 or amount > 50;
    continue when not exists (
      select 1 from public.usage_event_types t where t.name = item.key and t.source = 'client'
    );
    perform public.bump_usage(item.key, amount);
    accepted := accepted + 1;
  end loop;
  return accepted;
end;
$$;

-- Admin: totals. Accounts by status and "present now" come from the tables, "published so far"
-- from the counters (they keep deleted content).
create or replace function public.admin_stats_overview()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  totals jsonb;
begin
  perform public.require_admin();
  select coalesce(jsonb_object_agg(c.event, c.total), '{}'::jsonb) into totals
  from (select event, sum(count) as total from public.usage_counters group by event) c;
  return jsonb_build_object(
    'accounts', jsonb_build_object(
      'total', (select count(*) from public.profiles),
      'active', (select count(*) from public.profiles p where public.account_is_active(p.id)),
      'suspended', (select count(*) from public.profiles p
                    where p.account_status = 'suspended' and not public.account_is_active(p.id)),
      'banned', (select count(*) from public.profiles p where p.account_status = 'banned'),
      'deleting', (select count(*) from public.profiles p where p.account_status = 'deleting')
    ),
    'published', totals,
    'present', jsonb_build_object(
      'posts', (select count(*) from public.posts),
      'stories', (select count(*) from public.stories),
      'highlights', (select count(*) from public.highlights),
      'comments', (select count(*) from public.comments),
      'messages', (select count(*) from public.messages m where m.kind is null),
      'likes', (select count(*) from public.post_likes) + (select count(*) from public.story_likes)
               + (select count(*) from public.comment_likes),
      'plans', (select count(*) from public.training_plans),
      'workouts', (select count(*) from public.workouts)
    )
  );
end;
$$;

-- Which counter event belongs to a metric of the dashboard.
create or replace function public.usage_metric_event(p_metric text)
returns text
language sql immutable set search_path = ''
as $$
  select case p_metric
    when 'accounts' then 'account_created'
    when 'deleted_accounts' then 'account_deleted'
    when 'posts' then 'post_created'
    when 'stories' then 'story_created'
    when 'highlights' then 'highlight_created'
    when 'comments' then 'comment_created'
    when 'messages' then 'message_created'
    when 'likes' then 'like_created'
    when 'follows' then 'follow_created'
    when 'reports' then 'report_created'
    when 'workouts' then 'workout_completed'
    when 'plans' then 'plan_created'
    when 'plans_adopted' then 'plan_adopted'
    else null
  end;
$$;

-- Days on which an account created something (posts, stories, comments, messages, likes,
-- follows). An approximation of "active accounts": reading alone is not visible here.
create or replace function public.usage_active_days(p_from date, p_to date)
returns table (day date, user_id uuid)
language sql stable security definer set search_path = ''
as $$
  select distinct (x.created_at at time zone 'Europe/Zurich')::date, x.user_id
  from (
    select user_id, created_at from public.posts
    union all select user_id, created_at from public.stories
    union all select user_id, created_at from public.comments
    union all select sender_id, created_at from public.messages where kind is null
    union all select user_id, created_at from public.post_likes
    union all select user_id, created_at from public.story_likes
    union all select user_id, created_at from public.comment_likes
    union all select follower_id, created_at from public.follows
    union all select user_id, created_at from public.workouts
  ) x
  where x.created_at >= (p_from::timestamp at time zone 'Europe/Zurich')
    and x.created_at < ((p_to + 1)::timestamp at time zone 'Europe/Zurich');
$$;

-- Time series of one metric, bucketed by day / week / month / year (gaps filled with 0).
create or replace function public.admin_stats_timeseries(p_metric text, p_from date, p_to date, p_bucket text)
returns table (bucket date, value bigint)
language plpgsql stable security definer set search_path = ''
as $$
declare
  event_name text := public.usage_metric_event(p_metric);
begin
  perform public.require_admin();
  if p_bucket not in ('day', 'week', 'month', 'year') then
    raise exception 'invalid_bucket';
  end if;
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 3700 then
    raise exception 'invalid_range';
  end if;
  if p_metric <> 'active_accounts' and event_name is null then
    raise exception 'invalid_metric';
  end if;
  return query
  with buckets as (
    select distinct date_trunc(p_bucket, d)::date as b
    from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') d
  ),
  vals as (
    select date_trunc(p_bucket, c.day::timestamp)::date as b, sum(c.count)::bigint as v
    from public.usage_counters c
    where p_metric <> 'active_accounts' and c.event = event_name and c.day between p_from and p_to
    group by 1
    union all
    select date_trunc(p_bucket, a.day::timestamp)::date, count(distinct a.user_id)::bigint
    from public.usage_active_days(p_from, p_to) a
    where p_metric = 'active_accounts'
    group by 1
  )
  select buckets.b, coalesce(sum(vals.v), 0)::bigint
  from buckets left join vals on vals.b = buckets.b
  group by buckets.b
  order by buckets.b;
end;
$$;

-- Sums of the period and of the period just before it (same length), for the cards.
create or replace function public.admin_stats_period(p_from date, p_to date)
returns table (metric text, current_value bigint, previous_value bigint)
language plpgsql stable security definer set search_path = ''
as $$
declare
  span integer;
begin
  perform public.require_admin();
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 3700 then
    raise exception 'invalid_range';
  end if;
  span := p_to - p_from + 1;
  return query
  select m.metric,
    coalesce((select sum(c.count) from public.usage_counters c
              where c.event = public.usage_metric_event(m.metric) and c.day between p_from and p_to), 0)::bigint,
    coalesce((select sum(c.count) from public.usage_counters c
              where c.event = public.usage_metric_event(m.metric) and c.day between p_from - span and p_from - 1), 0)::bigint
  from unnest(array['accounts', 'deleted_accounts', 'posts', 'stories', 'highlights', 'comments', 'messages',
                    'likes', 'follows', 'reports', 'workouts', 'plans', 'plans_adopted']) as m(metric)
  union all
  select 'active_accounts',
    (select count(distinct a.user_id) from public.usage_active_days(p_from, p_to) a)::bigint,
    (select count(distinct a.user_id) from public.usage_active_days(p_from - span, p_from - 1) a)::bigint;
end;
$$;

-- Use by area and the top screens (client events only).
create or replace function public.admin_stats_areas(p_from date, p_to date)
returns table (area text, event text, total bigint)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.require_admin();
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 3700 then
    raise exception 'invalid_range';
  end if;
  return query
  select t.area, t.name, sum(c.count)::bigint
  from public.usage_counters c
  join public.usage_event_types t on t.name = c.event and t.source = 'client'
  where c.day between p_from and p_to
  group by t.area, t.name
  order by 3 desc;
end;
$$;

-- First day with any counter (for the period "Alles").
create or replace function public.admin_stats_first_day()
returns date
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.require_admin();
  return (select min(c.day) from public.usage_counters c);
end;
$$;

revoke all on function public.usage_today() from public, anon, authenticated;
revoke all on function public.bump_usage(text, bigint) from public, anon, authenticated;
revoke all on function public.on_usage_event() from public, anon, authenticated;
revoke all on function public.usage_metric_event(text) from public, anon, authenticated;
revoke all on function public.usage_active_days(date, date) from public, anon, authenticated;
revoke all on function public.track_events(jsonb) from public, anon;
grant execute on function public.track_events(jsonb) to authenticated;
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.admin_stats_overview()', 'public.admin_stats_timeseries(text, date, date, text)',
    'public.admin_stats_period(date, date)', 'public.admin_stats_areas(date, date)',
    'public.admin_stats_first_day()'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;


-- ================================================================ training statistics
-- "Statistik" in the profile. Others never read workouts for it: the functions below return
-- aggregated numbers only (sums per day, per exercise and day, plan day counts, streak lengths),
-- no ids, titles, notes, times of day or single sets. Who may see them:
-- profiles.training_stats_visibility ('private' | 'followers' | 'public', default 'private';
-- 'public' only while the profile is public, otherwise followers only).
alter table public.profiles add column if not exists training_stats_visibility text not null default 'private';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_training_stats_visibility_check') then
    alter table public.profiles add constraint profiles_training_stats_visibility_check
      check (training_stats_visibility in ('private', 'followers', 'public'));
  end if;
end;
$$;

-- May the caller see `target`'s training statistics? Own always; others only with an active,
-- unblocked account that isn't hidden from them, per the setting.
create or replace function public.can_view_training_stats(target uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select (select auth.uid()) is not null and (
    target = (select auth.uid())
    or exists (
      select 1 from public.profiles p
      where p.id = target
        and p.training_stats_visibility <> 'private'
        and public.can_see_account(target)
        and not public.is_hidden_from_me(target, 'posts')
        and (
          public.is_following(target)
          or (p.training_stats_visibility = 'public' and not p.is_private)
        )
    )
  );
$$;

-- Current and longest streak of `target`, with the same rules as lib/streak.ts: training days
-- (posts that count, accepted workout links, counting trainings) in a row; rest days bridge a
-- gap but don't add to the count; not having trained yet today keeps yesterday's streak.
-- Internal (no visibility check).
create or replace function public.streak_numbers(target uuid)
returns table (current_streak integer, longest_streak integer)
language sql stable security definer set search_path = ''
as $$
  with training as (
    select p.workout_date as d from public.posts p
    where p.user_id = target and public.post_counts_as_workout(p.id)
    union
    select p.workout_date from public.workout_shares ws
    join public.posts p on p.id = ws.post_id
    where ws.tagged_user_id = target and ws.status = 'accepted' and public.post_counts_as_workout(p.id)
    union
    select w.workout_date from public.workouts w
    where w.user_id = target and w.counts_for_streak and w.moderation_state is null
  ),
  rest as (
    select r.day as d from public.rest_day_uses r where r.user_id = target
    union
    select r.day from public.planned_rest_uses r where r.user_id = target
  ),
  active_days as (
    select t.d, true as is_training from training t
    union all
    select r.d, false from rest r where not exists (select 1 from training t where t.d = r.d)
  ),
  runs as (
    select a.d, a.is_training, a.d - (row_number() over (order by a.d))::integer as grp
    from active_days a
  ),
  cursor_day as (
    select case when exists (select 1 from active_days a where a.d = public.app_today())
                then public.app_today() else public.app_today() - 1 end as d
  )
  select
    coalesce((
      select (count(*) filter (where r.is_training))::integer from runs r
      where r.grp = (select r2.grp from runs r2 where r2.d = (select c.d from cursor_day c))
        and r.d <= (select c.d from cursor_day c)
    ), 0),
    coalesce((
      select max(x.n)::integer from (
        select count(*) filter (where r.is_training) as n from runs r group by r.grp
      ) x
    ), 0);
$$;

-- The period of a range (Europe/Zurich): 'weeks' = the last 12 calendar weeks (Mon-Sun, by
-- week), 'months' = the last 12 calendar months (by month), 'year' = this calendar year (by
-- month). Always up to today. Same as statsRange() in lib/trainingStats.ts.
create or replace function public.training_stats_range(p_range text)
returns table (range_from date, range_to date, bucket text)
language plpgsql stable set search_path = ''
as $$
declare
  today date := public.app_today();
begin
  case p_range
    when 'weeks' then
      return query select date_trunc('week', today::timestamp)::date - 77, today, 'week'::text;
    when 'months' then
      return query select (date_trunc('month', today::timestamp) - interval '11 months')::date, today, 'month'::text;
    when 'year' then
      return query select date_trunc('year', today::timestamp)::date, today, 'month'::text;
    else
      raise exception 'invalid_range';
  end case;
end;
$$;

-- The numbers of `target` in a range. Internal (no visibility check; see get_training_stats).
-- Removed trainings don't count; all other recorded trainings do (also those that didn't count
-- for the streak). Exercises are grouped by their normalized name (lowercase, trimmed, single
-- spaces), at most the 30 done most often. Estimated max weight (Epley): weight × (1 + reps /
-- 30), the weight itself for a single rep. Weights only where recorded (null otherwise).
create or replace function public.training_stats_of(target uuid, p_range text)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  with period as (
    select * from public.training_stats_range(p_range)
  ),
  ws as (
    select w.id, w.workout_date, w.active_seconds, w.plan_day_title
    from public.workouts w, period
    where w.user_id = target and w.moderation_state is null
      and w.workout_date between period.range_from and period.range_to
  ),
  set_rows as (
    select w.workout_date as d,
           lower(regexp_replace(btrim(e.name), '\s+', ' ', 'g')) as ex_key,
           e.name, s.reps, s.weight_kg, s.seconds,
           case when s.weight_kg is not null and s.reps >= 1 then
             case when s.reps = 1 then s.weight_kg else s.weight_kg * (1 + s.reps / 30.0) end
           end as e1rm
    from ws w
    join public.workout_exercises e on e.workout_id = w.id
    join public.workout_sets s on s.workout_exercise_id = e.id
  ),
  set_rows_ranked as (
    select r.*, max(r.weight_kg) over (partition by r.ex_key, r.d) as day_best_weight
    from set_rows r
  ),
  day_sets as (
    select r.d, count(*) as n_sets,
           sum(r.weight_kg * r.reps) filter (where r.weight_kg is not null and r.reps is not null) as vol
    from set_rows r group by r.d
  ),
  day_totals as (
    select w.workout_date as d, count(*) as n, sum(w.active_seconds) as secs
    from ws w group by w.workout_date
  ),
  top_ex as (
    select r.ex_key, mode() within group (order by r.name) as name, count(distinct r.d) as sessions
    from set_rows r
    group by r.ex_key
    order by count(distinct r.d) desc, r.ex_key
    limit 30
  ),
  ex_points as (
    select r.ex_key, r.d,
           max(r.weight_kg) as best_weight,
           max(r.reps) filter (where r.weight_kg = r.day_best_weight) as best_weight_reps,
           max(r.e1rm) as best_e1rm,
           sum(r.weight_kg * r.reps) filter (where r.weight_kg is not null and r.reps is not null) as vol,
           sum(r.reps) as total_reps, max(r.reps) as max_reps,
           sum(r.seconds) as total_seconds, max(r.seconds) as max_seconds
    from set_rows_ranked r
    where r.ex_key in (select t.ex_key from top_ex t)
    group by r.ex_key, r.d
  )
  select jsonb_build_object(
    'range', p_range,
    'bucket', (select period.bucket from period),
    'from', (select period.range_from from period),
    'to', (select period.range_to from period),
    'days', coalesce((
      select jsonb_agg(jsonb_build_object(
        'day', t.d, 'workouts', t.n, 'active_seconds', t.secs,
        'sets', coalesce(ds.n_sets, 0), 'volume_kg', round(ds.vol, 1)
      ) order by t.d)
      from day_totals t left join day_sets ds on ds.d = t.d
    ), '[]'::jsonb),
    'plan_days', coalesce((
      select jsonb_agg(jsonb_build_object('title', x.title, 'workouts', x.n) order by x.n desc, x.title)
      from (
        select w.plan_day_title as title, count(*) as n from ws w
        where w.plan_day_title is not null
        group by w.plan_day_title
        order by count(*) desc
        limit 30
      ) x
    ), '[]'::jsonb),
    'free_workouts', (select count(*) from ws w where w.plan_day_title is null),
    'exercises', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', t.ex_key, 'name', t.name, 'sessions', t.sessions,
        'points', (
          select jsonb_agg(jsonb_build_object(
            'day', p.d, 'best_weight_kg', p.best_weight, 'best_weight_reps', p.best_weight_reps,
            'best_e1rm_kg', round(p.best_e1rm, 1), 'volume_kg', round(p.vol, 1),
            'total_reps', p.total_reps, 'max_reps', p.max_reps,
            'total_seconds', p.total_seconds, 'max_seconds', p.max_seconds
          ) order by p.d)
          from ex_points p where p.ex_key = t.ex_key
        )
      ) order by t.sessions desc, t.ex_key)
      from top_ex t
    ), '[]'::jsonb),
    'current_streak', (select sn.current_streak from public.streak_numbers(target) sn),
    'longest_streak', (select sn.longest_streak from public.streak_numbers(target) sn)
  );
$$;

-- Training statistics of a person (null when the caller may not see them). Signed in only.
create or replace function public.get_training_stats(p_user_id uuid, p_range text)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_range is null or p_range not in ('weeks', 'months', 'year') then
    raise exception 'invalid_range';
  end if;
  if p_user_id is null or not public.can_view_training_stats(p_user_id) then
    return null;
  end if;
  return public.training_stats_of(p_user_id, p_range);
end;
$$;

-- My own training statistics.
create or replace function public.get_my_training_stats(p_range text)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  return public.get_training_stats(auth.uid(), p_range);
end;
$$;

revoke all on function public.streak_numbers(uuid) from public, anon, authenticated;
revoke all on function public.training_stats_range(text) from public, anon, authenticated;
revoke all on function public.training_stats_of(uuid, text) from public, anon, authenticated;
revoke all on function public.can_view_training_stats(uuid) from public, anon;
grant execute on function public.can_view_training_stats(uuid) to authenticated;
revoke all on function public.get_training_stats(uuid, text) from public, anon;
grant execute on function public.get_training_stats(uuid, text) to authenticated;
revoke all on function public.get_my_training_stats(text) from public, anon;
grant execute on function public.get_my_training_stats(text) to authenticated;


-- ================================================================ sign-in with username
-- Failed sign-ins by username (Edge Function login_with_username): at most 10 per username in 15
-- minutes. Only the username as typed (lowercase), no user id, no IP; rows older than a day are
-- removed by the function. No client access at all (only the function, with the service role).
create table if not exists public.login_attempts (
  id           bigint generated always as identity primary key,
  username_key text not null check (char_length(username_key) between 1 and 64),
  created_at   timestamptz not null default now()
);
create index if not exists login_attempts_key_idx on public.login_attempts (username_key, created_at desc);
alter table public.login_attempts enable row level security;
revoke all on public.login_attempts from public, anon, authenticated;


-- ================================================================ test data markers
-- Rows created by supabase/seed-testaccount.sql (run by hand in the test phase): kind = what it
-- is, ref = its id (or the day, for planned rest days). A second run removes exactly these rows
-- of that account before it creates new ones; other data is never touched. No client access at
-- all (RLS on, no policies, no grants). Goes with the account.
create table if not exists public.seed_markers (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  kind       text not null check (kind in ('training_plan', 'workout', 'post', 'story', 'highlight', 'planned_rest')),
  ref        text not null check (char_length(ref) between 1 and 64),
  created_at timestamptz not null default now(),
  primary key (user_id, kind, ref)
);
alter table public.seed_markers enable row level security;
revoke all on public.seed_markers from public, anon, authenticated;


-- Migration: a stored round for every active plan, computed once from the proofs so far.
do $$
declare
  t record;
begin
  for t in
    select tp.user_id, tp.id from public.training_plans tp
    where tp.is_active and not exists (select 1 from public.plan_rounds pr where pr.user_id = tp.user_id and pr.plan_id = tp.id)
  loop
    perform public.plan_round_load(t.user_id, t.id);
  end loop;
end;
$$;


-- ================================================================ data reset ("App-Neustart")
-- Admins remove either whole accounts ('full') or chosen categories of data ('categories') of
-- chosen people, as a job: draft -> preview (dry run, deletes nothing) -> confirm (reason, the
-- word NEUSTART and a fresh TOTP step) -> run by the Edge Function run_data_reset in batches
-- (resumable) -> done / failed. Everything goes through the functions below (admin role and
-- aal2 only, never moderators); clients have no rights on the tables.
--   * never touched: moderation_actions, report_snapshots, legal_confirmations, usage_counters,
--     account_deletions, admin_roles and the reset tables themselves.
--   * content removed or quarantined by the moderation stays (evidence), also everything it
--     hangs on (a post with a moderated comment, a chat with a moderated message).
--   * protected: protected_accounts (supabase/reset-config.sql), every account with a role in
--     admin_roles and the caller. They can't be chosen, also not through a hand-made call.
--   * flagged (suspended, banned, deleting, open reports, quarantined content): only with
--     include_flagged, which the dashboard asks for separately.
--   * app_settings.allow_full_reset = false: no 'full' jobs (categories still work). Switch it
--     off before the real start (docs/moderation.md).

-- Settings that only admins change by hand (SQL editor). No client access.
create table if not exists public.app_settings (
  key        text primary key check (key in ('allow_full_reset')),
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
revoke all on public.app_settings from public, anon, authenticated;
-- Test phase: deleting whole accounts allowed. Never overwritten by running this file again.
insert into public.app_settings (key, value) values ('allow_full_reset', 'true') on conflict (key) do nothing;

-- Accounts no reset job may ever touch (main account, test account). Filled by hand with
-- supabase/reset-config.sql. No client access.
create table if not exists public.protected_accounts (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  note       text check (char_length(note) <= 200),
  created_at timestamptz not null default now()
);
alter table public.protected_accounts enable row level security;
revoke all on public.protected_accounts from public, anon, authenticated;

create table if not exists public.reset_jobs (
  id              uuid primary key default gen_random_uuid(),
  created_by      uuid references public.profiles (id) on delete set null,
  status          text not null default 'draft'
                  check (status in ('draft', 'confirmed', 'running', 'done', 'failed', 'cancelled')),
  mode            text not null check (mode in ('categories', 'full')),
  categories      text[] not null default '{}',
  reason          text check (reason is null or char_length(reason) between 10 and 500),
  subject         text check (char_length(subject) <= 150),
  user_message    text check (char_length(user_message) <= 5000),
  include_flagged boolean not null default false,
  -- Totals of the last dry run; previewed_at must be newer than the last change to confirm.
  preview         jsonb,
  previewed_at    timestamptz,
  result          jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  confirmed_at    timestamptz,
  started_at      timestamptz,
  finished_at     timestamptz
);
create index if not exists reset_jobs_created_idx on public.reset_jobs (created_at desc);
alter table public.reset_jobs enable row level security;
revoke all on public.reset_jobs from public, anon, authenticated;

-- One row per person of a job. user_id becomes null when the account is deleted (the mapping
-- goes, user_hash = sha256 of the old id stays, like account_deletions). files: storage paths
-- still to remove after the rows are gone (cleared when done). email_*: Phase 4.
create table if not exists public.reset_job_targets (
  id            uuid primary key default gen_random_uuid(),
  job_id        uuid not null references public.reset_jobs (id) on delete cascade,
  user_id       uuid references public.profiles (id) on delete set null,
  user_hash     text not null check (user_hash ~ '^[0-9a-f]{64}$'),
  selected      boolean not null default true,
  flagged       boolean not null default false,
  status        text not null default 'pending'
                check (status in ('pending', 'claimed', 'files_pending', 'done', 'failed', 'skipped')),
  counts        jsonb,
  result        jsonb,
  files         jsonb,
  error         text check (char_length(error) <= 60),
  email_status  text not null default 'none'
                check (email_status in ('none', 'pending', 'sent', 'failed', 'not_configured', 'in_app')),
  email_address text,
  attempts      integer not null default 0,
  claimed_at    timestamptz,
  updated_at    timestamptz not null default now(),
  unique (job_id, user_id)
);
create index if not exists reset_job_targets_job_idx on public.reset_job_targets (job_id, status);
create index if not exists reset_job_targets_user_idx on public.reset_job_targets (user_id);
alter table public.reset_job_targets enable row level security;
revoke all on public.reset_job_targets from public, anon, authenticated;

-- Chats are ended for everybody (chats category, also before deleting whole accounts), except
-- chats with a protected account (protected_accounts, admin_roles) unless the job says
-- include_protected_chats (set only through admin_reset_set_protected_chats, logged).
alter table public.reset_jobs add column if not exists include_protected_chats boolean not null default false;
-- 'collateral': not chosen, but lost a chat that was ended (counted in result, notified, never
-- processed on their own and never deselectable).
alter table public.reset_job_targets add column if not exists role text not null default 'selected';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'reset_job_targets_role_check') then
    alter table public.reset_job_targets add constraint reset_job_targets_role_check check (role in ('selected', 'collateral'));
  end if;
end;
$$;
-- When the address was read (it is deleted when the mail is out, after 7 days at the latest) and
-- when the in-app notice was written.
alter table public.reset_job_targets add column if not exists email_captured_at timestamptz;
alter table public.reset_job_targets add column if not exists notice_sent_at timestamptz;

-- Someone who left a chat while the account stays (a reset removed only their side of a chat
-- with a protected account). The chat then shows "Nicht mehr im Chat" instead of "Gelöschtes
-- Konto"; when the account is deleted later, user_id becomes null and it shows "Gelöschtes
-- Konto" again. No client access; read through get_chat_partner_states().
create table if not exists public.conversation_departures (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id         uuid references public.profiles (id) on delete set null,
  departed_at     timestamptz not null default now()
);
create index if not exists conversation_departures_conversation_idx on public.conversation_departures (conversation_id);
alter table public.conversation_departures enable row level security;
revoke all on public.conversation_departures from public, anon, authenticated;

-- Server-made line in a chat: kind 'notice' ("Eine Person ist nicht mehr in diesem Chat."). Like
-- tag cards, clients can't write it (the insert policy requires kind is null).
alter table public.messages drop constraint if exists messages_kind_check;
alter table public.messages add constraint messages_kind_check check (kind is null or kind in ('tag', 'notice'));

-- Open chat screens learn that a chat was ended: Realtime sends the delete with the id only.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversations'
  ) then
    alter publication supabase_realtime add table public.conversations;
  end if;
end;
$$;

-- For my chats without another member: 'left' (the other person left, the account still
-- exists) or 'deleted' (the account is gone). No names, no ids of the other person.
create or replace function public.get_chat_partner_states(p_conversation_ids uuid[])
returns table (conversation_id uuid, state text)
language sql stable security definer set search_path = ''
as $$
  select c.id,
    case when exists (
      select 1 from public.conversation_departures d where d.conversation_id = c.id and d.user_id is not null
    ) then 'left' else 'deleted' end
  from public.conversations c
  where c.id = any (coalesce(p_conversation_ids, '{}'))
    and cardinality(coalesce(p_conversation_ids, '{}')) <= 500
    and exists (select 1 from public.conversation_members m where m.conversation_id = c.id and m.user_id = (select auth.uid()))
    and not exists (select 1 from public.conversation_members m where m.conversation_id = c.id and m.user_id <> (select auth.uid()));
$$;
revoke all on function public.get_chat_partner_states(uuid[]) from public, anon;
grant execute on function public.get_chat_partner_states(uuid[]) to authenticated;


create or replace function public.reset_category_keys()
returns text[]
language sql immutable set search_path = ''
as $$
  select array['chats', 'activities', 'plans', 'posts', 'stories', 'social', 'notifications', 'surveys', 'other'];
$$;

create or replace function public.reset_full_allowed()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((select s.value = 'true'::jsonb from public.app_settings s where s.key = 'allow_full_reset'), false);
$$;

-- Why an account can't be part of a reset job for the caller, or null. Internal.
create or replace function public.reset_protection(p_user uuid)
returns text
language sql stable security definer set search_path = ''
as $$
  select case
    when p_user = (select auth.uid()) then 'self'
    when exists (select 1 from public.admin_roles r where r.user_id = p_user) then 'staff'
    when exists (select 1 from public.protected_accounts pa where pa.user_id = p_user) then 'protected'
    when public.is_official(p_user) then 'protected'
  end;
$$;

-- Why an account counts as flagged (evidence could get lost), empty if not. Internal.
create or replace function public.reset_flags(p_user uuid)
returns text[]
language sql stable security definer set search_path = ''
as $$
  select array_remove(array[
    case when p.account_status = 'suspended' and (p.suspended_until is null or p.suspended_until > now()) then 'suspended' end,
    case when p.account_status = 'banned' then 'banned' end,
    case when p.account_status = 'deleting' then 'deleting' end,
    case when exists (select 1 from public.reports r where r.target_user_id = p_user and r.status in ('open', 'in_review'))
      then 'open_reports' end,
    case when exists (select 1 from public.posts x where x.user_id = p_user and x.moderation_state = 'quarantined')
      or exists (select 1 from public.stories x where x.user_id = p_user and x.moderation_state = 'quarantined')
      or exists (select 1 from public.comments x where x.user_id = p_user and x.moderation_state = 'quarantined')
      or exists (select 1 from public.messages x where x.sender_id = p_user and x.moderation_state = 'quarantined')
      or exists (select 1 from public.training_plans x where x.user_id = p_user and x.moderation_state = 'quarantined')
      or exists (select 1 from public.workouts x where x.user_id = p_user and x.moderation_state = 'quarantined')
      then 'quarantine' end
  ], null)
  from public.profiles p where p.id = p_user;
$$;



-- Sum of all numbers in a counts object ({category: {what: n}}). Internal.
create or replace function public.reset_counts_total(p_counts jsonb)
returns bigint
language sql immutable set search_path = ''
as $$
  select coalesce(sum(v.value::bigint), 0)
  from jsonb_each(coalesce(p_counts, '{}')) cat,
       jsonb_each_text(case when jsonb_typeof(cat.value) = 'object' then cat.value else '{}'::jsonb end) v;
$$;

-- Adds counts objects up per category and key. Internal.
create or replace function public.reset_counts_sum(p_list jsonb[])
returns jsonb
language sql immutable set search_path = ''
as $$
  select coalesce(jsonb_object_agg(s.cat, s.totals), '{}')
  from (
    select v.cat, jsonb_object_agg(v.k, v.total) as totals
    from (
      select c.key as cat, e.key as k, sum(e.value::bigint) as total
      from unnest(coalesce(p_list, '{}')) l(item),
           jsonb_each(coalesce(l.item, '{}')) c,
           jsonb_each_text(case when jsonb_typeof(c.value) = 'object' then c.value else '{}'::jsonb end) e
      group by c.key, e.key
    ) v
    group by v.cat
  ) s;
$$;

create or replace function public.reset_limits()
returns jsonb
language sql immutable set search_path = ''
as $$
  select jsonb_build_object(
    'max_targets', 500, 'batch_size', 25, 'phrase', 'NEUSTART', 'totp_max_age_seconds', 300, 'max_attempts', 5,
    'email_keep_days', 7,
    'categories', jsonb_build_array('chats', 'activities', 'plans', 'posts', 'stories', 'social', 'notifications', 'surveys', 'other')
  );
$$;

-- German name of a category (in-app notices). Internal.
create or replace function public.reset_category_label(p_key text)
returns text
language sql immutable set search_path = ''
as $$
  select case p_key
    when 'chats' then 'Chats' when 'activities' then 'Aktivitäten' when 'plans' then 'Pläne'
    when 'posts' then 'Beiträge' when 'stories' then 'Storys' when 'social' then 'Follower und Gefolgte'
    when 'notifications' then 'Benachrichtigungen' when 'surveys' then 'Umfragen (Teilnahme und Anzeige)'
    when 'other' then 'Sonstiges (Einstellungen, abgegebene Meldungen)'
    else p_key
  end;
$$;

-- A protected account in the sense of chats: protected_accounts or a staff role. Internal.
create or replace function public.reset_member_protected(p_user uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.admin_roles r where r.user_id = p_user)
    or exists (select 1 from public.protected_accounts pa where pa.user_id = p_user)
    or public.is_official(p_user);
$$;

drop function if exists public.reset_conversation_full(uuid, uuid[]);

-- Is this chat ended for everybody? Yes, unless a protected account is a member and the job
-- doesn't include chats with protected accounts. Internal.
create or replace function public.reset_conversation_ends(p_conversation uuid, p_include_protected boolean)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(p_include_protected, false) or not exists (
    select 1 from public.conversation_members m
    where m.conversation_id = p_conversation and public.reset_member_protected(m.user_id)
  );
$$;

-- Records that a person who was not chosen lost a chat (one row per job and person, numbers
-- added up; a step runs once per chat, so nothing is counted twice). Internal.
create or replace function public.reset_add_collateral(p_job_id uuid, p_user uuid, p_messages bigint)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  t public.reset_job_targets%rowtype;
begin
  select * into t from public.reset_job_targets x where x.job_id = p_job_id and x.user_id = p_user for update;
  if not found then
    insert into public.reset_job_targets (job_id, user_id, user_hash, role, selected, status)
    values (p_job_id, p_user, encode(pg_catalog.sha256(convert_to(p_user::text, 'UTF8')), 'hex'), 'collateral', false, 'pending')
    returning * into t;
  end if;
  if t.role <> 'collateral' then
    return;
  end if;
  update public.reset_job_targets
  set result = jsonb_build_object('chats', jsonb_build_object(
        'conversations_lost', coalesce((t.result #>> '{chats,conversations_lost}')::bigint, 0) + 1,
        'messages', coalesce((t.result #>> '{chats,messages}')::bigint, 0) + p_messages)),
      updated_at = now()
  where id = t.id;
end;
$$;

-- THE place that decides what a category reset removes for one person. p_apply = false only
-- counts (dry run); p_apply = true counts the same way first, then deletes. p_selected:
-- everybody chosen in the job. Returns {counts: {category: {what: n}}, files: [paths]}.
--   * Chats: every chat of the person is ended for ALL members (messages, members, reactions,
--     pins, "für mich gelöscht"), deleted by its chosen member with the smallest id; members who
--     were not chosen are recorded as 'collateral' of the job (p_job_id). Shared posts and
--     comments stay, only the message cards go. report_snapshots and moderation_actions are
--     not touched. A chat with a protected account stays (unless p_include_protected): only the
--     person's messages and membership go, a neutral line tells the others, and the departure is
--     noted ("Nicht mehr im Chat").
--   * Other categories: moderated content and what hangs on it stays (evidence).
--   * What goes anyway with the content of another chosen person (my like on their post, my
--     follow of them, a chat) is counted once only, for its owner (for follows and chats: the
--     one with the smaller id). So the dry run and the run give the same numbers, in whatever
--     order the people are processed.
--   * files: photos of removed posts and stories in the person's own folder that nothing else
--     still uses (a story can share its file with a post).
-- Internal (dry run and run functions).
drop function if exists public.reset_user_categories(uuid, text[], uuid[], boolean);
create or replace function public.reset_user_categories(
  p_user uuid, p_categories text[], p_selected uuid[], p_apply boolean,
  p_job_id uuid default null, p_include_protected boolean default false
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  others uuid[] := array(select x from unnest(coalesce(p_selected, '{}')) x where x <> p_user);
  lower_others uuid[] := array(select x from unnest(coalesce(p_selected, '{}')) x where x::text < p_user::text);
  with_chats boolean := 'chats' = any (p_categories);
  with_posts boolean := 'posts' = any (p_categories);
  with_stories boolean := 'stories' = any (p_categories);
  with_activities boolean := 'activities' = any (p_categories);
  with_plans boolean := 'plans' = any (p_categories);
  with_social boolean := 'social' = any (p_categories);
  with_notifications boolean := 'notifications' = any (p_categories);
  with_other boolean := 'other' = any (p_categories);
  with_surveys boolean := 'surveys' = any (p_categories);
  ended_convs uuid[] := '{}';
  my_ended uuid[] := '{}';
  part_convs uuid[] := '{}';
  my_posts uuid[] := '{}';
  my_stories uuid[] := '{}';
  my_workouts uuid[] := '{}';
  my_plans uuid[] := '{}';
  candidates text[] := '{}';
  files text[];
  counts jsonb := '{}';
  conv uuid;
  member record;
begin
  -- ------------------------------------------------------------ what goes
  if with_chats then
    ended_convs := array(
      select m.conversation_id from public.conversation_members m
      where m.user_id = p_user and public.reset_conversation_ends(m.conversation_id, p_include_protected)
    );
    -- Deleted (and counted) by the chosen member with the smallest id.
    my_ended := array(
      select c from unnest(ended_convs) c
      where (select min(o.user_id::text) from public.conversation_members o
             where o.conversation_id = c and o.user_id = any (coalesce(p_selected, '{}') || p_user)) = p_user::text
    );
    part_convs := array(
      select m.conversation_id from public.conversation_members m
      where m.user_id = p_user and not (m.conversation_id = any (ended_convs))
    );
  end if;
  if with_posts then
    my_posts := array(
      select p.id from public.posts p
      where p.user_id = p_user and p.moderation_state is null
        and not exists (select 1 from public.comments x where x.post_id = p.id and x.moderation_state is not null)
    );
    candidates := candidates
      || array(select p.photo_path from public.posts p where p.id = any (my_posts))
      || array(select m.photo_path from public.post_media m where m.post_id = any (my_posts))
      || array(select m.original_path from public.post_media m where m.post_id = any (my_posts) and m.original_path is not null);
  end if;
  if with_stories then
    my_stories := array(select s.id from public.stories s where s.user_id = p_user and s.moderation_state is null);
    candidates := candidates || array(select s.photo_path from public.stories s where s.id = any (my_stories));
  end if;
  if with_activities then
    my_workouts := array(select w.id from public.workouts w where w.user_id = p_user and w.moderation_state is null);
  end if;
  if with_plans then
    my_plans := array(select tp.id from public.training_plans tp where tp.user_id = p_user and tp.moderation_state is null);
  end if;
  files := array(
    select distinct f from unnest(candidates) f
    where f like p_user::text || '/%'
      and not exists (select 1 from public.posts p where p.photo_path = f and not (p.id = any (my_posts)))
      and not exists (select 1 from public.post_media m
                      where (m.photo_path = f or m.original_path = f) and not (m.post_id = any (my_posts)))
      and not exists (select 1 from public.stories s where s.photo_path = f and not (s.id = any (my_stories)))
      and not exists (select 1 from public.profiles pr where pr.avatar_path = f)
  );

  -- ------------------------------------------------------------ counts
  if with_notifications then
    counts := counts || jsonb_build_object('notifications', jsonb_build_object('notifications', (
      select count(*) from public.notifications x
      where x.user_id = p_user
        and not (with_posts and exists (select 1 from public.posts po where po.id = x.post_id and po.user_id = any (others)))
        and not (with_posts and exists (
          select 1 from public.comments cm join public.posts po on po.id = cm.post_id
          where cm.id = x.comment_id and (po.user_id = any (others) or cm.user_id = any (others))))
        and not (with_stories and exists (select 1 from public.stories s where s.id = x.story_id and s.user_id = any (others)))
        and not (exists (
          select 1 from public.workout_shares ws join public.posts po on po.id = ws.post_id
          where ws.id = x.workout_share_id
            and ((with_posts and po.user_id = any (others)) or (with_activities and ws.tagged_user_id = any (others)))))
        and not (with_social and x.type = 'follow_request' and x.actor_id = any (others))
    )));
  end if;

  if with_chats then
    counts := counts || jsonb_build_object('chats', jsonb_build_object(
      'conversations', cardinality(my_ended),
      -- Messages of ended chats count for the member who ends the chat (those of chosen people;
      -- the others count as collateral), my own messages in chats that stay count for me.
      'messages', (select count(*) from public.messages x
                   where (x.conversation_id = any (my_ended) and x.sender_id = any (coalesce(p_selected, '{}') || p_user))
                      or (x.conversation_id = any (part_convs) and x.sender_id = p_user)),
      'memberships', cardinality(part_convs)
    ));
  end if;

  if with_posts then
    counts := counts || jsonb_build_object('posts', jsonb_build_object(
      'posts', cardinality(my_posts),
      'photos', (select count(*) from public.post_media m where m.post_id = any (my_posts)),
      'comments', (select count(*) from public.comments x
                   join public.posts po on po.id = x.post_id
                   left join public.comments parent on parent.id = x.parent_comment_id
                   where x.user_id = p_user and x.moderation_state is null
                     and not (x.post_id = any (my_posts)) and not (po.user_id = any (others))
                     and not coalesce(parent.user_id = any (others), false)
                     and not exists (select 1 from public.comments r where r.parent_comment_id = x.id and r.moderation_state is not null)),
      'likes', (select count(*) from public.post_likes x join public.posts po on po.id = x.post_id
                where x.user_id = p_user and not (x.post_id = any (my_posts)) and not (po.user_id = any (others)))
               + (select count(*) from public.comment_likes x
                  join public.comments cm on cm.id = x.comment_id join public.posts po on po.id = cm.post_id
                  where x.user_id = p_user and not (cm.post_id = any (my_posts))
                    and not (po.user_id = any (others)) and not (cm.user_id = any (others))),
      'reposts', (select count(*) from public.post_reposts x join public.posts po on po.id = x.original_post_id
                  where x.reposter_id = p_user and not (po.user_id = any (others))),
      'tags', (select count(*) from public.post_tags x join public.posts po on po.id = x.post_id
               where x.user_id = p_user and not (x.post_id = any (my_posts)) and not (po.user_id = any (others)))
    ));
  end if;

  if with_stories then
    counts := counts || jsonb_build_object('stories', jsonb_build_object(
      'stories', cardinality(my_stories),
      'highlights', (select count(*) from public.highlights h where h.user_id = p_user),
      'likes', (select count(*) from public.story_likes x join public.stories s on s.id = x.story_id
                where x.user_id = p_user and s.user_id <> p_user and not (s.user_id = any (others))),
      'views', (select count(*) from public.story_views x join public.stories s on s.id = x.story_id
                where x.user_id = p_user and s.user_id <> p_user and not (s.user_id = any (others)))
    ));
  end if;

  if with_activities then
    counts := counts || jsonb_build_object('activities', jsonb_build_object(
      'workouts', cardinality(my_workouts),
      'sets', (select count(*) from public.workout_sets s join public.workout_exercises e on e.id = s.workout_exercise_id
               where e.workout_id = any (my_workouts)),
      'links', (select count(*) from public.workout_shares x join public.posts po on po.id = x.post_id
                where x.tagged_user_id = p_user and not (with_posts and po.user_id = any (others))),
      'rest_days', (select count(*) from public.rest_day_uses x where x.user_id = p_user)
    ));
  end if;

  if with_plans then
    counts := counts || jsonb_build_object('plans', jsonb_build_object(
      'plans', cardinality(my_plans),
      'rounds', (select count(*) from public.plan_rounds x where x.user_id = p_user),
      'deviations', (select count(*) from public.plan_deviations x where x.user_id = p_user),
      'planned_rest_days', (select count(*) from public.planned_rest_uses x where x.user_id = p_user),
      'adoptions', (select count(*) from public.plan_adoptions x where x.adopter_id = p_user)
    ));
  end if;

  if with_social then
    counts := counts || jsonb_build_object('social', jsonb_build_object(
      'following', (select count(*) from public.follows x
                    where x.follower_id = p_user and x.status = 'accepted' and not (x.following_id = any (lower_others))),
      'followers', (select count(*) from public.follows x
                    where x.following_id = p_user and x.status = 'accepted' and not (x.follower_id = any (lower_others))),
      'requests', (select count(*) from public.follows x
                   where x.status = 'pending'
                     and ((x.follower_id = p_user and not (x.following_id = any (lower_others)))
                       or (x.following_id = p_user and not (x.follower_id = any (lower_others))))),
      'blocks', (select count(*) from public.user_blocks x where x.blocker_id = p_user),
      'hidden_from', (select count(*) from public.audience_restrictions x where x.owner_id = p_user)
    ));
  end if;

  -- Surveys: who took part and which official cards were seen or hidden. The anonymous answers
  -- and the surveys themselves stay (they hold no reference to the person).
  if with_surveys then
    counts := counts || jsonb_build_object('surveys', jsonb_build_object(
      'participations', (select count(*) from public.survey_participation x where x.user_id = p_user),
      'item_views', (select count(*) from public.survey_item_views x where x.user_id = p_user)
    ));
  end if;

  if with_other then
    counts := counts || jsonb_build_object('other', jsonb_build_object(
      'reports_as_reporter', (select count(*) from public.reports x where x.reporter_id = p_user),
      'settings', (select count(*) from public.profiles p
                   where p.id = p_user and (
                     not p.is_private or p.story_visibility <> 'followers' or p.post_visibility <> 'followers'
                     or p.tag_permission <> 'everyone' or not p.tag_notifications or not p.tag_chat_messages
                     or not p.notify_plan_adopted or p.default_activity_visibility <> 'private'
                     or p.training_stats_visibility <> 'private'))
                  + (select count(*) from public.rest_budgets x where x.user_id = p_user)
    ));
  end if;

  if not p_apply then
    return jsonb_build_object('counts', counts, 'files', to_jsonb(files));
  end if;

  -- ------------------------------------------------------------ delete (notifications first)
  if with_notifications then
    delete from public.notifications x where x.user_id = p_user;
  end if;
  if with_chats then
    foreach conv in array my_ended loop
      if p_job_id is not null then
        for member in
          select m.user_id, (select count(*) from public.messages x where x.conversation_id = conv and x.sender_id = m.user_id) as n
          from public.conversation_members m
          where m.conversation_id = conv and not (m.user_id = any (coalesce(p_selected, '{}') || p_user))
        loop
          perform public.reset_add_collateral(p_job_id, member.user_id, member.n);
        end loop;
      end if;
      delete from public.conversations x where x.id = conv;
    end loop;
    foreach conv in array part_convs loop
      delete from public.message_reactions x where x.user_id = p_user and x.conversation_id = conv;
      delete from public.message_hidden x using public.messages mm
      where x.user_id = p_user and mm.id = x.message_id and mm.conversation_id = conv;
      delete from public.messages x where x.conversation_id = conv and x.sender_id = p_user;
      delete from public.conversation_members x where x.user_id = p_user and x.conversation_id = conv;
      insert into public.conversation_departures (conversation_id, user_id) values (conv, p_user);
      -- A neutral line for who stays (written in the name of a remaining member, shown centred).
      insert into public.messages (conversation_id, sender_id, body, kind)
      select conv, m.user_id, 'Eine Person ist nicht mehr in diesem Chat.', 'notice'
      from public.conversation_members m
      where m.conversation_id = conv
      order by public.reset_member_protected(m.user_id) desc, m.user_id::text
      limit 1;
    end loop;
  end if;
  if with_posts then
    delete from public.post_tags x where x.user_id = p_user;
    delete from public.post_reposts x where x.reposter_id = p_user;
    delete from public.post_likes x where x.user_id = p_user;
    delete from public.comment_likes x where x.user_id = p_user;
    delete from public.comments x
    where x.user_id = p_user and x.moderation_state is null
      and not exists (select 1 from public.comments r where r.parent_comment_id = x.id and r.moderation_state is not null);
    delete from public.posts x where x.id = any (my_posts);
  end if;
  if with_stories then
    delete from public.story_likes x where x.user_id = p_user;
    delete from public.story_views x where x.user_id = p_user;
    delete from public.highlights x where x.user_id = p_user;
    delete from public.stories x where x.id = any (my_stories);
  end if;
  if with_activities then
    delete from public.workout_shares x where x.tagged_user_id = p_user;
    delete from public.rest_day_uses x where x.user_id = p_user;
    delete from public.workouts x where x.id = any (my_workouts);
  end if;
  if with_plans then
    delete from public.plan_deviations x where x.user_id = p_user;
    delete from public.plan_rounds x where x.user_id = p_user;
    delete from public.planned_rest_uses x where x.user_id = p_user;
    delete from public.plan_adoptions x where x.adopter_id = p_user;
    delete from public.training_plans x where x.id = any (my_plans);
  end if;
  if with_social then
    delete from public.follows x where x.follower_id = p_user or x.following_id = p_user;
    delete from public.user_blocks x where x.blocker_id = p_user;
    delete from public.audience_restrictions x where x.owner_id = p_user;
  end if;
  if with_surveys then
    delete from public.survey_participation x where x.user_id = p_user;
    delete from public.survey_item_views x where x.user_id = p_user;
  end if;
  if with_other then
    update public.reports set reporter_id = null where reporter_id = p_user;
    update public.profiles
    set is_private = true, story_visibility = 'followers', post_visibility = 'followers',
        tag_permission = 'everyone', tag_notifications = true, tag_chat_messages = true,
        notify_plan_adopted = true, default_activity_visibility = 'private', training_stats_visibility = 'private'
    where id = p_user;
    delete from public.rest_budgets x where x.user_id = p_user;
  end if;
  return jsonb_build_object('counts', counts, 'files', to_jsonb(files));
end;
$$;

-- Did the job actually remove something of this person (then they are told)? Internal.
create or replace function public.reset_target_affected(p_target public.reset_job_targets, p_mode text)
returns boolean
language sql immutable set search_path = ''
as $$
  select case
    when p_target.role = 'collateral' then coalesce((p_target.result #>> '{chats,conversations_lost}')::bigint, 0) > 0
    when p_target.status <> 'done' then false
    when p_mode = 'full' then true
    else public.reset_counts_total(p_target.result) > 0
  end;
$$;

-- Reads the e-mail address of an affected person for the notification mail, right before it is
-- needed (before deleting an account). Kept only until the mail is out, at most email_keep_days.
-- Internal (definer: the only place that reads auth.users for resets).
create or replace function public.reset_capture_email(p_target_id uuid)
returns void
language sql security definer set search_path = ''
as $$
  update public.reset_job_targets t
  set email_address = u.email, email_captured_at = now(), email_status = 'pending', updated_at = now()
  from auth.users u
  where t.id = p_target_id and u.id = t.user_id and t.email_status = 'none' and u.email is not null;
$$;

-- Text of the in-app notice for people who keep their account (max. 1000 characters). Internal.
create or replace function public.reset_notice_text(p_role text, p_categories text[], p_reason text)
returns text
language sql immutable set search_path = ''
as $$
  select left(
    case when p_role = 'collateral' then
      'Eine oder mehrere deiner Unterhaltungen wurden im Rahmen einer Datenbereinigung beendet.'
    else
      'Im Rahmen einer Datenbereinigung wurden folgende Daten in deinem Konto gelöscht: '
      || (select string_agg(public.reset_category_label(k), ', ' order by array_position(public.reset_category_keys(), k))
          from unnest(p_categories) k) || '.'
    end
    || E'\n\nGrund: ' || coalesce(p_reason, '')
    || E'\n\nDein Konto, dein Benutzername und alle anderen Daten bleiben unverändert.',
    1000);
$$;

-- Dry run: what the job would remove, per person and in total, and who else loses a chat
-- (collateral). Deletes nothing. Stores the numbers (needed for confirming).
create or replace function public.admin_reset_preview(p_job_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  job public.reset_jobs%rowtype := public.reset_own_job(p_job_id, array['draft']);
  selected uuid[] := public.reset_selected_ids(p_job_id);
  t record;
  r jsonb;
  file_count bigint := 0;
  totals jsonb;
  ended uuid[] := '{}';
begin
  for t in select * from public.reset_job_targets x where x.job_id = p_job_id and x.role = 'selected' for update loop
    r := public.reset_user_categories(t.user_id, job.categories, selected, false, null, job.include_protected_chats);
    file_count := file_count + jsonb_array_length(r -> 'files');
    update public.reset_job_targets
    set counts = r -> 'counts', flagged = cardinality(public.reset_flags(t.user_id)) > 0, updated_at = now()
    where id = t.id;
  end loop;
  totals := public.reset_counts_sum(array(
    select x.counts from public.reset_job_targets x where x.job_id = p_job_id and x.role = 'selected'
  ));

  -- Who else loses a chat: members of ended chats who were not chosen.
  delete from public.reset_job_targets where job_id = p_job_id and role = 'collateral';
  if 'chats' = any (job.categories) then
    ended := array(
      select distinct m.conversation_id from public.conversation_members m
      where m.user_id = any (selected) and public.reset_conversation_ends(m.conversation_id, job.include_protected_chats)
    );
    insert into public.reset_job_targets (job_id, user_id, user_hash, role, selected, status, counts)
    select p_job_id, m.user_id, encode(pg_catalog.sha256(convert_to(m.user_id::text, 'UTF8')), 'hex'),
      'collateral', false, 'pending',
      jsonb_build_object('chats', jsonb_build_object(
        'conversations_lost', count(*),
        'messages', sum((select count(*) from public.messages x where x.conversation_id = m.conversation_id and x.sender_id = m.user_id))
      ))
    from public.conversation_members m
    where m.conversation_id = any (ended) and not (m.user_id = any (selected))
    group by m.user_id;
  end if;

  update public.reset_jobs
  set preview = jsonb_build_object(
        'totals', totals,
        'targets', (select count(*) from public.reset_job_targets x where x.job_id = p_job_id and x.role = 'selected'),
        'files', file_count,
        'collateral', (select jsonb_build_object(
                         'accounts', count(*),
                         'totals', public.reset_counts_sum(array_agg(x.counts)),
                         'with_email', count(*) filter (where exists (select 1 from auth.users u where u.id = x.user_id and u.email is not null)))
                       from public.reset_job_targets x where x.job_id = p_job_id and x.role = 'collateral')),
      previewed_at = now()
  where id = p_job_id;
  return jsonb_build_object(
    'job_id', p_job_id, 'mode', job.mode, 'categories', to_jsonb(job.categories), 'totals', totals, 'files', file_count,
    'include_protected_chats', job.include_protected_chats,
    'targets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'target_id', x.id, 'user_id', x.user_id, 'username', p.username, 'display_name', p.display_name,
        'flagged', x.flagged, 'counts', x.counts, 'total', public.reset_counts_total(x.counts)
      ) order by p.username)
      from public.reset_job_targets x join public.profiles p on p.id = x.user_id
      where x.job_id = p_job_id and x.role = 'selected'
    ), '[]'::jsonb),
    'collateral', coalesce((
      select jsonb_agg(jsonb_build_object(
        'target_id', x.id, 'username', p.username, 'display_name', p.display_name, 'counts', x.counts,
        'protected', public.reset_member_protected(x.user_id),
        'has_email', exists (select 1 from auth.users u where u.id = x.user_id and u.email is not null)
      ) order by p.username)
      from public.reset_job_targets x join public.profiles p on p.id = x.user_id
      where x.job_id = p_job_id and x.role = 'collateral'
    ), '[]'::jsonb),
    -- Chats with a protected account that stay (only the chosen person's side goes).
    'protected_chats_kept', case when 'chats' = any (job.categories) and not job.include_protected_chats then (
      select count(distinct m.conversation_id) from public.conversation_members m
      where m.user_id = any (selected) and not public.reset_conversation_ends(m.conversation_id, false)
    ) else 0 end
  );
end;
$$;

-- "Chats mit geschützten Konten ebenfalls beenden": only in a draft, only its creator, asks for
-- a new dry run, and switching it on is logged.
create or replace function public.admin_reset_set_protected_chats(p_job_id uuid, p_include boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  job public.reset_jobs%rowtype := public.reset_own_job(p_job_id, array['draft']);
begin
  if coalesce(p_include, false) = job.include_protected_chats then
    return;
  end if;
  update public.reset_jobs
  set include_protected_chats = coalesce(p_include, false), preview = null, previewed_at = null, updated_at = now()
  where id = p_job_id;
  perform public.log_moderation_action(
    case when p_include then 'reset_protected_chats_on' else 'reset_protected_chats_off' end,
    'reset_job', p_job_id, null, null,
    coalesce(job.reason, 'Chats mit geschützten Konten (Bereinigung)'), null, jsonb_build_object('mode', job.mode)
  );
end;
$$;

-- Confirms a draft: only its creator, after a dry run newer than the last change, with a reason,
-- the exact word and a TOTP step at most 5 minutes old. From now on scope and people are frozen.
create or replace function public.admin_reset_confirm(p_job_id uuid, p_phrase text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  job public.reset_jobs%rowtype := public.reset_own_job(p_job_id, array['draft']);
  limits jsonb := public.reset_limits();
  n integer;
begin
  if p_phrase is distinct from limits ->> 'phrase' then
    raise exception 'wrong_phrase';
  end if;
  if not public.reset_fresh_totp((limits ->> 'totp_max_age_seconds')::integer) then
    raise exception 'totp_required';
  end if;
  if job.reason is null or char_length(job.reason) < 10 then
    raise exception 'reason_too_short';
  end if;
  if job.previewed_at is null or job.previewed_at < job.updated_at then
    raise exception 'preview_required';
  end if;
  if job.mode = 'full' and not public.reset_full_allowed() then
    raise exception 'full_reset_disabled';
  end if;
  select count(*) into n from public.reset_job_targets t where t.job_id = p_job_id and t.role = 'selected';
  if n = 0 then
    raise exception 'no_targets';
  end if;
  -- Protection or flags may have changed since the people were chosen.
  if exists (select 1 from public.reset_job_targets t
             where t.job_id = p_job_id and t.role = 'selected' and public.reset_protection(t.user_id) is not null) then
    raise exception 'protected_target';
  end if;
  if not job.include_flagged and exists (
    select 1 from public.reset_job_targets t
    where t.job_id = p_job_id and t.role = 'selected' and cardinality(public.reset_flags(t.user_id)) > 0
  ) then
    raise exception 'flagged_not_confirmed';
  end if;
  perform pg_advisory_xact_lock(hashtext('peakpic.reset_jobs'));
  if exists (select 1 from public.reset_jobs j where j.id <> p_job_id and j.status in ('confirmed', 'running')) then
    raise exception 'other_job_active';
  end if;
  update public.reset_jobs set status = 'confirmed', confirmed_at = now() where id = p_job_id;
  perform public.log_moderation_action(
    'reset_confirmed', 'reset_job', p_job_id, null, null, job.reason, null,
    jsonb_build_object('mode', job.mode, 'categories', to_jsonb(job.categories), 'targets', n,
                       'include_flagged', job.include_flagged, 'include_protected_chats', job.include_protected_chats,
                       'preview', job.preview -> 'totals', 'collateral', job.preview -> 'collateral')
  );
end;
$$;

-- Earlier jobs (newest first).
create or replace function public.admin_reset_jobs()
returns table (
  id uuid, status text, mode text, categories text[], created_at timestamptz, confirmed_at timestamptz,
  finished_at timestamptz, targets bigint, own boolean
)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
begin
  perform public.require_admin();
  return query
  select j.id, j.status, j.mode, j.categories, j.created_at, j.confirmed_at, j.finished_at,
         (select count(*) from public.reset_job_targets t where t.job_id = j.id and t.role = 'selected'),
         j.created_by = auth.uid()
  from public.reset_jobs j
  order by j.created_at desc
  limit 100;
end;
$$;

-- One job with its progress and, per person, role, status, numbers and mail status. Never
-- e-mail addresses. Deleted accounts appear only with the start of their hash.
create or replace function public.admin_reset_job_status(p_job_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  job public.reset_jobs%rowtype;
begin
  perform public.require_admin();
  select * into job from public.reset_jobs j where j.id = p_job_id;
  if not found then
    raise exception 'job_not_found';
  end if;
  return jsonb_build_object(
    'id', job.id, 'status', job.status, 'mode', job.mode, 'categories', to_jsonb(job.categories),
    'reason', job.reason, 'subject', job.subject, 'user_message', job.user_message,
    'include_flagged', job.include_flagged, 'include_protected_chats', job.include_protected_chats,
    'preview', job.preview, 'previewed_at', job.previewed_at,
    'result', job.result, 'own', job.created_by = auth.uid(),
    'created_at', job.created_at, 'updated_at', job.updated_at, 'confirmed_at', job.confirmed_at,
    'started_at', job.started_at, 'finished_at', job.finished_at,
    'progress', (
      select jsonb_build_object(
        'total', count(*),
        'done', count(*) filter (where t.status = 'done'),
        'failed', count(*) filter (where t.status = 'failed'),
        'skipped', count(*) filter (where t.status = 'skipped'),
        'open', count(*) filter (where t.status in ('pending', 'claimed', 'files_pending'))
      )
      from public.reset_job_targets t where t.job_id = p_job_id and t.role = 'selected'
    ),
    'mail', (
      select jsonb_build_object(
        'pending', count(*) filter (where t.email_status = 'pending'),
        'sent', count(*) filter (where t.email_status = 'sent'),
        'failed', count(*) filter (where t.email_status = 'failed'),
        'not_configured', count(*) filter (where t.email_status = 'not_configured'),
        'in_app', count(*) filter (where t.notice_sent_at is not null)
      )
      from public.reset_job_targets t where t.job_id = p_job_id
    ),
    'targets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'target_id', t.id, 'user_id', t.user_id, 'username', p.username, 'display_name', p.display_name,
        'user_hash', left(t.user_hash, 12), 'role', t.role, 'flagged', t.flagged, 'status', t.status, 'error', t.error,
        'counts', t.counts, 'result', t.result, 'email_status', t.email_status,
        'in_app', t.notice_sent_at is not null, 'attempts', t.attempts
      ) order by t.role desc, p.username nulls last, t.user_hash)
      from public.reset_job_targets t left join public.profiles p on p.id = t.user_id
      where t.job_id = p_job_id
    ), '[]'::jsonb)
  );
end;
$$;

-- Categories: removes the person's rows (exactly like the dry run counted them) and returns the
-- files the Edge Function must remove. Repeating it after the rows are gone returns the same
-- files again.
create or replace function public.admin_reset_apply_user(p_job_id uuid, p_target_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  job public.reset_jobs%rowtype := public.reset_own_job(p_job_id, array['running']);
  t public.reset_job_targets%rowtype := public.reset_target_for_step(p_job_id, p_target_id);
  r jsonb;
begin
  if job.mode <> 'categories' then
    raise exception 'wrong_mode';
  end if;
  if t.status = 'files_pending' then
    return jsonb_build_object('user_id', t.user_id, 'files', coalesce(t.files, '[]'::jsonb));
  end if;
  if t.user_id is null or public.reset_protection(t.user_id) is not null
    or exists (select 1 from public.profiles p where p.id = t.user_id and p.account_status = 'deleting') then
    update public.reset_job_targets set status = 'skipped', error = 'not_allowed_anymore', updated_at = now() where id = t.id;
    return jsonb_build_object('skipped', true);
  end if;
  r := public.reset_user_categories(t.user_id, job.categories, public.reset_selected_ids(p_job_id), true,
                                    p_job_id, job.include_protected_chats);
  update public.reset_job_targets
  set status = 'files_pending', result = r -> 'counts', files = r -> 'files', updated_at = now()
  where id = t.id;
  return jsonb_build_object('user_id', t.user_id, 'files', r -> 'files');
end;
$$;

-- Whole account: ends the person's chats (like the chats category, others are recorded as
-- collateral), counts the rest for the report, reads the e-mail address for the notification
-- (afterwards it is gone), then marks the account 'deleting' (hidden at once, can't write; an
-- account already 'deleting' is simply finished). The Edge Function then deletes the files,
-- calls finish_account_deletion() and deletes the auth user, like delete_account.
-- {deleted: true} when the account is gone already (interrupted earlier).
create or replace function public.admin_reset_full_prepare(p_job_id uuid, p_target_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  job public.reset_jobs%rowtype := public.reset_own_job(p_job_id, array['running']);
  t public.reset_job_targets%rowtype := public.reset_target_for_step(p_job_id, p_target_id);
  chats jsonb;
  rest jsonb;
begin
  if job.mode <> 'full' then
    raise exception 'wrong_mode';
  end if;
  if not public.reset_full_allowed() then
    raise exception 'full_reset_disabled';
  end if;
  if t.user_id is null then
    return jsonb_build_object('deleted', true);
  end if;
  if public.reset_protection(t.user_id) is not null then
    update public.reset_job_targets set status = 'skipped', error = 'not_allowed_anymore', updated_at = now() where id = t.id;
    return jsonb_build_object('skipped', true);
  end if;
  if t.result is null then
    chats := public.reset_user_categories(t.user_id, array['chats'], public.reset_selected_ids(p_job_id), true,
                                          p_job_id, job.include_protected_chats);
    rest := public.reset_user_categories(t.user_id, array(select k from unnest(public.reset_category_keys()) k where k <> 'chats'),
                                         public.reset_selected_ids(p_job_id), false);
    update public.reset_job_targets
    set result = (rest -> 'counts') || (chats -> 'counts') || jsonb_build_object('account', jsonb_build_object('account', 1))
    where id = t.id;
  end if;
  perform public.reset_capture_email(t.id);
  update public.profiles
  set account_status = 'deleting', suspended_until = null, suspension_reason_code = null, moderation_updated_at = now()
  where id = t.user_id and account_status <> 'deleting';
  update public.reset_job_targets set status = 'files_pending', updated_at = now() where id = t.id;
  return jsonb_build_object('user_id', t.user_id);
end;
$$;

-- Ends the job once nobody chosen is open any more: 'done', or 'failed' if someone failed.
-- Settles the collateral, writes the in-app notices for affected people who keep their account
-- and reads their addresses for the mails (sent by the Edge Function afterwards). Logs the
-- totals per category (no names). Returns the progress either way.
create or replace function public.admin_reset_run_finish(p_job_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  job public.reset_jobs%rowtype := public.reset_own_job(p_job_id, array['running']);
  progress jsonb;
  totals jsonb;
  collateral jsonb;
  final_status text;
  t public.reset_job_targets%rowtype;
begin
  select jsonb_build_object(
    'total', count(*),
    'done', count(*) filter (where x.status = 'done'),
    'failed', count(*) filter (where x.status = 'failed'),
    'skipped', count(*) filter (where x.status = 'skipped'),
    'open', count(*) filter (where x.status in ('pending', 'claimed', 'files_pending'))
  ) into progress
  from public.reset_job_targets x where x.job_id = p_job_id and x.role = 'selected';
  if (progress ->> 'open')::integer > 0 then
    return progress || jsonb_build_object('status', 'running');
  end if;
  final_status := case when (progress ->> 'failed')::integer > 0 then 'failed' else 'done' end;

  update public.reset_job_targets
  set status = case when result is not null then 'done' else 'skipped' end, updated_at = now()
  where job_id = p_job_id and role = 'collateral' and status = 'pending';

  -- Affected people who keep their account: in-app notice (once) and the address for the mail.
  for t in
    select x.* from public.reset_job_targets x
    join public.profiles p on p.id = x.user_id
    where x.job_id = p_job_id
  loop
    continue when not public.reset_target_affected(t, job.mode);
    if t.notice_sent_at is null then
      insert into public.moderation_notices (user_id, kind, message)
      values (t.user_id, 'info', public.reset_notice_text(t.role, job.categories, job.reason));
      update public.reset_job_targets set notice_sent_at = now() where id = t.id;
    end if;
    perform public.reset_capture_email(t.id);
  end loop;

  totals := public.reset_counts_sum(array(
    select x.result from public.reset_job_targets x where x.job_id = p_job_id and x.role = 'selected' and x.status = 'done'
  ));
  select jsonb_build_object('accounts', count(*), 'totals', public.reset_counts_sum(array_agg(x.result)))
  into collateral
  from public.reset_job_targets x where x.job_id = p_job_id and x.role = 'collateral' and x.status = 'done';
  update public.reset_jobs
  set status = final_status, finished_at = now(),
      result = jsonb_build_object('totals', totals, 'collateral', collateral, 'progress', progress)
  where id = p_job_id;
  perform public.log_moderation_action(
    'reset_finished', 'reset_job', p_job_id, null, null, job.reason, null,
    jsonb_build_object('mode', job.mode, 'status', final_status, 'totals', totals, 'collateral', collateral, 'progress', progress)
  );
  return progress || jsonb_build_object('status', final_status);
end;
$$;

-- ---------------------------------------------------------------- notification mails
-- Only the Edge Function run_data_reset calls these, with the service role (addresses never go
-- through the admin's session or the browser).

-- Addresses older than email_keep_days are deleted, also when the mail never went out.
create or replace function public.reset_purge_emails()
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  n integer;
begin
  update public.reset_job_targets
  set email_address = null,
      email_status = case when email_status = 'pending' then 'failed' else email_status end,
      error = case when email_status = 'pending' then 'mail_expired' else error end,
      updated_at = now()
  where email_address is not null
    and email_captured_at < now() - make_interval(days => (public.reset_limits() ->> 'email_keep_days')::integer);
  get diagnostics n = row_count;
  return n;
end;
$$;

-- The next mails of a job (at most p_limit): address, role and the texts of the job.
create or replace function public.reset_mail_claim(p_job_id uuid, p_limit integer)
returns table (
  target_id uuid, email text, role text, mode text, categories text[], reason text, subject text, user_message text
)
language plpgsql security definer set search_path = ''
as $$
#variable_conflict use_column
begin
  perform public.reset_purge_emails();
  return query
  select t.id, t.email_address, t.role, j.mode, j.categories, j.reason, j.subject, j.user_message
  from public.reset_job_targets t join public.reset_jobs j on j.id = t.job_id
  where t.job_id = p_job_id and j.status in ('done', 'failed')
    and t.email_status = 'pending' and t.email_address is not null
  order by t.role, t.id
  limit least(greatest(coalesce(p_limit, 0), 0), 100);
end;
$$;

-- Outcome of one mail: 'sent' or 'failed' delete the address; 'pending' (quota, provider
-- unavailable) keeps it for "Offene Mails senden".
create or replace function public.reset_mail_result(p_target_id uuid, p_status text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if p_status not in ('sent', 'failed', 'pending') then
    raise exception 'invalid_status';
  end if;
  update public.reset_job_targets
  set email_status = p_status,
      email_address = case when p_status = 'pending' then email_address end,
      error = case when p_status = 'failed' then 'mail_failed' else error end,
      updated_at = now()
  where id = p_target_id and email_status = 'pending';
end;
$$;

-- No mail provider set up: nobody of the job gets a mail (people who keep their account have
-- the in-app notice); the addresses are deleted at once.
create or replace function public.reset_mail_not_configured(p_job_id uuid)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  n integer;
begin
  update public.reset_job_targets
  set email_status = 'not_configured', email_address = null, updated_at = now()
  where job_id = p_job_id and email_status = 'pending';
  get diagnostics n = row_count;
  return n;
end;
$$;

-- The job of the caller in a given state, locked. Internal.
create or replace function public.reset_own_job(p_job_id uuid, p_states text[])
returns public.reset_jobs
language plpgsql security definer set search_path = ''
as $$
declare
  job public.reset_jobs%rowtype;
begin
  perform public.require_admin();
  select * into job from public.reset_jobs j where j.id = p_job_id for update;
  if not found then
    raise exception 'job_not_found';
  end if;
  if job.created_by is distinct from auth.uid() then
    raise exception 'not_job_owner';
  end if;
  if not (job.status = any (p_states)) then
    raise exception 'job_wrong_state' using hint = job.status;
  end if;
  return job;
end;
$$;

-- Ids of everybody selected in a job (for chats). Internal.
create or replace function public.reset_selected_ids(p_job_id uuid)
returns uuid[]
language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(t.user_id), '{}') from public.reset_job_targets t
  where t.job_id = p_job_id and t.selected and t.user_id is not null and t.status <> 'skipped';
$$;

-- Validates mode and categories of a job. Internal.
create or replace function public.reset_checked_categories(p_mode text, p_categories text[])
returns text[]
language plpgsql stable security definer set search_path = ''
as $$
declare
  cats text[];
begin
  if p_mode is null or p_mode not in ('categories', 'full') then
    raise exception 'invalid_mode';
  end if;
  if p_mode = 'full' then
    if not public.reset_full_allowed() then
      raise exception 'full_reset_disabled';
    end if;
    return public.reset_category_keys();
  end if;
  cats := array(select distinct x from unnest(coalesce(p_categories, '{}')) x order by x);
  if cardinality(cats) = 0 then
    raise exception 'no_categories';
  end if;
  if exists (select 1 from unnest(cats) x where not (x = any (public.reset_category_keys()))) then
    raise exception 'invalid_category';
  end if;
  return cats;
end;
$$;

-- ---------------------------------------------------------------- dashboard functions
-- Numbers and switches for the dashboard.
create or replace function public.admin_reset_settings()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.require_admin();
  return public.reset_limits() || jsonb_build_object('allow_full_reset', public.reset_full_allowed());
end;
$$;

-- People to choose from (public profile data only), with protection and flags. Search in
-- username and display name; at most 500 rows.
create or replace function public.admin_reset_candidates(p_query text default null)
returns table (
  user_id uuid, username text, display_name text, account_status text, created_at timestamptz,
  protection text, flags text[]
)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  q text := btrim(coalesce(p_query, ''));
  pattern text := '%' || replace(replace(replace(btrim(coalesce(p_query, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%';
begin
  perform public.require_admin();
  return query
  select p.id, p.username, p.display_name, p.account_status, p.created_at,
         public.reset_protection(p.id), public.reset_flags(p.id)
  from public.profiles p
  where q = '' or p.username ilike pattern or p.display_name ilike pattern
  order by p.username
  limit 500;
end;
$$;

-- New job in 'draft'. 'full' only while app_settings.allow_full_reset is on; its categories are
-- always all of them.
create or replace function public.admin_reset_create_job(
  p_mode text, p_categories text[], p_reason text default null, p_subject text default null, p_user_message text default null
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  new_id uuid;
begin
  perform public.require_admin();
  insert into public.reset_jobs (created_by, mode, categories, reason, subject, user_message)
  values (
    auth.uid(), p_mode, public.reset_checked_categories(p_mode, p_categories),
    nullif(btrim(coalesce(p_reason, '')), ''), nullif(btrim(coalesce(p_subject, '')), ''),
    nullif(btrim(coalesce(p_user_message, '')), '')
  )
  returning id into new_id;
  return new_id;
end;
$$;

-- Changes a draft (scope, reason, mail texts). A changed scope needs a new dry run.
create or replace function public.admin_reset_update_job(
  p_job_id uuid, p_mode text, p_categories text[], p_reason text, p_subject text, p_user_message text
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  job public.reset_jobs%rowtype := public.reset_own_job(p_job_id, array['draft']);
  cats text[] := public.reset_checked_categories(p_mode, p_categories);
  scope_changed boolean := p_mode is distinct from job.mode or cats is distinct from job.categories;
begin
  if p_mode = 'categories' and exists (
    select 1 from public.reset_job_targets t join public.profiles p on p.id = t.user_id
    where t.job_id = p_job_id and p.account_status = 'deleting'
  ) then
    raise exception 'target_deleting';
  end if;
  update public.reset_jobs
  set mode = p_mode, categories = cats,
      reason = nullif(btrim(coalesce(p_reason, '')), ''),
      subject = nullif(btrim(coalesce(p_subject, '')), ''),
      user_message = nullif(btrim(coalesce(p_user_message, '')), ''),
      preview = case when scope_changed then null else preview end,
      previewed_at = case when scope_changed then null else previewed_at end,
      updated_at = case when scope_changed then now() else updated_at end
  where id = p_job_id;
end;
$$;

-- The people of a draft (replaces the list). Protected accounts, staff and the caller are
-- refused outright; flagged accounts only with p_include_flagged; accounts being deleted only
-- for 'full'. At most 500. A new dry run is needed afterwards.
create or replace function public.admin_reset_set_targets(p_job_id uuid, p_user_ids uuid[], p_include_flagged boolean)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  job public.reset_jobs%rowtype := public.reset_own_job(p_job_id, array['draft']);
  ids uuid[] := array(select distinct x from unnest(coalesce(p_user_ids, '{}')) x where x is not null);
  max_targets integer := (public.reset_limits() ->> 'max_targets')::integer;
begin
  if cardinality(ids) > max_targets then
    raise exception 'too_many_targets' using hint = max_targets::text;
  end if;
  if exists (select 1 from unnest(ids) x where not exists (select 1 from public.profiles p where p.id = x)) then
    raise exception 'unknown_user';
  end if;
  if exists (select 1 from unnest(ids) x where public.reset_protection(x) is not null) then
    raise exception 'protected_target';
  end if;
  if not coalesce(p_include_flagged, false)
    and exists (select 1 from unnest(ids) x where cardinality(public.reset_flags(x)) > 0) then
    raise exception 'flagged_not_confirmed';
  end if;
  if job.mode = 'categories'
    and exists (select 1 from public.profiles p where p.id = any (ids) and p.account_status = 'deleting') then
    raise exception 'target_deleting';
  end if;
  delete from public.reset_job_targets where job_id = p_job_id;
  insert into public.reset_job_targets (job_id, user_id, user_hash, flagged)
  select p_job_id, x, encode(pg_catalog.sha256(convert_to(x::text, 'UTF8')), 'hex'), cardinality(public.reset_flags(x)) > 0
  from unnest(ids) x;
  update public.reset_jobs
  set include_flagged = coalesce(p_include_flagged, false), preview = null, previewed_at = null, updated_at = now()
  where id = p_job_id;
  return cardinality(ids);
end;
$$;


-- Was the last TOTP step of this session at most p_seconds ago (amr claim of the JWT)?
create or replace function public.reset_fresh_totp(p_seconds integer)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((
    select max((e ->> 'timestamp')::numeric) >= extract(epoch from now()) - p_seconds
    from jsonb_array_elements(case when jsonb_typeof(auth.jwt() -> 'amr') = 'array' then auth.jwt() -> 'amr' else '[]'::jsonb end) e
    where e ->> 'method' = 'totp' and (e ->> 'timestamp') ~ '^[0-9]{1,12}(\.[0-9]+)?$'
  ), false);
$$;


-- Cancels a job that hasn't started (draft or confirmed). Only its creator.
create or replace function public.admin_reset_cancel(p_job_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  job public.reset_jobs%rowtype := public.reset_own_job(p_job_id, array['draft', 'confirmed']);
begin
  update public.reset_jobs set status = 'cancelled', finished_at = now() where id = p_job_id;
  if job.status = 'confirmed' then
    perform public.log_moderation_action(
      'reset_cancelled', 'reset_job', p_job_id, null, null, job.reason, null, jsonb_build_object('mode', job.mode)
    );
  end if;
end;
$$;

-- The rows a category touches for one person, as JSON (for the backup before a reset). Chats only
-- as metadata (ids, members, sender and time of each message), never their text: nobody reads
-- chats freely (moderators only through report_snapshots). No e-mail addresses. Internal.
create or replace function public.reset_export_user(p_user uuid, p_categories text[])
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  result jsonb;
  cats text[] := p_categories;
begin
  select jsonb_build_object(
    'user_id', p.id, 'username', p.username, 'display_name', p.display_name, 'created_at', p.created_at,
    'account_status', p.account_status
  ) into result
  from public.profiles p where p.id = p_user;
  if result is null then
    return null;
  end if;
  if 'chats' = any (cats) then
    result := result || jsonb_build_object('chats', jsonb_build_object(
      'memberships', (select coalesce(jsonb_agg(to_jsonb(m)), '[]') from public.conversation_members m where m.user_id = p_user),
      'messages', (select coalesce(jsonb_agg(jsonb_build_object(
                     'id', x.id, 'conversation_id', x.conversation_id, 'sender_id', x.sender_id,
                     'created_at', x.created_at, 'kind', x.kind, 'post_id', x.post_id)), '[]')
                   from public.messages x
                   where x.conversation_id in (select m.conversation_id from public.conversation_members m where m.user_id = p_user)
                     and x.sender_id = p_user)
    ));
  end if;
  if 'posts' = any (cats) then
    result := result || jsonb_build_object('posts', jsonb_build_object(
      'posts', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.posts x where x.user_id = p_user),
      'post_media', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.post_media x where x.user_id = p_user),
      'comments', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.comments x where x.user_id = p_user),
      'post_likes', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.post_likes x where x.user_id = p_user),
      'comment_likes', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.comment_likes x where x.user_id = p_user),
      'post_reposts', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.post_reposts x where x.reposter_id = p_user),
      'post_tags', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.post_tags x where x.user_id = p_user)
    ));
  end if;
  if 'stories' = any (cats) then
    result := result || jsonb_build_object('stories', jsonb_build_object(
      'stories', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.stories x where x.user_id = p_user),
      'highlights', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.highlights x where x.user_id = p_user),
      'highlight_items', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.highlight_items x
                          join public.highlights h on h.id = x.highlight_id where h.user_id = p_user),
      'story_likes', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.story_likes x where x.user_id = p_user),
      'story_views', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.story_views x where x.user_id = p_user)
    ));
  end if;
  if 'activities' = any (cats) then
    result := result || jsonb_build_object('activities', jsonb_build_object(
      'workouts', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.workouts x where x.user_id = p_user),
      'workout_exercises', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.workout_exercises x
                            join public.workouts w on w.id = x.workout_id where w.user_id = p_user),
      'workout_sets', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.workout_sets x
                       join public.workout_exercises e on e.id = x.workout_exercise_id
                       join public.workouts w on w.id = e.workout_id where w.user_id = p_user),
      'workout_shares', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.workout_shares x where x.tagged_user_id = p_user),
      'rest_day_uses', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.rest_day_uses x where x.user_id = p_user)
    ));
  end if;
  if 'plans' = any (cats) then
    result := result || jsonb_build_object('plans', jsonb_build_object(
      'training_plans', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.training_plans x where x.user_id = p_user),
      'plan_days', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.plan_days x
                    join public.training_plans tp on tp.id = x.plan_id where tp.user_id = p_user),
      'plan_exercises', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.plan_exercises x
                         join public.plan_days d on d.id = x.plan_day_id
                         join public.training_plans tp on tp.id = d.plan_id where tp.user_id = p_user),
      'plan_rounds', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.plan_rounds x where x.user_id = p_user),
      'plan_deviations', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.plan_deviations x where x.user_id = p_user),
      'planned_rest_uses', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.planned_rest_uses x where x.user_id = p_user),
      'plan_adoptions', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.plan_adoptions x where x.adopter_id = p_user)
    ));
  end if;
  if 'social' = any (cats) then
    result := result || jsonb_build_object('social', jsonb_build_object(
      'follows', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.follows x
                  where x.follower_id = p_user or x.following_id = p_user),
      'user_blocks', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.user_blocks x where x.blocker_id = p_user),
      'audience_restrictions', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.audience_restrictions x where x.owner_id = p_user)
    ));
  end if;
  if 'notifications' = any (cats) then
    result := result || jsonb_build_object('notifications', jsonb_build_object(
      'notifications', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.notifications x where x.user_id = p_user)
    ));
  end if;
  if 'surveys' = any (cats) then
    result := result || jsonb_build_object('surveys', jsonb_build_object(
      'participations', (select coalesce(jsonb_agg(jsonb_build_object('survey_id', x.survey_id, 'submitted_at', x.submitted_at)), '[]')
                         from public.survey_participation x where x.user_id = p_user),
      'item_views', (select coalesce(jsonb_agg(jsonb_build_object('item_id', x.item_id, 'first_seen_at', x.first_seen_at,
                                                                  'dismissed_at', x.dismissed_at, 'answered_at', x.answered_at)), '[]')
                     from public.survey_item_views x where x.user_id = p_user)
    ));
  end if;
  if 'other' = any (cats) then
    result := result || jsonb_build_object('other', jsonb_build_object(
      'reports_as_reporter', (select coalesce(jsonb_agg(jsonb_build_object(
                                'id', x.id, 'target_type', x.target_type, 'target_id', x.target_id, 'reason', x.reason,
                                'status', x.status, 'created_at', x.created_at)), '[]')
                              from public.reports x where x.reporter_id = p_user),
      'settings', (select jsonb_build_object(
                     'is_private', p.is_private, 'story_visibility', p.story_visibility, 'post_visibility', p.post_visibility,
                     'tag_permission', p.tag_permission, 'tag_notifications', p.tag_notifications,
                     'tag_chat_messages', p.tag_chat_messages, 'notify_plan_adopted', p.notify_plan_adopted,
                     'default_activity_visibility', p.default_activity_visibility,
                     'training_stats_visibility', p.training_stats_visibility)
                   from public.profiles p where p.id = p_user),
      'rest_budgets', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.rest_budgets x where x.user_id = p_user)
    ));
  end if;
  return result;
end;
$$;

-- Backup before confirming: the rows of everybody in the job, per category (chats without their
-- text, no e-mail addresses, no files). Only the job's creator, before it runs. Logged, because it
-- shows private content.
create or replace function public.admin_reset_export(p_job_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  job public.reset_jobs%rowtype := public.reset_own_job(p_job_id, array['draft', 'confirmed']);
  people jsonb;
begin
  if job.reason is null or char_length(job.reason) < 10 then
    raise exception 'reason_too_short';
  end if;
  select coalesce(jsonb_agg(public.reset_export_user(t.user_id, job.categories)), '[]') into people
  from public.reset_job_targets t where t.job_id = p_job_id and t.selected and t.user_id is not null;
  perform public.log_moderation_action(
    'reset_exported', 'reset_job', p_job_id, null, null, job.reason, null,
    jsonb_build_object('mode', job.mode, 'categories', to_jsonb(job.categories), 'targets', jsonb_array_length(people))
  );
  return jsonb_build_object(
    'job_id', job.id, 'mode', job.mode, 'categories', to_jsonb(job.categories), 'exported_at', now(),
    'note', 'Ohne Dateien im Storage, ohne Chat-Texte und ohne E-Mail-Adressen.',
    'people', people
  );
end;
$$;

revoke all on function public.reset_export_user(uuid, text[]) from public, anon, authenticated;
revoke all on function public.admin_reset_export(uuid) from public, anon;
grant execute on function public.admin_reset_export(uuid) to authenticated;



-- ---------------------------------------------------------------- run (Edge Function run_data_reset)
-- Called with the admin's own session; the Edge Function only adds storage and the Auth admin
-- API with the service role. Starting again after an interruption continues where it stopped:
-- every person has its own state, and each step can be repeated.

-- Starts or continues a confirmed job (only its creator). Failed people get another try (at
-- most max_attempts). Only one job runs at a time.
create or replace function public.admin_reset_run_start(p_job_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  job public.reset_jobs%rowtype := public.reset_own_job(p_job_id, array['confirmed', 'running', 'failed']);
begin
  if job.mode = 'full' and not public.reset_full_allowed() then
    raise exception 'full_reset_disabled';
  end if;
  perform pg_advisory_xact_lock(hashtext('peakpic.reset_jobs'));
  if exists (select 1 from public.reset_jobs j where j.id <> p_job_id and j.status = 'running') then
    raise exception 'other_job_active';
  end if;
  if job.status = 'confirmed' then
    update public.reset_jobs set status = 'running', started_at = now() where id = p_job_id;
    perform public.log_moderation_action(
      'reset_started', 'reset_job', p_job_id, null, null, job.reason, null,
      jsonb_build_object('mode', job.mode, 'categories', to_jsonb(job.categories),
                         'targets', (select count(*) from public.reset_job_targets t where t.job_id = p_job_id))
    );
  elsif job.status = 'failed' then
    update public.reset_job_targets
    set status = 'pending', error = null, updated_at = now()
    where job_id = p_job_id and status = 'failed'
      and attempts < (public.reset_limits() ->> 'max_attempts')::integer;
    update public.reset_jobs set status = 'running', finished_at = null where id = p_job_id;
    perform public.log_moderation_action(
      'reset_resumed', 'reset_job', p_job_id, null, null, job.reason, null, jsonb_build_object('mode', job.mode)
    );
  end if;
  return jsonb_build_object('mode', job.mode, 'status', 'running');
end;
$$;

-- The next people to work on (at most batch_size). Claims older than 10 minutes count as
-- abandoned (interrupted run) and are handed out again.
create or replace function public.admin_reset_claim_batch(p_job_id uuid)
returns table (target_id uuid, user_id uuid, status text)
language plpgsql security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  job public.reset_jobs%rowtype := public.reset_own_job(p_job_id, array['running']);
begin
  return query
  with picked as (
    select t.id from public.reset_job_targets t
    where t.job_id = p_job_id and t.selected
      and (t.status in ('pending', 'files_pending')
           or (t.status = 'claimed' and t.claimed_at < now() - interval '10 minutes'))
    order by t.user_id::text nulls first
    limit (public.reset_limits() ->> 'batch_size')::integer
    for update skip locked
  )
  update public.reset_job_targets t
  set status = case when t.status = 'files_pending' then 'files_pending' else 'claimed' end,
      claimed_at = now(), updated_at = now()
  from picked
  where t.id = picked.id
  returning t.id, t.user_id, t.status;
end;
$$;

-- A claimed person that may not be processed any more (protected or staff in the meantime,
-- deleting while categories are chosen) is skipped. Internal.
create or replace function public.reset_target_for_step(p_job_id uuid, p_target_id uuid)
returns public.reset_job_targets
language plpgsql security definer set search_path = ''
as $$
declare
  t public.reset_job_targets%rowtype;
begin
  select * into t from public.reset_job_targets x where x.id = p_target_id and x.job_id = p_job_id for update;
  if not found then
    raise exception 'target_not_found';
  end if;
  if t.status not in ('claimed', 'files_pending') then
    raise exception 'target_wrong_state' using hint = t.status;
  end if;
  return t;
end;
$$;



create or replace function public.admin_reset_target_done(p_job_id uuid, p_target_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  job public.reset_jobs%rowtype := public.reset_own_job(p_job_id, array['running']);
  t public.reset_job_targets%rowtype := public.reset_target_for_step(p_job_id, p_target_id);
begin
  update public.reset_job_targets
  set status = 'done', files = null, error = null, claimed_at = null, updated_at = now()
  where id = t.id;
end;
$$;

-- A step failed (error code only, no user data). Tried again on "Fortsetzen".
create or replace function public.admin_reset_target_failed(p_job_id uuid, p_target_id uuid, p_error text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  job public.reset_jobs%rowtype := public.reset_own_job(p_job_id, array['running']);
  t public.reset_job_targets%rowtype := public.reset_target_for_step(p_job_id, p_target_id);
begin
  update public.reset_job_targets
  set status = 'failed', attempts = attempts + 1, claimed_at = null, updated_at = now(),
      error = case when p_error ~ '^[a-z_]{1,40}$' then p_error else 'step_failed' end
  where id = t.id;
end;
$$;


do $$
declare
  f text;
begin
  foreach f in array array[
    'public.reset_limits()', 'public.reset_category_keys()', 'public.reset_full_allowed()',
    'public.reset_protection(uuid)', 'public.reset_flags(uuid)', 'public.reset_conversation_ends(uuid, boolean)',
    'public.reset_user_categories(uuid, text[], uuid[], boolean, uuid, boolean)', 'public.reset_counts_total(jsonb)',
    'public.reset_category_label(text)', 'public.reset_member_protected(uuid)', 'public.reset_add_collateral(uuid, uuid, bigint)',
    'public.reset_target_affected(public.reset_job_targets, text)', 'public.reset_capture_email(uuid)',
    'public.reset_notice_text(text, text[], text)',
    'public.reset_counts_sum(jsonb[])', 'public.reset_own_job(uuid, text[])', 'public.reset_selected_ids(uuid)',
    'public.reset_checked_categories(text, text[])', 'public.reset_fresh_totp(integer)',
    'public.reset_target_for_step(uuid, uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'public.admin_reset_settings()', 'public.admin_reset_candidates(text)',
    'public.admin_reset_create_job(text, text[], text, text, text)',
    'public.admin_reset_update_job(uuid, text, text[], text, text, text)',
    'public.admin_reset_set_targets(uuid, uuid[], boolean)', 'public.admin_reset_preview(uuid)',
    'public.admin_reset_confirm(uuid, text)', 'public.admin_reset_cancel(uuid)', 'public.admin_reset_jobs()',
    'public.admin_reset_job_status(uuid)', 'public.admin_reset_run_start(uuid)', 'public.admin_reset_claim_batch(uuid)',
    'public.admin_reset_apply_user(uuid, uuid)', 'public.admin_reset_full_prepare(uuid, uuid)',
    'public.admin_reset_target_done(uuid, uuid)', 'public.admin_reset_target_failed(uuid, uuid, text)',
    'public.admin_reset_run_finish(uuid)', 'public.admin_reset_set_protected_chats(uuid, boolean)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  -- Mails: only the Edge Function with the service role (addresses never reach a client).
  foreach f in array array[
    'public.reset_purge_emails()', 'public.reset_mail_claim(uuid, integer)', 'public.reset_mail_result(uuid, text)',
    'public.reset_mail_not_configured(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;


-- ================================================================ e-mail notices ("Mitteilungen")
-- Admins send service notices by e-mail from the dashboard: to one person, to several or to all
-- active accounts. Only categories for service notices exist (no advertising). Flow:
--   test mail to the admin's own address (mail_record_test) -> admin_mail_create (same content as
--   the test, at most 60 minutes old; recipients resolved and checked here) -> the Edge Function
--   send_admin_mail sends in batches and records each recipient's outcome. A reached quota stops
--   the rest ('waiting'); "Rest senden" continues later, single messages first.
--   * Addresses are never stored: the Edge Function reads them at the moment of sending
--     (mail_claim, service role only) and they never reach the dashboard.
--   * The text is kept only while mails wait (at most keep_days), permanently only its hash;
--     templates only when the admin saves one (mail_templates).
--   * Attachments live in the private bucket mail-attachments (admins only, own folder); they are
--     removed when the campaign is done and at the latest after 24 hours (mail_purge).
--   * Suspended, banned and deleting accounts are never recipients (also not when they became so
--     after the campaign was created: mail_claim skips them).
--   * Every campaign, test and resume is logged in moderation_actions (purpose, count, subject,
--     hash of the text; never addresses). Admins with aal2 only; no client table rights.

create table if not exists public.mail_templates (
  id         uuid primary key default gen_random_uuid(),
  created_by uuid references public.profiles (id) on delete set null,
  name       text not null check (char_length(btrim(name)) between 1 and 80),
  category   text not null check (category in ('account', 'legal', 'operations', 'personal')),
  subject    text not null check (char_length(subject) between 1 and 150 and subject !~ '[\r\n]'),
  body       text not null check (char_length(body) between 1 and 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.mail_templates enable row level security;
revoke all on public.mail_templates from public, anon, authenticated;

create table if not exists public.mail_campaigns (
  id               uuid primary key default gen_random_uuid(),
  created_by       uuid references public.profiles (id) on delete set null,
  category         text not null check (category in ('account', 'legal', 'operations', 'personal')),
  audience         text not null check (audience in ('single', 'selected', 'all')),
  subject          text not null check (char_length(subject) between 1 and 150 and subject !~ '[\r\n]'),
  body_hash        text not null check (body_hash ~ '^[0-9a-f]{64}$'),
  -- Only while mails wait; null once the campaign is done (at most keep_days).
  body             text check (char_length(body) <= 10000),
  template_id      uuid references public.mail_templates (id) on delete set null,
  -- [{path, name, size, type}] while mails wait; emptied when done, at the latest after 24 hours.
  attachments      jsonb not null default '[]',
  attachment_count integer not null default 0 check (attachment_count between 0 and 3),
  recipient_count  integer not null check (recipient_count between 1 and 500),
  status           text not null default 'sending' check (status in ('sending', 'waiting', 'done')),
  stop_reason      text check (stop_reason ~ '^[a-z_]{1,40}$'),
  created_at       timestamptz not null default now(),
  finished_at      timestamptz
);
create index if not exists mail_campaigns_created_idx on public.mail_campaigns (created_at desc);
alter table public.mail_campaigns enable row level security;
revoke all on public.mail_campaigns from public, anon, authenticated;

-- One row per recipient: status only, never the address.
create table if not exists public.mail_recipients (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.mail_campaigns (id) on delete cascade,
  user_id     uuid references public.profiles (id) on delete set null,
  status      text not null default 'pending' check (status in ('pending', 'claimed', 'sent', 'failed', 'skipped')),
  error       text check (error ~ '^[a-z_]{1,40}$'),
  claimed_at  timestamptz,
  sent_at     timestamptz,
  unique (campaign_id, user_id)
);
create index if not exists mail_recipients_campaign_idx on public.mail_recipients (campaign_id, status);
create index if not exists mail_recipients_user_idx on public.mail_recipients (user_id);
alter table public.mail_recipients enable row level security;
revoke all on public.mail_recipients from public, anon, authenticated;

-- Test mails an admin sent to themself (content hash only); a campaign needs one with the same
-- content. Removed when used and after a day.
create table if not exists public.mail_tests (
  admin_id     uuid not null references public.profiles (id) on delete cascade,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  created_at   timestamptz not null default now(),
  primary key (admin_id, content_hash)
);
alter table public.mail_tests enable row level security;
revoke all on public.mail_tests from public, anon, authenticated;

-- Private bucket for attachments: admins only, each in their own folder ({admin_id}/...).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('mail-attachments', 'mail-attachments', false, 5242880, array['application/pdf', 'image/png', 'image/jpeg', 'text/plain'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "mail-attachments: admins read own" on storage.objects;
create policy "mail-attachments: admins read own" on storage.objects
  for select to authenticated
  using (bucket_id = 'mail-attachments' and public.is_admin() and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "mail-attachments: admins upload own" on storage.objects;
create policy "mail-attachments: admins upload own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'mail-attachments' and public.is_admin() and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "mail-attachments: admins delete own" on storage.objects;
create policy "mail-attachments: admins delete own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'mail-attachments' and public.is_admin() and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Limits, also used by the dashboard and the Edge Function (_shared/adminMail.ts has the same).
create or replace function public.mail_limits()
returns jsonb
language sql immutable set search_path = ''
as $$
  select jsonb_build_object(
    'max_recipients', 500, 'confirm_count_above', 5, 'subject_max', 150, 'body_max', 10000,
    'max_files', 3, 'max_total_bytes', 5242880, 'attachment_hours', 24, 'keep_days', 7, 'test_valid_minutes', 60,
    'categories', jsonb_build_array('account', 'legal', 'operations', 'personal')
  );
$$;

create or replace function public.mail_category_label(p_key text)
returns text
language sql immutable set search_path = ''
as $$
  select case p_key
    when 'account' then 'Konto und Sicherheit' when 'legal' then 'Rechtliches'
    when 'operations' then 'Betrieb und Wartung' when 'personal' then 'Persönliche Nachricht'
  end;
$$;

-- Category, subject and text are valid (the same rules as in the Edge Function). Internal.
create or replace function public.mail_check_content(p_category text, p_subject text, p_body text)
returns void
language plpgsql immutable set search_path = ''
as $$
begin
  if p_category is null or public.mail_category_label(p_category) is null then
    raise exception 'invalid_category';
  end if;
  if p_subject is null or char_length(btrim(p_subject)) = 0 or char_length(p_subject) > 150 or p_subject ~ '[\r\n]' then
    raise exception 'invalid_subject';
  end if;
  if p_body is null or char_length(btrim(p_body)) = 0 or char_length(p_body) > 10000 then
    raise exception 'invalid_body';
  end if;
end;
$$;

-- Checks attachment metadata ([{path, name, size, type}]): at most 3, together at most 5 MB, only
-- pdf/png/jpg/txt, clean names, all in the admin's own folder. The Edge Function checks the bytes
-- (file signature) itself before it sends anything. Internal.
create or replace function public.mail_check_attachments(p_admin uuid, p_attachments jsonb)
returns void
language plpgsql immutable set search_path = ''
as $$
declare
  item jsonb;
  total bigint := 0;
begin
  if p_attachments is null or jsonb_typeof(p_attachments) <> 'array' then
    raise exception 'invalid_attachments';
  end if;
  if jsonb_array_length(p_attachments) > 3 then
    raise exception 'too_many_attachments';
  end if;
  for item in select value from jsonb_array_elements(p_attachments) loop
    if jsonb_typeof(item) <> 'object'
      or coalesce(item ->> 'path', '') !~ ('^' || p_admin::text || '/[0-9a-f-]{36}/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$')
      or coalesce(item ->> 'name', '') !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\.(pdf|png|jpg|txt)$'
      or coalesce(item ->> 'type', '') not in ('application/pdf', 'image/png', 'image/jpeg', 'text/plain')
      or coalesce(item ->> 'size', '') !~ '^[0-9]{1,8}$' or (item ->> 'size')::bigint < 1 then
      raise exception 'invalid_attachments';
    end if;
    total := total + (item ->> 'size')::bigint;
  end loop;
  if total > 5242880 then
    raise exception 'attachments_too_large';
  end if;
end;
$$;

-- Hash of everything a recipient gets (category, subject, text, attachments). Internal.
create or replace function public.mail_content_hash(p_category text, p_subject text, p_body text, p_attachments jsonb)
returns text
language sql immutable set search_path = ''
as $$
  select public.legal_hash(
    coalesce(p_category, '') || E'\n--\n' || coalesce(p_subject, '') || E'\n--\n' || coalesce(p_body, '') || E'\n--\n'
    || coalesce((
      select string_agg((a ->> 'path') || ':' || (a ->> 'size'), '|' order by a ->> 'path')
      from jsonb_array_elements(case when jsonb_typeof(p_attachments) = 'array' then p_attachments else '[]'::jsonb end) a
    ), '')
  );
$$;

-- ---------------------------------------------------------------- dashboard (admins)
create or replace function public.admin_mail_settings()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.require_admin();
  return public.mail_limits() || jsonb_build_object(
    'active_accounts', (select count(*) from public.profiles p where public.account_is_active(p.id))
  );
end;
$$;

-- Accounts that can receive a notice (active only), by username or display name.
create or replace function public.admin_mail_candidates(p_query text)
returns table (user_id uuid, username text, display_name text)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  q text := btrim(coalesce(p_query, ''));
  pattern text := '%' || replace(replace(replace(btrim(coalesce(p_query, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%';
begin
  perform public.require_admin();
  if char_length(q) < 2 then
    return;
  end if;
  return query
  select p.id, p.username, p.display_name
  from public.profiles p
  where (p.username ilike pattern or p.display_name ilike pattern) and public.account_is_active(p.id)
  order by (p.username = lower(q)) desc, p.username
  limit 50;
end;
$$;

-- Creates a campaign and its recipients. Needs a test mail of exactly this content by the same
-- admin (at most test_valid_minutes old, used up here). single: exactly one person; selected: a
-- list; all: every active account (only with p_service_only, "nur Servicemitteilungen"). At most
-- 500; above 5 the typed count must match. Every chosen person must be able to receive it.
create or replace function public.admin_mail_create(
  p_category text, p_subject text, p_body text, p_audience text, p_user_ids uuid[], p_attachments jsonb,
  p_confirm_count integer, p_service_only boolean, p_template_id uuid default null
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  ids uuid[];
  n integer;
  files jsonb := coalesce(p_attachments, '[]'::jsonb);
  wanted_hash text;
  campaign uuid;
begin
  perform public.require_admin();
  perform public.mail_check_content(p_category, p_subject, p_body);
  perform public.mail_check_attachments(me, files);
  if p_audience is null or p_audience not in ('single', 'selected', 'all') then
    raise exception 'invalid_audience';
  end if;
  wanted_hash := public.mail_content_hash(p_category, btrim(p_subject), p_body, files);
  if not exists (
    select 1 from public.mail_tests t
    where t.admin_id = me and t.content_hash = wanted_hash
      and t.created_at > now() - make_interval(mins => (public.mail_limits() ->> 'test_valid_minutes')::integer)
  ) then
    raise exception 'test_required';
  end if;

  if p_audience = 'all' then
    if not coalesce(p_service_only, false) then
      raise exception 'service_only_required';
    end if;
    ids := array(select p.id from public.profiles p where public.account_is_active(p.id) order by p.id);
  else
    ids := array(select distinct x from unnest(coalesce(p_user_ids, '{}')) x where x is not null);
    if p_audience = 'single' and cardinality(ids) <> 1 then
      raise exception 'invalid_audience';
    end if;
    if exists (select 1 from unnest(ids) x where not public.account_is_active(x)) then
      raise exception 'recipient_not_allowed';
    end if;
  end if;
  n := cardinality(ids);
  if n = 0 then
    raise exception 'no_recipients';
  end if;
  if n > (public.mail_limits() ->> 'max_recipients')::integer then
    raise exception 'too_many_recipients' using hint = n::text;
  end if;
  if n > (public.mail_limits() ->> 'confirm_count_above')::integer and p_confirm_count is distinct from n then
    raise exception 'confirm_count_mismatch' using hint = n::text;
  end if;
  if p_template_id is not null and not exists (select 1 from public.mail_templates t where t.id = p_template_id) then
    raise exception 'template_not_found';
  end if;

  insert into public.mail_campaigns
    (created_by, category, audience, subject, body_hash, body, template_id, attachments, attachment_count, recipient_count)
  values (me, p_category, p_audience, btrim(p_subject), public.legal_hash(p_body), p_body, p_template_id,
          files, jsonb_array_length(files), n)
  returning id into campaign;
  insert into public.mail_recipients (campaign_id, user_id) select campaign, x from unnest(ids) x;
  delete from public.mail_tests t where t.admin_id = me and t.content_hash = wanted_hash;

  perform public.log_moderation_action(
    'mail_send', 'mail_campaign', campaign, case when p_audience = 'single' then ids[1] end, null,
    'E-Mail-Mitteilung: ' || public.mail_category_label(p_category), null,
    jsonb_build_object('category', p_category, 'audience', p_audience, 'recipients', n, 'subject', btrim(p_subject),
                       'text_hash', public.legal_hash(p_body), 'attachments', jsonb_array_length(files),
                       'template_id', p_template_id)
  );
  return campaign;
end;
$$;

-- Campaigns to (continue to) send: one, or every unfinished one (p_campaign_id null), single
-- messages first, then the oldest. Waiting ones (quota) go back to 'sending'; that is logged.
create or replace function public.admin_mail_resume(p_campaign_id uuid)
returns table (campaign_id uuid)
language plpgsql security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  resumed integer;
begin
  perform public.require_admin();
  if p_campaign_id is not null and not exists (
    select 1 from public.mail_campaigns c where c.id = p_campaign_id and c.status in ('sending', 'waiting')
  ) then
    raise exception 'campaign_not_open';
  end if;
  update public.mail_campaigns c set status = 'sending', stop_reason = null
  where c.status = 'waiting' and (p_campaign_id is null or c.id = p_campaign_id);
  get diagnostics resumed = row_count;
  if resumed > 0 then
    perform public.log_moderation_action(
      'mail_resume', 'mail_campaign', p_campaign_id, null, null, 'Wartende E-Mail-Mitteilungen weiter senden', null,
      jsonb_build_object('campaigns', resumed)
    );
  end if;
  return query
  select c.id from public.mail_campaigns c
  where c.status = 'sending' and (p_campaign_id is null or c.id = p_campaign_id)
  order by (c.audience = 'single') desc, c.created_at;
end;
$$;

-- Counts of one campaign's recipients. Internal.
create or replace function public.mail_campaign_counts(p_campaign uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'sent', count(*) filter (where r.status = 'sent'),
    'failed', count(*) filter (where r.status = 'failed'),
    'pending', count(*) filter (where r.status in ('pending', 'claimed')),
    'skipped', count(*) filter (where r.status = 'skipped')
  )
  from public.mail_recipients r where r.campaign_id = p_campaign;
$$;

-- History: newest first, with counts. No text, no addresses.
create or replace function public.admin_mail_campaigns(p_limit integer default 50, p_offset integer default 0)
returns table (
  id uuid, created_at timestamptz, finished_at timestamptz, category text, audience text, subject text,
  recipient_count integer, attachment_count integer, status text, stop_reason text, counts jsonb, created_by_username text
)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
begin
  perform public.require_admin();
  return query
  select c.id, c.created_at, c.finished_at, c.category, c.audience, c.subject, c.recipient_count, c.attachment_count,
         c.status, c.stop_reason, public.mail_campaign_counts(c.id), p.username
  from public.mail_campaigns c left join public.profiles p on p.id = c.created_by
  order by c.created_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

-- One campaign with the status of each recipient (username, never the address).
create or replace function public.admin_mail_campaign(p_campaign_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  result jsonb;
begin
  perform public.require_admin();
  select jsonb_build_object(
    'id', c.id, 'created_at', c.created_at, 'finished_at', c.finished_at, 'category', c.category,
    'audience', c.audience, 'subject', c.subject, 'body_hash', c.body_hash, 'recipient_count', c.recipient_count,
    'attachment_count', c.attachment_count, 'status', c.status, 'stop_reason', c.stop_reason,
    'counts', public.mail_campaign_counts(c.id),
    'recipients', coalesce((
      select jsonb_agg(jsonb_build_object('username', p.username, 'display_name', p.display_name,
                                          'status', r.status, 'error', r.error, 'sent_at', r.sent_at)
                       order by r.status, p.username nulls last)
      from public.mail_recipients r left join public.profiles p on p.id = r.user_id
      where r.campaign_id = c.id
    ), '[]'::jsonb)
  ) into result
  from public.mail_campaigns c where c.id = p_campaign_id;
  if result is null then
    raise exception 'campaign_not_found';
  end if;
  return result;
end;
$$;

-- Templates: saved only when the admin asks for it.
create or replace function public.admin_mail_templates()
returns table (id uuid, name text, category text, subject text, body text, updated_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
begin
  perform public.require_admin();
  return query select t.id, t.name, t.category, t.subject, t.body, t.updated_at from public.mail_templates t order by t.name;
end;
$$;

create or replace function public.admin_mail_save_template(p_id uuid, p_name text, p_category text, p_subject text, p_body text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  saved uuid;
begin
  perform public.require_admin();
  perform public.mail_check_content(p_category, p_subject, p_body);
  if p_name is null or char_length(btrim(p_name)) not between 1 and 80 then
    raise exception 'invalid_template_name';
  end if;
  if p_id is null and (select count(*) from public.mail_templates) >= 100 then
    raise exception 'too_many_templates';
  end if;
  if p_id is null then
    insert into public.mail_templates (created_by, name, category, subject, body)
    values (auth.uid(), btrim(p_name), p_category, btrim(p_subject), p_body)
    returning id into saved;
  else
    update public.mail_templates
    set name = btrim(p_name), category = p_category, subject = btrim(p_subject), body = p_body, updated_at = now()
    where id = p_id
    returning id into saved;
    if saved is null then
      raise exception 'template_not_found';
    end if;
  end if;
  return saved;
end;
$$;

create or replace function public.admin_mail_delete_template(p_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.require_admin();
  delete from public.mail_templates where id = p_id;
end;
$$;

-- ---------------------------------------------------------------- Edge Function (service role)
-- A test mail went out to the admin's own address: remember its content hash and log it.
create or replace function public.mail_record_test(
  p_admin uuid, p_category text, p_subject text, p_body text, p_attachments jsonb
)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.mail_check_content(p_category, p_subject, p_body);
  perform public.mail_check_attachments(p_admin, coalesce(p_attachments, '[]'::jsonb));
  if not exists (select 1 from public.admin_roles r where r.user_id = p_admin and r.role = 'admin') then
    raise exception 'not_authorized';
  end if;
  insert into public.mail_tests (admin_id, content_hash)
  values (p_admin, public.mail_content_hash(p_category, btrim(p_subject), p_body, coalesce(p_attachments, '[]'::jsonb)))
  on conflict (admin_id, content_hash) do update set created_at = now();
  insert into public.moderation_actions (actor_id, action, target_type, target_id, reason, details)
  values (p_admin, 'mail_test', 'mail_campaign', null, 'Testmail an die eigene Adresse',
          jsonb_build_object('category', p_category, 'subject', btrim(p_subject), 'text_hash', public.legal_hash(p_body),
                             'attachments', jsonb_array_length(coalesce(p_attachments, '[]'::jsonb))));
end;
$$;

-- What to send for one campaign (text and attachments only while it isn't done).
create or replace function public.mail_campaign_for_send(p_campaign uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('status', c.status, 'category', c.category, 'subject', c.subject, 'body', c.body,
                            'attachments', c.attachments, 'created_by', c.created_by)
  from public.mail_campaigns c where c.id = p_campaign;
$$;

-- The next recipients of a campaign with their address, read now from auth.users (at most
-- p_limit, max 100). Recipients whose account isn't active any more, is gone or has no address
-- are skipped. Claims older than 10 minutes (interrupted call) are handed out again.
create or replace function public.mail_claim(p_campaign uuid, p_limit integer)
returns table (recipient_id uuid, email text)
language plpgsql security definer set search_path = ''
as $$
#variable_conflict use_column
begin
  update public.mail_recipients r
  set status = 'skipped', error = case when r.user_id is null then 'account_deleted' else 'not_active' end, claimed_at = null
  where r.campaign_id = p_campaign and r.status = 'pending'
    and (r.user_id is null or not public.account_is_active(r.user_id));
  update public.mail_recipients r
  set status = 'skipped', error = 'no_address', claimed_at = null
  where r.campaign_id = p_campaign and r.status = 'pending'
    and not exists (select 1 from auth.users u where u.id = r.user_id and coalesce(u.email, '') <> '');
  return query
  with picked as (
    select r.id from public.mail_recipients r
    where r.campaign_id = p_campaign
      and (r.status = 'pending' or (r.status = 'claimed' and r.claimed_at < now() - interval '10 minutes'))
    order by r.id
    limit least(greatest(coalesce(p_limit, 0), 0), 100)
    for update skip locked
  ), claimed as (
    update public.mail_recipients r set status = 'claimed', claimed_at = now()
    from picked where r.id = picked.id
    returning r.id, r.user_id
  )
  select claimed.id, u.email::text from claimed join auth.users u on u.id = claimed.user_id;
end;
$$;

-- Outcome for claimed recipients: 'sent', 'failed' (with an error code) or 'pending' (back into
-- the queue, e.g. quota reached).
create or replace function public.mail_result(p_recipient_ids uuid[], p_status text, p_error text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if p_status not in ('sent', 'failed', 'pending') then
    raise exception 'invalid_status';
  end if;
  update public.mail_recipients r
  set status = p_status, claimed_at = null,
      sent_at = case when p_status = 'sent' then now() end,
      error = case when p_status = 'failed' then (case when p_error ~ '^[a-z_]{1,40}$' then p_error else 'send_failed' end) end
  where r.id = any (coalesce(p_recipient_ids, '{}')) and r.status = 'claimed';
end;
$$;

-- After a call: p_fail ends every open recipient with that error (e.g. attachments gone);
-- p_stop (quota, provider) puts the open ones back and sets the campaign 'waiting'. With nobody
-- open the campaign is done: text and attachment list are removed, the files to delete returned.
create or replace function public.mail_campaign_refresh(p_campaign uuid, p_stop text, p_fail text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  c public.mail_campaigns%rowtype;
  open_count integer;
  files jsonb := '[]';
begin
  select * into c from public.mail_campaigns x where x.id = p_campaign for update;
  if not found then
    raise exception 'campaign_not_found';
  end if;
  if p_fail is not null then
    update public.mail_recipients
    set status = 'failed', claimed_at = null, error = case when p_fail ~ '^[a-z_]{1,40}$' then p_fail else 'send_failed' end
    where campaign_id = p_campaign and status in ('pending', 'claimed');
  elsif p_stop is not null then
    update public.mail_recipients set status = 'pending', claimed_at = null
    where campaign_id = p_campaign and status = 'claimed';
  end if;
  select count(*) into open_count from public.mail_recipients r
  where r.campaign_id = p_campaign and r.status in ('pending', 'claimed');
  if open_count = 0 then
    files := coalesce((select jsonb_agg(a -> 'path') from jsonb_array_elements(c.attachments) a), '[]');
    update public.mail_campaigns
    set status = 'done', finished_at = coalesce(finished_at, now()), body = null, attachments = '[]', stop_reason = null
    where id = p_campaign;
  elsif p_stop is not null then
    update public.mail_campaigns
    set status = 'waiting', stop_reason = case when p_stop ~ '^[a-z_]{1,40}$' then p_stop else 'stopped' end
    where id = p_campaign;
  end if;
  return public.mail_campaign_counts(p_campaign)
    || jsonb_build_object('status', case when open_count = 0 then 'done' when p_stop is not null then 'waiting' else 'sending' end,
                          'files', files);
end;
$$;

-- Clean-up at every call of the Edge Function: attachments of campaigns older than 24 hours go
-- (their open recipients fail with attachments_expired), texts older than keep_days go (open
-- recipients fail with expired), uploads older than 24 hours go, old test marks go. Returns the
-- storage paths to delete.
create or replace function public.mail_purge()
returns text[]
language plpgsql security definer set search_path = ''
as $$
declare
  files text[] := '{}';
  c record;
begin
  for c in
    select x.id, x.attachments from public.mail_campaigns x
    where jsonb_array_length(x.attachments) > 0
      and x.created_at < now() - make_interval(hours => (public.mail_limits() ->> 'attachment_hours')::integer)
    for update
  loop
    files := files || array(select a ->> 'path' from jsonb_array_elements(c.attachments) a);
    update public.mail_recipients set status = 'failed', error = 'attachments_expired', claimed_at = null
    where campaign_id = c.id and status in ('pending', 'claimed');
    update public.mail_campaigns
    set attachments = '[]', body = null, status = 'done', finished_at = coalesce(finished_at, now()), stop_reason = null
    where id = c.id;
  end loop;
  for c in
    select x.id from public.mail_campaigns x
    where x.body is not null and x.created_at < now() - make_interval(days => (public.mail_limits() ->> 'keep_days')::integer)
    for update
  loop
    update public.mail_recipients set status = 'failed', error = 'expired', claimed_at = null
    where campaign_id = c.id and status in ('pending', 'claimed');
    update public.mail_campaigns
    set body = null, status = 'done', finished_at = coalesce(finished_at, now()), stop_reason = null
    where id = c.id;
  end loop;
  files := files || array(
    select o.name from storage.objects o
    where o.bucket_id = 'mail-attachments'
      and o.created_at < now() - make_interval(hours => (public.mail_limits() ->> 'attachment_hours')::integer)
  );
  delete from public.mail_tests where created_at < now() - interval '1 day';
  return array(select distinct f from unnest(files) f where f is not null);
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.mail_category_label(text)', 'public.mail_check_content(text, text, text)',
    'public.mail_check_attachments(uuid, jsonb)', 'public.mail_content_hash(text, text, text, jsonb)',
    'public.mail_campaign_counts(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'public.mail_limits()', 'public.admin_mail_settings()', 'public.admin_mail_candidates(text)',
    'public.admin_mail_create(text, text, text, text, uuid[], jsonb, integer, boolean, uuid)',
    'public.admin_mail_resume(uuid)', 'public.admin_mail_campaigns(integer, integer)', 'public.admin_mail_campaign(uuid)',
    'public.admin_mail_templates()', 'public.admin_mail_save_template(uuid, text, text, text, text)',
    'public.admin_mail_delete_template(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  -- Addresses and the queue: only the Edge Function with the service role.
  foreach f in array array[
    'public.mail_record_test(uuid, text, text, text, jsonb)', 'public.mail_campaign_for_send(uuid)',
    'public.mail_claim(uuid, integer)', 'public.mail_result(uuid[], text, text)',
    'public.mail_campaign_refresh(uuid, text, text)', 'public.mail_purge()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;


-- ================================================================ brand: logos and login design
-- Logos are stored as a checked JSON structure (shared/brand/logoSpec.ts), never as raw SVG;
-- animations are presets with parameters in fixed ranges (shared/brand/presets.ts). Each place a
-- logo appears ("target": app_login = app login screen, dashboard = dashboard login, loading
-- screen, sidebar) has one active logo; the logo brings its preset. app_design_config holds the
-- look of the app login screen. Clients have no table rights: everybody (also signed out) reads
-- only get_public_design_config(); admins (aal2) change things through functions, logged.

-- One number from a JSON value within a range (JSON has no NaN or Infinity). Internal.
create or replace function public.brand_number_between(p_value jsonb, p_min numeric, p_max numeric)
returns boolean
language sql immutable set search_path = ''
as $$
  select coalesce(jsonb_typeof(p_value) = 'number' and (p_value #>> '{}')::numeric between p_min and p_max, false);
$$;

-- Exactly the parameters of shared/brand/presets.ts, each within its range.
create or replace function public.brand_preset_params_valid(p jsonb)
returns boolean
language sql immutable set search_path = ''
as $$
  select coalesce(
    jsonb_typeof(p) = 'object'
    and p ?& array['duration', 'drawLine', 'drawPortion', 'strokeWidth', 'fill', 'fillMode', 'shine', 'shineWidth',
                   'shineAngle', 'wave', 'waveStrength', 'waveScale', 'dots', 'dotSpacing', 'dotRadius', 'dotGlowRadius',
                   'dotFade', 'breathe', 'breatheStrength', 'hold', 'exit', 'easing']
    and (select count(*) from jsonb_object_keys(p)) = 22
    and public.brand_number_between(p -> 'duration', 4, 16)
    and public.brand_number_between(p -> 'drawPortion', 0.1, 0.5)
    and public.brand_number_between(p -> 'strokeWidth', 1, 6)
    and public.brand_number_between(p -> 'shineWidth', 20, 120)
    and public.brand_number_between(p -> 'shineAngle', -30, 30)
    and public.brand_number_between(p -> 'waveStrength', 0.3, 1)
    and public.brand_number_between(p -> 'waveScale', 3, 8)
    and public.brand_number_between(p -> 'dotSpacing', 12, 28)
    and public.brand_number_between(p -> 'dotRadius', 0.8, 2.2)
    and public.brand_number_between(p -> 'dotGlowRadius', 1.2, 2.6)
    and public.brand_number_between(p -> 'dotFade', 0.2, 0.8)
    and public.brand_number_between(p -> 'breatheStrength', 0, 4)
    and public.brand_number_between(p -> 'hold', 0, 0.4)
    and jsonb_typeof(p -> 'drawLine') = 'boolean' and jsonb_typeof(p -> 'fill') = 'boolean'
    and jsonb_typeof(p -> 'shine') = 'boolean' and jsonb_typeof(p -> 'wave') = 'boolean'
    and jsonb_typeof(p -> 'dots') = 'boolean' and jsonb_typeof(p -> 'breathe') = 'boolean'
    and jsonb_typeof(p -> 'fillMode') = 'string' and p ->> 'fillMode' in ('fade', 'wipeUp', 'wipeLeft', 'bloom')
    and jsonb_typeof(p -> 'exit') = 'string' and p ->> 'exit' in ('fade', 'shrink', 'none')
    and jsonb_typeof(p -> 'easing') = 'string' and p ->> 'easing' in ('smooth', 'snappy', 'linear'),
    false);
$$;

create table if not exists public.animation_presets (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(btrim(name)) between 1 and 40),
  kind       text not null check (kind in ('builtin', 'custom')),
  params     jsonb not null check (public.brand_preset_params_valid(params)),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.animation_presets enable row level security;
revoke all on public.animation_presets from public, anon, authenticated;

-- ---------------------------------------------------------------- Animation v2 (presets)
-- A timeline with tracks (shared/brand/animation.ts). The same rules as validateAnimationSpec()
-- there; a test compares both on many valid and manipulated specs. v1 parameters stay readable
-- (spec_version 1); the clients convert them frame-exactly. New saves are always v2.

create or replace function public.brand_keys_only(p jsonb, p_allowed text[])
returns boolean
language sql immutable set search_path = ''
as $$
  select coalesce(jsonb_typeof(p) = 'object' and not exists (select 1 from jsonb_object_keys(p) k where k <> all (p_allowed)), false);
$$;

create or replace function public.brand_int_between(p jsonb, p_min numeric, p_max numeric)
returns boolean
language sql immutable set search_path = ''
as $$
  select coalesce(public.brand_number_between(p, p_min, p_max) and (p #>> '{}')::numeric = trunc((p #>> '{}')::numeric), false);
$$;

-- One easing of a keyframe segment: fixed kinds, numbers in fixed ranges.
create or replace function public.brand_easing_valid(e jsonb)
returns boolean
language sql immutable set search_path = ''
as $$
  select coalesce(
    jsonb_typeof(e) = 'object'
    and jsonb_typeof(e -> 'type') = 'string'
    and (not e ? 'reverse' or jsonb_typeof(e -> 'reverse') = 'boolean')
    and case e ->> 'type'
      when 'preset' then public.brand_keys_only(e, array['type', 'name', 'reverse'])
        and jsonb_typeof(e -> 'name') = 'string'
        and e ->> 'name' in ('linear', 'smooth', 'snappy', 'easeIn', 'easeOut', 'easeInOut', 'easeInStrong', 'easeOutStrong', 'easeInOutStrong')
      when 'bezier' then public.brand_keys_only(e, array['type', 'x1', 'y1', 'x2', 'y2', 'reverse'])
        and public.brand_number_between(e -> 'x1', 0, 1) and public.brand_number_between(e -> 'x2', 0, 1)
        and public.brand_number_between(e -> 'y1', -1, 2) and public.brand_number_between(e -> 'y2', -1, 2)
      when 'spring' then public.brand_keys_only(e, array['type', 'damping', 'frequency', 'reverse'])
        and public.brand_number_between(e -> 'damping', 0.2, 1) and public.brand_number_between(e -> 'frequency', 1, 6)
      when 'bounce' then public.brand_keys_only(e, array['type', 'bounces', 'damping', 'reverse'])
        and public.brand_int_between(e -> 'bounces', 1, 4) and public.brand_number_between(e -> 'damping', 0.2, 0.8)
      when 'hold' then public.brand_keys_only(e, array['type', 'reverse'])
      else false
    end,
    false);
$$;

-- Why an Animation v2 is refused (a short code), or null. Structure, ranges, at most 16 tracks
-- with 1 to 12 rising keyframes, one dot raster, 40 sparks, and the cost estimate within 160
-- (same weights as animationCost(), with the 24 shapes that are animated one by one at most).
create or replace function public.brand_animation_problem(p jsonb)
returns text
language plpgsql immutable set search_path = ''
as $$
declare
  tr jsonb;
  kf jsonb;
  tgt jsonb;
  stg jsonb;
  kind text;
  allowed text[];
  prev numeric;
  vmin numeric;
  vmax numeric;
  dots int := 0;
  sparks numeric := 0;
  cost numeric := 0;
  per_shape boolean := false;
  elements numeric;
  weight numeric;
  fields_ok boolean;
  shapes constant numeric := 24;
begin
  if p is null or jsonb_typeof(p) is distinct from 'object' then
    return 'not_object';
  end if;
  if char_length(p::text) > 80000 then
    return 'too_large';
  end if;
  if not public.brand_keys_only(p, array['version', 'duration', 'strokeWidth', 'tracks']) then
    return 'unknown_field';
  end if;
  if jsonb_typeof(p -> 'version') is distinct from 'number' or (p ->> 'version')::numeric <> 2 then
    return 'version';
  end if;
  if not public.brand_number_between(p -> 'duration', 2, 30) then
    return 'duration';
  end if;
  if not public.brand_number_between(p -> 'strokeWidth', 1, 6) then
    return 'stroke_width';
  end if;
  if jsonb_typeof(p -> 'tracks') is distinct from 'array' or jsonb_array_length(p -> 'tracks') not between 1 and 16 then
    return 'tracks';
  end if;

  for tr in select t.value from jsonb_array_elements(p -> 'tracks') t loop
    if jsonb_typeof(tr) is distinct from 'object' or jsonb_typeof(tr -> 'kind') is distinct from 'string' then
      return 'track';
    end if;
    kind := tr ->> 'kind';
    if kind not in ('draw', 'fill', 'shine', 'wave', 'dots', 'sparks', 'breathe', 'rotate', 'float', 'exit', 'color') then
      return 'track_kind';
    end if;
    allowed := array['kind', 'enabled', 'target', 'keyframes', 'stagger', 'repeat'] || case kind
      when 'fill' then array['variant']
      when 'shine' then array['width', 'angle', 'strength']
      when 'wave' then array['scale', 'grow']
      when 'dots' then array['variant', 'spacing', 'radius', 'glowRadius', 'fade']
      when 'sparks' then array['count', 'seed', 'size', 'distance']
      when 'float' then array['axis']
      when 'exit' then array['variant', 'layer', 'amount']
      when 'color' then array['from', 'to']
      else array[]::text[]
    end;
    if not public.brand_keys_only(tr, allowed) then
      return 'track_field';
    end if;
    if jsonb_typeof(tr -> 'enabled') is distinct from 'boolean' then
      return 'track_enabled';
    end if;

    tgt := tr -> 'target';
    if not coalesce(
      (tgt ->> 'type' = 'all' and public.brand_keys_only(tgt, array['type']))
      or (tgt ->> 'type' = 'shape' and public.brand_keys_only(tgt, array['type', 'index']) and public.brand_int_between(tgt -> 'index', 0, 99))
      or (tgt ->> 'type' = 'role' and public.brand_keys_only(tgt, array['type', 'role'])
          and jsonb_typeof(tgt -> 'role') = 'string' and tgt ->> 'role' in ('fill', 'cutout', 'stroke')),
      false) or jsonb_typeof(tgt -> 'type') is distinct from 'string' then
      return 'target';
    end if;

    stg := tr -> 'stagger';
    if not public.brand_keys_only(stg, array['mode', 'amount', 'seed'])
      or jsonb_typeof(stg -> 'mode') is distinct from 'string'
      or stg ->> 'mode' not in ('none', 'order', 'center', 'random')
      or not public.brand_number_between(stg -> 'amount', 0, 0.5)
      or not public.brand_int_between(stg -> 'seed', 0, 999999) then
      return 'stagger';
    end if;
    if not public.brand_int_between(tr -> 'repeat', 1, 4) then
      return 'repeat';
    end if;
    if kind in ('shine', 'wave', 'dots', 'sparks') and (tgt ->> 'type' <> 'all' or stg ->> 'mode' <> 'none') then
      return 'global_target';
    end if;

    if jsonb_typeof(tr -> 'keyframes') is distinct from 'array' or jsonb_array_length(tr -> 'keyframes') not between 1 and 12 then
      return 'keyframes';
    end if;
    vmin := case kind when 'breathe' then -0.1 when 'rotate' then -360 when 'float' then -30 else 0 end;
    vmax := case kind when 'breathe' then 0.1 when 'rotate' then 360 when 'float' then 30 else 1 end;
    prev := null;
    for kf in select k.value from jsonb_array_elements(tr -> 'keyframes') k loop
      if not public.brand_keys_only(kf, array['t', 'v', 'ease'])
        or not public.brand_number_between(kf -> 't', 0, 1)
        or (prev is not null and (kf ->> 't')::numeric <= prev)
        or not public.brand_number_between(kf -> 'v', vmin, vmax)
        or not public.brand_easing_valid(kf -> 'ease') then
        return 'keyframe';
      end if;
      prev := (kf ->> 't')::numeric;
    end loop;

    fields_ok := case kind
      when 'fill' then jsonb_typeof(tr -> 'variant') = 'string'
        and tr ->> 'variant' in ('fade', 'bloom', 'wipeUp', 'wipeDown', 'wipeLeft', 'wipeRight')
      when 'shine' then public.brand_number_between(tr -> 'width', 20, 120)
        and public.brand_number_between(tr -> 'angle', -30, 30) and public.brand_number_between(tr -> 'strength', 0.1, 0.8)
      when 'wave' then public.brand_number_between(tr -> 'scale', 3, 8) and public.brand_easing_valid(tr -> 'grow')
      when 'dots' then jsonb_typeof(tr -> 'variant') = 'string' and tr ->> 'variant' in ('glow', 'gradient')
        and public.brand_number_between(tr -> 'spacing', 12, 28) and public.brand_number_between(tr -> 'radius', 0.8, 2.2)
        and public.brand_number_between(tr -> 'glowRadius', 1.2, 2.6) and public.brand_number_between(tr -> 'fade', 0.2, 0.8)
      when 'sparks' then public.brand_int_between(tr -> 'count', 1, 40) and public.brand_int_between(tr -> 'seed', 0, 999999)
        and public.brand_number_between(tr -> 'size', 0.5, 3) and public.brand_number_between(tr -> 'distance', 0.2, 1.5)
      when 'float' then jsonb_typeof(tr -> 'axis') = 'string' and tr ->> 'axis' in ('x', 'y')
      when 'exit' then jsonb_typeof(tr -> 'variant') = 'string' and tr ->> 'variant' in ('fade', 'shrink')
        and jsonb_typeof(tr -> 'layer') = 'string' and tr ->> 'layer' in ('all', 'outline', 'fill')
        and public.brand_number_between(tr -> 'amount', 0.1, 1)
      when 'color' then jsonb_typeof(tr -> 'from') = 'string' and tr ->> 'from' in ('accent', 'accentLight', 'accentDark', 'neutral')
        and jsonb_typeof(tr -> 'to') = 'string' and tr ->> 'to' in ('accent', 'accentLight', 'accentDark', 'neutral')
      else true
    end;
    if not coalesce(fields_ok, false) then
      return 'track_value';
    end if;

    if kind = 'dots' then
      dots := dots + 1;
    end if;
    if kind = 'sparks' then
      sparks := sparks + (tr ->> 'count')::numeric;
    end if;
    if (tr -> 'enabled')::boolean then
      if kind = 'draw' then
        elements := shapes;
      elsif kind = 'sparks' then
        elements := (tr ->> 'count')::numeric;
      elsif tgt ->> 'type' <> 'all' or stg ->> 'mode' <> 'none' then
        per_shape := true;
        elements := case when tgt ->> 'type' = 'shape' then 1 else shapes end;
      else
        elements := 1;
      end if;
      weight := case kind
        when 'draw' then 1 when 'fill' then 2 when 'shine' then 4 when 'wave' then 6
        when 'dots' then case when tr ->> 'variant' = 'gradient' then 5 else 3 end
        when 'sparks' then 1 when 'color' then 2 else 1
      end;
      cost := cost + elements * weight;
    end if;
  end loop;

  if dots > 1 then
    return 'dots';
  end if;
  if sparks > 40 then
    return 'sparks';
  end if;
  if per_shape then
    cost := cost + shapes;
  end if;
  if cost > 160 then
    return 'cost';
  end if;
  return null;
end;
$$;

alter table public.animation_presets add column if not exists spec_version int not null default 1;
alter table public.animation_presets add column if not exists spec jsonb;
-- v2 presets keep their v1 parameters only as the source of the "Einfach" tab (or none).
alter table public.animation_presets alter column params drop not null;
alter table public.animation_presets drop constraint if exists animation_presets_params_check;
alter table public.animation_presets drop constraint if exists animation_presets_spec_check;
alter table public.animation_presets add constraint animation_presets_spec_check check (
  (spec_version = 1 and spec is null and public.brand_preset_params_valid(params))
  or (spec_version = 2 and public.brand_animation_problem(spec) is null
      and (params is null or public.brand_preset_params_valid(params)))
);

-- The last 10 saves of each custom preset ("Versionsverlauf"); restored through the editor.
create table if not exists public.preset_versions (
  id        uuid primary key default gen_random_uuid(),
  preset_id uuid not null references public.animation_presets (id) on delete cascade,
  version   int not null check (version >= 1),
  name      text not null check (char_length(btrim(name)) between 1 and 40),
  spec      jsonb not null check (public.brand_animation_problem(spec) is null),
  params    jsonb check (params is null or public.brand_preset_params_valid(params)),
  saved_at  timestamptz not null default now(),
  saved_by  uuid references public.profiles (id) on delete set null,
  unique (preset_id, version)
);
alter table public.preset_versions enable row level security;
revoke all on public.preset_versions from public, anon, authenticated;
create index if not exists preset_versions_preset_idx on public.preset_versions (preset_id, version desc);

create table if not exists public.logo_library (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null check (char_length(btrim(name)) between 1 and 40),
  kind                text not null check (kind in ('builtin', 'uploaded')),
  -- The checked structure only (never the SVG text); size limited.
  spec                jsonb not null check (jsonb_typeof(spec) = 'object' and octet_length(spec::text) <= 120000),
  preset_id           uuid not null references public.animation_presets (id) on delete restrict,
  source_hash         text check (source_hash ~ '^[0-9a-f]{64}$'),
  uploaded_by         uuid references public.profiles (id) on delete set null,
  created_at          timestamptz not null default now(),
  rights_confirmed_at timestamptz,
  check (kind = 'builtin' or rights_confirmed_at is not null)
);
alter table public.logo_library enable row level security;
revoke all on public.logo_library from public, anon, authenticated;

create table if not exists public.design_assignments (
  target     text primary key check (target in ('app_login', 'dashboard')),
  logo_id    uuid not null references public.logo_library (id) on delete restrict,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);
alter table public.design_assignments enable row level security;
revoke all on public.design_assignments from public, anon, authenticated;

-- Exactly one row (id is always true).
create table if not exists public.app_design_config (
  id              boolean primary key default true check (id),
  login_palette   text not null default 'bw' check (login_palette in ('color', 'bw')),
  login_mode      text not null default 'system' check (login_mode in ('system', 'light', 'dark')),
  login_animation text not null default 'on' check (login_animation in ('on', 'off')),
  updated_at      timestamptz not null default now(),
  updated_by      uuid references public.profiles (id) on delete set null
);
alter table public.app_design_config enable row level security;
revoke all on public.app_design_config from public, anon, authenticated;

-- Seeds: the built-in presets and logos (same values as shared/brand, checked by a test). Running
-- the file again restores their canonical values; custom presets and uploads are not touched.
insert into public.animation_presets (id, name, kind, params) values
  ('00000000-0000-4000-8000-00000000a001', 'Standard', 'builtin',
-- brand-seed:00000000-0000-4000-8000-00000000a001
   '{"duration":8,"drawLine":true,"drawPortion":0.3,"strokeWidth":2.4,"fill":true,"fillMode":"fade","shine":true,"shineWidth":50,"shineAngle":12,"wave":true,"waveStrength":0.95,"waveScale":6,"dots":true,"dotSpacing":18,"dotRadius":1.1,"dotGlowRadius":1.6,"dotFade":0.35,"breathe":true,"breatheStrength":2,"hold":0.2,"exit":"fade","easing":"smooth"}'::jsonb),
  ('00000000-0000-4000-8000-00000000a002', 'Ruhig', 'builtin',
-- brand-seed:00000000-0000-4000-8000-00000000a002
   '{"duration":10,"drawLine":false,"drawPortion":0.3,"strokeWidth":2.4,"fill":true,"fillMode":"fade","shine":false,"shineWidth":50,"shineAngle":12,"wave":false,"waveStrength":0.95,"waveScale":6,"dots":true,"dotSpacing":18,"dotRadius":1.1,"dotGlowRadius":1.6,"dotFade":0.35,"breathe":false,"breatheStrength":2,"hold":0.2,"exit":"fade","easing":"smooth"}'::jsonb),
  ('00000000-0000-4000-8000-00000000a003', 'Lebendig', 'builtin',
-- brand-seed:00000000-0000-4000-8000-00000000a003
   '{"duration":6,"drawLine":true,"drawPortion":0.3,"strokeWidth":2.4,"fill":true,"fillMode":"bloom","shine":true,"shineWidth":70,"shineAngle":12,"wave":true,"waveStrength":1,"waveScale":8,"dots":true,"dotSpacing":18,"dotRadius":1.1,"dotGlowRadius":1.6,"dotFade":0.35,"breathe":true,"breatheStrength":3,"hold":0.2,"exit":"fade","easing":"snappy"}'::jsonb),
  ('00000000-0000-4000-8000-00000000a004', 'Nur Zeichnen', 'builtin',
-- brand-seed:00000000-0000-4000-8000-00000000a004
   '{"duration":8,"drawLine":true,"drawPortion":0.5,"strokeWidth":2.4,"fill":false,"fillMode":"fade","shine":false,"shineWidth":50,"shineAngle":12,"wave":false,"waveStrength":0.95,"waveScale":6,"dots":true,"dotSpacing":18,"dotRadius":1.1,"dotGlowRadius":1.6,"dotFade":0.35,"breathe":false,"breatheStrength":2,"hold":0.2,"exit":"fade","easing":"smooth"}'::jsonb)
on conflict (id) do update set name = excluded.name, kind = 'builtin', params = excluded.params;

-- The built-in presets as Animation v2: frame for frame the same values as their v1 parameters
-- above (test "v1 presets as v2"); the parameters stay for the "Einfach" tab. Running the file
-- again restores them.
update public.animation_presets set spec_version = 2, spec =
-- brand-seed-v2:00000000-0000-4000-8000-00000000a001
   '{"version":2,"duration":8,"strokeWidth":2.4,"tracks":[{"enabled":true,"target":{"type":"all"},"stagger":{"mode":"none","amount":0,"seed":0},"repeat":1,"kind":"dots","variant":"glow","spacing":18,"radius":1.1,"glowRadius":1.6,"fade":0.35,"keyframes":[{"t":0,"v":0,"ease":{"type":"preset","name":"linear"}}]},{"enabled":true,"target":{"type":"all"},"stagger":{"mode":"none","amount":0,"seed":0},"repeat":1,"kind":"wave","scale":6,"grow":{"type":"bezier","x1":0.2,"y1":0.6,"x2":0.3,"y2":1},"keyframes":[{"t":0.4,"v":0,"ease":{"type":"preset","name":"linear"}},{"t":0.42,"v":0.95,"ease":{"type":"preset","name":"linear","reverse":true}},{"t":0.62,"v":0,"ease":{"type":"preset","name":"linear"}}]},{"enabled":true,"target":{"type":"all"},"stagger":{"mode":"none","amount":0,"seed":0},"repeat":1,"kind":"draw","keyframes":[{"t":0,"v":0,"ease":{"type":"bezier","x1":0.45,"y1":0,"x2":0.2,"y2":1}},{"t":0.3,"v":1,"ease":{"type":"preset","name":"linear"}}]},{"enabled":true,"target":{"type":"all"},"stagger":{"mode":"none","amount":0,"seed":0},"repeat":1,"kind":"fill","variant":"fade","keyframes":[{"t":0.25,"v":0,"ease":{"type":"bezier","x1":0,"y1":0,"x2":0.58,"y2":1}},{"t":0.42,"v":1,"ease":{"type":"preset","name":"linear"}}]},{"enabled":true,"target":{"type":"all"},"stagger":{"mode":"none","amount":0,"seed":0},"repeat":1,"kind":"exit","variant":"fade","layer":"outline","amount":0.4,"keyframes":[{"t":0.36,"v":0,"ease":{"type":"preset","name":"linear"}},{"t":0.48,"v":1,"ease":{"type":"preset","name":"linear"}}]},{"enabled":true,"target":{"type":"all"},"stagger":{"mode":"none","amount":0,"seed":0},"repeat":1,"kind":"shine","width":50,"angle":12,"strength":0.55,"keyframes":[{"t":0.42,"v":0,"ease":{"type":"bezier","x1":0.42,"y1":0,"x2":0.58,"y2":1}},{"t":0.62,"v":1,"ease":{"type":"preset","name":"linear"}}]},{"enabled":true,"target":{"type":"all"},"stagger":{"mode":"none","amount":0,"seed":0},"repeat":1,"kind":"breathe","keyframes":[{"t":0.5,"v":0,"ease":{"type":"bezier","x1":0.42,"y1":0,"x2":0.58,"y2":1}},{"t":0.65,"v":0.02,"ease":{"type":"bezier","x1":0.42,"y1":0,"x2":0.58,"y2":1,"reverse":true}},{"t":0.8,"v":0,"ease":{"type":"preset","name":"linear"}}]},{"enabled":true,"target":{"type":"all"},"stagger":{"mode":"none","amount":0,"seed":0},"repeat":1,"kind":"exit","variant":"fade","layer":"all","amount":0.4,"keyframes":[{"t":0.82,"v":0,"ease":{"type":"preset","name":"linear"}},{"t":0.95,"v":1,"ease":{"type":"preset","name":"linear"}}]}]}'::jsonb
where id = '00000000-0000-4000-8000-00000000a001';
update public.animation_presets set spec_version = 2, spec =
-- brand-seed-v2:00000000-0000-4000-8000-00000000a002
   '{"version":2,"duration":10,"strokeWidth":2.4,"tracks":[{"enabled":true,"target":{"type":"all"},"stagger":{"mode":"none","amount":0,"seed":0},"repeat":1,"kind":"dots","variant":"glow","spacing":18,"radius":1.1,"glowRadius":1.6,"fade":0.35,"keyframes":[{"t":0,"v":0,"ease":{"type":"preset","name":"linear"}}]},{"enabled":true,"target":{"type":"all"},"stagger":{"mode":"none","amount":0,"seed":0},"repeat":1,"kind":"fill","variant":"fade","keyframes":[{"t":0.25,"v":0,"ease":{"type":"bezier","x1":0,"y1":0,"x2":0.58,"y2":1}},{"t":0.42,"v":1,"ease":{"type":"preset","name":"linear"}}]},{"enabled":true,"target":{"type":"all"},"stagger":{"mode":"none","amount":0,"seed":0},"repeat":1,"kind":"exit","variant":"fade","layer":"all","amount":0.4,"keyframes":[{"t":0.82,"v":0,"ease":{"type":"preset","name":"linear"}},{"t":0.95,"v":1,"ease":{"type":"preset","name":"linear"}}]}]}'::jsonb
where id = '00000000-0000-4000-8000-00000000a002';
update public.animation_presets set spec_version = 2, spec =
-- brand-seed-v2:00000000-0000-4000-8000-00000000a003
   '{"version":2,"duration":6,"strokeWidth":2.4,"tracks":[{"enabled":true,"target":{"type":"all"},"stagger":{"mode":"none","amount":0,"seed":0},"repeat":1,"kind":"dots","variant":"glow","spacing":18,"radius":1.1,"glowRadius":1.6,"fade":0.35,"keyframes":[{"t":0,"v":0,"ease":{"type":"preset","name":"linear"}}]},{"enabled":true,"target":{"type":"all"},"stagger":{"mode":"none","amount":0,"seed":0},"repeat":1,"kind":"wave","scale":8,"grow":{"type":"bezier","x1":0.1,"y1":0.9,"x2":0.2,"y2":1},"keyframes":[{"t":0.4,"v":0,"ease":{"type":"preset","name":"linear"}},{"t":0.42,"v":1,"ease":{"type":"preset","name":"linear","reverse":true}},{"t":0.62,"v":0,"ease":{"type":"preset","name":"linear"}}]},{"enabled":true,"target":{"type":"all"},"stagger":{"mode":"none","amount":0,"seed":0},"repeat":1,"kind":"draw","keyframes":[{"t":0,"v":0,"ease":{"type":"bezier","x1":0.7,"y1":0,"x2":0.1,"y2":1}},{"t":0.3,"v":1,"ease":{"type":"preset","name":"linear"}}]},{"enabled":true,"target":{"type":"all"},"stagger":{"mode":"none","amount":0,"seed":0},"repeat":1,"kind":"fill","variant":"bloom","keyframes":[{"t":0.25,"v":0,"ease":{"type":"bezier","x1":0.16,"y1":1,"x2":0.3,"y2":1}},{"t":0.42,"v":1,"ease":{"type":"preset","name":"linear"}}]},{"enabled":true,"target":{"type":"all"},"stagger":{"mode":"none","amount":0,"seed":0},"repeat":1,"kind":"exit","variant":"fade","layer":"outline","amount":0.4,"keyframes":[{"t":0.36,"v":0,"ease":{"type":"preset","name":"linear"}},{"t":0.48,"v":1,"ease":{"type":"preset","name":"linear"}}]},{"enabled":true,"target":{"type":"all"},"stagger":{"mode":"none","amount":0,"seed":0},"repeat":1,"kind":"shine","width":70,"angle":12,"strength":0.55,"keyframes":[{"t":0.42,"v":0,"ease":{"type":"bezier","x1":0.65,"y1":0,"x2":0.35,"y2":1}},{"t":0.62,"v":1,"ease":{"type":"preset","name":"linear"}}]},{"enabled":true,"target":{"type":"all"},"stagger":{"mode":"none","amount":0,"seed":0},"repeat":1,"kind":"breathe","keyframes":[{"t":0.5,"v":0,"ease":{"type":"bezier","x1":0.65,"y1":0,"x2":0.35,"y2":1}},{"t":0.65,"v":0.03,"ease":{"type":"bezier","x1":0.65,"y1":0,"x2":0.35,"y2":1,"reverse":true}},{"t":0.8,"v":0,"ease":{"type":"preset","name":"linear"}}]},{"enabled":true,"target":{"type":"all"},"stagger":{"mode":"none","amount":0,"seed":0},"repeat":1,"kind":"exit","variant":"fade","layer":"all","amount":0.4,"keyframes":[{"t":0.82,"v":0,"ease":{"type":"preset","name":"linear"}},{"t":0.95,"v":1,"ease":{"type":"preset","name":"linear"}}]}]}'::jsonb
where id = '00000000-0000-4000-8000-00000000a003';
update public.animation_presets set spec_version = 2, spec =
-- brand-seed-v2:00000000-0000-4000-8000-00000000a004
   '{"version":2,"duration":8,"strokeWidth":2.4,"tracks":[{"enabled":true,"target":{"type":"all"},"stagger":{"mode":"none","amount":0,"seed":0},"repeat":1,"kind":"dots","variant":"glow","spacing":18,"radius":1.1,"glowRadius":1.6,"fade":0.35,"keyframes":[{"t":0,"v":0,"ease":{"type":"preset","name":"linear"}}]},{"enabled":true,"target":{"type":"all"},"stagger":{"mode":"none","amount":0,"seed":0},"repeat":1,"kind":"draw","keyframes":[{"t":0,"v":0,"ease":{"type":"bezier","x1":0.45,"y1":0,"x2":0.2,"y2":1}},{"t":0.413043,"v":1,"ease":{"type":"preset","name":"linear"}}]},{"enabled":true,"target":{"type":"all"},"stagger":{"mode":"none","amount":0,"seed":0},"repeat":1,"kind":"exit","variant":"fade","layer":"all","amount":0.4,"keyframes":[{"t":0.842609,"v":0,"ease":{"type":"preset","name":"linear"}},{"t":0.95,"v":1,"ease":{"type":"preset","name":"linear"}}]}]}'::jsonb
where id = '00000000-0000-4000-8000-00000000a004';

-- App-Logo: the shapes of assets/peakpic-icons/svg-quellen/default_bw.svg (without the square
-- background). Flamme: PLATZHALTER (the login screen used the Ionicons glyph, no vector file).
insert into public.logo_library (id, name, kind, spec, preset_id) values
  ('00000000-0000-4000-8000-00000000b001', 'App-Logo', 'builtin',
-- brand-seed:00000000-0000-4000-8000-00000000b001
   '{"version":1,"viewBox":[131,92,167,212],"shapes":[{"type":"path","d":"M148 128 C 158 108, 188 104, 202 122 C 218 142, 222 168, 210 190 C 202 204, 196 210, 202 220 C 214 228, 232 232, 250 244 C 236 250, 226 258, 224 268 C 206 250, 186 236, 172 218 C 160 202, 152 190, 150 170 C 149 156, 143 142, 148 128 Z","role":"fill","transform":[1,0,0,1,0,0]},{"type":"circle","cx":252,"cy":258,"r":34,"role":"fill","transform":[1,0,0,1,0,0]},{"type":"rect","x":242,"y":218,"width":20,"height":10,"rx":4,"ry":4,"role":"fill","transform":[1,0,0,1,0,0]},{"type":"circle","cx":252,"cy":258,"r":18,"role":"cutout","transform":[1,0,0,1,0,0]}]}'::jsonb,
   '00000000-0000-4000-8000-00000000a001'),
  ('00000000-0000-4000-8000-00000000b002', 'Flamme', 'builtin',
-- brand-seed:00000000-0000-4000-8000-00000000b002
   '{"version":1,"viewBox":[0,0,200,240],"shapes":[{"type":"path","d":"M104 8C112 52 168 84 168 150C168 200 136 228 100 228C64 228 32 200 32 150C32 112 56 92 72 66C78 84 88 96 98 98C92 70 94 36 104 8Z","role":"fill","transform":[1,0,0,1,0,0]},{"type":"path","d":"M100 150C112 168 122 180 122 194C122 208 112 216 100 216C88 216 78 208 78 194C78 180 88 168 100 150Z","role":"cutout","transform":[1,0,0,1,0,0]}]}'::jsonb,
   '00000000-0000-4000-8000-00000000a001')
on conflict (id) do update set name = excluded.name, kind = 'builtin', spec = excluded.spec;

insert into public.design_assignments (target, logo_id) values
  ('app_login', '00000000-0000-4000-8000-00000000b001'),
  ('dashboard', '00000000-0000-4000-8000-00000000b001')
on conflict (target) do nothing;

insert into public.app_design_config (id) values (true) on conflict (id) do nothing;

-- get_public_design_config() is defined after the colour sets (it includes them), see below.

-- Look of the app login screen ("Design" page). Admin with aal2; logged with before and after.
create or replace function public.set_app_design_config(p_palette text, p_mode text, p_animation text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  before public.app_design_config%rowtype;
begin
  perform public.require_admin();
  if p_palette is null or p_palette not in ('color', 'bw') then
    raise exception 'invalid_palette';
  end if;
  if p_mode is null or p_mode not in ('system', 'light', 'dark') then
    raise exception 'invalid_mode';
  end if;
  if p_animation is null or p_animation not in ('on', 'off') then
    raise exception 'invalid_animation';
  end if;
  insert into public.app_design_config (id) values (true) on conflict (id) do nothing;
  select * into before from public.app_design_config c where c.id for update;
  update public.app_design_config
  set login_palette = p_palette, login_mode = p_mode, login_animation = p_animation,
      updated_at = now(), updated_by = auth.uid()
  where id;
  perform public.log_moderation_action(
    'design_app_login', 'app_design_config', null, null, null, 'Design des App-Anmeldebildschirms geändert', null,
    jsonb_build_object(
      'before', jsonb_build_object('palette', before.login_palette, 'mode', before.login_mode, 'animation', before.login_animation),
      'after', jsonb_build_object('palette', p_palette, 'mode', p_mode, 'animation', p_animation)
    )
  );
end;
$$;

revoke all on function public.brand_number_between(jsonb, numeric, numeric) from public, anon, authenticated;
revoke all on function public.brand_preset_params_valid(jsonb) from public, anon, authenticated;
revoke all on function public.set_app_design_config(text, text, text) from public, anon;
grant execute on function public.set_app_design_config(text, text, text) to authenticated;


-- ---------------------------------------------------------------- logo library (phase 2)
-- The same rules as validateLogoSpec (shared/brand/logoSpec.ts), checked on every save, also when
-- the structure comes from the browser. A test compares both on manipulated structures.
create or replace function public.brand_logo_spec_valid(p jsonb)
returns boolean
language plpgsql immutable set search_path = ''
as $$
declare
  shape jsonb;
  t text;
  keys text[];
  m jsonb;
  d text;
  seg text[];
  arg_count integer;
  value_count integer;
  commands integer;
  total_commands integer := 0;
  total_path_chars integer := 0;
  n jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return false; end if;
  if exists (select 1 from jsonb_object_keys(p) k where k not in ('version', 'viewBox', 'shapes')) then return false; end if;
  if (p -> 'version') is distinct from '1'::jsonb then return false; end if;
  if jsonb_typeof(p -> 'viewBox') <> 'array' or jsonb_array_length(p -> 'viewBox') <> 4 then return false; end if;
  for n in select value from jsonb_array_elements(p -> 'viewBox') loop
    if not public.brand_number_between(n, -100000, 100000) then return false; end if;
  end loop;
  if (p -> 'viewBox' ->> 2)::numeric <= 0 or (p -> 'viewBox' ->> 3)::numeric <= 0 then return false; end if;
  if jsonb_typeof(p -> 'shapes') <> 'array' or jsonb_array_length(p -> 'shapes') = 0
    or jsonb_array_length(p -> 'shapes') > 100 then
    return false;
  end if;
  if not exists (
    select 1 from jsonb_array_elements(p -> 'shapes') s
    where jsonb_typeof(s.value) = 'object' and (s.value -> 'role') is distinct from '"cutout"'::jsonb
  ) then
    return false;
  end if;

  for shape in select value from jsonb_array_elements(p -> 'shapes') loop
    if jsonb_typeof(shape) <> 'object' then return false; end if;
    t := shape ->> 'type';
    if jsonb_typeof(shape -> 'type') is distinct from 'string' then return false; end if;
    keys := case t
      when 'path' then array['d']
      when 'circle' then array['cx', 'cy', 'r']
      when 'ellipse' then array['cx', 'cy', 'rx', 'ry']
      when 'rect' then array['x', 'y', 'width', 'height', 'rx', 'ry']
      when 'line' then array['x1', 'y1', 'x2', 'y2']
      when 'polygon' then array['points']
      when 'polyline' then array['points']
    end;
    if keys is null then return false; end if;
    if exists (
      select 1 from jsonb_object_keys(shape) k
      where k not in ('type', 'role', 'transform', 'strokeWidth', 'fillRule') and not (k = any (keys))
    ) then
      return false;
    end if;
    if jsonb_typeof(shape -> 'role') is distinct from 'string' or shape ->> 'role' not in ('fill', 'cutout', 'stroke') then return false; end if;
    m := shape -> 'transform';
    if jsonb_typeof(m) is distinct from 'array' or jsonb_array_length(m) <> 6
      or not public.brand_number_between(m -> 0, -1000, 1000) or not public.brand_number_between(m -> 1, -1000, 1000)
      or not public.brand_number_between(m -> 2, -1000, 1000) or not public.brand_number_between(m -> 3, -1000, 1000)
      or not public.brand_number_between(m -> 4, -100000, 100000) or not public.brand_number_between(m -> 5, -100000, 100000)
      or abs((m ->> 0)::numeric * (m ->> 3)::numeric - (m ->> 1)::numeric * (m ->> 2)::numeric) < 0.000000001 then
      return false;
    end if;
    if shape ? 'strokeWidth' and not public.brand_number_between(shape -> 'strokeWidth', 0.01, 1000) then return false; end if;
    if shape ? 'fillRule' and (jsonb_typeof(shape -> 'fillRule') <> 'string' or shape ->> 'fillRule' not in ('nonzero', 'evenodd')) then
      return false;
    end if;

    if t = 'path' then
      if jsonb_typeof(shape -> 'd') <> 'string' then return false; end if;
      d := shape ->> 'd';
      total_path_chars := total_path_chars + char_length(d);
      if total_path_chars > 100000 then return false; end if;
      if char_length(d) = 0 or char_length(d) > 20000 or d !~ '^[MmLlHhVvCcSsQqTtAaZz0-9 \t\n\r,.eE-]*$' then return false; end if;
      -- Every character belongs to a command letter, a number or a separator (as the tokenizer).
      if regexp_replace(d, '[MmLlHhVvCcSsQqTtAaZz]|-?([0-9]+\.?[0-9]*|\.[0-9]+)([eE]-?[0-9]+)?|[ \t\n\r,]+', '', 'g') <> '' then
        return false;
      end if;
      if d !~ '^[ \t\n\r,]*[Mm]' then return false; end if;
      if exists (
        select 1 from regexp_matches(d, '-?([0-9]+\.?[0-9]*|\.[0-9]+)([eE]-?[0-9]+)?', 'g') x
        where abs((x[1] || coalesce(x[2], ''))::numeric) > 100000
      ) then
        return false;
      end if;
      commands := 0;
      for seg in select regexp_matches(d, '([MmLlHhVvCcSsQqTtAaZz])([^MmLlHhVvCcSsQqTtAaZz]*)', 'g') loop
        commands := commands + 1;
        arg_count := case lower(seg[1]) when 'm' then 2 when 'l' then 2 when 'h' then 1 when 'v' then 1 when 'c' then 6
                                       when 's' then 4 when 'q' then 4 when 't' then 2 when 'a' then 7 else 0 end;
        select count(*) into value_count from regexp_matches(seg[2], '-?([0-9]+\.?[0-9]*|\.[0-9]+)([eE]-?[0-9]+)?', 'g');
        if arg_count = 0 then
          if value_count <> 0 then return false; end if;
        elsif value_count = 0 or value_count % arg_count <> 0 then
          return false;
        end if;
      end loop;
      if commands > 4000 then return false; end if;
      total_commands := total_commands + commands;
    elsif t in ('polygon', 'polyline') then
      if jsonb_typeof(shape -> 'points') is distinct from 'array' then return false; end if;
      value_count := jsonb_array_length(shape -> 'points');
      if value_count < 4 or value_count % 2 <> 0 or value_count > 4000 then return false; end if;
      for n in select value from jsonb_array_elements(shape -> 'points') loop
        if not public.brand_number_between(n, -100000, 100000) then return false; end if;
      end loop;
      total_commands := total_commands + value_count / 2;
    else
      for i in 1 .. cardinality(keys) loop
        if not public.brand_number_between(shape -> keys[i], -100000, 100000) then return false; end if;
      end loop;
      if t = 'circle' and (shape ->> 'r')::numeric <= 0 then return false; end if;
      if t = 'ellipse' and ((shape ->> 'rx')::numeric <= 0 or (shape ->> 'ry')::numeric <= 0) then return false; end if;
      if t = 'rect' and ((shape ->> 'width')::numeric <= 0 or (shape ->> 'height')::numeric <= 0
                         or (shape ->> 'rx')::numeric < 0 or (shape ->> 'ry')::numeric < 0) then
        return false;
      end if;
    end if;
    if total_commands > 8000 then return false; end if;
  end loop;
  return true;
exception when others then
  return false;
end;
$$;

-- Every stored logo has a valid structure (also the built-in ones, also direct inserts).
alter table public.logo_library drop constraint if exists logo_library_spec_check;
alter table public.logo_library add constraint logo_library_spec_check
  check (jsonb_typeof(spec) = 'object' and octet_length(spec::text) <= 250000 and public.brand_logo_spec_valid(spec));

-- Calls of the Edge Function logo_import (at most 10 per admin and hour). No client access.
create table if not exists public.logo_import_calls (
  admin_id   uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists logo_import_calls_admin_idx on public.logo_import_calls (admin_id, created_at desc);
alter table public.logo_import_calls enable row level security;
revoke all on public.logo_import_calls from public, anon, authenticated;

-- One import slot for the caller (logo_import calls it first with the admin's session).
create or replace function public.admin_logo_import_slot()
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.require_admin();
  delete from public.logo_import_calls where created_at < now() - interval '1 day';
  if (select count(*) from public.logo_import_calls c where c.admin_id = auth.uid() and c.created_at > now() - interval '1 hour') >= 10 then
    raise exception 'rate_limited';
  end if;
  insert into public.logo_import_calls (admin_id) values (auth.uid());
end;
$$;

-- For everybody, also signed out (dashboard login page, loading screen): the active logo of the
-- dashboard and its preset. Nothing else.
create or replace function public.get_dashboard_logo()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('logo', l.spec, 'preset', case when p.spec_version = 2 then p.spec else p.params end)
  from public.design_assignments a
  join public.logo_library l on l.id = a.logo_id
  join public.animation_presets p on p.id = l.preset_id
  where a.target = 'dashboard';
$$;

-- All logos with preset, targets where they are active, author and date. Admin.
create or replace function public.admin_logo_list()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.require_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', l.id, 'name', l.name, 'kind', l.kind, 'spec', l.spec, 'preset_id', l.preset_id, 'preset_name', p.name,
      'created_at', l.created_at, 'uploaded_by', u.username, 'rights_confirmed_at', l.rights_confirmed_at,
      'targets', coalesce((select jsonb_agg(a.target order by a.target) from public.design_assignments a where a.logo_id = l.id), '[]'::jsonb)
    ) order by l.kind, l.created_at)
    from public.logo_library l
    join public.animation_presets p on p.id = l.preset_id
    left join public.profiles u on u.id = l.uploaded_by
  ), '[]'::jsonb);
end;
$$;

-- Creates (p_id null) or changes a logo. The structure is checked again here. New uploads need the
-- confirmed rights (time stored), at most 30. Built-in logos: only the preset can change.
-- Logged with the file's hash and its cleaned name (never the file).
create or replace function public.admin_logo_save(
  p_id uuid, p_name text, p_spec jsonb, p_preset_id uuid, p_source_hash text, p_file_name text, p_rights_confirmed boolean
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  existing public.logo_library%rowtype;
  saved uuid;
  file_name text := left(regexp_replace(coalesce(p_file_name, ''), '[^A-Za-z0-9._ -]+', '_', 'g'), 100);
begin
  perform public.require_admin();
  if p_name is null or char_length(btrim(p_name)) not between 1 and 40 then
    raise exception 'invalid_name';
  end if;
  if not exists (select 1 from public.animation_presets pr where pr.id = p_preset_id) then
    raise exception 'preset_not_found';
  end if;
  if p_source_hash is not null and p_source_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_hash';
  end if;

  if p_id is null then
    if not public.brand_logo_spec_valid(p_spec) or octet_length(p_spec::text) > 250000 then
      raise exception 'invalid_logo';
    end if;
    if not coalesce(p_rights_confirmed, false) then
      raise exception 'rights_required';
    end if;
    if (select count(*) from public.logo_library l where l.kind = 'uploaded') >= 30 then
      raise exception 'too_many_logos';
    end if;
    insert into public.logo_library (name, kind, spec, preset_id, source_hash, uploaded_by, rights_confirmed_at)
    values (btrim(p_name), 'uploaded', p_spec, p_preset_id, p_source_hash, auth.uid(), now())
    returning id into saved;
    perform public.log_moderation_action(
      'logo_create', 'logo', saved, null, null, 'Logo in die Bibliothek aufgenommen', null,
      jsonb_build_object('name', btrim(p_name), 'source_hash', p_source_hash, 'file_name', nullif(file_name, ''),
                         'preset_id', p_preset_id, 'shapes', jsonb_array_length(p_spec -> 'shapes'))
    );
    return saved;
  end if;

  select * into existing from public.logo_library l where l.id = p_id for update;
  if not found then
    raise exception 'logo_not_found';
  end if;
  if existing.kind = 'builtin' then
    if p_spec is not null and p_spec is distinct from existing.spec then
      raise exception 'builtin_logo';
    end if;
    update public.logo_library set preset_id = p_preset_id where id = p_id;
  else
    if not public.brand_logo_spec_valid(p_spec) or octet_length(p_spec::text) > 250000 then
      raise exception 'invalid_logo';
    end if;
    update public.logo_library set name = btrim(p_name), spec = p_spec, preset_id = p_preset_id where id = p_id;
  end if;
  perform public.log_moderation_action(
    'logo_update', 'logo', p_id, null, null, 'Logo in der Bibliothek geändert', null,
    jsonb_build_object(
      'before', jsonb_build_object('name', existing.name, 'preset_id', existing.preset_id, 'shapes', jsonb_array_length(existing.spec -> 'shapes')),
      'after', jsonb_build_object('name', case when existing.kind = 'builtin' then existing.name else btrim(p_name) end,
                                  'preset_id', p_preset_id,
                                  'shapes', jsonb_array_length(coalesce(p_spec, existing.spec) -> 'shapes')),
      'spec_changed', existing.kind <> 'builtin' and p_spec is distinct from existing.spec
    )
  );
  return p_id;
end;
$$;

-- Deletes an uploaded logo that is not active anywhere. Built-in logos stay.
create or replace function public.admin_logo_delete(p_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  existing public.logo_library%rowtype;
begin
  perform public.require_admin();
  select * into existing from public.logo_library l where l.id = p_id for update;
  if not found then
    raise exception 'logo_not_found';
  end if;
  if existing.kind = 'builtin' then
    raise exception 'builtin_logo';
  end if;
  if exists (select 1 from public.design_assignments a where a.logo_id = p_id) then
    raise exception 'logo_active';
  end if;
  delete from public.logo_library where id = p_id;
  perform public.log_moderation_action(
    'logo_delete', 'logo', p_id, null, null, 'Logo aus der Bibliothek gelöscht', null,
    jsonb_build_object('name', existing.name, 'source_hash', existing.source_hash)
  );
end;
$$;

-- Makes a logo the active one of the given targets ('app_login', 'dashboard'). Logged with the
-- logo that was active before on each target.
create or replace function public.admin_logo_activate(p_logo_id uuid, p_targets text[])
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  targets text[] := array(select distinct x from unnest(coalesce(p_targets, '{}')) x order by x);
  before jsonb;
begin
  perform public.require_admin();
  if cardinality(targets) = 0 or exists (select 1 from unnest(targets) x where x not in ('app_login', 'dashboard')) then
    raise exception 'invalid_targets';
  end if;
  if not exists (select 1 from public.logo_library l where l.id = p_logo_id) then
    raise exception 'logo_not_found';
  end if;
  select coalesce(jsonb_object_agg(a.target, a.logo_id), '{}'::jsonb) into before
  from public.design_assignments a where a.target = any (targets);
  insert into public.design_assignments (target, logo_id, updated_at, updated_by)
  select x, p_logo_id, now(), auth.uid() from unnest(targets) x
  on conflict (target) do update set logo_id = excluded.logo_id, updated_at = excluded.updated_at, updated_by = excluded.updated_by;
  perform public.log_moderation_action(
    'logo_activate', 'logo', p_logo_id, null, null, 'Logo aktiviert', null,
    jsonb_build_object('targets', to_jsonb(targets), 'before', before,
                       'after', (select jsonb_object_agg(x, p_logo_id) from unnest(targets) x))
  );
end;
$$;

-- Presets with how many logos use them. Admin. v2 presets bring their spec (and, if made in the
-- "Einfach" tab, the v1 parameters); v1 presets only their parameters.
create or replace function public.admin_preset_list()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.require_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.name, 'kind', p.kind, 'spec_version', p.spec_version, 'spec', p.spec, 'params', p.params,
      'updated_at', p.updated_at,
      'used_by', (select count(*) from public.logo_library l where l.preset_id = p.id),
      'versions', (select count(*) from public.preset_versions v where v.preset_id = p.id)
    ) order by p.kind, p.name)
    from public.animation_presets p
  ), '[]'::jsonb);
end;
$$;

-- What the log keeps of a spec: its hash, duration and number of tracks (never the whole spec).
create or replace function public.brand_spec_summary(p_name text, p_spec jsonb)
returns jsonb
language sql immutable set search_path = ''
as $$
  select jsonb_build_object(
    'name', p_name,
    'spec_hash', case when p_spec is null then null else encode(sha256(convert_to(p_spec::text, 'UTF8')), 'hex') end,
    'duration', p_spec -> 'duration',
    'tracks', case when jsonb_typeof(p_spec -> 'tracks') = 'array' then jsonb_array_length(p_spec -> 'tracks') end
  );
$$;

drop function if exists public.admin_preset_save(uuid, text, jsonb);

-- Creates (p_id null: also "Duplizieren") or changes a custom preset: the Animation v2 is checked
-- again here (brand_animation_problem), the optional v1 parameters (tab "Einfach") as well.
-- Built-in presets never change; at most 50 custom presets. Every save becomes a version (the
-- last 10 per preset stay). Logged with before and after (name, hash of the spec).
create or replace function public.admin_preset_save(p_id uuid, p_name text, p_spec jsonb, p_params jsonb default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  existing public.animation_presets%rowtype;
  saved uuid;
  next_version int;
  problem text := public.brand_animation_problem(p_spec);
begin
  perform public.require_admin();
  if p_name is null or char_length(btrim(p_name)) not between 1 and 40 then
    raise exception 'invalid_name';
  end if;
  if problem is not null then
    raise exception 'invalid_spec' using detail = problem;
  end if;
  if p_params is not null and not public.brand_preset_params_valid(p_params) then
    raise exception 'invalid_params';
  end if;
  if p_id is null then
    if (select count(*) from public.animation_presets p where p.kind = 'custom') >= 50 then
      raise exception 'too_many_presets';
    end if;
    insert into public.animation_presets (name, kind, spec_version, spec, params, created_by)
    values (btrim(p_name), 'custom', 2, p_spec, p_params, auth.uid())
    returning id into saved;
    insert into public.preset_versions (preset_id, version, name, spec, params, saved_by)
    values (saved, 1, btrim(p_name), p_spec, p_params, auth.uid());
    perform public.log_moderation_action('preset_create', 'animation_preset', saved, null, null, 'Animations-Preset angelegt', null,
      jsonb_build_object('after', public.brand_spec_summary(btrim(p_name), p_spec)));
    return saved;
  end if;
  select * into existing from public.animation_presets p where p.id = p_id for update;
  if not found then
    raise exception 'preset_not_found';
  end if;
  if existing.kind = 'builtin' then
    raise exception 'builtin_preset';
  end if;
  update public.animation_presets
  set name = btrim(p_name), spec_version = 2, spec = p_spec, params = p_params, updated_at = now()
  where id = p_id;
  select coalesce(max(v.version), 0) + 1 into next_version from public.preset_versions v where v.preset_id = p_id;
  insert into public.preset_versions (preset_id, version, name, spec, params, saved_by)
  values (p_id, next_version, btrim(p_name), p_spec, p_params, auth.uid());
  delete from public.preset_versions v where v.preset_id = p_id and v.version <= next_version - 10;
  perform public.log_moderation_action('preset_update', 'animation_preset', p_id, null, null, 'Animations-Preset geändert', null,
    jsonb_build_object('before', public.brand_spec_summary(existing.name, coalesce(existing.spec, existing.params)),
                       'after', public.brand_spec_summary(btrim(p_name), p_spec), 'version', next_version));
  return p_id;
end;
$$;

-- The saved versions of a preset, newest first (at most 10). Admin.
create or replace function public.admin_preset_versions(p_preset_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.require_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', v.id, 'version', v.version, 'name', v.name, 'spec', v.spec, 'params', v.params,
      'saved_at', v.saved_at, 'saved_by', u.username
    ) order by v.version desc)
    from public.preset_versions v
    left join public.profiles u on u.id = v.saved_by
    where v.preset_id = p_preset_id
  ), '[]'::jsonb);
end;
$$;

-- Deletes a custom preset no logo uses.
create or replace function public.admin_preset_delete(p_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  existing public.animation_presets%rowtype;
begin
  perform public.require_admin();
  select * into existing from public.animation_presets p where p.id = p_id for update;
  if not found then
    raise exception 'preset_not_found';
  end if;
  if existing.kind = 'builtin' then
    raise exception 'builtin_preset';
  end if;
  if exists (select 1 from public.logo_library l where l.preset_id = p_id) then
    raise exception 'preset_in_use';
  end if;
  delete from public.animation_presets where id = p_id;
  perform public.log_moderation_action('preset_delete', 'animation_preset', p_id, null, null, 'Animations-Preset gelöscht', null,
    jsonb_build_object('name', existing.name));
end;
$$;

revoke all on function public.brand_logo_spec_valid(jsonb) from public, anon, authenticated;
revoke all on function public.brand_keys_only(jsonb, text[]) from public, anon, authenticated;
revoke all on function public.brand_int_between(jsonb, numeric, numeric) from public, anon, authenticated;
revoke all on function public.brand_easing_valid(jsonb) from public, anon, authenticated;
revoke all on function public.brand_animation_problem(jsonb) from public, anon, authenticated;
revoke all on function public.brand_spec_summary(text, jsonb) from public, anon, authenticated;
revoke all on function public.get_dashboard_logo() from public;
grant execute on function public.get_dashboard_logo() to anon, authenticated;
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.admin_logo_import_slot()', 'public.admin_logo_list()',
    'public.admin_logo_save(uuid, text, jsonb, uuid, text, text, boolean)', 'public.admin_logo_delete(uuid)',
    'public.admin_logo_activate(uuid, text[])', 'public.admin_preset_list()',
    'public.admin_preset_save(uuid, text, jsonb, jsonb)', 'public.admin_preset_delete(uuid)',
    'public.admin_preset_versions(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;


-- ---------------------------------------------------------------- colour sets ("Hauptfarben")
-- The accent of the palette "Hauptfarbe" for dark and light, plus chart colours; one active set
-- per target ('dashboard_colors', 'app_login_colors'). Readability is enforced here with the same
-- rules as shared/brand/colors.ts (compared by a test): accent at least 3:1 against every reference
-- background of its mode, text on the accent (#1b0f0a or #ffffff) at least 4.5:1, at most 8 chart
-- colours with at least 3:1 against the backgrounds of both modes. "Schwarz-Weiss" is independent.

-- Relative luminance (WCAG) of #rrggbb. Internal.
create or replace function public.brand_luminance(p_hex text)
returns double precision
language sql immutable set search_path = ''
as $$
  select 0.2126 * c[1] + 0.7152 * c[2] + 0.0722 * c[3]
  from (
    select array(
      select case when v <= 0.03928 then v / 12.92 else power((v + 0.055) / 1.055, 2.4) end
      from (select (('x' || substr(lower(p_hex), i, 2))::bit(8)::integer) / 255.0::double precision as v
            from unnest(array[2, 4, 6]) with ordinality as t(i, n) order by n) channels
    ) as c
  ) x;
$$;

create or replace function public.brand_contrast(p_a text, p_b text)
returns double precision
language sql immutable set search_path = ''
as $$
  select (greatest(public.brand_luminance(p_a), public.brand_luminance(p_b)) + 0.05)
       / (least(public.brand_luminance(p_a), public.brand_luminance(p_b)) + 0.05);
$$;

create or replace function public.brand_min_contrast(p_color text, p_backgrounds text[])
returns double precision
language sql immutable set search_path = ''
as $$
  select min(public.brand_contrast(p_color, bg)) from unnest(p_backgrounds) bg;
$$;

-- Text colour on an accent: the one of #1b0f0a and #ffffff with more contrast (tie: the dark one).
create or replace function public.brand_on_accent(p_accent text)
returns text
language sql immutable set search_path = ''
as $$
  select case when public.brand_contrast('#ffffff', p_accent) > public.brand_contrast('#1b0f0a', p_accent) then '#ffffff' else '#1b0f0a' end;
$$;

-- Why a colour set can't be used, or null. Same order and codes as colorSetProblem().
create or replace function public.brand_color_set_problem(p_dark text, p_light text, p_chart jsonb)
returns text
language plpgsql immutable set search_path = ''
as $$
declare
  dark_bg constant text[] := array['#09090b', '#111114', '#111113', '#1a1a1d'];
  light_bg constant text[] := array['#f7f7f5', '#fdfdfb', '#f2f2f4', '#fbfbfc'];
  c jsonb;
begin
  if p_dark is null or p_light is null or p_dark !~ '^#[0-9a-fA-F]{6}$' or p_light !~ '^#[0-9a-fA-F]{6}$' then
    return 'invalid_hex';
  end if;
  if public.brand_min_contrast(p_dark, dark_bg) < 3 then return 'accent_dark_contrast'; end if;
  if public.brand_min_contrast(p_light, light_bg) < 3 then return 'accent_light_contrast'; end if;
  if public.brand_contrast(public.brand_on_accent(p_dark), p_dark) < 4.5 then return 'on_accent_dark'; end if;
  if public.brand_contrast(public.brand_on_accent(p_light), p_light) < 4.5 then return 'on_accent_light'; end if;
  if p_chart is not null and p_chart <> 'null'::jsonb then
    if jsonb_typeof(p_chart) <> 'array' or jsonb_array_length(p_chart) > 8 then return 'invalid_chart'; end if;
    for c in select value from jsonb_array_elements(p_chart) loop
      if jsonb_typeof(c) <> 'string' or (c #>> '{}') !~ '^#[0-9a-fA-F]{6}$' then return 'invalid_chart'; end if;
    end loop;
    for c in select value from jsonb_array_elements(p_chart) loop
      if public.brand_min_contrast(c #>> '{}', dark_bg || light_bg) < 3 then return 'chart_contrast'; end if;
    end loop;
  end if;
  return null;
end;
$$;

create table if not exists public.brand_colors (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (char_length(btrim(name)) between 1 and 40),
  kind         text not null check (kind in ('builtin', 'custom')),
  accent_dark  text not null check (accent_dark ~ '^#[0-9a-f]{6}$'),
  accent_light text not null check (accent_light ~ '^#[0-9a-f]{6}$'),
  -- null: chart colours are derived from the accent.
  chart_colors jsonb check (chart_colors is null or (jsonb_typeof(chart_colors) = 'array' and jsonb_array_length(chart_colors) between 1 and 8)),
  created_at   timestamptz not null default now(),
  created_by   uuid references public.profiles (id) on delete set null,
  updated_at   timestamptz not null default now(),
  check (public.brand_color_set_problem(accent_dark, accent_light, chart_colors) is null)
);
alter table public.brand_colors enable row level security;
revoke all on public.brand_colors from public, anon, authenticated;

-- Built-in sets (same ids and values as shared/brand/colors.ts). "Orange" is the default.
insert into public.brand_colors (id, name, kind, accent_dark, accent_light) values
  ('00000000-0000-4000-8000-00000000c001', 'Orange', 'builtin', '#ff5a36', '#f2481f'),
  ('00000000-0000-4000-8000-00000000c002', 'Blau', 'builtin', '#4d9fff', '#1f6fd6'),
  ('00000000-0000-4000-8000-00000000c003', 'Grün', 'builtin', '#34c77b', '#14804a'),
  ('00000000-0000-4000-8000-00000000c004', 'Violett', 'builtin', '#a78bfa', '#7c3aed'),
  ('00000000-0000-4000-8000-00000000c005', 'Rot', 'builtin', '#ff6b6b', '#d62839')
on conflict (id) do update
  set name = excluded.name, kind = 'builtin', accent_dark = excluded.accent_dark,
      accent_light = excluded.accent_light, chart_colors = null;

-- Two more targets: the active colour set of the dashboard and of the app login. A target holds
-- either a logo or a colour set, never both.
alter table public.design_assignments alter column logo_id drop not null;
alter table public.design_assignments
  add column if not exists color_id uuid references public.brand_colors (id) on delete restrict;
alter table public.design_assignments drop constraint if exists design_assignments_target_check;
alter table public.design_assignments add constraint design_assignments_target_check
  check (target in ('app_login', 'dashboard', 'dashboard_colors', 'app_login_colors'));
alter table public.design_assignments drop constraint if exists design_assignments_kind_check;
alter table public.design_assignments add constraint design_assignments_kind_check
  check ((target in ('app_login', 'dashboard') and logo_id is not null and color_id is null)
      or (target in ('dashboard_colors', 'app_login_colors') and color_id is not null and logo_id is null));
insert into public.design_assignments (target, color_id) values
  ('dashboard_colors', '00000000-0000-4000-8000-00000000c001'),
  ('app_login_colors', '00000000-0000-4000-8000-00000000c001')
on conflict (target) do nothing;

-- The public fields of a colour set. Internal.
create or replace function public.brand_color_public(p_target text)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('name', b.name, 'accent_dark', b.accent_dark, 'accent_light', b.accent_light, 'chart_colors', b.chart_colors)
  from public.design_assignments a join public.brand_colors b on b.id = a.color_id
  where a.target = p_target;
$$;

-- For everybody, also signed out (the login screens): palette, mode, animation on/off, the active
-- logo of the app login screen and its preset, the active colour sets of the app login and of the
-- dashboard (name, two accents, chart colours). Nothing else (no ids, no people).
create or replace function public.get_public_design_config()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'palette', c.login_palette,
    'mode', c.login_mode,
    'animation', c.login_animation,
    'logo', l.spec,
    'preset', case when p.spec_version = 2 then p.spec else p.params end,
    'colors', public.brand_color_public('app_login_colors'),
    'dashboard_colors', public.brand_color_public('dashboard_colors')
  )
  from public.app_design_config c
  join public.design_assignments a on a.target = 'app_login'
  join public.logo_library l on l.id = a.logo_id
  join public.animation_presets p on p.id = l.preset_id
  where c.id;
$$;

-- All colour sets with the targets they are active on. Admin.
create or replace function public.admin_color_list()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.require_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', b.id, 'name', b.name, 'kind', b.kind, 'accent_dark', b.accent_dark, 'accent_light', b.accent_light,
      'chart_colors', b.chart_colors, 'created_at', b.created_at, 'created_by', u.username,
      'targets', coalesce((select jsonb_agg(a.target order by a.target) from public.design_assignments a where a.color_id = b.id), '[]'::jsonb)
    ) order by b.kind, b.created_at)
    from public.brand_colors b left join public.profiles u on u.id = b.created_by
  ), '[]'::jsonb);
end;
$$;

-- Creates (p_id null, also "Duplizieren") or changes a custom colour set: hex, contrast and number
-- checked; at most 20 custom sets; built-in sets never change. Logged with before and after.
create or replace function public.admin_color_save(p_id uuid, p_name text, p_dark text, p_light text, p_chart jsonb)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  existing public.brand_colors%rowtype;
  problem text;
  chart jsonb := case when p_chart is null or p_chart = 'null'::jsonb then null else p_chart end;
  saved uuid;
begin
  perform public.require_admin();
  if p_name is null or char_length(btrim(p_name)) not between 1 and 40 then
    raise exception 'invalid_name';
  end if;
  problem := public.brand_color_set_problem(p_dark, p_light, chart);
  if problem is not null then
    raise exception '%', problem;
  end if;
  if chart is not null then
    chart := (select jsonb_agg(lower(v #>> '{}')) from jsonb_array_elements(chart) v);
  end if;
  if p_id is null then
    if (select count(*) from public.brand_colors b where b.kind = 'custom') >= 20 then
      raise exception 'too_many_color_sets';
    end if;
    insert into public.brand_colors (name, kind, accent_dark, accent_light, chart_colors, created_by)
    values (btrim(p_name), 'custom', lower(p_dark), lower(p_light), chart, auth.uid())
    returning id into saved;
    perform public.log_moderation_action('color_create', 'brand_colors', saved, null, null, 'Farbsatz angelegt', null,
      jsonb_build_object('name', btrim(p_name), 'accent_dark', lower(p_dark), 'accent_light', lower(p_light), 'chart_colors', chart));
    return saved;
  end if;
  select * into existing from public.brand_colors b where b.id = p_id for update;
  if not found then
    raise exception 'color_set_not_found';
  end if;
  if existing.kind = 'builtin' then
    raise exception 'builtin_color_set';
  end if;
  update public.brand_colors
  set name = btrim(p_name), accent_dark = lower(p_dark), accent_light = lower(p_light), chart_colors = chart, updated_at = now()
  where id = p_id;
  perform public.log_moderation_action('color_update', 'brand_colors', p_id, null, null, 'Farbsatz geändert', null,
    jsonb_build_object(
      'before', jsonb_build_object('name', existing.name, 'accent_dark', existing.accent_dark, 'accent_light', existing.accent_light, 'chart_colors', existing.chart_colors),
      'after', jsonb_build_object('name', btrim(p_name), 'accent_dark', lower(p_dark), 'accent_light', lower(p_light), 'chart_colors', chart)));
  return p_id;
end;
$$;

-- Deletes a custom colour set that is not active anywhere.
create or replace function public.admin_color_delete(p_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  existing public.brand_colors%rowtype;
begin
  perform public.require_admin();
  select * into existing from public.brand_colors b where b.id = p_id for update;
  if not found then
    raise exception 'color_set_not_found';
  end if;
  if existing.kind = 'builtin' then
    raise exception 'builtin_color_set';
  end if;
  if exists (select 1 from public.design_assignments a where a.color_id = p_id) then
    raise exception 'color_set_active';
  end if;
  delete from public.brand_colors where id = p_id;
  perform public.log_moderation_action('color_delete', 'brand_colors', p_id, null, null, 'Farbsatz gelöscht', null,
    jsonb_build_object('name', existing.name, 'accent_dark', existing.accent_dark, 'accent_light', existing.accent_light));
end;
$$;

-- Makes a colour set active on the given targets ('dashboard_colors', 'app_login_colors').
create or replace function public.admin_color_activate(p_color_id uuid, p_targets text[])
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  targets text[] := array(select distinct x from unnest(coalesce(p_targets, '{}')) x order by x);
  before jsonb;
begin
  perform public.require_admin();
  if cardinality(targets) = 0 or exists (select 1 from unnest(targets) x where x not in ('dashboard_colors', 'app_login_colors')) then
    raise exception 'invalid_targets';
  end if;
  if not exists (select 1 from public.brand_colors b where b.id = p_color_id) then
    raise exception 'color_set_not_found';
  end if;
  select coalesce(jsonb_object_agg(a.target, a.color_id), '{}'::jsonb) into before
  from public.design_assignments a where a.target = any (targets);
  insert into public.design_assignments (target, color_id, updated_at, updated_by)
  select x, p_color_id, now(), auth.uid() from unnest(targets) x
  on conflict (target) do update set color_id = excluded.color_id, updated_at = excluded.updated_at, updated_by = excluded.updated_by;
  perform public.log_moderation_action('color_activate', 'brand_colors', p_color_id, null, null, 'Farbsatz aktiviert', null,
    jsonb_build_object('targets', to_jsonb(targets), 'before', before,
                       'after', (select jsonb_object_agg(x, p_color_id) from unnest(targets) x)));
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.brand_luminance(text)', 'public.brand_contrast(text, text)', 'public.brand_min_contrast(text, text[])',
    'public.brand_on_accent(text)', 'public.brand_color_set_problem(text, text, jsonb)', 'public.brand_color_public(text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'public.admin_color_list()', 'public.admin_color_save(uuid, text, text, text, jsonb)',
    'public.admin_color_delete(uuid)', 'public.admin_color_activate(uuid, text[])'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;
revoke all on function public.get_public_design_config() from public;
grant execute on function public.get_public_design_config() to anon, authenticated;


-- =============================================================================================
-- Surveys ("Umfragen") and official posts
-- =============================================================================================
-- A survey has up to 10 questions. Published surveys and their results are "official posts"
-- (survey_items) of the official account. Clients never touch these tables: everything goes
-- through the functions below, which return only what users may see (never e-mail addresses,
-- never who answered, never raw answers).
--
-- Anonymity: survey_participation knows WHO took part (to prevent taking part twice);
-- survey_responses / survey_answers know WHAT was answered, with a random id and only the day,
-- no user and no time of day. Nothing links the two. Deleting an account removes its
-- participation; the anonymous answers stay.
--
-- No background job: the state of a survey and the end of the feed/profile time are computed
-- from the timestamps on every read (survey_state).

create table if not exists public.surveys (
  id                      uuid primary key default gen_random_uuid(),
  title                   text not null check (char_length(btrim(title, E' \t\r\n')) between 3 and 120),
  topic                   text not null check (char_length(btrim(topic, E' \t\r\n')) between 10 and 1000),
  -- The state at the last write; readers always use survey_state() (computed from the times).
  status                  text not null default 'draft' check (status in ('draft', 'scheduled', 'active', 'closed', 'cancelled')),
  starts_at               timestamptz,
  ends_at                 timestamptz,
  cancelled_at            timestamptz,
  cancel_reason           text check (cancel_reason is null or char_length(btrim(cancel_reason)) between 10 and 500),
  cancel_keep_answers     boolean,
  pin_until_answered      boolean not null default false,
  allow_text              boolean not null default false,
  feed_days               integer not null default 7 check (feed_days between 1 and 90),
  -- null: "unbegrenzt" (only for the profile).
  profile_days            integer default 90 check (profile_days is null or profile_days between 1 and 3650),
  feed_until              timestamptz,
  profile_until           timestamptz,
  eligible_count_at_start integer check (eligible_count_at_start >= 0),
  eligible_count_at_close integer check (eligible_count_at_close >= 0),
  created_by              uuid references public.profiles (id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  published_at            timestamptz,
  check (ends_at is null or starts_at is null
         or (ends_at >= starts_at + interval '1 hour' and ends_at <= starts_at + interval '90 days')),
  check ((cancelled_at is null) = (cancel_reason is null) and (cancelled_at is null) = (cancel_keep_answers is null)),
  check (published_at is null or (starts_at is not null and ends_at is not null and feed_until is not null)),
  check (cancelled_at is null or published_at is not null)
);
alter table public.surveys enable row level security;
revoke all on public.surveys from public, anon, authenticated;
-- When the anonymous answers were deleted after the retention period (survey_purge_expired_answers).
alter table public.surveys add column if not exists answers_purged_at timestamptz;

-- Why a question can't be stored (a code), or null. The same rules as questionProblem() in
-- shared/surveys.ts (a test compares both). The question as JSON with the column names.
create or replace function public.survey_question_problem(q jsonb, p_allow_text boolean)
returns text
language plpgsql immutable set search_path = ''
as $$
declare
  kind text := q ->> 'kind';
  options jsonb := case when jsonb_typeof(q -> 'options') = 'null' then null else q -> 'options' end;
  n integer;
  ok boolean;
begin
  if jsonb_typeof(q) is distinct from 'object' then
    return 'invalid_kind';
  end if;
  if jsonb_typeof(q -> 'kind') is distinct from 'string' or kind not in ('single', 'multiple', 'scale', 'yes_no', 'text') then
    return 'invalid_kind';
  end if;
  if jsonb_typeof(q -> 'prompt') is distinct from 'string'
    or char_length(btrim(q ->> 'prompt', E' \t\r\n')) not between 3 and 200 then
    return 'invalid_prompt';
  end if;
  if jsonb_typeof(q -> 'required') is distinct from 'boolean' then
    return 'invalid_required';
  end if;
  if kind in ('single', 'multiple') then
    if jsonb_typeof(options) is distinct from 'array' then
      return 'invalid_options';
    end if;
    n := jsonb_array_length(options);
    if n not between 2 and 10 then
      return 'invalid_options';
    end if;
    if exists (select 1 from jsonb_array_elements(options) o
               where jsonb_typeof(o) <> 'string' or char_length(btrim(o #>> '{}', E' \t\r\n')) not between 1 and 80) then
      return 'invalid_options';
    end if;
    if (select count(distinct lower(btrim(o #>> '{}', E' \t\r\n'))) from jsonb_array_elements(options) o) <> n then
      return 'duplicate_options';
    end if;
  elsif options is not null then
    return 'invalid_options';
  end if;
  if kind = 'multiple' then
    if not public.brand_int_between(q -> 'max_choices', 1, n) then
      return 'invalid_max_choices';
    end if;
  elsif coalesce(jsonb_typeof(q -> 'max_choices'), 'null') <> 'null' then
    return 'invalid_max_choices';
  end if;
  if kind = 'scale' then
    ok := jsonb_typeof(q -> 'scale_min') = 'number' and jsonb_typeof(q -> 'scale_max') = 'number'
      and ((q ->> 'scale_min')::numeric, (q ->> 'scale_max')::numeric) in ((1, 5), (1, 10), (0, 10));
    if not coalesce(ok, false) then
      return 'invalid_scale';
    end if;
  elsif coalesce(jsonb_typeof(q -> 'scale_min'), 'null') <> 'null' or coalesce(jsonb_typeof(q -> 'scale_max'), 'null') <> 'null' then
    return 'invalid_scale';
  end if;
  if kind = 'text' then
    if not coalesce(p_allow_text, false) then
      return 'text_not_allowed';
    end if;
    if not public.brand_int_between(q -> 'text_max', 20, 280) then
      return 'invalid_text_max';
    end if;
  elsif coalesce(jsonb_typeof(q -> 'text_max'), 'null') <> 'null' then
    return 'invalid_text_max';
  end if;
  return null;
end;
$$;

create table if not exists public.survey_questions (
  id          uuid primary key default gen_random_uuid(),
  survey_id   uuid not null references public.surveys (id) on delete cascade,
  -- 0..9: at most 10 questions per survey.
  position    integer not null check (position between 0 and 9),
  kind        text not null check (kind in ('single', 'multiple', 'scale', 'yes_no', 'text')),
  prompt      text not null,
  required    boolean not null default true,
  options     jsonb,
  max_choices integer,
  scale_min   integer,
  scale_max   integer,
  text_max    integer,
  unique (survey_id, position),
  -- Free text is allowed here; whether the survey allows it is checked when saving and publishing.
  check (public.survey_question_problem(jsonb_build_object(
    'kind', kind, 'prompt', prompt, 'required', required, 'options', options, 'max_choices', max_choices,
    'scale_min', scale_min, 'scale_max', scale_max, 'text_max', text_max), true) is null)
);
alter table public.survey_questions enable row level security;
revoke all on public.survey_questions from public, anon, authenticated;

-- Images (bucket survey-media) and logos (from the logo library). scope 'survey': shown with the
-- survey; 'results': chosen for a results post (copied into its snapshot).
create table if not exists public.survey_media (
  id           uuid primary key default gen_random_uuid(),
  survey_id    uuid not null references public.surveys (id) on delete cascade,
  scope        text not null default 'survey' check (scope in ('survey', 'results')),
  kind         text not null check (kind in ('image', 'logo')),
  storage_path text unique check (storage_path ~ '^survey/[0-9a-f-]{36}/[a-z]+-[0-9a-f-]{36}\.(png|jpg|webp)$'),
  logo_id      uuid references public.logo_library (id) on delete restrict,
  alt_text     text not null check (char_length(btrim(alt_text)) between 1 and 140),
  position     integer not null check (position between 0 and 6),
  width        integer check (width between 1 and 1600),
  height       integer check (height between 1 and 1600),
  bytes        integer check (bytes between 1 and 2097152),
  created_at   timestamptz not null default now(),
  check ((kind = 'image') = (storage_path is not null and width is not null and height is not null and bytes is not null)),
  check ((kind = 'logo') = (logo_id is not null)),
  check (storage_path is null or split_part(storage_path, '/', 2) = survey_id::text)
);
alter table public.survey_media enable row level security;
revoke all on public.survey_media from public, anon, authenticated;
create index if not exists survey_media_survey_idx on public.survey_media (survey_id, scope, position);

-- Who took part (prevents taking part twice). Never linked to the answers.
create table if not exists public.survey_participation (
  survey_id    uuid not null references public.surveys (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  submitted_at timestamptz not null default now(),
  primary key (survey_id, user_id)
);
alter table public.survey_participation enable row level security;
revoke all on public.survey_participation from public, anon, authenticated;
create index if not exists survey_participation_user_idx on public.survey_participation (user_id);

-- The anonymous answers: a random id and the day (no user, no time of day).
create table if not exists public.survey_responses (
  id            uuid primary key default gen_random_uuid(),
  survey_id     uuid not null references public.surveys (id) on delete cascade,
  submitted_day date not null
);
alter table public.survey_responses enable row level security;
revoke all on public.survey_responses from public, anon, authenticated;
create index if not exists survey_responses_survey_idx on public.survey_responses (survey_id);

create table if not exists public.survey_answers (
  response_id uuid not null references public.survey_responses (id) on delete cascade,
  question_id uuid not null references public.survey_questions (id) on delete cascade,
  value       jsonb not null check (octet_length(value::text) <= 2000),
  -- Free text hidden by an admin in the evaluation (the answer itself never changes).
  hidden      boolean not null default false,
  primary key (response_id, question_id)
);
alter table public.survey_answers enable row level security;
revoke all on public.survey_answers from public, anon, authenticated;
create index if not exists survey_answers_question_idx on public.survey_answers (question_id);

-- Official posts: the survey itself and published results (with their fixed snapshot).
create table if not exists public.survey_items (
  id                 uuid primary key default gen_random_uuid(),
  kind               text not null check (kind in ('survey', 'results')),
  survey_id          uuid not null references public.surveys (id) on delete cascade,
  published_at       timestamptz not null,
  feed_until         timestamptz not null,
  -- null: shown in the profile without end.
  profile_until      timestamptz,
  pin_until_answered boolean not null default false,
  status             text not null default 'visible' check (status in ('visible', 'withdrawn')),
  withdrawn_at       timestamptz,
  snapshot           jsonb check (snapshot is null or octet_length(snapshot::text) <= 200000),
  created_by         uuid references public.profiles (id) on delete set null,
  created_at         timestamptz not null default now(),
  check ((kind = 'results') = (snapshot is not null)),
  check ((status = 'withdrawn') = (withdrawn_at is not null)),
  check (feed_until > published_at and (profile_until is null or profile_until > published_at))
);
alter table public.survey_items enable row level security;
revoke all on public.survey_items from public, anon, authenticated;
create unique index if not exists survey_items_one_survey_post on public.survey_items (survey_id) where kind = 'survey';
create index if not exists survey_items_published_idx on public.survey_items (published_at desc);

-- Per account and official post: first seen, hidden, answered (reach, "first time on top").
-- Written only through functions; every account reads only its own rows.
create table if not exists public.survey_item_views (
  item_id       uuid not null references public.survey_items (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  first_seen_at timestamptz,
  dismissed_at  timestamptz,
  answered_at   timestamptz,
  primary key (item_id, user_id)
);
alter table public.survey_item_views enable row level security;
revoke all on public.survey_item_views from public, anon, authenticated;
grant select on public.survey_item_views to authenticated;
drop policy if exists "survey_item_views: owner reads" on public.survey_item_views;
create policy "survey_item_views: owner reads" on public.survey_item_views
  for select to authenticated using (user_id = (select auth.uid()));
create index if not exists survey_item_views_user_idx on public.survey_item_views (user_id);

-- Statistics counters per survey (or none: whole-feature events), day and event. No user id.
-- "Abgeschickt" never comes from here but from survey_participation.
create table if not exists public.survey_counters (
  survey_id uuid references public.surveys (id) on delete cascade,
  scope_key uuid generated always as (coalesce(survey_id, '00000000-0000-0000-0000-000000000000'::uuid)) stored,
  day       date not null,
  event     text not null check (event in ('card_shown', 'card_opened', 'started', 'dismissed', 'results_shown',
                                           'results_opened', 'profile_tab_opened', 'settings_list_opened')),
  count     bigint not null default 0 check (count >= 0),
  primary key (scope_key, day, event)
);
alter table public.survey_counters enable row level security;
revoke all on public.survey_counters from public, anon, authenticated;

-- Global rate of counter events per minute (protects against floods; nothing about the caller).
create table if not exists public.survey_event_rate (
  minute timestamptz primary key,
  count  integer not null default 0
);
alter table public.survey_event_rate enable row level security;
revoke all on public.survey_event_rate from public, anon, authenticated;

-- ---------------------------------------------------------------- guards

-- Questions, title, topic and free text are fixed once the first answer is in (also for the
-- service role). Still possible afterwards: extending the end, cancelling, exchanging images.
create or replace function public.survey_guard_questions()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  target uuid := case when tg_op = 'DELETE' then old.survey_id else new.survey_id end;
begin
  if exists (select 1 from public.survey_responses r where r.survey_id = target)
    and exists (select 1 from public.surveys s where s.id = target) then
    raise exception 'survey_locked';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
drop trigger if exists survey_questions_guard on public.survey_questions;
create trigger survey_questions_guard
  before insert or update or delete on public.survey_questions
  for each row execute function public.survey_guard_questions();

create or replace function public.survey_guard_update()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if (new.title, new.topic, new.allow_text, new.starts_at) is distinct from (old.title, old.topic, old.allow_text, old.starts_at)
    and exists (select 1 from public.survey_responses r where r.survey_id = old.id) then
    raise exception 'survey_locked';
  end if;
  return new;
end;
$$;
drop trigger if exists surveys_guard_update on public.surveys;
create trigger surveys_guard_update
  before update on public.surveys
  for each row execute function public.survey_guard_update();

-- Answers never change (only the "hidden" mark of the evaluation); responses never change.
create or replace function public.survey_guard_answers()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_table_name = 'survey_responses' or (new.response_id, new.question_id, new.value) is distinct from (old.response_id, old.question_id, old.value) then
    raise exception 'answers_are_final';
  end if;
  return new;
end;
$$;
drop trigger if exists survey_answers_final on public.survey_answers;
create trigger survey_answers_final before update on public.survey_answers
  for each row execute function public.survey_guard_answers();
drop trigger if exists survey_responses_final on public.survey_responses;
create trigger survey_responses_final before update on public.survey_responses
  for each row execute function public.survey_guard_answers();

-- The snapshot of a results post and what it belongs to never change; only withdrawing does.
create or replace function public.survey_guard_items()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if (new.kind, new.survey_id, new.snapshot, new.published_at) is distinct from (old.kind, old.survey_id, old.snapshot, old.published_at) then
    raise exception 'item_is_final';
  end if;
  return new;
end;
$$;
drop trigger if exists survey_items_final on public.survey_items;
create trigger survey_items_final before update on public.survey_items
  for each row execute function public.survey_guard_items();

-- At most 4 images and 3 logos per survey and scope.
create or replace function public.survey_guard_media()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.kind = 'image' and (select count(*) from public.survey_media m
                             where m.survey_id = new.survey_id and m.scope = new.scope and m.kind = 'image' and m.id <> new.id) >= 4 then
    raise exception 'too_many_images';
  end if;
  if new.kind = 'logo' and (select count(*) from public.survey_media m
                            where m.survey_id = new.survey_id and m.scope = new.scope and m.kind = 'logo' and m.id <> new.id) >= 3 then
    raise exception 'too_many_logos';
  end if;
  return new;
end;
$$;
drop trigger if exists survey_media_limits on public.survey_media;
create trigger survey_media_limits before insert or update on public.survey_media
  for each row execute function public.survey_guard_media();

-- The official account can't be written to: user messages into a chat with it are refused
-- (server cards such as tag notices are not user messages and stay possible).
create or replace function public.guard_official_messages()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.kind is null and not public.is_official(new.sender_id) and exists (
    select 1 from public.conversation_members m
    where m.conversation_id = new.conversation_id and public.is_official(m.user_id)
  ) then
    raise exception 'chat_not_possible';
  end if;
  return new;
end;
$$;
drop trigger if exists messages_official_guard on public.messages;
create trigger messages_official_guard before insert on public.messages
  for each row execute function public.guard_official_messages();

-- Nobody can block the official account (its posts reach every account). Blocks that existed
-- before it became official are removed.
create or replace function public.guard_official_block()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if public.is_official(new.blocked_id) then
    raise exception 'block_not_possible';
  end if;
  return new;
end;
$$;
drop trigger if exists user_blocks_official_guard on public.user_blocks;
create trigger user_blocks_official_guard before insert on public.user_blocks
  for each row execute function public.guard_official_block();
delete from public.user_blocks b where public.is_official(b.blocked_id);

-- The official account's id for the app (to hide "Folgen", "Nachricht" and "Blockieren" and
-- show the badge). Only the id, null when there is none.
create or replace function public.get_official_account_id()
returns uuid
language sql stable security definer set search_path = ''
as $$
  select case when auth.uid() is not null then public.official_user_id() end;
$$;

-- ---------------------------------------------------------------- state and visibility

-- The state at p_at from the timestamps: active from the start (inclusive) until the end
-- (exclusive), unless cancelled. Same as surveyState() in shared/surveys.ts.
create or replace function public.survey_state(p_published_at timestamptz, p_starts_at timestamptz, p_ends_at timestamptz,
                                               p_cancelled_at timestamptz, p_at timestamptz)
returns text
language sql immutable set search_path = ''
as $$
  select case
    when p_cancelled_at is not null then 'cancelled'
    when p_published_at is null or p_starts_at is null or p_ends_at is null then 'draft'
    when p_at < p_starts_at then 'scheduled'
    when p_at < p_ends_at then 'active'
    else 'closed'
  end;
$$;

create or replace function public.survey_state_of(p_survey uuid)
returns text
language sql stable security definer set search_path = ''
as $$
  select public.survey_state(s.published_at, s.starts_at, s.ends_at, s.cancelled_at, now()) from public.surveys s where s.id = p_survey;
$$;

-- Accounts that can take part: active, not the official account.
create or replace function public.survey_eligible_count()
returns integer
language sql stable security definer set search_path = ''
as $$
  select count(*)::integer from public.profiles p
  where public.account_is_active(p.id) and p.id is distinct from public.official_user_id();
$$;

-- Official posts exist for the caller at all: active account, an official account that is
-- active and not blocked in either direction.
create or replace function public.official_visible_to_me()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null
    and public.is_account_active()
    and public.official_user_id() is not null
    and public.account_is_active(public.official_user_id())
    and not public.is_blocked_between(auth.uid(), public.official_user_id());
$$;

-- Is an official post visible to the caller? scope 'feed' (within feed_until), 'profile'
-- (within profile_until), 'any' (feed, profile, or a running survey in the settings). Survey
-- posts of cancelled surveys and withdrawn posts are never visible.
create or replace function public.survey_item_visible(p_item uuid, p_scope text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.official_visible_to_me() and exists (
    select 1 from public.survey_items i join public.surveys s on s.id = i.survey_id
    where i.id = p_item and i.status = 'visible' and i.published_at <= now()
      and (i.kind = 'results' or s.cancelled_at is null)
      and case p_scope
        when 'feed' then now() < i.feed_until
        when 'profile' then i.profile_until is null or now() < i.profile_until
        else now() < i.feed_until or i.profile_until is null or now() < i.profile_until
          or (i.kind = 'survey' and public.survey_state(s.published_at, s.starts_at, s.ends_at, s.cancelled_at, now()) = 'active')
      end
  );
$$;

-- The media of a survey or a results snapshot as users see them: the storage path (signed by
-- the client, see the storage policy), the checked logo spec, alt text and size.
create or replace function public.survey_media_json(p_survey uuid, p_scope text)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'kind', m.kind, 'path', m.storage_path, 'logo', l.spec, 'alt_text', m.alt_text, 'position', m.position,
    'width', m.width, 'height', m.height
  ) order by m.position), '[]'::jsonb)
  from public.survey_media m left join public.logo_library l on l.id = m.logo_id
  where m.survey_id = p_survey and m.scope = p_scope;
$$;

-- One official post as users see it. Only these fields; no ids of people, no answers.
create or replace function public.survey_item_json(p_item uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'item_id', i.id,
    'kind', i.kind,
    'survey_id', s.id,
    'title', s.title,
    'topic', case when i.kind = 'survey' then s.topic end,
    'state', public.survey_state(s.published_at, s.starts_at, s.ends_at, s.cancelled_at, now()),
    'starts_at', s.starts_at,
    'ends_at', s.ends_at,
    'published_at', i.published_at,
    'feed_until', i.feed_until,
    'profile_until', i.profile_until,
    'pin_until_answered', i.pin_until_answered,
    'answered', exists (select 1 from public.survey_participation p where p.survey_id = s.id and p.user_id = auth.uid()),
    'question_count', (select count(*) from public.survey_questions q where q.survey_id = s.id),
    'media', case when i.kind = 'survey' then public.survey_media_json(s.id, 'survey') else coalesce(i.snapshot -> 'media', '[]'::jsonb) end,
    'snapshot', case when i.kind = 'results' then i.snapshot end
  )
  from public.survey_items i join public.surveys s on s.id = i.survey_id
  where i.id = p_item;
$$;

-- ---------------------------------------------------------------- counters

-- Adds one to a counter. Global limits only (per minute for all, per day and survey), nothing
-- about the caller is kept. Internal.
create or replace function public.survey_bump(p_survey uuid, p_event text)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_minute timestamptz := date_trunc('minute', now());
  v_day date := (now() at time zone 'Europe/Zurich')::date;
  v_cap bigint := greatest(500, 30 * coalesce((select s.eligible_count_at_start from public.surveys s where s.id = p_survey), 0));
  v_count bigint;
begin
  insert into public.survey_event_rate as r (minute, count) values (v_minute, 1)
  on conflict (minute) do update set count = r.count + 1
  returning r.count into v_count;
  if v_count > 3000 then
    return false;
  end if;
  delete from public.survey_event_rate r where r.minute < now() - interval '10 minutes';
  select c.count into v_count from public.survey_counters c
  where c.scope_key = coalesce(p_survey, '00000000-0000-0000-0000-000000000000'::uuid) and c.day = v_day and c.event = p_event;
  if coalesce(v_count, 0) >= v_cap then
    return false;
  end if;
  insert into public.survey_counters as c (survey_id, day, event, count) values (p_survey, v_day, p_event, 1)
  on conflict (scope_key, day, event) do update set count = c.count + 1;
  return true;
end;
$$;

-- Statistics event from the app (allow-list). Only for surveys the caller can see; returns
-- whether it was counted. Stores nothing about the caller.
create or replace function public.track_survey_event(p_survey_id uuid, p_event text)
returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  if p_event is null or p_event not in ('card_shown', 'card_opened', 'started', 'dismissed', 'results_shown',
                                         'results_opened', 'profile_tab_opened', 'settings_list_opened') then
    return false;
  end if;
  if not public.official_visible_to_me() then
    return false;
  end if;
  if p_event in ('profile_tab_opened', 'settings_list_opened') then
    return public.survey_bump(null, p_event);
  end if;
  if not exists (select 1 from public.survey_items i where i.survey_id = p_survey_id and public.survey_item_visible(i.id, 'any')) then
    return false;
  end if;
  return public.survey_bump(p_survey_id, p_event);
end;
$$;

-- ---------------------------------------------------------------- reading (app)

-- The official posts of the feed for the caller: at most one survey and one results post on
-- top (new, not seen yet; or "oben anheften bis beantwortet" until answered or hidden), the
-- others by date. Hidden posts are left out. For every active account except across a block;
-- independent of following.
create or replace function public.get_official_feed_items()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  result jsonb;
begin
  if not public.official_visible_to_me() then
    return jsonb_build_object('top', '[]'::jsonb, 'items', '[]'::jsonb);
  end if;
  with candidates as (
    select i.id, i.kind, i.published_at, i.pin_until_answered, v.first_seen_at,
      public.survey_state(s.published_at, s.starts_at, s.ends_at, s.cancelled_at, now()) as state,
      exists (select 1 from public.survey_participation p where p.survey_id = i.survey_id and p.user_id = me) as answered
    from public.survey_items i
    join public.surveys s on s.id = i.survey_id
    left join public.survey_item_views v on v.item_id = i.id and v.user_id = me
    where i.status = 'visible' and i.published_at <= now() and now() < i.feed_until
      and (i.kind = 'results' or s.cancelled_at is null)
      and v.dismissed_at is null
      -- Answered surveys leave the feed (they stay under "Einstellungen → Umfragen").
      and not (i.kind = 'survey' and exists (select 1 from public.survey_participation p where p.survey_id = i.survey_id and p.user_id = me))
  ), wanted as (
    select c.*, case
      when c.kind = 'survey' and (c.answered or c.state <> 'active') then false
      when c.first_seen_at is null then true
      when c.kind = 'survey' and c.pin_until_answered then true
      else false
    end as wants_top
    from candidates c
  ), ranked as (
    select w.*, row_number() over (partition by w.kind, w.wants_top order by w.published_at desc, w.id) as rn from wanted w
  )
  select jsonb_build_object(
    'top', coalesce((select jsonb_agg(public.survey_item_json(r.id) || jsonb_build_object('seen', r.first_seen_at is not null)
                                      order by r.published_at desc)
                     from ranked r where r.wants_top and r.rn = 1), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(public.survey_item_json(r.id) || jsonb_build_object('seen', r.first_seen_at is not null)
                                        order by r.published_at desc)
                       from ranked r where not (r.wants_top and r.rn = 1)), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

-- The card was visible for at least a second (the app decides): next time it takes its normal
-- place. The first time counts for the reach ("card_shown"). Returns false if not visible.
create or replace function public.mark_item_seen(p_item_id uuid)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  first boolean;
  survey uuid;
begin
  if not public.survey_item_visible(p_item_id, 'any') then
    return false;
  end if;
  insert into public.survey_item_views (item_id, user_id, first_seen_at) values (p_item_id, auth.uid(), now())
  on conflict (item_id, user_id) do update set first_seen_at = coalesce(public.survey_item_views.first_seen_at, now())
  returning (xmax = 0) into first;
  select i.survey_id into survey from public.survey_items i where i.id = p_item_id;
  if first then
    perform public.survey_bump(survey, case when (select i.kind from public.survey_items i where i.id = p_item_id) = 'results'
                                         then 'results_shown' else 'card_shown' end);
  end if;
  return true;
end;
$$;

-- Hides a card in the caller's feed (running surveys stay reachable in the settings).
create or replace function public.dismiss_item(p_item_id uuid)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  before timestamptz;
begin
  if not public.survey_item_visible(p_item_id, 'any') then
    return false;
  end if;
  select v.dismissed_at into before from public.survey_item_views v where v.item_id = p_item_id and v.user_id = auth.uid();
  insert into public.survey_item_views (item_id, user_id, first_seen_at, dismissed_at) values (p_item_id, auth.uid(), now(), now())
  on conflict (item_id, user_id) do update
    set dismissed_at = coalesce(public.survey_item_views.dismissed_at, now()),
        first_seen_at = coalesce(public.survey_item_views.first_seen_at, now());
  if before is null then
    perform public.survey_bump((select i.survey_id from public.survey_items i where i.id = p_item_id), 'dismissed');
  end if;
  return true;
end;
$$;

-- Settings, "Umfragen": running surveys (open or answered, with the time left; also hidden
-- ones) and results of the last 30 days. open_count for the badge on the entry.
create or replace function public.get_active_surveys()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  surveys jsonb;
  results jsonb;
begin
  if not public.official_visible_to_me() then
    return jsonb_build_object('surveys', '[]'::jsonb, 'results', '[]'::jsonb, 'open_count', 0);
  end if;
  select coalesce(jsonb_agg(public.survey_item_json(i.id) order by s.ends_at), '[]'::jsonb) into surveys
  from public.survey_items i join public.surveys s on s.id = i.survey_id
  where i.kind = 'survey' and i.status = 'visible' and i.published_at <= now()
    and public.survey_state(s.published_at, s.starts_at, s.ends_at, s.cancelled_at, now()) = 'active';
  select coalesce(jsonb_agg(public.survey_item_json(i.id) order by i.published_at desc), '[]'::jsonb) into results
  from public.survey_items i
  where i.kind = 'results' and i.published_at > now() - interval '30 days' and public.survey_item_visible(i.id, 'any');
  return jsonb_build_object(
    'surveys', surveys,
    'results', results,
    'open_count', (select count(*) from jsonb_array_elements(surveys) e where not (e ->> 'answered')::boolean)
  );
end;
$$;

-- The official account's public profile: name, picture, description, badge and how many
-- surveys and results it shows. Never e-mail or other account data.
create or replace function public.get_official_profile()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select case when public.official_visible_to_me() then (
    select jsonb_build_object(
      'user_id', p.id, 'username', p.username, 'display_name', p.display_name, 'avatar_path', p.avatar_path,
      'bio', o.bio, 'official', true,
      'survey_count', (select count(*) from public.survey_items i where i.kind = 'survey' and public.survey_item_visible(i.id, 'profile')),
      'results_count', (select count(*) from public.survey_items i where i.kind = 'results' and public.survey_item_visible(i.id, 'profile'))
    )
    from public.official_account o join public.profiles p on p.id = o.user_id
    where o.id
  ) end;
$$;

-- Posts of the official profile, tab 'surveys' or 'results', newest first, before a time.
create or replace function public.get_official_profile_items(p_tab text, p_before timestamptz default null, p_limit integer default 20)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(public.survey_item_json(x.id) order by x.published_at desc), '[]'::jsonb)
  from (
    select i.id, i.published_at from public.survey_items i
    where i.kind = case p_tab when 'results' then 'results' else 'survey' end
      and p_tab in ('surveys', 'results')
      and (p_before is null or i.published_at < p_before)
      and public.survey_item_visible(i.id, 'profile')
    order by i.published_at desc
    limit least(greatest(coalesce(p_limit, 20), 1), 50)
  ) x;
$$;

-- One official post (results view, links): only when the caller can see it.
create or replace function public.get_official_item(p_item_id uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select case when public.survey_item_visible(p_item_id, 'any') then public.survey_item_json(p_item_id) end;
$$;

-- A survey for taking part: its questions (without anything about others), whether the caller
-- has answered, the state and the end. Null when the caller can't see it.
create or replace function public.get_survey(p_survey_id uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'survey_id', s.id, 'title', s.title, 'topic', s.topic,
    'state', public.survey_state(s.published_at, s.starts_at, s.ends_at, s.cancelled_at, now()),
    'ends_at', s.ends_at, 'allow_text', s.allow_text,
    'answered', exists (select 1 from public.survey_participation p where p.survey_id = s.id and p.user_id = auth.uid()),
    'media', public.survey_media_json(s.id, 'survey'),
    'questions', coalesce((select jsonb_agg(jsonb_build_object(
      'id', q.id, 'kind', q.kind, 'prompt', q.prompt, 'required', q.required, 'options', q.options,
      'max_choices', q.max_choices, 'scale_min', q.scale_min, 'scale_max', q.scale_max, 'text_max', q.text_max
    ) order by q.position) from public.survey_questions q where q.survey_id = s.id), '[]'::jsonb)
  )
  from public.surveys s
  join public.survey_items i on i.survey_id = s.id and i.kind = 'survey'
  where s.id = p_survey_id and public.survey_item_visible(i.id, 'any');
$$;

-- ---------------------------------------------------------------- taking part

-- Why answers can't be stored (a code), or null. Same as answersProblem() in shared/surveys.ts.
create or replace function public.survey_answers_problem(p_survey uuid, p_answers jsonb)
returns text
language plpgsql stable security definer set search_path = ''
as $$
declare
  q public.survey_questions%rowtype;
  v jsonb;
  allow boolean;
  fits boolean;
begin
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' or char_length(p_answers::text) > 12000 then
    return 'invalid_answers';
  end if;
  select s.allow_text into allow from public.surveys s where s.id = p_survey;
  if exists (select 1 from jsonb_object_keys(p_answers) k
             where not exists (select 1 from public.survey_questions x where x.survey_id = p_survey and x.id::text = k)) then
    return 'invalid_answers';
  end if;
  for q in select * from public.survey_questions x where x.survey_id = p_survey order by x.position loop
    v := p_answers -> q.id::text;
    if v is null or jsonb_typeof(v) = 'null' then
      if q.required then
        return 'required_missing';
      end if;
      continue;
    end if;
    fits := case q.kind
      when 'single' then public.brand_int_between(v, 0, jsonb_array_length(q.options) - 1)
      when 'multiple' then jsonb_typeof(v) = 'array' and jsonb_array_length(v) between 1 and q.max_choices
        and not exists (select 1 from jsonb_array_elements(v) x where not public.brand_int_between(x, 0, jsonb_array_length(q.options) - 1))
        and (select count(distinct (x #>> '{}')::numeric) from jsonb_array_elements(v) x) = jsonb_array_length(v)
      when 'scale' then public.brand_int_between(v, q.scale_min, q.scale_max)
      when 'yes_no' then jsonb_typeof(v) = 'boolean'
      when 'text' then coalesce(allow, false) and jsonb_typeof(v) = 'string'
        and char_length(btrim(v #>> '{}', E' \t\r\n')) between 1 and q.text_max
      else false
    end;
    if not coalesce(fits, false) then
      return 'invalid_answers';
    end if;
  end loop;
  return null;
end;
$$;

-- Takes part: participation and the anonymous answers in ONE transaction. Checks: active
-- account, the survey visible and running, not yet taken part, the answers. Answers can't be
-- changed afterwards. Returns only "Danke".
create or replace function public.submit_survey_response(p_survey_id uuid, p_answers jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  s public.surveys%rowtype;
  item uuid;
  problem text;
  response uuid;
begin
  if me is null or not public.is_account_active() then
    raise exception 'account_inactive';
  end if;
  select * into s from public.surveys x where x.id = p_survey_id for share;
  select i.id into item from public.survey_items i where i.survey_id = p_survey_id and i.kind = 'survey';
  if not found or item is null or not public.survey_item_visible(item, 'any') then
    raise exception 'survey_not_found';
  end if;
  if public.is_official(me) then
    raise exception 'not_allowed';
  end if;
  if public.survey_state(s.published_at, s.starts_at, s.ends_at, s.cancelled_at, now()) <> 'active' then
    raise exception 'survey_not_active';
  end if;
  problem := public.survey_answers_problem(p_survey_id, p_answers);
  if problem is not null then
    raise exception '%', problem;
  end if;
  insert into public.survey_participation (survey_id, user_id) values (p_survey_id, me) on conflict do nothing;
  if not found then
    raise exception 'already_answered';
  end if;
  insert into public.survey_responses (survey_id, submitted_day)
  values (p_survey_id, (now() at time zone 'Europe/Zurich')::date)
  returning id into response;
  insert into public.survey_answers (response_id, question_id, value)
  select response, q.id,
    case when q.kind = 'text' then to_jsonb(btrim(p_answers ->> q.id::text, E' \t\r\n')) else p_answers -> q.id::text end
  from public.survey_questions q
  where q.survey_id = p_survey_id and coalesce(jsonb_typeof(p_answers -> q.id::text), 'null') <> 'null';
  insert into public.survey_item_views (item_id, user_id, first_seen_at, answered_at) values (item, me, now(), now())
  on conflict (item_id, user_id) do update
    set answered_at = now(), first_seen_at = coalesce(public.survey_item_views.first_seen_at, now());
  perform public.bump_usage('survey_submitted');
  return jsonb_build_object('ok', true, 'message', 'Danke');
end;
$$;

-- ---------------------------------------------------------------- admins

-- Validates and stores the questions of a draft (replacing them). Internal.
create or replace function public.survey_store_questions(p_survey uuid, p_questions jsonb, p_allow_text boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  q jsonb;
  pos integer := 0;
  problem text;
begin
  if p_questions is null or jsonb_typeof(p_questions) <> 'array' or jsonb_array_length(p_questions) > 10 then
    raise exception 'invalid_questions';
  end if;
  for q in select x.value from jsonb_array_elements(p_questions) x loop
    problem := public.survey_question_problem(q, p_allow_text);
    if problem is not null then
      raise exception '%', problem;
    end if;
  end loop;
  delete from public.survey_questions x where x.survey_id = p_survey;
  for q in select x.value from jsonb_array_elements(p_questions) x loop
    insert into public.survey_questions (survey_id, position, kind, prompt, required, options, max_choices, scale_min, scale_max, text_max)
    values (
      p_survey, pos, q ->> 'kind', btrim(q ->> 'prompt', E' \t\r\n'), (q ->> 'required')::boolean,
      case when q ->> 'kind' in ('single', 'multiple')
        then (select jsonb_agg(to_jsonb(btrim(o #>> '{}', E' \t\r\n'))) from jsonb_array_elements(q -> 'options') o) end,
      (q ->> 'max_choices')::numeric::integer, (q ->> 'scale_min')::numeric::integer, (q ->> 'scale_max')::numeric::integer,
      (q ->> 'text_max')::numeric::integer
    );
    pos := pos + 1;
  end loop;
end;
$$;

-- What the log keeps of a survey (texts as hash; never answers).
create or replace function public.survey_log_summary(p_survey uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'title', s.title,
    'topic_hash', encode(sha256(convert_to(s.topic, 'UTF8')), 'hex'),
    'questions_hash', encode(sha256(convert_to(coalesce((select jsonb_agg(to_jsonb(q) - 'id' - 'survey_id' order by q.position)
                                                        from public.survey_questions q where q.survey_id = s.id), '[]'::jsonb)::text, 'UTF8')), 'hex'),
    'questions', (select count(*) from public.survey_questions q where q.survey_id = s.id),
    'starts_at', s.starts_at, 'ends_at', s.ends_at, 'allow_text', s.allow_text,
    'pin_until_answered', s.pin_until_answered, 'feed_days', s.feed_days, 'profile_days', s.profile_days
  )
  from public.surveys s where s.id = p_survey;
$$;

-- Everything about one survey for the dashboard (questions, media, counts, whether locked).
create or replace function public.admin_survey_get(p_survey_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.require_admin();
  return (
    select to_jsonb(s) || jsonb_build_object(
      'state', public.survey_state(s.published_at, s.starts_at, s.ends_at, s.cancelled_at, now()),
      'locked', exists (select 1 from public.survey_responses r where r.survey_id = s.id),
      'participants', (select count(*) from public.survey_participation p where p.survey_id = s.id),
      'responses', (select count(*) from public.survey_responses r where r.survey_id = s.id),
      'eligible_now', public.survey_eligible_count(),
      'created_by_name', (select u.username from public.profiles u where u.id = s.created_by),
      'questions', coalesce((select jsonb_agg(to_jsonb(q) - 'survey_id' order by q.position) from public.survey_questions q where q.survey_id = s.id), '[]'::jsonb),
      'media', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'scope', m.scope, 'kind', m.kind, 'path', m.storage_path,
                                                             'logo_id', m.logo_id, 'logo', l.spec, 'alt_text', m.alt_text,
                                                             'position', m.position, 'width', m.width, 'height', m.height)
                                          order by m.scope, m.position)
                         from public.survey_media m left join public.logo_library l on l.id = m.logo_id where m.survey_id = s.id), '[]'::jsonb),
      'items', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'kind', i.kind, 'status', i.status, 'published_at', i.published_at,
                                                             'feed_until', i.feed_until, 'profile_until', i.profile_until)
                                          order by i.published_at)
                         from public.survey_items i where i.survey_id = s.id), '[]'::jsonb)
    )
    from public.surveys s where s.id = p_survey_id
  );
end;
$$;

-- All surveys with state, answers and participation rate. When a survey has ended, the number
-- of eligible accounts at the end is fixed here (no background job).
create or replace function public.admin_survey_list()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.require_admin();
  update public.surveys s set eligible_count_at_close = public.survey_eligible_count(), status = 'closed'
  where s.eligible_count_at_close is null and s.cancelled_at is null and s.published_at is not null and s.ends_at <= now();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', s.id, 'title', s.title,
      'state', public.survey_state(s.published_at, s.starts_at, s.ends_at, s.cancelled_at, now()),
      'starts_at', s.starts_at, 'ends_at', s.ends_at, 'published_at', s.published_at, 'cancelled_at', s.cancelled_at,
      'participants', (select count(*) from public.survey_participation p where p.survey_id = s.id),
      'responses', (select count(*) from public.survey_responses r where r.survey_id = s.id),
      'eligible_count_at_start', s.eligible_count_at_start, 'eligible_count_at_close', s.eligible_count_at_close,
      'questions', (select count(*) from public.survey_questions q where q.survey_id = s.id),
      'locked', exists (select 1 from public.survey_responses r where r.survey_id = s.id),
      'created_at', s.created_at, 'updated_at', s.updated_at
    ) order by coalesce(s.published_at, s.created_at) desc)
    from public.surveys s
  ), '[]'::jsonb);
end;
$$;

-- Creates (p_id null) or changes a survey. Everything is checked again. Drafts: everything.
-- Published without answers: texts, questions and options (the start only while planned).
-- Once there is an answer: refused ("survey_locked"; extend, cancel, images stay possible).
-- p_survey: {title, topic, starts_at|null (= start when publishing), ends_at|null,
-- pin_until_answered, allow_text, feed_days, profile_days|null, questions: [...]}
create or replace function public.admin_survey_save(p_id uuid, p_survey jsonb)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  existing public.surveys%rowtype;
  state text;
  saved uuid;
  v_title text := btrim(p_survey ->> 'title', E' \t\r\n');
  v_topic text := btrim(p_survey ->> 'topic', E' \t\r\n');
  starts timestamptz;
  ends timestamptz;
  allow boolean := coalesce((p_survey ->> 'allow_text')::boolean, false);
  feed integer := coalesce((p_survey ->> 'feed_days')::integer, 7);
  profile integer := case when p_survey ? 'profile_days' then (p_survey ->> 'profile_days')::integer else 90 end;
  before jsonb;
begin
  perform public.require_admin();
  if p_survey is null or jsonb_typeof(p_survey) <> 'object' or octet_length(p_survey::text) > 60000 then
    raise exception 'invalid_survey';
  end if;
  begin
    starts := (p_survey ->> 'starts_at')::timestamptz;
    ends := (p_survey ->> 'ends_at')::timestamptz;
  exception when others then
    raise exception 'invalid_dates';
  end;
  if v_title is null or char_length(v_title) not between 3 and 120 then
    raise exception 'invalid_title';
  end if;
  if v_topic is null or char_length(v_topic) not between 10 and 1000 then
    raise exception 'invalid_topic';
  end if;
  if feed not between 1 and 90 or (profile is not null and profile not between 1 and 3650) then
    raise exception 'invalid_display';
  end if;
  if p_id is null and starts is not null and ends is not null
    and (ends < starts + interval '1 hour' or ends > starts + interval '90 days') then
    raise exception 'invalid_dates';
  end if;
  if not allow and exists (select 1 from jsonb_array_elements(coalesce(p_survey -> 'questions', '[]')) q where q ->> 'kind' = 'text') then
    raise exception 'text_not_allowed';
  end if;

  if p_id is null then
    insert into public.surveys (title, topic, starts_at, ends_at, pin_until_answered, allow_text, feed_days, profile_days, created_by)
    values (v_title, v_topic, starts, ends, coalesce((p_survey ->> 'pin_until_answered')::boolean, false), allow, feed, profile, auth.uid())
    returning id into saved;
    perform public.survey_store_questions(saved, coalesce(p_survey -> 'questions', '[]'), allow);
    perform public.log_moderation_action('survey_create', 'survey', saved, null, null, 'Umfrage angelegt', null,
      jsonb_build_object('after', public.survey_log_summary(saved)));
    return saved;
  end if;

  select * into existing from public.surveys s where s.id = p_id for update;
  if not found then
    raise exception 'survey_not_found';
  end if;
  state := public.survey_state(existing.published_at, existing.starts_at, existing.ends_at, existing.cancelled_at, now());
  if state in ('closed', 'cancelled') then
    raise exception 'survey_finished';
  end if;
  if exists (select 1 from public.survey_responses r where r.survey_id = p_id) then
    raise exception 'survey_locked';
  end if;
  -- Once published, start, end and display time stay (the end changes only by extending).
  if existing.published_at is not null then
    starts := existing.starts_at;
    ends := existing.ends_at;
    feed := existing.feed_days;
    profile := existing.profile_days;
    if jsonb_array_length(coalesce(p_survey -> 'questions', '[]')) = 0 then
      raise exception 'no_questions';
    end if;
  end if;
  if starts is not null and ends is not null
    and (ends < starts + interval '1 hour' or ends > starts + interval '90 days') then
    raise exception 'invalid_dates';
  end if;
  before := public.survey_log_summary(p_id);
  update public.surveys set
    title = v_title, topic = v_topic, starts_at = starts, ends_at = ends,
    pin_until_answered = coalesce((p_survey ->> 'pin_until_answered')::boolean, false), allow_text = allow,
    feed_days = feed, profile_days = profile, updated_at = now()
  where id = p_id;
  perform public.survey_store_questions(p_id, coalesce(p_survey -> 'questions', '[]'), allow);
  if existing.published_at is not null then
    update public.survey_items i set
      pin_until_answered = coalesce((p_survey ->> 'pin_until_answered')::boolean, false)
    where i.survey_id = p_id and i.kind = 'survey';
  end if;
  perform public.log_moderation_action('survey_update', 'survey', p_id, null, null, 'Umfrage geändert', null,
    jsonb_build_object('before', before, 'after', public.survey_log_summary(p_id)));
  return p_id;
end;
$$;

-- Publishes a draft. Needs the confirmation word and a fresh two-factor step (like other
-- delicate actions): an official account, title, topic, 1 to 10 valid questions, the end set
-- (start: now if empty). Fixes the number of eligible accounts and creates the official post.
create or replace function public.admin_survey_publish(p_id uuid, p_confirm text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  s public.surveys%rowtype;
  starts timestamptz;
  eligible integer;
  q record;
  problem text;
begin
  perform public.require_admin();
  if p_confirm is distinct from 'VERÖFFENTLICHEN' then
    raise exception 'confirmation_required';
  end if;
  if not public.reset_fresh_totp(300) then
    raise exception 'totp_required';
  end if;
  if public.official_user_id() is null then
    raise exception 'official_account_missing';
  end if;
  select * into s from public.surveys x where x.id = p_id for update;
  if not found then
    raise exception 'survey_not_found';
  end if;
  if s.published_at is not null then
    raise exception 'already_published';
  end if;
  if not exists (select 1 from public.survey_questions x where x.survey_id = p_id) then
    raise exception 'no_questions';
  end if;
  for q in select * from public.survey_questions x where x.survey_id = p_id loop
    problem := public.survey_question_problem(jsonb_build_object(
      'kind', q.kind, 'prompt', q.prompt, 'required', q.required, 'options', q.options, 'max_choices', q.max_choices,
      'scale_min', q.scale_min, 'scale_max', q.scale_max, 'text_max', q.text_max), s.allow_text);
    if problem is not null then
      raise exception '%', problem;
    end if;
  end loop;
  if s.ends_at is null then
    raise exception 'invalid_dates';
  end if;
  starts := coalesce(s.starts_at, now());
  if starts < now() - interval '5 minutes' then
    raise exception 'start_in_past';
  end if;
  if s.ends_at < starts + interval '1 hour' or s.ends_at > starts + interval '90 days' then
    raise exception 'invalid_dates';
  end if;
  eligible := public.survey_eligible_count();
  update public.surveys set
    starts_at = starts, published_at = now(), updated_at = now(),
    status = case when starts > now() then 'scheduled' else 'active' end,
    feed_until = starts + make_interval(days => s.feed_days),
    profile_until = case when s.profile_days is null then null else starts + make_interval(days => s.profile_days) end,
    eligible_count_at_start = eligible
  where id = p_id;
  insert into public.survey_items (kind, survey_id, published_at, feed_until, profile_until, pin_until_answered, created_by)
  values ('survey', p_id, starts, starts + make_interval(days => s.feed_days),
          case when s.profile_days is null then null else starts + make_interval(days => s.profile_days) end,
          s.pin_until_answered, auth.uid());
  perform public.log_moderation_action('survey_publish', 'survey', p_id, null, null, 'Umfrage veröffentlicht', null,
    jsonb_build_object('after', public.survey_log_summary(p_id), 'eligible', eligible));
  return jsonb_build_object('starts_at', starts, 'eligible', eligible);
end;
$$;

-- Only a later end (at most 90 days after the start), while planned or running.
create or replace function public.admin_survey_extend(p_id uuid, p_ends_at timestamptz)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  s public.surveys%rowtype;
begin
  perform public.require_admin();
  select * into s from public.surveys x where x.id = p_id for update;
  if not found then
    raise exception 'survey_not_found';
  end if;
  if public.survey_state(s.published_at, s.starts_at, s.ends_at, s.cancelled_at, now()) not in ('scheduled', 'active') then
    raise exception 'survey_finished';
  end if;
  if p_ends_at is null or p_ends_at <= s.ends_at or p_ends_at > s.starts_at + interval '90 days' or p_ends_at <= now() then
    raise exception 'invalid_dates';
  end if;
  update public.surveys set ends_at = p_ends_at, updated_at = now() where id = p_id;
  perform public.log_moderation_action('survey_extend', 'survey', p_id, null, null, 'Umfrage verlängert', null,
    jsonb_build_object('before', jsonb_build_object('ends_at', s.ends_at), 'after', jsonb_build_object('ends_at', p_ends_at)));
end;
$$;

-- Cancels a planned or running survey (reason required). keep_answers: the answers stay for the
-- internal evaluation; otherwise answers, participation and counters of the survey are deleted.
-- The survey post disappears.
create or replace function public.admin_survey_cancel(p_id uuid, p_reason text, p_keep_answers boolean)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  s public.surveys%rowtype;
  reason text := btrim(coalesce(p_reason, ''));
  responses integer;
begin
  perform public.require_admin();
  if char_length(reason) not between 10 and 500 then
    raise exception 'invalid_reason';
  end if;
  if p_keep_answers is null then
    raise exception 'invalid_choice';
  end if;
  select * into s from public.surveys x where x.id = p_id for update;
  if not found then
    raise exception 'survey_not_found';
  end if;
  if public.survey_state(s.published_at, s.starts_at, s.ends_at, s.cancelled_at, now()) not in ('scheduled', 'active') then
    raise exception 'survey_finished';
  end if;
  select count(*) into responses from public.survey_responses r where r.survey_id = p_id;
  update public.surveys set cancelled_at = now(), cancel_reason = reason, cancel_keep_answers = p_keep_answers,
    status = 'cancelled', eligible_count_at_close = public.survey_eligible_count(), updated_at = now()
  where id = p_id;
  update public.survey_items set status = 'withdrawn', withdrawn_at = now()
  where survey_id = p_id and kind = 'survey' and status = 'visible';
  if not p_keep_answers then
    delete from public.survey_responses r where r.survey_id = p_id;
    delete from public.survey_participation p where p.survey_id = p_id;
    delete from public.survey_counters c where c.survey_id = p_id;
  end if;
  perform public.log_moderation_action('survey_cancel', 'survey', p_id, null, null, reason, null,
    jsonb_build_object('keep_answers', p_keep_answers, 'responses', responses));
  return jsonb_build_object('responses', responses, 'kept', p_keep_answers);
end;
$$;

-- Deletes a draft (never a published survey).
create or replace function public.admin_survey_delete(p_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  s public.surveys%rowtype;
begin
  perform public.require_admin();
  select * into s from public.surveys x where x.id = p_id for update;
  if not found then
    raise exception 'survey_not_found';
  end if;
  if s.published_at is not null then
    raise exception 'not_a_draft';
  end if;
  perform public.log_moderation_action('survey_delete', 'survey', p_id, null, null, 'Umfrage-Entwurf gelöscht', null,
    jsonb_build_object('before', public.survey_log_summary(p_id)));
  delete from public.surveys where id = p_id;
end;
$$;

-- Withdraws an official post (survey or results) at once.
create or replace function public.admin_item_withdraw(p_item_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  i public.survey_items%rowtype;
begin
  perform public.require_admin();
  select * into i from public.survey_items x where x.id = p_item_id for update;
  if not found then
    raise exception 'item_not_found';
  end if;
  if i.status = 'withdrawn' then
    return;
  end if;
  update public.survey_items set status = 'withdrawn', withdrawn_at = now() where id = p_item_id;
  perform public.log_moderation_action('survey_item_withdraw', 'survey_item', p_item_id, null, null, 'Offizieller Beitrag zurückgezogen', null,
    jsonb_build_object('kind', i.kind, 'survey_id', i.survey_id));
end;
$$;

-- ---------------------------------------------------------------- media (admins)

-- A path for a new image (the Edge Function survey_media_upload stores the file there with the
-- service role, then registers it). Checks the survey and the limit first.
create or replace function public.admin_survey_media_slot(p_survey_id uuid, p_scope text, p_ext text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  s public.surveys%rowtype;
begin
  perform public.require_admin();
  if p_scope is null or p_scope not in ('survey', 'results') or p_ext is null or p_ext not in ('png', 'jpg', 'webp') then
    raise exception 'invalid_media';
  end if;
  select * into s from public.surveys x where x.id = p_survey_id;
  if not found then
    raise exception 'survey_not_found';
  end if;
  if s.cancelled_at is not null and p_scope = 'survey' then
    raise exception 'survey_finished';
  end if;
  if (select count(*) from public.survey_media m where m.survey_id = p_survey_id and m.scope = p_scope and m.kind = 'image') >= 4 then
    raise exception 'too_many_images';
  end if;
  return 'survey/' || p_survey_id || '/' || p_scope || '-' || gen_random_uuid() || '.' || p_ext;
end;
$$;

create or replace function public.admin_survey_media_register(
  p_survey_id uuid, p_scope text, p_path text, p_alt_text text, p_width integer, p_height integer, p_bytes integer
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  saved uuid;
begin
  perform public.require_admin();
  if p_path is null or split_part(p_path, '/', 2) <> p_survey_id::text or split_part(split_part(p_path, '/', 3), '-', 1) <> p_scope then
    raise exception 'invalid_media';
  end if;
  insert into public.survey_media (survey_id, scope, kind, storage_path, alt_text, position, width, height, bytes)
  values (p_survey_id, p_scope, 'image', p_path, btrim(p_alt_text), coalesce((select max(m.position) + 1 from public.survey_media m
          where m.survey_id = p_survey_id and m.scope = p_scope), 0), p_width, p_height, p_bytes)
  returning id into saved;
  perform public.log_moderation_action('survey_media_add', 'survey', p_survey_id, null, null, 'Bild zur Umfrage hinzugefügt', null,
    jsonb_build_object('scope', p_scope, 'path', p_path, 'bytes', p_bytes, 'width', p_width, 'height', p_height));
  return saved;
end;
$$;

create or replace function public.admin_survey_media_add_logo(p_survey_id uuid, p_scope text, p_logo_id uuid, p_alt_text text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  saved uuid;
begin
  perform public.require_admin();
  if p_scope is null or p_scope not in ('survey', 'results') then
    raise exception 'invalid_media';
  end if;
  if not exists (select 1 from public.surveys s where s.id = p_survey_id) then
    raise exception 'survey_not_found';
  end if;
  if not exists (select 1 from public.logo_library l where l.id = p_logo_id) then
    raise exception 'logo_not_found';
  end if;
  insert into public.survey_media (survey_id, scope, kind, logo_id, alt_text, position)
  values (p_survey_id, p_scope, 'logo', p_logo_id, btrim(p_alt_text),
          coalesce((select max(m.position) + 1 from public.survey_media m where m.survey_id = p_survey_id and m.scope = p_scope), 0))
  returning id into saved;
  perform public.log_moderation_action('survey_media_add', 'survey', p_survey_id, null, null, 'Logo zur Umfrage hinzugefügt', null,
    jsonb_build_object('scope', p_scope, 'logo_id', p_logo_id));
  return saved;
end;
$$;

-- Alt text and order (positions are given as the new order of the ids).
create or replace function public.admin_survey_media_update(p_media_id uuid, p_alt_text text, p_position integer)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  m public.survey_media%rowtype;
begin
  perform public.require_admin();
  select * into m from public.survey_media x where x.id = p_media_id for update;
  if not found then
    raise exception 'media_not_found';
  end if;
  if p_position is null or p_position not between 0 and 6 then
    raise exception 'invalid_media';
  end if;
  -- Swap with the one at the target position.
  update public.survey_media x set position = m.position
  where x.survey_id = m.survey_id and x.scope = m.scope and x.position = p_position and x.id <> m.id;
  update public.survey_media set alt_text = btrim(p_alt_text), position = p_position where id = p_media_id;
end;
$$;

-- Removes a media row; returns the storage path of an image (the Edge Function then deletes the
-- file) or null for a logo. Media of a published results post stay (its snapshot shows them).
create or replace function public.admin_survey_media_remove(p_media_id uuid)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  m public.survey_media%rowtype;
begin
  perform public.require_admin();
  select * into m from public.survey_media x where x.id = p_media_id for update;
  if not found then
    raise exception 'media_not_found';
  end if;
  if m.scope = 'results' and exists (select 1 from public.survey_items i where i.survey_id = m.survey_id and i.kind = 'results') then
    raise exception 'media_in_use';
  end if;
  delete from public.survey_media where id = p_media_id;
  perform public.log_moderation_action('survey_media_remove', 'survey', m.survey_id, null, null, 'Medium der Umfrage entfernt', null,
    jsonb_build_object('scope', m.scope, 'kind', m.kind, 'path', m.storage_path, 'logo_id', m.logo_id));
  return m.storage_path;
end;
$$;

-- All registered image paths (the Edge Function removes files in the bucket that aren't).
create or replace function public.admin_survey_media_paths()
returns text[]
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.require_admin();
  return array(select m.storage_path from public.survey_media m where m.storage_path is not null);
end;
$$;

-- ---------------------------------------------------------------- storage

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('survey-media', 'survey-media', false, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- May the caller read this file? Admins always (previews); users only for an official post
-- they can see (the survey's own images, or images chosen for its results).
create or replace function public.survey_media_readable(p_name text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.is_admin() or exists (
    select 1 from public.survey_media m
    join public.survey_items i on i.survey_id = m.survey_id and i.kind = m.scope
    where m.storage_path = p_name and public.survey_item_visible(i.id, 'any')
  );
$$;

drop policy if exists "survey-media: read visible" on storage.objects;
create policy "survey-media: read visible" on storage.objects
  for select to authenticated
  using (bucket_id = 'survey-media' and public.survey_media_readable(name));
-- No insert, update or delete policies: files come and go only through the Edge Function.

-- ---------------------------------------------------------------- usage events

insert into public.usage_event_types (name, area, source) values
  ('survey_card_opened', 'feed', 'client'),
  ('survey_submitted', 'feed', 'server'),
  ('results_opened', 'feed', 'client')
on conflict (name) do nothing;

-- ---------------------------------------------------------------- rights

do $$
declare
  f text;
begin
  -- Internal: never callable by clients.
  foreach f in array array[
    'public.official_user_id()', 'public.survey_question_problem(jsonb, boolean)',
    'public.survey_guard_questions()', 'public.survey_guard_update()', 'public.survey_guard_answers()',
    'public.survey_guard_items()', 'public.survey_guard_media()', 'public.guard_official_messages()',
    'public.guard_official_block()',
    'public.survey_state_of(uuid)', 'public.survey_eligible_count()', 'public.official_visible_to_me()',
    'public.survey_item_visible(uuid, text)', 'public.survey_media_json(uuid, text)', 'public.survey_item_json(uuid)',
    'public.survey_bump(uuid, text)', 'public.survey_answers_problem(uuid, jsonb)',
    'public.survey_store_questions(uuid, jsonb, boolean)', 'public.survey_log_summary(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  -- Signed-in users (each checks the account and visibility itself).
  foreach f in array array[
    'public.track_survey_event(uuid, text)', 'public.get_official_feed_items()', 'public.mark_item_seen(uuid)',
    'public.dismiss_item(uuid)', 'public.get_active_surveys()', 'public.get_official_profile()',
    'public.get_official_profile_items(text, timestamptz, integer)', 'public.get_survey(uuid)',
    'public.submit_survey_response(uuid, jsonb)', 'public.is_official(uuid)', 'public.survey_media_readable(text)',
    'public.get_official_account_id()', 'public.get_official_item(uuid)',
    'public.survey_state(timestamptz, timestamptz, timestamptz, timestamptz, timestamptz)',
    -- Admins (each checks admin and two-factor first).
    'public.admin_survey_get(uuid)', 'public.admin_survey_list()', 'public.admin_survey_save(uuid, jsonb)',
    'public.admin_survey_publish(uuid, text)', 'public.admin_survey_extend(uuid, timestamptz)',
    'public.admin_survey_cancel(uuid, text, boolean)', 'public.admin_survey_delete(uuid)', 'public.admin_item_withdraw(uuid)',
    'public.admin_survey_media_slot(uuid, text, text)',
    'public.admin_survey_media_register(uuid, text, text, text, integer, integer, integer)',
    'public.admin_survey_media_add_logo(uuid, text, uuid, text)', 'public.admin_survey_media_update(uuid, text, integer)',
    'public.admin_survey_media_remove(uuid)', 'public.admin_survey_media_paths()'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;

-- ---------------------------------------------------------------- evaluation and results (admins)
-- Numbers are only ever computed here, from the anonymous answers. A published summary is a
-- fixed snapshot that the server builds from the admin's choice (questions, quotes, conclusion),
-- so it can't contain made-up numbers and never changes afterwards.

-- Statistics of one question: answered, distribution (key, label, count), mean, median, NPS
-- (scale 0-10), and for free text the answers (random order by their random id, with "hidden").
create or replace function public.survey_question_stats(p_question uuid, p_with_texts boolean)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  q public.survey_questions%rowtype;
  answered integer;
  dist jsonb := '[]'::jsonb;
  v_mean numeric;
  v_median numeric;
  v_nps numeric;
  texts jsonb;
begin
  select * into q from public.survey_questions x where x.id = p_question;
  if not found then
    return null;
  end if;
  select count(*) into answered from public.survey_answers a where a.question_id = q.id;
  if q.kind = 'single' then
    select coalesce(jsonb_agg(jsonb_build_object('key', o.idx - 1, 'label', o.label,
      'count', (select count(*) from public.survey_answers a where a.question_id = q.id and a.value = to_jsonb(o.idx - 1)))
      order by o.idx), '[]') into dist
    from jsonb_array_elements_text(q.options) with ordinality o(label, idx);
  elsif q.kind = 'multiple' then
    select coalesce(jsonb_agg(jsonb_build_object('key', o.idx - 1, 'label', o.label,
      'count', (select count(*) from public.survey_answers a where a.question_id = q.id and a.value @> to_jsonb(o.idx - 1)))
      order by o.idx), '[]') into dist
    from jsonb_array_elements_text(q.options) with ordinality o(label, idx);
  elsif q.kind = 'yes_no' then
    dist := jsonb_build_array(
      jsonb_build_object('key', 'true', 'label', 'Ja', 'count', (select count(*) from public.survey_answers a where a.question_id = q.id and a.value = 'true'::jsonb)),
      jsonb_build_object('key', 'false', 'label', 'Nein', 'count', (select count(*) from public.survey_answers a where a.question_id = q.id and a.value = 'false'::jsonb)));
  elsif q.kind = 'scale' then
    select coalesce(jsonb_agg(jsonb_build_object('key', v, 'label', v::text,
      'count', (select count(*) from public.survey_answers a where a.question_id = q.id and a.value = to_jsonb(v)))
      order by v), '[]') into dist
    from generate_series(q.scale_min, q.scale_max) v;
    select avg((a.value #>> '{}')::numeric), percentile_cont(0.5) within group (order by (a.value #>> '{}')::numeric)
    into v_mean, v_median
    from public.survey_answers a where a.question_id = q.id;
    if q.scale_min = 0 and q.scale_max = 10 and answered > 0 then
      select round(((count(*) filter (where (a.value #>> '{}')::numeric >= 9))
                   - (count(*) filter (where (a.value #>> '{}')::numeric <= 6))) * 100.0 / count(*), 1)
      into v_nps from public.survey_answers a where a.question_id = q.id;
    end if;
  elsif q.kind = 'text' and p_with_texts then
    select coalesce(jsonb_agg(jsonb_build_object('response_id', a.response_id, 'text', a.value #>> '{}', 'hidden', a.hidden)
                              order by a.response_id), '[]')
    into texts from public.survey_answers a where a.question_id = q.id;
  end if;
  return jsonb_build_object(
    'question_id', q.id, 'position', q.position, 'kind', q.kind, 'prompt', q.prompt, 'required', q.required,
    'answered', answered, 'distribution', dist, 'mean', round(v_mean, 2), 'median', v_median, 'nps', v_nps,
    'texts', texts
  );
end;
$$;

-- The whole evaluation of a survey (internal; admin_survey_results adds the checks and the log).
-- No single answers except free text (for hiding and choosing quotes), no times of people:
-- participations per day, and per hour only from 20 participations on.
create or replace function public.survey_results_json(p_survey uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  s public.surveys%rowtype;
  item uuid;
  participants integer;
  responses integer;
begin
  select * into s from public.surveys x where x.id = p_survey;
  if not found then
    return null;
  end if;
  select i.id into item from public.survey_items i where i.survey_id = p_survey and i.kind = 'survey';
  select count(*) into participants from public.survey_participation p where p.survey_id = p_survey;
  select count(*) into responses from public.survey_responses r where r.survey_id = p_survey;
  return jsonb_build_object(
    'survey', jsonb_build_object('id', s.id, 'title', s.title, 'state', public.survey_state(s.published_at, s.starts_at, s.ends_at, s.cancelled_at, now()),
                                 'starts_at', s.starts_at, 'ends_at', s.ends_at, 'cancelled_at', s.cancelled_at,
                                 'cancel_keep_answers', s.cancel_keep_answers, 'allow_text', s.allow_text,
                                 'answers_purged_at', s.answers_purged_at),
    'participants', participants,
    'responses', responses,
    'eligible_start', s.eligible_count_at_start,
    'eligible_close', s.eligible_count_at_close,
    'eligible_now', public.survey_eligible_count(),
    'started', coalesce((select sum(c.count) from public.survey_counters c where c.survey_id = p_survey and c.event = 'started'), 0),
    'opened', coalesce((select sum(c.count) from public.survey_counters c where c.survey_id = p_survey and c.event = 'card_opened'), 0),
    'dismissed', coalesce((select sum(c.count) from public.survey_counters c where c.survey_id = p_survey and c.event = 'dismissed'), 0),
    'reach', (select count(*) from public.survey_item_views v where v.item_id = item and v.first_seen_at is not null),
    'per_day', coalesce((select jsonb_agg(jsonb_build_object('day', d.day, 'count', d.n) order by d.day)
                         from (select r.submitted_day as day, count(*) as n from public.survey_responses r
                               where r.survey_id = p_survey group by r.submitted_day) d), '[]'::jsonb),
    'hours', case when participants >= 20 then (
      select jsonb_agg(coalesce((select count(*) from public.survey_participation p
                                 where p.survey_id = p_survey
                                   and extract(hour from p.submitted_at at time zone 'Europe/Zurich') = h), 0) order by h)
      from generate_series(0, 23) h) end,
    'questions', coalesce((select jsonb_agg(public.survey_question_stats(q.id, true) order by q.position)
                           from public.survey_questions q where q.survey_id = p_survey), '[]'::jsonb),
    'min_answers', 5,
    'results_items', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'status', i.status, 'published_at', i.published_at,
                                                                   'feed_until', i.feed_until, 'profile_until', i.profile_until)
                                                order by i.published_at)
                               from public.survey_items i where i.survey_id = p_survey and i.kind = 'results'), '[]'::jsonb)
  );
end;
$$;

-- The evaluation for the dashboard (also as an interim result while running). Looking at it
-- (free texts included) is logged.
create or replace function public.admin_survey_results(p_survey_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  result jsonb;
begin
  perform public.require_admin();
  result := public.survey_results_json(p_survey_id);
  if result is null then
    raise exception 'survey_not_found';
  end if;
  perform public.log_moderation_action('survey_results_view', 'survey', p_survey_id, null, null, 'Umfrage-Auswertung angesehen', null,
    jsonb_build_object('responses', result -> 'responses'));
  return result;
end;
$$;

-- Hides (or shows again) one free text answer in the evaluation; the answer itself stays.
create or replace function public.admin_survey_text_hide(p_response_id uuid, p_question_id uuid, p_hidden boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  survey uuid;
begin
  perform public.require_admin();
  select q.survey_id into survey from public.survey_questions q where q.id = p_question_id and q.kind = 'text';
  if survey is null then
    raise exception 'answer_not_found';
  end if;
  update public.survey_answers set hidden = coalesce(p_hidden, true)
  where response_id = p_response_id and question_id = p_question_id;
  if not found then
    raise exception 'answer_not_found';
  end if;
  perform public.log_moderation_action('survey_text_hide', 'survey', survey, null, null,
    case when coalesce(p_hidden, true) then 'Freitext verborgen' else 'Freitext wieder angezeigt' end, null,
    jsonb_build_object('question_id', p_question_id));
end;
$$;

-- The snapshot of a results post in the format of the app (ResultsSnapshot in shared/surveys.ts),
-- built here from the choice: {questions: [question ids in order], quotes: {question id: [response
-- ids]}, conclusion, show_rate}. Quotes must be visible free text answers of that question.
create or replace function public.survey_build_snapshot(p_survey uuid, p_options jsonb)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  s public.surveys%rowtype;
  conclusion text := btrim(coalesce(p_options ->> 'conclusion', ''));
  qid text;
  stats jsonb;
  quotes jsonb;
  questions jsonb := '[]'::jsonb;
  answered numeric;
  responses integer;
  rate numeric;
begin
  select * into s from public.surveys x where x.id = p_survey;
  if not found then
    raise exception 'survey_not_found';
  end if;
  if p_options is null or jsonb_typeof(p_options) <> 'object' or jsonb_typeof(p_options -> 'questions') is distinct from 'array'
     or jsonb_array_length(p_options -> 'questions') not between 1 and 10 then
    raise exception 'invalid_selection';
  end if;
  if char_length(conclusion) not between 1 and 600 then
    raise exception 'invalid_conclusion';
  end if;
  select count(*) into responses from public.survey_responses r where r.survey_id = p_survey;
  if responses < 5 then
    raise exception 'too_few_answers';
  end if;
  for qid in select x.value from jsonb_array_elements_text(p_options -> 'questions') x loop
    if not exists (select 1 from public.survey_questions q where q.id::text = qid and q.survey_id = p_survey) then
      raise exception 'invalid_selection';
    end if;
    stats := public.survey_question_stats(qid::uuid, false);
    answered := (stats ->> 'answered')::numeric;
    quotes := '[]'::jsonb;
    if jsonb_typeof(p_options -> 'quotes' -> qid) = 'array' then
      if jsonb_array_length(p_options -> 'quotes' -> qid) > 20 then
        raise exception 'invalid_selection';
      end if;
      if exists (select 1 from jsonb_array_elements_text(p_options -> 'quotes' -> qid) r
                 where not exists (select 1 from public.survey_answers a
                                   where a.question_id::text = qid and a.response_id::text = r.value and not a.hidden)) then
        raise exception 'invalid_quote';
      end if;
      select coalesce(jsonb_agg(a.value order by a.response_id), '[]') into quotes
      from public.survey_answers a
      where a.question_id::text = qid and a.response_id::text in (select r.value from jsonb_array_elements_text(p_options -> 'quotes' -> qid) r);
    end if;
    questions := questions || jsonb_build_array(jsonb_build_object(
      'prompt', stats ->> 'prompt',
      'kind', stats ->> 'kind',
      'answered', answered,
      'options', coalesce((select jsonb_agg(jsonb_build_object(
        'label', d ->> 'label', 'count', (d ->> 'count')::numeric,
        'percent', case when answered > 0 then round((d ->> 'count')::numeric * 100 / answered, 1) else 0 end))
        from jsonb_array_elements(stats -> 'distribution') d), '[]'::jsonb),
      'mean', stats -> 'mean',
      'median', stats -> 'median',
      'nps', stats -> 'nps',
      'quotes', quotes
    ));
  end loop;
  rate := case when coalesce(s.eligible_count_at_start, 0) > 0
    then round(least(1, (select count(*) from public.survey_participation p where p.survey_id = p_survey)::numeric / s.eligible_count_at_start), 3) end;
  return jsonb_build_object(
    'version', 1,
    'title', s.title,
    'conclusion', conclusion,
    'participants', responses,
    'participationRate', case when coalesce((p_options ->> 'show_rate')::boolean, false) then rate end,
    'closedAt', coalesce(s.cancelled_at, case when s.ends_at <= now() then s.ends_at end),
    'questions', questions,
    'media', public.survey_media_json(p_survey, 'results')
  );
end;
$$;

-- What the results post would show (nothing is stored).
create or replace function public.admin_results_preview(p_survey_id uuid, p_options jsonb)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.require_admin();
  return public.survey_build_snapshot(p_survey_id, p_options);
end;
$$;

-- Publishes results: only for an ended survey (or one cancelled with its answers kept), at least
-- 5 answers, the confirmation word. The snapshot is stored once and never changes; feed and
-- profile time from now. Logged with a hash of the snapshot.
create or replace function public.admin_results_publish(p_survey_id uuid, p_options jsonb, p_feed_days integer, p_profile_days integer, p_confirm text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  s public.surveys%rowtype;
  state text;
  snapshot jsonb;
  saved uuid;
begin
  perform public.require_admin();
  if p_confirm is distinct from 'VERÖFFENTLICHEN' then
    raise exception 'confirmation_required';
  end if;
  if public.official_user_id() is null then
    raise exception 'official_account_missing';
  end if;
  select * into s from public.surveys x where x.id = p_survey_id for update;
  if not found then
    raise exception 'survey_not_found';
  end if;
  state := public.survey_state(s.published_at, s.starts_at, s.ends_at, s.cancelled_at, now());
  if not (state = 'closed' or (state = 'cancelled' and s.cancel_keep_answers)) then
    raise exception 'survey_not_finished';
  end if;
  if p_feed_days is null or p_feed_days not between 1 and 90 or (p_profile_days is not null and p_profile_days not between 1 and 3650) then
    raise exception 'invalid_display';
  end if;
  snapshot := public.survey_build_snapshot(p_survey_id, p_options);
  insert into public.survey_items (kind, survey_id, published_at, feed_until, profile_until, snapshot, created_by)
  values ('results', p_survey_id, now(), now() + make_interval(days => p_feed_days),
          case when p_profile_days is null then null else now() + make_interval(days => p_profile_days) end, snapshot, auth.uid())
  returning id into saved;
  perform public.log_moderation_action('survey_results_publish', 'survey_item', saved, null, null, 'Umfrage-Auswertung veröffentlicht', null,
    jsonb_build_object('survey_id', p_survey_id, 'snapshot_hash', encode(sha256(convert_to(snapshot::text, 'UTF8')), 'hex'),
                       'questions', jsonb_array_length(snapshot -> 'questions'), 'participants', snapshot -> 'participants'));
  return saved;
end;
$$;

-- Overview "Umfragen und Aktivität" for a period (days in Europe/Zurich): cards, participations
-- per day, per survey (state, answers, rate, reach) and per hour from 30 participations on.
create or replace function public.admin_survey_stats(p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  counter jsonb;
  participations integer;
begin
  perform public.require_admin();
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 3660 then
    raise exception 'invalid_period';
  end if;
  select coalesce(jsonb_object_agg(c.event, c.total), '{}'::jsonb) into counter
  from (select event, sum(count) as total from public.survey_counters where day between p_from and p_to group by event) c;
  select count(*) into participations from public.survey_participation p
  where (p.submitted_at at time zone 'Europe/Zurich')::date between p_from and p_to;
  return jsonb_build_object(
    'active', (select count(*) from public.surveys s where public.survey_state(s.published_at, s.starts_at, s.ends_at, s.cancelled_at, now()) = 'active'),
    'participations', participations,
    'running_participants', (select count(*) from public.survey_participation p join public.surveys s on s.id = p.survey_id
                             where public.survey_state(s.published_at, s.starts_at, s.ends_at, s.cancelled_at, now()) = 'active'),
    'running_eligible', (select coalesce(sum(s.eligible_count_at_start), 0) from public.surveys s
                         where public.survey_state(s.published_at, s.starts_at, s.ends_at, s.cancelled_at, now()) = 'active'),
    'counters', counter,
    'per_day', coalesce((select jsonb_agg(jsonb_build_object('day', d.day, 'count', d.n) order by d.day)
                         from (select r.submitted_day as day, count(*) as n from public.survey_responses r
                               where r.submitted_day between p_from and p_to group by r.submitted_day) d), '[]'::jsonb),
    'hours', case when participations >= 30 then (
      select jsonb_agg(coalesce((select count(*) from public.survey_participation p
                                 where (p.submitted_at at time zone 'Europe/Zurich')::date between p_from and p_to
                                   and extract(hour from p.submitted_at at time zone 'Europe/Zurich') = h), 0) order by h)
      from generate_series(0, 23) h) end,
    'surveys', coalesce((select jsonb_agg(jsonb_build_object(
        'id', s.id, 'title', s.title,
        'state', public.survey_state(s.published_at, s.starts_at, s.ends_at, s.cancelled_at, now()),
        'ends_at', s.ends_at,
        'responses', (select count(*) from public.survey_responses r where r.survey_id = s.id),
        'eligible_start', s.eligible_count_at_start,
        'reach', (select count(*) from public.survey_item_views v join public.survey_items i on i.id = v.item_id
                  where i.survey_id = s.id and i.kind = 'survey' and v.first_seen_at is not null)
      ) order by s.published_at desc)
      from public.surveys s where s.published_at is not null), '[]'::jsonb)
  );
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.survey_question_stats(uuid, boolean)', 'public.survey_results_json(uuid)', 'public.survey_build_snapshot(uuid, jsonb)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'public.admin_survey_results(uuid)', 'public.admin_survey_text_hide(uuid, uuid, boolean)',
    'public.admin_results_preview(uuid, jsonb)', 'public.admin_results_publish(uuid, jsonb, integer, integer, text)',
    'public.admin_survey_stats(date, date)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;

-- =============================================================================
-- Retention of survey answers (Phase 6)
-- =============================================================================
-- The anonymous answers of a survey are kept for 12 months after it ended (or was cancelled
-- with "behalten"), then deleted together with who took part and the seen/hidden marks of its
-- card. What stays: the survey with its questions, the daily counters without persons and the
-- published results (their snapshot never changes). Only for a manual run in the SQL editor
-- (supabase/maintenance.sql) or later pg_cron; no client may call it. Logged.
create or replace function public.survey_purge_expired_answers(p_months integer default 12)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  s record;
  v_surveys integer := 0;
  v_responses integer := 0;
  v_participations integer := 0;
  n integer;
begin
  if p_months is null or p_months not between 1 and 120 then
    raise exception 'invalid_months';
  end if;
  for s in
    select x.id, x.title from public.surveys x
    where x.answers_purged_at is null and x.published_at is not null
      and coalesce(x.cancelled_at, x.ends_at) <= now() - make_interval(months => p_months)
    for update
  loop
    delete from public.survey_responses r where r.survey_id = s.id;
    get diagnostics n = row_count;
    v_responses := v_responses + n;
    delete from public.survey_participation p where p.survey_id = s.id;
    get diagnostics n = row_count;
    v_participations := v_participations + n;
    delete from public.survey_item_views v using public.survey_items i
    where i.id = v.item_id and i.survey_id = s.id and i.kind = 'survey';
    update public.surveys set answers_purged_at = now() where id = s.id;
    v_surveys := v_surveys + 1;
    perform public.log_moderation_action('survey_answers_purged', 'survey', s.id, null, null,
      format('Aufbewahrungsfrist von %s Monaten abgelaufen', p_months), null,
      jsonb_build_object('months', p_months));
  end loop;
  return jsonb_build_object('surveys', v_surveys, 'responses', v_responses, 'participations', v_participations);
end;
$$;
revoke all on function public.survey_purge_expired_answers(integer) from public, anon, authenticated;
