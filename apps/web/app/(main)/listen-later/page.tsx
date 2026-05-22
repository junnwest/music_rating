'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
import { BookmarkPlus, X } from 'lucide-react';
import { supabase } from '../../../lib/supabaseClient';
import { useLanguage } from '../../../lib/i18n';

interface SavedAlbum {
  id: string;
  title: string;
  artist: string;
  coverUrl: string | null;
}

const STORAGE_KEY = 'sillajuku:listen-later';

function loadIds(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
  } catch {
    return [];
  }
}

function saveIds(ids: string[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
}

export default function ListenLaterPage() {
  const { t } = useLanguage();
  const [albums, setAlbums] = useState<SavedAlbum[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ids = loadIds();
    if (ids.length === 0) { setLoading(false); return; }
    if (!supabase) { setLoading(false); return; }

    supabase
      .from('releases')
      .select('id, title, artist, cover_url')
      .in('id', ids)
      .then(({ data }) => {
        if (data) {
          const map = new Map(data.map((r: any) => [r.id, r]));
          setAlbums(
            ids
              .map(id => map.get(id))
              .filter(Boolean)
              .map((r: any) => ({ id: r.id, title: r.title, artist: r.artist, coverUrl: r.cover_url }))
          );
        }
        setLoading(false);
      });
  }, []);

  const remove = (id: string) => {
    const next = albums.filter(a => a.id !== id);
    setAlbums(next);
    saveIds(next.map(a => a.id));
  };

  return (
    <div className="flex-1">
      <div className="bg-surface border-b border-divider">
        <div className="max-w-[1440px] mx-auto px-5 py-12">
          <p className="text-[11px] font-semibold text-muted uppercase mb-3" style={{ letterSpacing: '0.7px' }}>
            {t('listenLater.library')}
          </p>
          <h1 className="text-[28px] sm:text-[38px] font-extrabold text-ink leading-[1.06]" style={{ letterSpacing: '-1.2px' }}>
            {t('listenLater.title')}
          </h1>
          <p className="text-[15px] text-muted mt-3 max-w-[500px] leading-relaxed">
            {t('listenLater.subtitle')}
          </p>
        </div>
      </div>

      <div className="max-w-[1440px] mx-auto px-5 py-8 pb-16 w-full">
        {loading ? (
          <div className="py-24 text-center">
            <p className="text-[13px] text-muted">{t('listenLater.loadingAlbums')}</p>
          </div>
        ) : albums.length > 0 ? (
          <>
            <p className="text-[13px] text-muted mb-5">{albums.length} {t('listenLater.library').toLowerCase()}</p>
            <div
              className="grid gap-4"
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}
            >
              {albums.map(album => (
                <div key={album.id} className="relative group">
                  <Link href={`/album/${album.id}`} className="block">
                    <div className="w-full aspect-square rounded-lg overflow-hidden bg-surface border border-divider mb-2">
                      {album.coverUrl ? (
                        <img
                          src={album.coverUrl}
                          alt={album.title}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                      ) : (
                        <div className="w-full h-full bg-surface" />
                      )}
                    </div>
                    <p className="text-[13px] font-semibold text-ink truncate group-hover:text-mid transition">{album.title}</p>
                    <p className="text-[12px] text-muted truncate">{album.artist}</p>
                  </Link>
                  <button
                    onClick={() => remove(album.id)}
                    className="absolute top-2 right-2 w-7 h-7 rounded-full bg-page border border-divider flex items-center justify-center text-muted hover:text-red-500 hover:border-red-300 transition opacity-0 group-hover:opacity-100 shadow-sm"
                    title="Remove"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <BookmarkPlus size={36} className="text-subtle mb-3" />
            <p className="text-[15px] font-semibold text-ink">{t('listenLater.noAlbums')}</p>
            <p className="text-[13px] text-muted mt-1 max-w-[300px]">
              {t('listenLater.noAlbumsDesc')}
            </p>
            <Link
              href="/"
              className="mt-4 text-[13px] font-semibold text-ink border border-divider rounded-lg px-5 py-2 hover:bg-surface transition"
            >
              {t('listenLater.discoverAlbums')}
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
