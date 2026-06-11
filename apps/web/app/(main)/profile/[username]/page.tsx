import { createServerClient } from '../../../../lib/supabaseServer';
import ProfilePanel from '../../../../components/ProfilePanel';
import { getServerT } from '../../../../lib/i18n/server';

interface Props {
  params: { username: string };
}

export default async function UserProfilePage({ params }: Props) {
  const t = getServerT();
  const username = decodeURIComponent(params.username);
  const supabase = createServerClient();

  let userId: string | null = null;

  if (supabase) {
    // Try profiles table first (fast path — populated after first visit)
    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .eq('username', username)
      .maybeSingle();

    userId = profile?.id ?? null;

    // Fallback: targeted auth.users lookup by email prefix via SQL function.
    // Avoids fetching all users — queries auth.users with an indexed email filter.
    if (!userId) {
      try {
        const { data: uid } = await (supabase as any).rpc('get_user_id_by_email_prefix', { email_prefix: username });
        userId = uid ?? null;
      } catch (err) {
        console.error('[profile] get_user_id_by_email_prefix failed:', err);
      }
    }
  }

  if (!userId) {
    return (
      <main className="min-h-screen bg-page flex items-center justify-center">
        <div className="text-center">
          <p className="text-xl font-bold text-ink mb-2">{t('profile.notFound')}</p>
          <p className="text-sm text-muted">{t('profile.notFoundDesc')} &ldquo;{username}&rdquo;.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-page">
      <ProfilePanel targetUserId={userId} />
    </main>
  );
}
