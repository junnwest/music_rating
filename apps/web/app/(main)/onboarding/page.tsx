'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';
import { getCanonSuggestions } from '../../../lib/canon-suggestions';
import { useLanguage } from '../../../lib/i18n';

const FALLBACK_GENRES = [
  'K-Pop', 'K-Indie', 'K-R&B', 'K-Rap', 'Korean Ballad', 'Korean Folk',
  'J-Pop', 'J-Rock', 'City Pop',
  'Indie Rock', 'Alternative', 'Post-Rock', 'Shoegaze',
  'Hip-Hop', 'R&B & Soul', 'Jazz',
  'Folk', 'Electronic', 'Ambient', 'Classical', 'Pop',
];

interface PickAlbum {
  id: string;
  title: string;
  artist: string;
  cover_url: string | null;
  release_type: string;
}

function StepDots({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-[7px] mb-8">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className="rounded-full transition-all"
          style={{
            width: i === current ? 20 : 7,
            height: 7,
            background: i <= current ? '#E8A020' : '#EBEBEB',
          }}
        />
      ))}
    </div>
  );
}

const COUNTRIES = [
  { code: 'KR', label: '🇰🇷 South Korea' },
  { code: 'JP', label: '🇯🇵 Japan' },
  { code: 'TW', label: '🇹🇼 Taiwan' },
  { code: 'HK', label: '🇭🇰 Hong Kong' },
  { code: 'SG', label: '🇸🇬 Singapore' },
  { code: 'CN', label: '🇨🇳 China' },
  { code: 'US', label: '🇺🇸 United States' },
  { code: 'GB', label: '🇬🇧 United Kingdom' },
  { code: 'CA', label: '🇨🇦 Canada' },
  { code: 'AU', label: '🇦🇺 Australia' },
  { code: 'PH', label: '🇵🇭 Philippines' },
  { code: 'ID', label: '🇮🇩 Indonesia' },
  { code: 'TH', label: '🇹🇭 Thailand' },
  { code: 'VN', label: '🇻🇳 Vietnam' },
  { code: 'MY', label: '🇲🇾 Malaysia' },
  { code: 'OTHER', label: '🌍 Other' },
];

type StreamingPlatform = 'spotify' | 'youtube_music' | 'tidal' | 'apple_music' | null;

interface IdentityData {
  displayName: string;
  username: string;
  bio: string;
  country: string;
}

