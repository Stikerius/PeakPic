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
--                   only by triggers / security definer functions, never by clients
--   * workout links workout_shares: the post owner asks, only the tagged person accepts or
--                   declines (until the end of the next day); only accepted links count
--   * reposts       readable only if the viewer may read the original post AND the
--                   reposter's posts; only accepted, linked people may repost feed posts
--   * hashtags      tags and use counts readable by every signed-in user; which content uses a
--                   tag only as far as that content is readable. Maintained by triggers only.
--   * chats         only members can read conversations, members and messages
--   * training plan one per user: an ordered cycle of units (plan_days), not tied to weekdays.
--                   Readable by the owner, and by people who may see the owner's posts while
--                   "Plan im Profil anzeigen" is on (can_view_plan). Written only through
--                   save_training_plan() / delete_training_plan(); sequence_changed_at marks
--                   changes of order or units (the plan streak restarts there).
--   * plan on posts posts.plan_day_id: a unit of the poster's own plan (checked by a trigger,
--                   changeable only while the workout day is today or yesterday); title,
--                   position and plan length are copied onto the post so the label survives
--                   plan changes.
--   * rest days     rest_budgets (X per calendar week Mon-Sun, the number changeable every
--                   21 days) and
--                   rest_day_uses: only the owner reads them, nobody writes them directly; all
--                   rules live in set_rest_budget / use_rest_day / undo_rest_day. Others see
--                   rest days with the calendar (rest_days()), never the budget.
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
  created_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  joined_at       timestamptz not null default now(),
  last_read_at    timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index if not exists conversation_members_user_idx on public.conversation_members (user_id);

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

