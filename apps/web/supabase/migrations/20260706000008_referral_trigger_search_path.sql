-- Fix: credit_referral_on_phone_verified() references public.referrals /
-- public.verified_phones unqualified. The trigger fires from auth.users'
-- own update path (GoTrue's connection role), whose default search_path
-- doesn't reliably include `public` the way a normal SQL-editor session's
-- does -- confirmed live: `select to_regclass('public.referrals')` resolved
-- fine from the SQL editor, but the trigger itself failed with
-- `relation "referrals" does not exist` (SQLSTATE 42P01) during a real
-- phone verification. Matches Supabase's own documented pattern for
-- auth.users triggers (their handle_new_user() example always pins
-- `security definer set search_path = public` for this exact reason).
ALTER FUNCTION credit_referral_on_phone_verified() SET search_path = public;

-- redeem_referral_code() is normally called via PostgREST as `authenticated`,
-- whose search_path does include public -- but pinning it here too removes
-- any dependence on that role's configuration remaining that way.
ALTER FUNCTION redeem_referral_code(text) SET search_path = public;
