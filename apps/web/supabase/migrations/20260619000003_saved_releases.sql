create table if not exists saved_releases (
  user_id    uuid not null references profiles(id) on delete cascade,
  release_id uuid not null references releases(id)   on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, release_id)
);

create index if not exists idx_saved_releases_user_id on saved_releases(user_id);

alter table saved_releases enable row level security;

create policy "users manage own saved releases"
  on saved_releases for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);
