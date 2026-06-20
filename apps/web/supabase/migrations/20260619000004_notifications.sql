-- ── Notifications table ─────────────────────────────────────────────────────
create table if not exists notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(id) on delete cascade,  -- recipient
  actor_id   uuid          references profiles(id) on delete set null, -- who triggered it
  type       text not null check (type in ('like', 'comment', 'follow')),
  rating_id  uuid          references ratings(id)  on delete cascade,  -- null for 'follow'
  created_at timestamptz not null default now()
);

create index if not exists idx_notifications_user_id  on notifications(user_id);
create index if not exists idx_notifications_created  on notifications(user_id, created_at desc);

alter table notifications enable row level security;

create policy "users read own notifications"
  on notifications for select using (auth.uid() = user_id);

create policy "system can insert notifications"
  on notifications for insert with check (true);

-- ── Trigger: like on a rating → notify the rating's author ──────────────────
create or replace function _notify_on_like()
returns trigger language plpgsql security definer as $$
declare
  owner_id uuid;
begin
  select user_id into owner_id from ratings where id = new.rating_id;
  if owner_id is not null and owner_id <> new.user_id then
    insert into notifications (user_id, actor_id, type, rating_id)
    values (owner_id, new.user_id, 'like', new.rating_id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_like on rating_likes;
create trigger trg_notify_like
  after insert on rating_likes
  for each row execute function _notify_on_like();

-- ── Trigger: comment on a rating → notify the rating's author ───────────────
create or replace function _notify_on_comment()
returns trigger language plpgsql security definer as $$
declare
  owner_id uuid;
begin
  select user_id into owner_id from ratings where id = new.rating_id;
  if owner_id is not null and owner_id <> new.user_id then
    insert into notifications (user_id, actor_id, type, rating_id)
    values (owner_id, new.user_id, 'comment', new.rating_id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_comment on rating_comments;
create trigger trg_notify_comment
  after insert on rating_comments
  for each row execute function _notify_on_comment();

-- ── Trigger: new follow → notify the followed user ──────────────────────────
create or replace function _notify_on_follow()
returns trigger language plpgsql security definer as $$
begin
  insert into notifications (user_id, actor_id, type)
  values (new.following_id, new.follower_id, 'follow');
  return new;
end;
$$;

drop trigger if exists trg_notify_follow on follows;
create trigger trg_notify_follow
  after insert on follows
  for each row execute function _notify_on_follow();