function StepIdentity({
  defaultUsername,
  onNext,
}: {
  defaultUsername: string;
  onNext: (data: IdentityData) => void;
}) {
  const { t } = useLanguage();
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState(defaultUsername);
  const [bio, setBio] = useState('');
  const [country, setCountry] = useState('');
  const [usernameStatus, setUsernameStatus] = useState<'idle' | 'checking' | 'available' | 'taken' | 'invalid'>('idle');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const usernameRegex = /^[a-z0-9_]{3,20}$/;

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const val = username.toLowerCase().trim();
    if (!val) { setUsernameStatus('idle'); return; }
    if (!usernameRegex.test(val)) { setUsernameStatus('invalid'); return; }
    setUsernameStatus('checking');
    debounceRef.current = setTimeout(async () => {
      const res = await fetch(`/api/check-username?username=${encodeURIComponent(val)}`);
      const json = await res.json();
      setUsernameStatus(json.available ? 'available' : 'taken');
    }, 400);
  }, [username]);

  const usernameHint: Record<typeof usernameStatus, string> = {
    idle: t('onboarding.usernameHintIdle'),
    checking: t('onboarding.usernameHintChecking'),
    available: t('onboarding.usernameHintAvailable'),
    taken: t('onboarding.usernameHintTaken'),
    invalid: t('onboarding.usernameHintInvalid'),
  };

  const usernameColor: Record<typeof usernameStatus, string> = {
    idle: '#A0A09C',
    checking: '#A0A09C',
    available: '#E8A020',
    taken: '#E53E3E',
    invalid: '#E53E3E',
  };

  const canProceed =
    displayName.trim().length >= 1 &&
    (usernameStatus === 'available' || (usernameStatus === 'idle' && defaultUsername === username)) &&
    usernameRegex.test(username.toLowerCase().trim());

  return (
    <div>
      <StepDots current={0} total={4} />
      <h2 className="text-[26px] font-extrabold text-ink mb-1" style={{ letterSpacing: '-0.7px' }}>
        {t('onboarding.setupProfile')}
      </h2>
      <p className="text-[13px] text-muted mb-8">{t('onboarding.findYou')}</p>

      <div className="flex flex-col gap-5">
        <div>
          <label className="block text-[12px] font-semibold text-ink mb-1.5">{t('onboarding.displayName')}</label>
          <input
            autoFocus
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder={t('onboarding.displayNamePlaceholder')}
            maxLength={40}
            className="w-full bg-surface border border-divider rounded-lg px-4 py-[10px] text-[14px] text-ink placeholder:text-muted outline-none focus:border-ink transition"
          />
        </div>

        <div>
          <label className="block text-[12px] font-semibold text-ink mb-1.5">{t('onboarding.username')}</label>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[14px] text-muted">@</span>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
              placeholder={t('onboarding.usernamePlaceholder')}
              maxLength={20}
              className="w-full bg-surface border border-divider rounded-lg pl-8 pr-4 py-[10px] text-[14px] text-ink placeholder:text-muted outline-none focus:border-ink transition"
            />
          </div>
          <p className="text-[11px] mt-1.5" style={{ color: usernameColor[usernameStatus] }}>
            {usernameHint[usernameStatus]}
          </p>
        </div>

        <div>
          <label className="block text-[12px] font-semibold text-ink mb-1.5">
            {t('onboarding.bio')} <span className="font-normal text-muted">{t('onboarding.optional')}</span>
          </label>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value.slice(0, 160))}
            placeholder={t('onboarding.bioPlaceholder')}
            rows={2}
            className="w-full bg-surface border border-divider rounded-lg px-4 py-[10px] text-[14px] text-ink placeholder:text-muted outline-none focus:border-ink transition resize-none"
          />
          <p className="text-[11px] text-muted mt-1 text-right">{bio.length}/160</p>
        </div>

        <div>
          <label className="block text-[12px] font-semibold text-ink mb-1.5">
            {t('onboarding.country')} <span className="font-normal text-muted">{t('onboarding.optional')}</span>
          </label>
          <select
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            className="w-full bg-surface border border-divider rounded-lg px-4 py-[10px] text-[14px] text-ink outline-none focus:border-ink transition appearance-none"
          >
            <option value="">{t('onboarding.countryPlaceholder')}</option>
            {COUNTRIES.map(({ code, label }) => (
              <option key={code} value={code}>{label}</option>
            ))}
          </select>
        </div>
      </div>

      <button
        onClick={() => onNext({ displayName: displayName.trim(), username: username.toLowerCase().trim(), bio: bio.trim(), country })}
        disabled={!canProceed}
        className="mt-8 w-full bg-ink text-white dark:bg-[#F0F0EE] dark:text-[#111111] rounded-lg py-[13px] text-[14px] font-bold transition hover:opacity-80 disabled:opacity-35 disabled:cursor-not-allowed"
      >
        {t('onboarding.nextBtn')}
      </button>
    </div>
  );
}

