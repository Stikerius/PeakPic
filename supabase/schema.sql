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
--   * training plans up to 10 per user, exactly one active: an ordered cycle of days
--                   (plan_days: training or rest) with exercises (plan_exercises), not tied
--                   to weekdays.
--                   Readable by the owner, and per plan visibility ('private' | 'followers' |
--                   'public', public only while the profile is public; can_view_plan).
--                   Written only through save_plan() / activate_plan() / duplicate_plan() /
--                   delete_plan(); sequence_changed_at marks changes of order or day types
--                   and activation (the plan streak restarts there).
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
  foreach t in array array['posts', 'stories', 'comments', 'messages', 'training_plans'] loop
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
-- linked people). Every post that wasn't removed by moderation counts; a later automatic
-- check plugs in here.
create or replace function public.post_counts_as_workout(post uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  -- Removed or quarantined posts don't count.
  select exists (select 1 from public.posts p where p.id = post and p.moderation_state is null);
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
-- 1 to 30 days, at most 20 exercises per training day, at most 10 plans. My first plan is
-- active at once.
create or replace function public.save_plan(
  p_plan_id uuid, p_name text, p_visibility text, p_allow_adopt boolean, p_days jsonb
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  plan uuid := p_plan_id;
  old_sequence text[];
  new_sequence text[] := '{}';
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
            not exists (select 1 from public.training_plans tp where tp.user_id = me and tp.is_active))
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

  select coalesce(array_agg(d.id::text || ':' || d.day_type order by d.position), '{}') into old_sequence
  from public.plan_days d where d.plan_id = plan;
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
    new_sequence := new_sequence || (day_id::text || ':' || day_kind);

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
  -- New order (or a day turned into a rest day): the plan streak starts again from day 1.
  if old_sequence is distinct from new_sequence then
    update public.training_plans set sequence_changed_at = now() where id = plan;
  end if;
  return plan;
end;
$$;

-- Makes one of my plans the active one. The order starts again at day 1 and the plan streak
-- runs anew; posts keep their assignment.
create or replace function public.activate_plan(p_plan_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not authenticated';
  end if;
  if not public.is_account_active() then
    raise exception 'account_inactive';
  end if;
  if not exists (select 1 from public.training_plans tp where tp.id = p_plan_id and tp.user_id = me) then
    raise exception 'plan_not_found';
  end if;
  update public.training_plans set is_active = false where user_id = me and is_active and id <> p_plan_id;
  update public.training_plans set is_active = true, sequence_changed_at = now(), updated_at = now()
  where id = p_plan_id;
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
    or not exists (select 1 from public.training_plans tp where tp.user_id = me and tp.is_active) then
    update public.training_plans set is_active = false where user_id = me and is_active;
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
  select e.name
  from public.plan_exercises e
  join public.plan_days d on d.id = e.plan_day_id
  join public.training_plans tp on tp.id = d.plan_id
  where tp.user_id = (select auth.uid())
  group by lower(e.name), e.name
  order by count(*) desc, e.name
  limit 200;
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
    union all
    select r.day, r.created_at, r.plan_day_id, 'rest'
    from public.planned_rest_uses r
    join public.training_plans tp on tp.id = r.plan_id and tp.is_active
    where r.user_id = p_user and r.created_at >= tp.sequence_changed_at
  ) x
  order by x.day, x.created_at;
$$;

-- Confirms the planned rest day of the active plan for `d` (today or yesterday). Allowed when
-- the plan entry before it is really done: the last completed entry (training day or planned
-- rest day) was on the day before `d`, and the entry after it is a rest day. Not on a day with
-- training, not twice. Keeps the streak alive, doesn't count as a training day.
create or replace function public.use_planned_rest_day(d date)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  plan public.training_plans%rowtype;
  entries uuid[];
  kinds text[];
  last_day date;
  last_entry uuid;
  last_index integer;
  next_index integer;
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
  select array_agg(pd.id order by pd.position), array_agg(pd.day_type order by pd.position)
  into entries, kinds
  from public.plan_days pd where pd.plan_id = plan.id;

  -- The last completed entry before d that belongs to the plan.
  select pp.day, pp.plan_day_id into last_day, last_entry
  from public.plan_progress(me) pp
  where pp.day < d and pp.plan_day_id = any (entries)
  order by pp.day desc, pp.created_at desc
  limit 1;
  if last_entry is null then
    raise exception 'planned_rest_not_due' using hint = 'no completed plan day before';
  end if;
  if last_day <> d - 1 then
    raise exception 'planned_rest_not_due' using hint = 'the previous plan day was not done the day before';
  end if;
  last_index := array_position(entries, last_entry);
  next_index := (last_index % array_length(entries, 1)) + 1;
  if kinds[next_index] <> 'rest' then
    raise exception 'planned_rest_not_due' using hint = 'the next plan day is a training day';
  end if;
  insert into public.planned_rest_uses (user_id, day, plan_id, plan_day_id)
  values (me, d, plan.id, entries[next_index]);
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

-- Reports a post, story, comment, profile or plan. Only what the caller may see, never their own,
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

  if report.target_type in ('post', 'story', 'comment', 'message', 'plan')
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
  foreach t in array array['posts', 'stories', 'comments', 'messages', 'training_plans'] loop
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
revoke all on function public.activate_plan(uuid) from public, anon;
grant execute on function public.activate_plan(uuid) to authenticated;
revoke all on function public.duplicate_plan(uuid) from public, anon;
grant execute on function public.duplicate_plan(uuid) to authenticated;
revoke all on function public.delete_plan(uuid) from public, anon;
grant execute on function public.delete_plan(uuid) to authenticated;
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
-- Hashtags: read only; rows and counters are maintained by triggers.
revoke all on public.hashtags, public.content_hashtags from anon, authenticated;
grant select on public.hashtags, public.content_hashtags to authenticated;
-- Training plans: read only; written through save_plan / activate_plan / duplicate_plan / delete_plan.
revoke all on public.training_plans, public.plan_days, public.plan_exercises from anon, authenticated;
grant select on public.training_plans, public.plan_days, public.plan_exercises to authenticated;
revoke all on public.planned_rest_uses from anon, authenticated;
grant select on public.planned_rest_uses to authenticated;
-- Adoptions: no client access (the daily limit and notifications are handled in adopt_plan).
revoke all on public.plan_adoptions from anon, authenticated;
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
alter table public.workout_shares       enable row level security;
alter table public.post_reposts         enable row level security;
alter table public.notifications        enable row level security;
alter table public.username_history     enable row level security;
alter table public.training_plans       enable row level security;
alter table public.plan_days            enable row level security;
alter table public.plan_exercises       enable row level security;
alter table public.planned_rest_uses    enable row level security;
alter table public.plan_adoptions       enable row level security;
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
  using (moderation_state is null and public.is_account_active() and public.is_conversation_member(conversation_id));

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

drop policy if exists "messages: delete own" on public.messages;
create policy "messages: delete own" on public.messages
  for delete to authenticated
  using (sender_id = (select auth.uid()) and public.is_account_active() and moderation_state is null);
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

-- notifications: only the recipient, only reading and marking as read.
drop policy if exists "notifications: recipient reads" on public.notifications;
create policy "notifications: recipient reads" on public.notifications
  for select to authenticated
  using (user_id = (select auth.uid()) and (actor_id is null or public.can_see_account(actor_id)));

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
    or exists (select 1 from public.training_plans x where x.user_id = p_user and x.moderation_state = 'quarantined') then
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
  ('screen_home', 'home', 'client'),
  ('screen_feed', 'feed', 'client'),
  ('screen_post', 'feed', 'client'),
  ('screen_comments', 'feed', 'client'),
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
create or replace function public.on_usage_event()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
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
      ('training_plans', 'insert', 'plan_adopted')
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
      'plans', (select count(*) from public.training_plans)
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
