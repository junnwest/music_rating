import { unstable_noStore as noStore } from 'next/cache';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createServerClient } from '../../../../lib/supabaseServer';
import UserAvatar from '../../../../components/UserAvatar';

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

export default async function ListDetailPage({ params }: { params: { id: string } }) {
  noStore();
  const supabase = createServerClient();

  if (!supabase) notFound();

  const { data: list } = await supabase
    .from('lists')
    .select('id, title, description, user_id, username, created_at')
    .eq('id', params.id)
    .single();

  if (!list) notFound();

  const { data: items } = await supabase
    .from('list_items')
    .select('id, release_id, added_at, releases(id, title, artist, cover_url)')
    .eq('list_id', params.id)
    .order('added_at', { ascending: false });

  const albums = (items ?? []).map((item: any) => ({
    itemId: item.id,
    releaseId: item.release_id,
    addedAt: item.added_at,
    release: item.releases,
  }));

  return (
    <div className="bg-page min-h-screen">
      {/* Header */}
      <div className="bg-surface border-b border-divider">
        <div className="max-w-[1440px] mx-auto px-5 py-8">
          <Link href="/explore" className="text-[12px] text-muted hover:text-ink transition mb-3 inline-block">
            ← Explore
          </Link>
          <h1 className="text-[24px] font-extrabold text-ink" style={{ letterSpacing: '-0.6px' }}>
            {list.title}
          </h1>
          {list.description && (
            <p className="text-[13px] text-muted mt-1">{list.description}</p>
          )}
          <div className="flex items-center gap-2 mt-3">
            <UserAvatar size={20} />
            <span className="text-[12px] text-muted">{list.username ?? 'user'}</span>
            <span className="text-[12px] text-[#D0D0CE]">·</span>
            <span className="text-[12px] text-muted">{albums.length} {albums.length === 1 ? 'album' : 'albums'}</span>
            <span className="text-[12px] text-[#D0D0CE]">·</span>
            <span className="text-[12px] text-muted">Created {timeAgo(list.created_at)}</span>
          </div>
        </div>
      </div>

      {/* Albums grid */}
      <div className="max-w-[1440px] mx-auto px-5 py-9 pb-14">
        {albums.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-sm text-muted">No albums in this list yet.</p>
          </div>
        ) : (
          <div className="grid gap-x-[18px] gap-y-8" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(152px, 1fr))' }}>
            {albums.map(({ itemId, releaseId, addedAt, release }) => (
              <Link key={itemId} href={`/album/${releaseId}`} className="block min-w-0 group/card">
                <div className="relative overflow-hidden rounded-[7px]" style={{ aspectRatio: '1 / 1' }}>
                  {release?.cover_url ? (
                    <img
                      src={release.cover_url}
                      alt={release.title}
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                  ) : (
                    <div className="absolute inset-0 bg-surface border border-divider" />
                  )}
                </div>
                <div className="mt-[9px]">
                  <div className="text-[13px] font-semibold text-ink truncate leading-snug group-hover/card:text-mint-dark transition">
                    {release?.title ?? '—'}
                  </div>
                  <div className="text-[12px] text-muted mt-0.5 truncate">{release?.artist ?? ''}</div>
                  <div className="text-[11px] text-muted mt-0.5">{timeAgo(addedAt)}</div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
