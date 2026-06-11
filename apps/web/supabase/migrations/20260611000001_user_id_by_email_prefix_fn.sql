-- Replaces auth.admin.listUsers(perPage:1000) in the profile page.
-- Queries auth.users directly with a targeted filter instead of fetching
-- all users and finding the match in application code.
CREATE OR REPLACE FUNCTION public.get_user_id_by_email_prefix(email_prefix TEXT)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM auth.users
  WHERE split_part(email, '@', 1) = email_prefix
  LIMIT 1;
$$;