-- Training plan: an ordered cycle of units (e.g. Push, Pull, Beine), repeated, not tied to
-- weekdays. One plan per user.
create table if not exists public.training_plans (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null unique references public.profiles (id) on delete cascade,
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
    or public.is_following(target)
    or exists (select 1 from public.profiles p where p.id = target and not p.is_private);
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
      and (
        p.user_id = (select auth.uid())
        or (
          -- Streak-only proofs: photos, likes, comments only for the owner.
          p.in_feed
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
    where c.id = comment and public.can_view_post(c.post_id)
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
          (public.is_following(h.user_id) or public.is_public_content(h.user_id, 'stories'))
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
      and (
        s.user_id = (select auth.uid())
        or (
          s.expires_at > now()
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
-- linked people). Today every post counts; a later automatic check plugs in here.
create or replace function public.post_counts_as_workout(post uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.posts p where p.id = post);
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
      (public.is_following(target) or public.is_public_content(target, 'posts'))
      and not public.is_hidden_from_me(target, 'posts')
    );
$$;

-- Training days of `target`: own posts that count, plus accepted workout links (shared_by =
-- the post owner). Duplicate days are fine; the streak counts each day once.
create or replace function public.workout_days(target uuid)
returns table (day date, post_id uuid, shared_by uuid)
language sql stable security definer set search_path = ''
as $$
  select p.workout_date, p.id, null::uuid
  from public.posts p
  where p.user_id = target and public.can_view_calendar(target) and public.post_counts_as_workout(p.id)
  union all
  select p.workout_date, p.id, p.user_id
  from public.workout_shares ws
  join public.posts p on p.id = ws.post_id
  where ws.tagged_user_id = target
    and ws.status = 'accepted'
    and public.can_view_calendar(target)
    and public.post_counts_as_workout(p.id);
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
-- Same audience as the owner's posts (followers, or everyone signed in if public; not hidden),
-- and only while the owner shows the plan in the profile. The owner always.
create or replace function public.can_view_plan(plan uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.training_plans tp
    where tp.id = plan
      and (
        tp.user_id = (select auth.uid())
        or (
          tp.show_in_profile
          and (public.is_following(tp.user_id) or public.is_public_content(tp.user_id, 'posts'))
          and not public.is_hidden_from_me(tp.user_id, 'posts')
        )
      )
  );
$$;

-- Creates or replaces the caller's plan in one go. p_days is the full ordered list:
-- [{"id": <existing unit id or null>, "title": "...", "notes": "..."}]. Existing units keep
-- their id (posts stay assigned to them), units left out are removed. 1 to 21 units.
create or replace function public.save_training_plan(p_name text, p_show_in_profile boolean, p_days jsonb)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  plan uuid;
  old_sequence uuid[];
  new_sequence uuid[] := '{}';
  item jsonb;
  item_id uuid;
  idx integer := 0;
begin
  if me is null then
    raise exception 'not authenticated';
  end if;
  if jsonb_typeof(p_days) is distinct from 'array'
    or jsonb_array_length(p_days) not between 1 and 21 then
    raise exception 'plan_length' using hint = 'A plan has 1 to 21 units.';
  end if;

  insert into public.training_plans (user_id, name, show_in_profile)
  values (me, btrim(p_name), coalesce(p_show_in_profile, true))
  on conflict (user_id) do update
    set name = excluded.name, show_in_profile = excluded.show_in_profile, updated_at = now()
  returning id into plan;

  select coalesce(array_agg(d.id order by d.position), '{}') into old_sequence
  from public.plan_days d where d.plan_id = plan;
  -- Out of the way of the new positions (unique per plan).
  update public.plan_days set position = position + 1000 where plan_id = plan;

  for item in select value from jsonb_array_elements(p_days) loop
    item_id := nullif(item ->> 'id', '')::uuid;
    if item_id is not null
      and not (item_id = any (new_sequence))
      and exists (select 1 from public.plan_days d where d.id = item_id and d.plan_id = plan) then
      update public.plan_days
      set position = idx, title = btrim(item ->> 'title'), notes = nullif(btrim(coalesce(item ->> 'notes', '')), '')
      where id = item_id;
    else
      insert into public.plan_days (plan_id, position, title, notes)
      values (plan, idx, btrim(item ->> 'title'), nullif(btrim(coalesce(item ->> 'notes', '')), ''))
      returning id into item_id;
    end if;
    new_sequence := new_sequence || item_id;
    idx := idx + 1;
  end loop;

  delete from public.plan_days where plan_id = plan and not (id = any (new_sequence));
  if old_sequence is distinct from new_sequence then
    update public.training_plans set sequence_changed_at = now() where id = plan;
  end if;
  return plan;
end;
$$;

create or replace function public.delete_training_plan()
returns void
language sql security definer set search_path = ''
as $$
  delete from public.training_plans where user_id = (select auth.uid());
$$;

-- ---------------------------------------------------------------- streak inputs
-- Today in the app's time zone.
create or replace function public.app_today()
returns date
language sql stable set search_path = ''
as $$
  select (now() at time zone 'Europe/Zurich')::date;
$$;

-- Does `target` have a counting training proof on `d` (own post or accepted workout link)?
-- Uses post_counts_as_workout, like workout_days(). Internal.
create or replace function public.is_training_day(target uuid, d date)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
      select 1 from public.posts p
      where p.user_id = target and p.workout_date = d and public.post_counts_as_workout(p.id)
    )
    or exists (
      select 1 from public.workout_shares ws
      join public.posts p on p.id = ws.post_id
      where ws.tagged_user_id = target and ws.status = 'accepted' and p.workout_date = d
        and public.post_counts_as_workout(p.id)
    );
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
  if d is null or d not in (public.app_today(), public.app_today() - 1) then
    raise exception 'rest_day_not_allowed' using hint = 'only today or yesterday';
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
  if d is null or d not in (public.app_today(), public.app_today() - 1) then
    raise exception 'rest_day_not_allowed' using hint = 'only today or yesterday';
  end if;
  delete from public.rest_day_uses where user_id = auth.uid() and day = d;
end;
$$;

-- Rest days of `target`, for whoever may see their calendar (the budget stays private).
create or replace function public.rest_days(target uuid)
returns table (day date)
language sql stable security definer set search_path = ''
as $$
  select r.day from public.rest_day_uses r
  where r.user_id = target and public.can_view_calendar(target);
$$;

-- My training proofs since my plan's order last changed, with their plan unit, for the plan
-- streak. Same notion of "counts" as the normal streak (post_counts_as_workout).
create or replace function public.plan_proofs()
returns table (post_id uuid, day date, created_at timestamptz, plan_day_id uuid)
language sql stable security definer set search_path = ''
as $$
  select p.id, p.workout_date, p.created_at, p.plan_day_id
  from public.posts p
  join public.training_plans tp on tp.user_id = p.user_id
  where p.user_id = (select auth.uid())
    and p.created_at >= tp.sequence_changed_at
    and public.post_counts_as_workout(p.id)
  order by p.workout_date, p.created_at;
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
  where d.id = new.plan_day_id and tp.user_id = new.user_id;
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
  elsif new.status = 'accepted' then
    delete from public.rest_day_uses r
    using public.posts p
    where p.id = new.post_id and r.user_id = new.tagged_user_id and r.day = p.workout_date;
  end if;
  return null;
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

drop trigger if exists notifications_guard_update on public.notifications;
create trigger notifications_guard_update
  before update on public.notifications
  for each row execute function public.on_notification_update();

drop trigger if exists posts_plan_day on public.posts;
create trigger posts_plan_day
  before insert or update on public.posts
  for each row execute function public.on_post_plan_day();

drop trigger if exists posts_training_added on public.posts;
create trigger posts_training_added
  after insert or update of workout_date on public.posts
  for each row execute function public.on_training_added();

drop trigger if exists workout_shares_training_added on public.workout_shares;
create trigger workout_shares_training_added
  after update of status on public.workout_shares
  for each row execute function public.on_training_added();

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
revoke all on function public.save_training_plan(text, boolean, jsonb) from public, anon;
grant execute on function public.save_training_plan(text, boolean, jsonb) to authenticated;
revoke all on function public.delete_training_plan() from public, anon;
grant execute on function public.delete_training_plan() to authenticated;
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
-- Hashtags: read only; rows and counters are maintained by triggers.
revoke all on public.hashtags, public.content_hashtags from anon, authenticated;
grant select on public.hashtags, public.content_hashtags to authenticated;
-- Training plans: read only; written through save_training_plan / delete_training_plan.
revoke all on public.training_plans, public.plan_days from anon, authenticated;
grant select on public.training_plans, public.plan_days to authenticated;
-- Rest days: owners read their own; all writes go through the rest-day functions.
revoke all on public.rest_budgets, public.rest_day_uses from anon, authenticated;
grant select on public.rest_budgets, public.rest_day_uses to authenticated;
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
alter table public.workout_shares       enable row level security;
alter table public.post_reposts         enable row level security;
alter table public.notifications        enable row level security;
alter table public.username_history     enable row level security;
alter table public.training_plans       enable row level security;
alter table public.plan_days            enable row level security;
alter table public.rest_budgets         enable row level security;
alter table public.rest_day_uses        enable row level security;
alter table public.hashtags             enable row level security;
alter table public.content_hashtags     enable row level security;

-- profiles: everyone signed in can read, only you can change your own row.
-- Rows are created by the handle_new_user trigger.
drop policy if exists "profiles: read" on public.profiles;
create policy "profiles: read" on public.profiles
  for select to authenticated using (true);

drop policy if exists "profiles: update own" on public.profiles;
create policy "profiles: update own" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
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
    user_id = (select auth.uid())
    or (
      (
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
    and (storage.foldername(photo_path))[1] = (select auth.uid())::text
  );

drop policy if exists "posts: update own" on public.posts;
create policy "posts: update own" on public.posts
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "posts: delete own" on public.posts;
create policy "posts: delete own" on public.posts
  for delete to authenticated using (user_id = (select auth.uid()));

-- post_media: visible with its post; only the post owner adds, reorders or removes photos.
drop policy if exists "post_media: read on visible posts" on public.post_media;
create policy "post_media: read on visible posts" on public.post_media
  for select to authenticated using (public.can_view_post(post_id));

drop policy if exists "post_media: add to own post" on public.post_media;
create policy "post_media: add to own post" on public.post_media
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.is_my_post(post_id)
    and (storage.foldername(photo_path))[1] = (select auth.uid())::text
    and (original_path is null or (storage.foldername(original_path))[1] = (select auth.uid())::text)
  );

drop policy if exists "post_media: reorder own" on public.post_media;
create policy "post_media: reorder own" on public.post_media
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and public.is_my_post(post_id));

drop policy if exists "post_media: delete own" on public.post_media;
create policy "post_media: delete own" on public.post_media
  for delete to authenticated using (user_id = (select auth.uid()));

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
  with check (public.is_my_post(post_id) and public.can_tag(user_id, 'posts'));

drop policy if exists "post_tags: owner or tagged person removes" on public.post_tags;
create policy "post_tags: owner or tagged person removes" on public.post_tags
  for delete to authenticated
  using (user_id = (select auth.uid()) or public.is_my_post(post_id));

-- post_likes
drop policy if exists "post_likes: read on visible posts" on public.post_likes;
create policy "post_likes: read on visible posts" on public.post_likes
  for select to authenticated using (public.can_view_post(post_id));

drop policy if exists "post_likes: like visible posts" on public.post_likes;
create policy "post_likes: like visible posts" on public.post_likes
  for insert to authenticated
  with check (user_id = (select auth.uid()) and public.can_view_post(post_id));

drop policy if exists "post_likes: unlike own" on public.post_likes;
create policy "post_likes: unlike own" on public.post_likes
  for delete to authenticated using (user_id = (select auth.uid()));

-- comments
drop policy if exists "comments: read on visible posts" on public.comments;
create policy "comments: read on visible posts" on public.comments
  for select to authenticated using (public.can_view_post(post_id));

drop policy if exists "comments: write on visible posts" on public.comments;
create policy "comments: write on visible posts" on public.comments
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.can_view_post(post_id)
    and (parent_comment_id is null or public.is_top_level_comment_on(parent_comment_id, post_id))
  );

