import { createServerClient } from './supabaseServer';

export async function getAuthedUserId(authHeader: string | null): Promise<string | null> {
  console.log('[authGuard] header received:', authHeader ? `Bearer ...${authHeader.slice(-8)}` : 'null');

  if (!authHeader?.startsWith('Bearer ')) {
    console.log('[authGuard] FAIL: missing or malformed Authorization header');
    return null;
  }
  const token = authHeader.slice(7);

  const supabase = createServerClient();
  if (!supabase) {
    console.log('[authGuard] FAIL: createServerClient() returned null — check NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY env vars');
    return null;
  }

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error) {
    console.log('[authGuard] FAIL: getUser error:', error.message, error.status);
    return null;
  }
  if (!user) {
    console.log('[authGuard] FAIL: getUser returned no user (token invalid or expired)');
    return null;
  }

  console.log('[authGuard] OK: userId =', user.id);
  return user.id;
}
