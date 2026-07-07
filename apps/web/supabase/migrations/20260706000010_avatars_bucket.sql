-- Creates the "avatars" storage bucket -- EditProfileView.swift has always
-- uploaded to it (path "<user id>/avatar.jpg"), but the bucket itself was
-- never actually created, so every upload has been silently failing with
-- "Bucket not found" and getting swallowed by that view's own catch block.
--
-- Public read (avatar URLs are shown to other users on profiles/comments/etc,
-- same as any other public avatar), write restricted to a user's own folder
-- (path's first segment must equal auth.uid()) so nobody can overwrite
-- someone else's avatar.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists "avatar images are publicly accessible" on storage.objects;
create policy "avatar images are publicly accessible" on storage.objects
  for select using (bucket_id = 'avatars');

drop policy if exists "users can upload their own avatar" on storage.objects;
create policy "users can upload their own avatar" on storage.objects
  for insert with check (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "users can update their own avatar" on storage.objects;
create policy "users can update their own avatar" on storage.objects
  for update using (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "users can delete their own avatar" on storage.objects;
create policy "users can delete their own avatar" on storage.objects
  for delete using (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
  );
