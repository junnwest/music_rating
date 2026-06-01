-- Accomplishments / Badges system
-- accomplishment_definitions: catalogue of all possible badges
create table if not exists accomplishment_definitions (
  id         text primary key,          -- e.g. 'ratings_10', 'ratings_50', 'leaderboard_all'
  title      text not null,             -- "Rated 10 Albums"
  description text not null,            -- shown on profile / notification
  icon       text not null default '🏅', -- emoji icon
  badge_type text not null              -- 'milestone' | 'completion'
);

-- user_accomplishments: earned badges per user
create table if not exists user_accomplishments (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references profiles(id) on delete cascade,
  definition_id text not null references accomplishment_definitions(id) on delete cascade,
  earned_at     timestamptz not null default now(),
  notified      boolean not null default false,
  unique (user_id, definition_id)
);

-- Indexes for fast lookups
create index if not exists user_accomplishments_user_idx on user_accomplishments(user_id);
create index if not exists user_accomplishments_notified_idx on user_accomplishments(user_id, notified);

-- RLS
alter table accomplishment_definitions enable row level security;
alter table user_accomplishments enable row level security;

-- Anyone can read badge definitions
create policy "accomplishment_definitions_public_read"
  on accomplishment_definitions for select using (true);

-- Users can read their own accomplishments; also allow read by others for profile display
create policy "user_accomplishments_read"
  on user_accomplishments for select using (true);

-- Only the service role / server inserts (no direct client writes)
create policy "user_accomplishments_insert_service"
  on user_accomplishments for insert with check (false);

-- Seed the initial badge definitions
insert into accomplishment_definitions (id, title, description, icon, badge_type) values
  ('ratings_10',  'First 10',      'Rated 10 albums',            '🎵', 'milestone'),
  ('ratings_50',  'Fifty Deep',    'Rated 50 albums',            '🎧', 'milestone'),
  ('ratings_100', 'Century Club',  'Rated 100 albums',           '💿', 'milestone'),
  ('ratings_500', 'Audiophile',    'Rated 500 albums',           '🏆', 'milestone'),
  ('leaderboard_complete', 'Full Sweep', 'Rated every album in a community leaderboard', '⭐', 'completion')
on conflict (id) do nothing;
