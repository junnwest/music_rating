'use client';

function buildSearchUrl(base: string, query: string): string {
  return `${base}${encodeURIComponent(query)}`;
}

// ── Icons ────────────────────────────────────────────────────────────────────

function YTMusicIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.5" />
      <polygon points="10.5,9.5 15.5,12 10.5,14.5" fill="currentColor" />
    </svg>
  );
}

function SpotifyIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
    </svg>
  );
}

function TidalIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 4.5l-4 4-4-4 4-4 4 4zm0 7l-4 4-4-4 4-4 4 4zm7-7l-4 4-4-4 4-4 4 4zm0 0l4 4-4 4-4-4 4-4z" />
    </svg>
  );
}

// ── Album-level buttons ──────────────────────────────────────────────────────

function StreamingLink({
  href,
  icon,
  label,
  className,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  className?: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={label}
      className={`inline-flex items-center justify-center w-9 h-9 rounded-lg border border-white/20 bg-white/10 text-white hover:bg-white/20 transition ${className ?? ''}`}
    >
      {icon}
    </a>
  );
}

export function StreamingButtons({
  artist,
  album,
  spotifyUrl,
  preferred,
}: {
  artist: string;
  album: string;
  spotifyUrl?: string | null;
  preferred?: string | null;
}) {
  const query = `${artist} ${album}`;
  const ytUrl = buildSearchUrl('https://music.youtube.com/search?q=', query);
  const tidalUrl = buildSearchUrl('https://listen.tidal.com/search?q=', query);
  const spUrl = spotifyUrl || buildSearchUrl('https://open.spotify.com/search/', query);

  const showSpotify = !preferred || preferred === 'spotify';
  const showYT = !preferred || preferred === 'youtube_music';
  const showTidal = !preferred || preferred === 'tidal';

  return (
    <div className="inline-flex items-center gap-1.5">
      {showSpotify && <StreamingLink href={spUrl} icon={<SpotifyIcon />} label="Play on Spotify" />}
      {showYT && <StreamingLink href={ytUrl} icon={<YTMusicIcon />} label="Play on YouTube Music" />}
      {showTidal && <StreamingLink href={tidalUrl} icon={<TidalIcon />} label="Play on Tidal" />}
    </div>
  );
}

// ── Track-level buttons ──────────────────────────────────────────────────────

function TrackLink({
  href,
  icon,
  label,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={label}
      className="text-muted hover:text-ink transition flex-shrink-0 p-0.5"
    >
      {icon}
    </a>
  );
}

export function TrackStreamingButtons({
  artist,
  track,
  preferred,
}: {
  artist: string;
  track: string;
  preferred?: string | null;
}) {
  const query = `${artist} ${track}`;
  const spUrl = buildSearchUrl('https://open.spotify.com/search/', query);
  const ytUrl = buildSearchUrl('https://music.youtube.com/search?q=', query);
  const tidalUrl = buildSearchUrl('https://listen.tidal.com/search?q=', query);

  const showSpotify = !preferred || preferred === 'spotify';
  const showYT = !preferred || preferred === 'youtube_music';
  const showTidal = !preferred || preferred === 'tidal';

  return (
    <span className="inline-flex items-center gap-1">
      {showSpotify && <TrackLink href={spUrl} icon={<SpotifyIcon size={13} />} label="Spotify" />}
      {showYT && <TrackLink href={ytUrl} icon={<YTMusicIcon size={13} />} label="YouTube Music" />}
      {showTidal && <TrackLink href={tidalUrl} icon={<TidalIcon size={13} />} label="Tidal" />}
    </span>
  );
}

// Keep old exports for backwards compat with mobile import if needed
export const YouTubeMusicAlbumButton = StreamingButtons;
export const YouTubeMusicTrackButton = TrackStreamingButtons;
