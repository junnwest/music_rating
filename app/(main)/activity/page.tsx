import { unstable_noStore as noStore } from 'next/cache';
import Link from 'next/link';
import { createServerClient } from '../../../lib/supabaseServer';

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

export default async function ActivityPage() {
  noStore();
  const supabase = createServerClient();

  if (!supabase) {
    return (
      <div className="max-w-[720px] mx-auto px-5 py-16 text-center">
        <p className="text-sm text-muted">Database not available.</p>
      </div>
    );
  }

  const [{ data: ratings }, { data: reviews }] = await Promise.all([
    supabase
      .from('ratings')
      .select('user_id, release_id, score, created_at, releases(id, title, artist, cover_url)')
      .order('created_at', { ascending: false })
      .limit(30),
    supabase
      .from('reviews')
      .select('user_id, username, release_id, body, created_at')
      .order('created_at', { ascending: false })
      .limit(30),
  ]);

  // Build username map from auth
  let userMap = new Map<string, string>();
  try {
    const { data: { users } } = await supabase.auth.admin.listUsers();
    userMap = new Map(users.map((u) => [u.id, u.email?.split('@')[0] ?? 'user']));
  } catch {}

  // Get release info for reviews
  const reviewReleaseIds = [...new Set((reviews ?? []).map((r) => r.release_id))];
  const { data: reviewReleases } = reviewReleaseIds.length > 0
    ? await supabase.from('releases').select('id, title, artist, cover_url').in('id', reviewReleaseIds)
    : { data: [] };
  const releaseMap = new Map((reviewReleases ?? []).map((r: any) => [r.id, r]));

  type FeedItem = {
    type: 'rating' | 'review';
    username: string;
    release: any;
    score?: number;
    body?: string;
    date: string;
    releaseId: string;
  };

  const feed: FeedItem[] = [
    ...(ratings ?? []).map((r: any) => ({
      type: 'rating' as const,
      username: userMap.get(r.user_id) ?? 'user',
      release: r.releases,
      score: r.score,
      date: r.created_at,
      releaseId: r.release_id,
    })),
    ...(reviews ?? []).map((r: any) => ({
      type: 'review' as const,
      username: r.username,
      release: releaseMap.get(r.release_id) ?? null,
      body: r.body,
      date: r.created_at,
      releaseId: r.release_id,
    })),
  ]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 50);

  return (
    <div className="bg-white min-h-screen">
      <div className="bg-surface border-b border-[#EBEBEB]">
        <div className="max-w-[1440px] mx-auto px-5 py-8">
          <h1 className="text-[24px] font-extrabold text-ink" style={{ letterSpacing: '-0.6px' }}>
            Activity
          </h1>
          <p className="text-[13px] text-muted mt-1">Recent ratings and reviews from the community</p>
        </div>
      </div>

      <div className="max-w-[720px] mx-auto px-5 py-9 pb-14">
        {feed.length === 0 ? (
          <p className="text-sm text-muted">No activity yet. Be the first to rate an album.</p>
        ) : (
          <div className="flex flex-col">
            {feed.map((item, i) => (
              <div key={i} className="flex gap-4 py-5 border-b border-[#EBEBEB] last:border-0">
                {/* Avatar */}
                <div className="w-8 h-8 rounded-full bg-mint-bg border border-mint flex items-center justify-center text-[11px] font-bold text-mint-dark flex-shrink-0 mt-0.5">
                  {item.username[0].toUpperCase()}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] leading-snug">
                        <span className="font-semibold text-ink">{item.username}</span>
                        <span className="text-muted"> {item.type === 'rating' ? 'rated' : 'reviewed'} </span>
                        <Link href={`/album/${item.releaseId}`} className="font-semibold text-ink hover:text-mid transition">
                          {item.release?.title ?? '—'}
                        </Link>
                        {item.score && (
                          <span
                            className="inline-flex items-center ml-2 text-[10px] font-bold rounded-[4px] px-[6px] py-[1px] align-middle"
                            style={{ background: '#3DFFD1', color: '#00453A' }}
                          >
                            ★ {item.score}
                          </span>
                        )}
                      </p>
                      {item.release?.artist && (
                        <p className="text-[12px] text-muted mt-0.5">{item.release.artist}</p>
                      )}
                      {item.type === 'review' && item.body && (
                        <p className="text-[13px] text-mid mt-2 leading-relaxed line-clamp-2 italic">
                          "{item.body}"
                        </p>
                      )}
                      <p className="text-[11px] text-muted mt-1.5">{timeAgo(item.date)}</p>
                    </div>

                    {item.release?.cover_url && (
                      <Link href={`/album/${item.releaseId}`} className="flex-shrink-0">
                        <img
                          src={item.release.cover_url}
                          alt={item.release.title}
                          className="w-[52px] h-[52px] rounded-[5px] object-cover"
                        />
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