drop policy if exists "comments: delete own or on own post" on public.comments;
create policy "comments: delete own or on own post" on public.comments
  for delete to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.posts p
      where p.id = post_id and p.user_id = (select auth.uid())
    )
  );

-- comment_likes: same rules as post_likes, via the comment's post.
drop policy if exists "comment_likes: read on visible comments" on public.comment_likes;
create policy "comment_likes: read on visible comments" on public.comment_likes
  for select to authenticated using (public.can_view_comment(comment_id));

drop policy if exists "comment_likes: like visible comments" on public.comment_likes;
create policy "comment_likes: like visible comments" on public.comment_likes
  for insert to authenticated
  with check (user_id = (select auth.uid()) and public.can_view_comment(comment_id));

drop policy if exists "comment_likes: unlike own" on public.comment_likes;
create policy "comment_likes: unlike own" on public.comment_likes
  for delete to authenticated using (user_id = (select auth.uid()));

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
      and (public.can_view_follow_lists(follower_id) or public.can_view_follow_lists(following_id))
    )
  );

-- The status is set by follows_set_status, whatever the client sends.
drop policy if exists "follows: follow as yourself" on public.follows;
create policy "follows: follow as yourself" on public.follows
  for insert to authenticated with check (follower_id = (select auth.uid()));

