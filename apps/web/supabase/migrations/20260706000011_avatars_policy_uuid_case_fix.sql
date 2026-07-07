-- Fix: the write policies from 20260706000010 compared the path's folder
-- segment to auth.uid() as plain text, but Swift's UUID.uuidString is always
-- UPPERCASE (e.g. "C8DB8A49-...") while Postgres's auth.uid()::text cast is
-- lowercase ("c8db8a49-..."). A case-sensitive text comparison of the same
-- UUID in two different cases never matches -- confirmed live: upload failed
-- with "new row violates row-level security policy" right after the bucket
-- itself was created successfully. Casting both sides to `uuid` instead of
-- comparing as `text` sidesteps this entirely, since Postgres's UUID parser
-- (and equality) is case-insensitive.
drop policy if exists "users can upload their own avatar" on storage.objects;
create policy "users can upload their own avatar" on storage.objects
  for insert with check (
    bucket_id = 'avatars' and (storage.foldername(name))[1]::uuid = auth.uid()
  );

drop policy if exists "users can update their own avatar" on storage.objects;
create policy "users can update their own avatar" on storage.objects
  for update using (
    bucket_id = 'avatars' and (storage.foldername(name))[1]::uuid = auth.uid()
  );

drop policy if exists "users can delete their own avatar" on storage.objects;
create policy "users can delete their own avatar" on storage.objects
  for delete using (
    bucket_id = 'avatars' and (storage.foldername(name))[1]::uuid = auth.uid()
  );
