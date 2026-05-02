import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { albums, artists } from '@/data';
import { AlbumCard } from '@/components/AlbumCard';
import { SearchIcon } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlQuery = searchParams.get('q') || '';
  const [query, setQuery] = useState(urlQuery);

  useEffect(() => {
    setQuery(urlQuery);
  }, [urlQuery]);

  const handleSearch = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && query.trim()) {
      setSearchParams({ q: query.trim() });
    }
  };

  const albumResults = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return albums.filter(a =>
      a.title.toLowerCase().includes(q) ||
      a.artist.toLowerCase().includes(q)
    );
  }, [query]);

  const artistResults = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return artists.filter(a =>
      a.name.toLowerCase().includes(q) ||
      a.genres.some(g => g.toLowerCase().includes(q))
    );
  }, [query]);

  const hasQuery = query.trim().length > 0;
  const hasResults = albumResults.length > 0 || artistResults.length > 0;

  return (
    <div className="flex-1 bg-white">
      <div className="max-w-[1440px] mx-auto px-5 py-8 pb-14 w-full">
        {/* Search input */}
        <div className="bg-surface border border-divider rounded-full px-4 py-2.5 flex items-center gap-2 max-w-[560px] mb-8">
          <SearchIcon size={15} className="text-muted" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleSearch}
            placeholder="Search albums, artists…"
            className="flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-placeholder"
          />
        </div>

        {/* No query yet */}
        {!hasQuery && (
          <div className="text-center py-20">
            <SearchIcon size={32} className="text-subtle mx-auto mb-3" />
            <p className="text-[14px] text-muted">Type something and press Enter to search.</p>
          </div>
        )}

        {/* Has query */}
        {hasQuery && (
          <>
            <p className="text-[13px] text-muted mb-6">
              Showing results for <strong className="text-ink">"{query}"</strong>
              {hasResults && (
                <span className="text-muted font-normal"> — {albumResults.length + artistResults.length} found</span>
              )}
            </p>

            {/* Artists */}
            {artistResults.length > 0 && (
              <section className="mb-8">
                <h2 className="text-[13px] font-bold text-muted uppercase mb-4" style={{ letterSpacing: '0.7px' }}>Artists</h2>
                <div className="flex flex-wrap gap-3">
                  {artistResults.map(artist => (
                    <Link
                      key={artist.id}
                      to={`/artist/${artist.id}`}
                      className="flex items-center gap-3 border border-divider rounded-xl px-4 py-3 bg-white hover:border-mid transition group"
                    >
                      <div className={`w-10 h-10 rounded-full ${artist.avatarGradient}`} />
                      <div>
                        <p className="text-[13px] font-semibold text-ink group-hover:text-mid transition">{artist.name}</p>
                        <p className="text-[11px] text-muted">{artist.genres.join(' · ')}</p>
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            )}

            {/* Albums */}
            {albumResults.length > 0 && (
              <section>
                <h2 className="text-[13px] font-bold text-muted uppercase mb-4" style={{ letterSpacing: '0.7px' }}>Albums</h2>
                <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
                  {albumResults.map(album => (
                    <motion.div key={album.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
                      <AlbumCard album={album} size="md" showYear />
                    </motion.div>
                  ))}
                </div>
              </section>
            )}

            {/* No results */}
            {!hasResults && (
              <div className="text-center py-16">
                <p className="text-[14px] text-muted">No results found for "{query}".</p>
                <p className="text-[12px] text-subtle mt-1">Try a different spelling or keyword.</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