-- Only the followed person accepts a request (pending -> accepted, see follows_guard_update).
drop policy if exists "follows: accept requests to me" on public.follows;
create policy "follows: accept requests to me" on public.follows
  for update to authenticated
  using (following_id = (select auth.uid()) and status = 'pending')
  with check (following_id = (select auth.uid()) and status = 'accepted');

-- Unfollow / withdraw a request yourself, or remove a follower / decline a request to you.
drop policy if exists "follows: unfollow as yourself" on public.follows;
drop policy if exists "follows: unfollow, remove follower or decline" on public.follows;
create policy "follows: unfollow, remove follower or decline" on public.follows
  for delete to authenticated
  using (follower_id = (select auth.uid()) or following_id = (select auth.uid()));

-- stories: expired stories are invisible to everyone but their owner, except stories in a
-- highlight the caller may see (owner and followers, see can_view_highlight).
drop policy if exists "stories: read active from followed, own always" on public.stories;
create policy "stories: read active from followed, own always" on public.stories
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (
      expires_at > now()
      and (
        public.is_following(user_id)
        or (select auth.uid()) = any (mentioned_user_ids)
        or public.is_public_content(user_id, 'stories')
      )
      and not public.is_hidden_from_me(user_id, 'stories')
    )
    or public.is_in_visible_highlight(id)
  );

