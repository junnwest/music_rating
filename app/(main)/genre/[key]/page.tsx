import { notFound } from 'next/navigation';
import Link from 'next/link';
import { createServerClient } from '../../../../lib/supabaseServer';
import { GENRE_CATEGORIES } from '../../../../lib/genre-categories';
import type { AlbumRelease } from '../../../../types';
import { getServerT } from '../../../../lib/i18n/server';

interface Props {
  params: { key: string };
}

export async function generateStaticParams() {
  return GENRE_CATEGORIES.map((c) => ({ key: c.key }));
}

export default async function GenrePage({ params }: Props) {
  const t = getServerT();
  const category = GENRE_CATEGORIES.find((c) => c.key === params.key);
  if (!category) notFound();

  let albums: AlbumRelease[] = [];

  const supabase = createServerClient();
  if (supabase) {
    const orClause = category.genreFilters.map((g) => `genres.ilike.%${g}%`).join(',');
    const { data } = await supabase
      .from('releases')
      .select('id, title, artist, cover_url, release_type, release_date')
      .or(orClause)
      .not('cover_url', 'is', null)
      .order('release_date', { ascending: false });

    albums = (data ?? []).map((r: any) => ({
      id: r.id,
      title: r.title,
      artist: r.artist,
      coverUrl: r.cover_url ?? null,
      releaseType: r.release_type ?? 'Album',
      date: r.release_date ?? null,
      country: null,
    }));
  }

  return (
    <main className="min-h-screen bg-page">
      {/* Header */}
      <div className="bg-surface border-b border-divider">
        <div className="max-w-[1440px] mx-auto px-5 py-8">
          <Link href="/" className="text-[12px] text-muted hover:text-mid transition">
            {t('genre.backHome')}
          </Link>
          <h1
            className="text-[28px] font-extrabold text-ink mt-3"
            style={{ letterSpacing: '-0.7px' }}
          >
            {category.name}
          </h1>
          <p className="text-[13px] text-muted mt-1">{category.description}</p>
          <p className="text-[12px] text-muted mt-2">{albums.length} {t('genre.albums')}</p>
        </div>
      </div>

      {/* Grid */}
      <div className="max-w-[1440px] mx-auto px-5 py-9 pb-16">
        {albums.length === 0 ? (
          <p className="text-sm text-muted py-16 text-center">No albums found for this category yet.</p>
        ) : (
          <div
            className="grid gap-x-[18px] gap-y-8"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))' }}
          >
            {albums.map((album) => (
              <Link key={album.id} href={`/album/${album.id}`} className="group/card block">
                <div className="relative w-full rounded-[7px] overflow-hidden" style={{ aspectRatio: '1 / 1' }}>
                  {album.coverUrl ? (
                    <img
                      src={album.coverUrl}
                      alt={album.title}
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                  ) : (
                    <div className="absolute inset-0 bg-surface border border-divider" />
                  )}
                  <div className="absolute inset-0 flex items-end justify-end p-2 opacity-0 group-hover/card:opacity-100 transition-opacity">
                    <span className="bg-ink text-white dark:bg-[#F0F0EE] dark:text-[#111111] rounded-[6px] px-[11px] py-[5px] text-[11px] font-semibold">
                      Rate →
                    </span>
                  </div>
                </div>
                <div className="mt-[9px]">
                  <div className="text-[13px] font-semibold text-ink truncate leading-snug">
                    {album.title}
                  </div>
                  <div className="text-[12px] text-muted mt-0.5 truncate">{album.artist}</div>
                  {album.date && (
                    <div className="text-[11px] text-muted mt-0.5">{album.date.slice(0, 4)}</div>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
