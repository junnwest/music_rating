export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const required = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  ];

  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(
      `[sillajuku] Missing required environment variables: ${missing.join(', ')}. ` +
      'Add them to .env.local before starting the server.',
    );
  }
}
