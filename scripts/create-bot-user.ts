/**
 * Creates the silla_bot test account.
 * Run once:  npx ts-node --skip-project scripts/create-bot-user.ts
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY in .env.local
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const BOT_EMAIL    = 'silla.bot@sillajuku.com';
const BOT_PASSWORD = 'SillaBot2026!';
const BOT_USERNAME = 'silla_bot';
const BOT_DISPLAY  = 'Silla Bot';

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  // Create auth user
  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email: BOT_EMAIL,
    password: BOT_PASSWORD,
    email_confirm: true,
    user_metadata: { onboarding_completed: true },
  });

  if (authError) {
    console.error('Auth error:', authError.message);
    process.exit(1);
  }

  const uid = authData.user.id;
  console.log('✓ Auth user created:', uid);

  // Create profile (service role bypasses RLS)
  const { error: profileError } = await admin.from('profiles').insert({
    id: uid,
    username: BOT_USERNAME,
    display_name: BOT_DISPLAY,
    preferred_genres: '',
  });

  if (profileError) {
    console.error('Profile error:', profileError.message);
    process.exit(1);
  }

  console.log('✓ Profile created');
  console.log('\n── Bot account ready ──────────────────');
  console.log(`  Email:    ${BOT_EMAIL}`);
  console.log(`  Password: ${BOT_PASSWORD}`);
  console.log(`  Username: @${BOT_USERNAME}`);
  console.log(`  User ID:  ${uid}`);
  console.log('────────────────────────────────────────');
  console.log('\nSave the User ID — you need it for bot-actions.ts');
}

main();
