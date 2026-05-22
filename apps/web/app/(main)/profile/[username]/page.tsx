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

    // Fallback: scan auth.users by email prefix (covers users who haven't visited their profile yet)
    if (!userId) {
      try {
        const { data: { users } } = await supabase.auth.admin.listUsers({ perPage: 1000 });
        const match = users.find((u) => u.email?.split('@')[0] === username);
        userId = match?.id ?? null;
      } catch {}
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
