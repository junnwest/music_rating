-- rating_likes: one row per user per rating (composite PK prevents duplicates)
create table if not exists rating_likes (
  user_id    uuid not null references profiles(id) on delete cascade,
  rating_id  uuid not null references ratings(id)  on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, rating_id)
);

create index if not exists idx_rating_likes_rating_id on rating_likes(rating_id);

-- rating_comments
create table if not exists rating_comments (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(id) on delete cascade,
  rating_id  uuid not null references ratings(id)  on delete cascade,
  content    text not null check (char_length(content) > 0),
  created_at timestamptz not null default now()
);

create index if not exists idx_rating_comments_rating_id on rating_comments(rating_id);

-- RLS
alter table rating_likes    enable row level security;
alter table rating_comments enable row level security;

create policy "authenticated users can view likes"
  on rating_likes for select using (auth.role() = 'authenticated');

create policy "users manage own likes"
  on rating_likes for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "authenticated users can view comments"
  on rating_comments for select using (auth.role() = 'authenticated');

create policy "users can post comments"
  on rating_comments for insert
  with check (auth.uid() = user_id);

create policy "users can delete own comments"
  on rating_comments for delete using (auth.uid() = user_id);
