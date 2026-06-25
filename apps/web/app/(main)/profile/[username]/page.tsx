import type { Metadata } from 'next';
import { createServerClient } from '../../../../lib/supabaseServer';
import ProfilePanel from '../../../../components/ProfilePanel';
import { getServerT } from '../../../../lib/i18n/server';

interface Props {
  params: { username: string };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const username = decodeURIComponent(params.username);
  const supabase = createServerClient();

  let displayName = username;
  let avatarUrl: string | null = null;

  if (supabase) {
    const { data } = await supabase
      .from('profiles')
      .select('display_name, avatar_url')
      .eq('username', username)
      .maybeSingle();
    displayName = data?.display_name ?? username;
    avatarUrl = data?.avatar_url ?? null;
  }

  return {
    title: `${displayName} (@${username}) — sillajuku`,
    description: `See ${displayName}'s music ratings and taste on sillajuku.`,
    openGraph: {
      title: `${displayName} on sillajuku`,
      description: `See ${displayName}'s music ratings and taste.`,
      url: `https://sillajuku.com/profile/${username}`,
      siteName: 'sillajuku',
      type: 'profile',
      ...(avatarUrl && { images: [{ url: avatarUrl }] }),
    },
    twitter: {
      card: 'summary',
      title: `${displayName} on sillajuku`,
      description: `See ${displayName}'s music ratings and taste.`,
      ...(avatarUrl && { images: [avatarUrl] }),
    },
  };
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