-- Mentions follow can_tag, at most 10.
drop policy if exists "stories: insert own" on public.stories;
create policy "stories: insert own" on public.stories
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (storage.foldername(photo_path))[1] = (select auth.uid())::text
    and public.mentions_allowed(mentioned_user_ids)
  );

drop policy if exists "stories: delete own" on public.stories;
create policy "stories: delete own" on public.stories
  for delete to authenticated using (user_id = (select auth.uid()));

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
  with check (user_id = (select auth.uid()) and public.can_view_story(story_id));

drop policy if exists "story_likes: unlike own" on public.story_likes;
create policy "story_likes: unlike own" on public.story_likes
  for delete to authenticated using (user_id = (select auth.uid()));

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
  with check (user_id = (select auth.uid()) and public.can_view_story(story_id));

-- highlights: owner manages them; owner and followers read them.
-- Same rule as can_view_highlight, but on the row's own columns: inside
-- INSERT ... RETURNING a lookup of the new row by id can't see it yet.
drop policy if exists "highlights: read" on public.highlights;
create policy "highlights: read" on public.highlights
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (
      (public.is_following(user_id) or public.is_public_content(user_id, 'stories'))
      and not public.is_hidden_from_me(user_id, 'stories')
    )
  );

drop policy if exists "highlights: create own" on public.highlights;
create policy "highlights: create own" on public.highlights
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (cover_story_id is null or public.is_my_story(cover_story_id))
  );

drop policy if exists "highlights: update own" on public.highlights;
create policy "highlights: update own" on public.highlights
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and (cover_story_id is null or public.is_my_story(cover_story_id))
  );

drop policy if exists "highlights: delete own" on public.highlights;
create policy "highlights: delete own" on public.highlights
  for delete to authenticated using (user_id = (select auth.uid()));

-- highlight_items: only own stories into own highlights.
drop policy if exists "highlight_items: read" on public.highlight_items;
create policy "highlight_items: read" on public.highlight_items
  for select to authenticated using (public.can_view_highlight(highlight_id));

drop policy if exists "highlight_items: add own story" on public.highlight_items;
create policy "highlight_items: add own story" on public.highlight_items
  for insert to authenticated
  with check (public.is_my_highlight(highlight_id) and public.is_my_story(story_id));

drop policy if exists "highlight_items: remove own" on public.highlight_items;
create policy "highlight_items: remove own" on public.highlight_items
  for delete to authenticated using (public.is_my_highlight(highlight_id));

-- audience_restrictions: private to the owner (the hidden person must not find out).
drop policy if exists "audience_restrictions: owner reads" on public.audience_restrictions;
create policy "audience_restrictions: owner reads" on public.audience_restrictions
  for select to authenticated using (owner_id = (select auth.uid()));

drop policy if exists "audience_restrictions: owner adds" on public.audience_restrictions;
create policy "audience_restrictions: owner adds" on public.audience_restrictions
  for insert to authenticated with check (owner_id = (select auth.uid()));

drop policy if exists "audience_restrictions: owner removes" on public.audience_restrictions;
create policy "audience_restrictions: owner removes" on public.audience_restrictions
  for delete to authenticated using (owner_id = (select auth.uid()));

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
  for select to authenticated using (public.is_conversation_member(conversation_id));

