import { createServerClient } from './supabaseServer';

export async function getAuthedUserId(authHeader: string | null): Promise<string | null> {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);

  // Use the service-role client's getUser(token) — the SDK validates the JWT
  // against Supabase and returns the user. More reliable than a raw fetch to
  // /auth/v1/user which breaks with the new sb_publishable_ key format.
  const supabase = createServerClient();
  if (!supabase) return null;

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;
  return user.id;
}
