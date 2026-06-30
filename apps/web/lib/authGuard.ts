import { createClient } from '@supabase/supabase-js';

export async function getAuthedUserId(authHeader: string | null): Promise<string | null> {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  // Prefer the service-role key (server-side secret, always available at runtime).
  // NEXT_PUBLIC_ vars are baked in at build time and may be stale on Vercel.
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  const client = createClient(url, key, { auth: { persistSession: false } });
  const { data: { user } } = await client.auth.getUser(token);
  return user?.id ?? null;
}