function StepGenres({
  onNext,
  onBack,
}: {
  onNext: (genres: string[]) => void;
  onBack: () => void;
}) {
  const { t } = useLanguage();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [genres, setGenres] = useState<string[]>([]);
  const [loadingGenres, setLoadingGenres] = useState(true);

  useEffect(() => {
    fetch('/api/genres/top')
      .then((r) => r.json())
      .then(({ genres: g }) => setGenres(Array.isArray(g) ? g : FALLBACK_GENRES))
      .catch(() => setGenres(FALLBACK_GENRES))
      .finally(() => setLoadingGenres(false));
  }, []);

  const toggle = (g: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(g) ? next.delete(g) : next.add(g);
      return next;
    });
  };

  const selectionHint =
    selected.size === 0
      ? t('onboarding.selectAtLeast3')
      : selected.size < 3
      ? `${3 - selected.size} more`
      : `${selected.size} selected`;

  return (
    <div>
      <StepDots current={1} total={4} />
      <h2 className="text-[26px] font-extrabold text-ink mb-1" style={{ letterSpacing: '-0.7px' }}>
        {t('onboarding.whatDoYouListen')}
      </h2>
      <p className="text-[13px] text-muted mb-8">
        {t('onboarding.pickGenres')}
      </p>

      <div className="flex flex-wrap gap-2 mb-8">
        {loadingGenres ? (
          <p className="text-[13px] text-muted">{t('onboarding.loading')}</p>
        ) : (
          genres.map((g) => {
            const on = selected.has(g);
            return (
              <button
                key={g}
                onClick={() => toggle(g)}
                className="px-[14px] py-[8px] rounded-full text-[13px] font-semibold border transition"
                style={
                  on
                    ? { background: '#E8A020', borderColor: '#E8A020', color: '#7A4F0A' }
                    : { background: 'white', borderColor: '#EBEBEB', color: '#6B6B6B' }
                }
              >
                {g}
              </button>
            );
          })
        )}
      </div>

      <p className="text-[12px] text-muted mb-6">{selectionHint}</p>

      <div className="flex gap-3">
        <button
          onClick={onBack}
          className="flex-1 border border-divider text-ink rounded-lg py-[13px] text-[14px] font-semibold hover:bg-surface transition"
        >
          {t('onboarding.backBtn')}
        </button>
        <button
          onClick={() => onNext([...selected])}
          disabled={selected.size < 3}
          className="flex-[2] bg-ink text-white dark:bg-[#F0F0EE] dark:text-[#111111] rounded-lg py-[13px] text-[14px] font-bold transition hover:opacity-80 disabled:opacity-35 disabled:cursor-not-allowed"
        >
          {t('onboarding.nextBtn')}
        </button>
      </div>
    </div>
  );
}

const STREAMING_PLATFORMS = [
  {
    id: 'spotify' as const,
    label: 'Spotify',
    color: '#1DB954',
    icon: (
      <svg width={28} height={28} viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
      </svg>
    ),
  },
  {
    id: 'youtube_music' as const,
    label: 'YouTube Music',
    color: '#FF0000',
    icon: (
      <svg width={28} height={28} viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.5" />
        <polygon points="10.5,9.5 15.5,12 10.5,14.5" fill="currentColor" />
      </svg>
    ),
  },
  {
    id: 'tidal' as const,
    label: 'Tidal',
    color: '#000000',
    icon: (
      <svg width={28} height={28} viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 4.5l-4 4-4-4 4-4 4 4zm0 7l-4 4-4-4 4-4 4 4zm7-7l-4 4-4-4 4-4 4 4zm0 0l4 4-4 4-4-4 4-4z" />
      </svg>
    ),
  },
  {
    id: 'apple_music' as const,
    label: 'Apple Music',
    color: '#FC3C44',
    icon: (
      <svg width={28} height={28} viewBox="0 0 24 24" fill="currentColor">
        <path d="M9 3v11.5a2.5 2.5 0 102.5 2.5V9l7-1.5V5L9 3z" />
      </svg>
    ),
  },
];

