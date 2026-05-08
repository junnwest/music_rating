import { createClient } from '@supabase/supabase-js';

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const TEST_PASSWORD = process.env.TEST_USER2_PASSWORD;
if (!TEST_PASSWORD) {
  console.error('Missing TEST_USER2_PASSWORD in .env.local');
  process.exit(1);
}

async function main() {
  const { data, error } = await admin.auth.admin.createUser({
    email: 'music.lover@sillajuku.com',
    password: TEST_PASSWORD,
    email_confirm: true,
    user_metadata: { onboarding_completed: true },
  });
  if (error) { console.error('Auth error:', error.message); process.exit(1); }

  const uid = data.user.id;
  const { error: pe } = await admin.from('profiles').insert({
    id: uid, username: 'music_lover', display_name: 'Music Lover', preferred_genres: '',
  });
  if (pe) { console.error('Profile error:', pe.message); process.exit(1); }

  console.log('✓ Created @music_lover');
  console.log('  Email:    music.lover@sillajuku.com');
  console.log('  ID:      ', uid);
}

main();