drop policy if exists "messages: members send" on public.messages;
create policy "messages: members send" on public.messages
  for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and public.is_conversation_member(conversation_id)
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

drop policy if exists "messages: delete own" on public.messages;
create policy "messages: delete own" on public.messages
  for delete to authenticated using (sender_id = (select auth.uid()));
-- No update policy: pins change only through set_message_pinned().

-- message_reactions: members of the chat read them; you only set or remove your own.
drop policy if exists "message_reactions: members read" on public.message_reactions;
create policy "message_reactions: members read" on public.message_reactions
  for select to authenticated using (public.is_conversation_member(conversation_id));

drop policy if exists "message_reactions: react as yourself" on public.message_reactions;
create policy "message_reactions: react as yourself" on public.message_reactions
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.is_conversation_member(conversation_id)
    and public.message_in_conversation(message_id, conversation_id)
  );

drop policy if exists "message_reactions: change own" on public.message_reactions;
create policy "message_reactions: change own" on public.message_reactions
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and public.is_conversation_member(conversation_id)
    and public.message_in_conversation(message_id, conversation_id)
  );

drop policy if exists "message_reactions: delete own" on public.message_reactions;
create policy "message_reactions: delete own" on public.message_reactions
  for delete to authenticated using (user_id = (select auth.uid()));

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
  using (tagged_user_id = (select auth.uid()) and status = 'pending')
  with check (tagged_user_id = (select auth.uid()) and status in ('accepted', 'declined'));

-- The owner may withdraw a request while it is still open.
drop policy if exists "workout_shares: owner withdraws pending" on public.workout_shares;
create policy "workout_shares: owner withdraws pending" on public.workout_shares
  for delete to authenticated
  using (public.is_my_post(post_id) and status = 'pending');

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
      and (public.is_following(reposter_id) or public.is_public_content(reposter_id, 'posts'))
      and not public.is_hidden_from_me(reposter_id, 'posts')
    )
  );

drop policy if exists "post_reposts: linked person reposts" on public.post_reposts;
create policy "post_reposts: linked person reposts" on public.post_reposts
  for insert to authenticated
  with check (reposter_id = (select auth.uid()) and public.can_repost(original_post_id));

drop policy if exists "post_reposts: reposter edits caption" on public.post_reposts;
create policy "post_reposts: reposter edits caption" on public.post_reposts
  for update to authenticated
  using (reposter_id = (select auth.uid()))
  with check (reposter_id = (select auth.uid()) and public.can_repost(original_post_id));

drop policy if exists "post_reposts: reposter deletes" on public.post_reposts;
create policy "post_reposts: reposter deletes" on public.post_reposts
  for delete to authenticated using (reposter_id = (select auth.uid()));

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
      show_in_profile
      and (public.is_following(user_id) or public.is_public_content(user_id, 'posts'))
      and not public.is_hidden_from_me(user_id, 'posts')
    )
  );

drop policy if exists "plan_days: read with plan" on public.plan_days;
create policy "plan_days: read with plan" on public.plan_days
  for select to authenticated using (public.can_view_plan(plan_id));

-- rest_budgets / rest_day_uses: only the owner reads; no write policies (functions only).
drop policy if exists "rest_budgets: owner reads" on public.rest_budgets;
create policy "rest_budgets: owner reads" on public.rest_budgets
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "rest_day_uses: owner reads" on public.rest_day_uses;
create policy "rest_day_uses: owner reads" on public.rest_day_uses
  for select to authenticated using (user_id = (select auth.uid()));

-- notifications: only the recipient, only reading and marking as read.
drop policy if exists "notifications: recipient reads" on public.notifications;
create policy "notifications: recipient reads" on public.notifications
  for select to authenticated using (user_id = (select auth.uid()));

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
  using (bucket_id = 'photos' and public.can_view_photo(name));

drop policy if exists "photos: upload to own folder" on storage.objects;
create policy "photos: upload to own folder" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "photos: update own" on storage.objects;
create policy "photos: update own" on storage.objects
  for update to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "photos: delete own" on storage.objects;
create policy "photos: delete own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