function StepStreaming({
  value,
  onChange,
  onNext,
  onBack,
}: {
  value: StreamingPlatform;
  onChange: (v: StreamingPlatform) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const { t } = useLanguage();
  return (
    <div>
      <StepDots current={2} total={4} />
      <h2 className="text-[26px] font-extrabold text-ink mb-1" style={{ letterSpacing: '-0.7px' }}>
        {t('onboarding.streamingTitle')}
      </h2>
      <p className="text-[13px] text-muted mb-8">{t('onboarding.streamingDesc')}</p>

      <div className="flex flex-col gap-3 mb-8">
        {STREAMING_PLATFORMS.map((p) => {
          const selected = value === p.id;
          return (
            <button
              key={p.id}
              onClick={() => onChange(selected ? null : p.id)}
              className="flex items-center gap-4 px-5 py-4 rounded-xl border-2 text-left transition"
              style={
                selected
                  ? { borderColor: '#E8A020', background: 'rgba(232,160,32,0.07)' }
                  : { borderColor: '#EBEBEB', background: 'transparent' }
              }
            >
              <span style={{ color: selected ? p.color : '#A0A09C' }}>{p.icon}</span>
              <span className="text-[15px] font-semibold text-ink">{p.label}</span>
              {selected && (
                <span className="ml-auto text-[#E8A020]">
                  <svg width={18} height={18} viewBox="0 0 18 18" fill="none">
                    <circle cx="9" cy="9" r="9" fill="#E8A020" />
                    <path d="M5 9l3 3 5-5" stroke="#7A4F0A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              )}
            </button>
          );
        })}

        <button
          onClick={() => onChange(null)}
          className="flex items-center gap-4 px-5 py-4 rounded-xl border-2 text-left transition"
          style={
            value === null
              ? { borderColor: '#E8A020', background: 'rgba(232,160,32,0.07)' }
              : { borderColor: '#EBEBEB', background: 'transparent' }
          }
        >
          <span className="text-[15px] font-semibold text-ink">{t('onboarding.streamingNone')}</span>
          <span className="text-[12px] text-muted ml-1">— {t('onboarding.streamingNoneDesc')}</span>
          {value === null && (
            <span className="ml-auto text-[#E8A020]">
              <svg width={18} height={18} viewBox="0 0 18 18" fill="none">
                <circle cx="9" cy="9" r="9" fill="#E8A020" />
                <path d="M5 9l3 3 5-5" stroke="#7A4F0A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          )}
        </button>
      </div>

      <div className="flex gap-3">
        <button
          onClick={onBack}
          className="flex-1 border border-divider text-ink rounded-lg py-[13px] text-[14px] font-semibold hover:bg-surface transition"
        >
          {t('onboarding.backBtn')}
        </button>
        <button
          onClick={onNext}
          className="flex-[2] bg-ink text-white dark:bg-[#F0F0EE] dark:text-[#111111] rounded-lg py-[13px] text-[14px] font-bold transition hover:opacity-80"
        >
          {t('onboarding.nextBtn')}
        </button>
      </div>
    </div>
  );
}

const COLS = 7;
const ROWS = 4;
const GRID_SIZE = COLS * ROWS;
const MAX_ALBUMS = 6;

function AlbumCell({
  album,
  isSelected,
  disabled,
  onToggle,
}: {
  album: PickAlbum;
  isSelected: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      disabled={disabled}
      className={`group/cell block w-full text-left ${disabled ? 'opacity-30 cursor-not-allowed' : ''}`}
    >
      <div className="relative w-full aspect-square rounded-[7px] overflow-hidden bg-surface">
        {album.cover_url && (
          <img
            src={album.cover_url}
            alt={album.title}
            className="absolute inset-0 w-full h-full object-cover"
          />
        )}
        {isSelected && (
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{ background: 'rgba(232,160,32,0.2)' }}
          >
            <div className="w-6 h-6 rounded-full flex items-center justify-center" style={{ background: '#E8A020' }}>
              <svg width="12" height="9" viewBox="0 0 14 10" fill="none">
                <path d="M1.5 5L5 8.5L12.5 1" stroke="#7A4F0A" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          </div>
        )}
        {!isSelected && !disabled && (
          <div
            className="absolute inset-0 opacity-0 group-hover/cell:opacity-100 transition flex items-center justify-center"
            style={{ background: 'rgba(0,0,0,0.14)' }}
          >
            <div className="w-6 h-6 rounded-full border-2 border-white" />
          </div>
        )}
      </div>
      <p className="mt-[5px] text-[11px] font-semibold text-ink truncate leading-tight">{album.title}</p>
      <p className="text-[10px] text-muted truncate">{album.artist}</p>
    </button>
  );
}


function StepAlbums({
  genres,
  selected,
  onSelectionChange,
}: {
  genres: string[];
  selected: PickAlbum[];
  onSelectionChange: (albums: PickAlbum[]) => void;
}) {
  const { t } = useLanguage();
  const [query, setQuery] = useState('');
  const [pool, setPool] = useState<PickAlbum[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { loadDefaults(); }, []);

  const TYPE_ORDER: Record<string, number> = { album: 0, ep: 1, single: 2 };

  const loadDefaults = async () => {
    if (!supabase) return;
    const canon = await getCanonSuggestions(supabase, genres, GRID_SIZE * 2);
    if (canon.length >= GRID_SIZE) {
      setPool(canon);
      return;
    }
    const { data } = await supabase
      .from('releases')
      .select('id, title, artist, cover_url, release_type')
      .not('cover_url', 'is', null)
      .limit(GRID_SIZE * 4);
    const seen = new Set(canon.map(r => r.id));
    const extra = (data ?? [])
      .filter((r: any) => !seen.has(r.id))
      .map((r: any) => ({ id: r.id, title: r.title, artist: r.artist, cover_url: r.cover_url, release_type: r.release_type ?? 'Album' }))
      .sort((a: any, b: any) => {
        const aOrd = TYPE_ORDER[a.release_type?.toLowerCase()] ?? 3;
        const bOrd = TYPE_ORDER[b.release_type?.toLowerCase()] ?? 3;
        return aOrd - bOrd;
      });
    setPool([...canon, ...extra].slice(0, GRID_SIZE * 2));
  };

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) { loadDefaults(); return; }
    debounceRef.current = setTimeout(async () => {
      if (!supabase) return;
      const q = query.trim();
      const { data } = await supabase
        .from('releases')
        .select('id, title, artist, cover_url, release_type')
        .or(`title.ilike.%${q}%,artist.ilike.%${q}%`)
        .not('cover_url', 'is', null)
        .limit(GRID_SIZE);
      if (data && data.length > 0) {
        setPool(data.map((r: any) => ({
          id: r.id, title: r.title, artist: r.artist,
          cover_url: r.cover_url, release_type: r.release_type ?? 'Album',
        })));
        return;
      }
      try {
        const res = await fetch(`/api/search?query=${encodeURIComponent(q)}`);
        const json = await res.json();
        if (json.releases) {
          setPool(json.releases.slice(0, GRID_SIZE).map((r: any) => ({
            id: r.id, title: r.title, artist: r.artist,
            cover_url: r.coverUrl, release_type: r.releaseType ?? 'Album',
          })));
        }
      } catch (err) {
        console.error('[onboarding] Spotify search fallback failed:', err);
      }
    }, 350);
  }, [query]);

  const toggle = (album: PickAlbum) => {
    if (selected.find((s) => s.id === album.id)) {
      onSelectionChange(selected.filter((s) => s.id !== album.id));
    } else if (selected.length < MAX_ALBUMS) {
      onSelectionChange([...selected, album]);
    }
  };

  const selectedIds = new Set(selected.map((s) => s.id));
  const poolFiltered = pool.filter((a) => !selectedIds.has(a.id));
  const displayed = [...selected, ...poolFiltered].slice(0, GRID_SIZE);

  return (
    <div>
      <StepDots current={3} total={4} />
      <div className="flex items-end justify-between mb-1">
        <h2 className="text-[26px] font-extrabold text-ink" style={{ letterSpacing: '-0.7px' }}>
          {t('onboarding.yourEssentials')}
        </h2>
        {selected.length > 0 && (
          <span className="text-[12px] text-muted mb-1">{selected.length}/{MAX_ALBUMS} picked</span>
        )}
      </div>
      <p className="text-[13px] text-muted mb-4">
        {t('onboarding.essentialsDesc')}
      </p>

      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('onboarding.searchAlbum')}
        className="w-full bg-surface border border-divider rounded-lg px-4 py-[9px] text-[14px] text-ink placeholder:text-muted outline-none focus:border-ink transition mb-4"
      />

      <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-7 gap-[10px]">
        {displayed.map((album) => (
          <AlbumCell
            key={album.id}
            album={album}
            isSelected={selectedIds.has(album.id)}
            disabled={!selectedIds.has(album.id) && selected.length >= MAX_ALBUMS}
            onToggle={() => toggle(album)}
          />
        ))}
      </div>
    </div>
  );
}

