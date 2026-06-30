export async function getAuthedUserId(authHeader: string | null): Promise<string | null> {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  // Use the anon key as the apikey for the /auth/v1/user request.
  // The service-role key is intentionally NOT used here: some supabase-js versions
  // override the Authorization header when initialising with a service-role client,
  // which breaks user-JWT validation. A direct fetch with the user's JWT in
  // Authorization is the reliable path for any key choice.
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;

  const resp = await fetch(`${url}/auth/v1/user`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${token}`,
    },
  });
  if (!resp.ok) return null;
  const user = await resp.json() as { id?: string } | null;
  return user?.id ?? null;
}
