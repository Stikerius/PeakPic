-- =============================================================================
-- PeakPic database schema
--
-- Paste this whole file into Supabase Dashboard → SQL Editor and run it.
-- The script is idempotent: running it again updates functions and policies
-- without dropping data.
--
-- Visibility model
--   * profiles      readable by every signed-in user (needed for search)
--   * follows       readable by every signed-in user (follower counts)
--   * comments      readable (and likeable) exactly when their post is
--   * posts/stories readable by the owner and by people who follow the owner;
--                   a post shared into a chat is also readable by that chat's members;
--                   tagged people can see a story. Owners can hide their posts and/or
--                   stories from specific people (audience_restrictions); that always wins.
--   * chats         only members can read conversations, members and messages
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
    where follower_id = (select auth.uid()) and following_id = target
  );
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
          (public.is_following(p.user_id) or public.is_post_shared_with_me(p.id))
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
          and (public.is_following(s.user_id) or (select auth.uid()) = any (s.mentioned_user_ids))
          and not public.is_hidden_from_me(s.user_id, 'stories')
        )
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
      select 1 from public.stories s
      where s.photo_path = object_name and public.can_view_story(s.id)
    );
$$;

-- Lets the sign-up screen check a username before an account exists.
create or replace function public.username_available(name text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select not exists (select 1 from public.profiles where username = lower(name));
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

  select cm.conversation_id into conversation
  from public.conversation_members cm
  join public.conversation_members other
    on other.conversation_id = cm.conversation_id and other.user_id = other_user
  where cm.user_id = me
    and (select count(*) from public.conversation_members all_m
         where all_m.conversation_id = cm.conversation_id) = 2
  limit 1;

  if conversation is null then
    insert into public.conversations (created_by) values (me) returning id into conversation;
    insert into public.conversation_members (conversation_id, user_id)
    values (conversation, me), (conversation, other_user);
  end if;

  return conversation;
end;
$$;

-- Create a profile for every new auth user, using the username from sign-up metadata.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, username)
  values (
    new.id,
    coalesce(
      lower(new.raw_user_meta_data ->> 'username'),
      'user_' || substr(replace(new.id::text, '-', ''), 1, 12)
    )
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

revoke all on function public.get_or_create_direct_conversation(uuid) from public, anon;
grant execute on function public.get_or_create_direct_conversation(uuid) to authenticated;
grant execute on function public.username_available(text) to anon, authenticated;


-- -----------------------------------------------------------------------------
-- Table privileges (RLS below decides which rows)
-- -----------------------------------------------------------------------------

grant select, insert, update, delete on
  public.profiles, public.posts, public.post_likes, public.comments, public.comment_likes, public.follows,
  public.stories, public.story_likes, public.story_views, public.audience_restrictions,
  public.conversations, public.conversation_members, public.messages
to authenticated;


-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------

alter table public.profiles             enable row level security;
alter table public.posts                enable row level security;
alter table public.post_likes           enable row level security;
alter table public.comments             enable row level security;
alter table public.comment_likes        enable row level security;
alter table public.follows              enable row level security;
alter table public.stories              enable row level security;
alter table public.story_likes          enable row level security;
alter table public.story_views          enable row level security;
alter table public.audience_restrictions enable row level security;
alter table public.conversations        enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages             enable row level security;

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
drop policy if exists "posts: read own, followed or shared" on public.posts;
create policy "posts: read own, followed or shared" on public.posts
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (
      (public.is_following(user_id) or public.is_post_shared_with_me(id))
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
drop policy if exists "follows: read" on public.follows;
create policy "follows: read" on public.follows
  for select to authenticated using (true);

drop policy if exists "follows: follow as yourself" on public.follows;
create policy "follows: follow as yourself" on public.follows
  for insert to authenticated with check (follower_id = (select auth.uid()));

drop policy if exists "follows: unfollow as yourself" on public.follows;
create policy "follows: unfollow as yourself" on public.follows
  for delete to authenticated using (follower_id = (select auth.uid()));

-- stories: expired stories are invisible to everyone but their owner.
drop policy if exists "stories: read active from followed, own always" on public.stories;
create policy "stories: read active from followed, own always" on public.stories
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (
      expires_at > now()
      and (public.is_following(user_id) or (select auth.uid()) = any (mentioned_user_ids))
      and not public.is_hidden_from_me(user_id, 'stories')
    )
  );

-- You can only tag people you follow.
drop policy if exists "stories: insert own" on public.stories;
create policy "stories: insert own" on public.stories
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (storage.foldername(photo_path))[1] = (select auth.uid())::text
    and public.follows_all(mentioned_user_ids)
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
  );

drop policy if exists "messages: delete own" on public.messages;
create policy "messages: delete own" on public.messages
  for delete to authenticated using (sender_id = (select auth.uid()));


-- -----------------------------------------------------------------------------
-- Realtime (used by chats in a later phase)
-- -----------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
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