export default function OnboardingPage() {
  const router = useRouter();
  const { t } = useLanguage();
  const [step, setStep] = useState(0);
  const [identity, setIdentity] = useState<IdentityData | null>(null);
  const [genres, setGenres] = useState<string[]>([]);
  const [streamingPlatform, setStreamingPlatform] = useState<StreamingPlatform>(null);
  const [albumsSelected, setAlbumsSelected] = useState<PickAlbum[]>([]);
  const [saving, setSaving] = useState(false);
  const [defaultUsername, setDefaultUsername] = useState('');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      const user = data.session?.user;
      if (!user) { router.replace('/login'); return; }
      if (user.user_metadata?.onboarding_completed) { router.replace('/'); return; }
      setDefaultUsername(user.email?.split('@')[0]?.replace(/[^a-z0-9_]/g, '') ?? '');
      setReady(true);
    });
  }, []);

  const handleFinish = async (albums: PickAlbum[]) => {
    if (!supabase || !identity) return;
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      await supabase.from('profiles').upsert({
        id: user.id,
        username: identity.username,
        display_name: identity.displayName,
        bio: identity.bio || null,
        preferred_genres: genres.join(','),
        country: identity.country || null,
        preferred_streaming_platform: streamingPlatform,
      }, { onConflict: 'id' });

      if (albums.length > 0) {
        await supabase.from('releases').upsert(
          albums.map((a) => ({ id: a.id, title: a.title, artist: a.artist, cover_url: a.cover_url, release_type: a.release_type })),
          { onConflict: 'id', ignoreDuplicates: true }
        );
        await supabase.from('pinned_albums').upsert(
          albums.map((a) => ({ user_id: user.id, release_id: a.id })),
          { onConflict: 'user_id,release_id', ignoreDuplicates: true }
        );
      }

      await supabase.auth.updateUser({ data: { onboarding_completed: true } });
      router.replace(`/profile/${identity.username}`);
    } catch (err) {
      console.error('[Onboarding] save error:', err);
      setSaving(false);
    }
  };

  if (!ready) {
    return (
      <div className="min-h-screen bg-page flex items-center justify-center">
        <p className="text-sm text-muted">{t('onboarding.loading')}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-page flex flex-col items-center justify-center px-4 py-8 gap-4">
      <div
        className="bg-page rounded-[20px] border border-divider shadow-xl w-full flex flex-col p-5 sm:p-10"
        style={{ maxWidth: 860 }}
      >
        <div className="text-[11px] font-semibold text-muted uppercase mb-6" style={{ letterSpacing: '0.7px' }}>
          {t('onboarding.welcome')}
        </div>

        {step === 0 && (
          <StepIdentity
            defaultUsername={defaultUsername}
            onNext={(data) => { setIdentity(data); setStep(1); }}
          />
        )}
        {step === 1 && (
          <StepGenres
            onNext={(g) => { setGenres(g); setStep(2); }}
            onBack={() => setStep(0)}
          />
        )}
        {step === 2 && (
          <StepStreaming
            value={streamingPlatform}
            onChange={setStreamingPlatform}
            onNext={() => setStep(3)}
            onBack={() => setStep(1)}
          />
        )}
        {step === 3 && identity && (
          <StepAlbums
            genres={genres}
            selected={albumsSelected}
            onSelectionChange={setAlbumsSelected}
          />
        )}
      </div>

      {step === 3 && identity && (
        <div className="flex gap-3 w-full" style={{ maxWidth: 860 }}>
          <button
            onClick={() => setStep(2)}
            disabled={saving}
            className="flex-1 bg-page border border-divider text-ink rounded-lg py-[13px] text-[14px] font-semibold hover:bg-surface transition disabled:opacity-40"
          >
            {t('onboarding.backBtn')}
          </button>
          <button
            onClick={() => handleFinish(albumsSelected)}
            disabled={saving}
            className="flex-[2] bg-ink text-white dark:bg-[#F0F0EE] dark:text-[#111111] rounded-lg py-[13px] text-[14px] font-bold transition hover:opacity-80 disabled:opacity-50"
          >
            {saving ? t('onboarding.savingBtn') : albumsSelected.length === 0 ? t('onboarding.skipFinish') : t('onboarding.finish')}
          </button>
        </div>
      )}
    </div>
  );
}
