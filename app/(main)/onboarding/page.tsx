'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';
import { getCanonSuggestions } from '../../../lib/canon-suggestions';
import { useLanguage } from '../../../lib/i18n';

const GENRES = [
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
            background: i <= current ? '#3DFFD1' : '#EBEBEB',
          }}
        />
      ))}
    </div>
  );
}

interface IdentityData {
  displayName: string;
  username: string;
  bio: string;
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
    available: '#00B894',
    taken: '#E53E3E',
    invalid: '#E53E3E',
  };

  const canProceed =
    displayName.trim().length >= 1 &&
    (usernameStatus === 'available' || (usernameStatus === 'idle' && defaultUsername === username)) &&
    usernameRegex.test(username.toLowerCase().trim());

  return (
    <div>
      <StepDots current={0} total={3} />
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
      </div>

      <button
        onClick={() => onNext({ displayName: displayName.trim(), username: username.toLowerCase().trim(), bio: bio.trim() })}
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
      <StepDots current={1} total={3} />
      <h2 className="text-[26px] font-extrabold text-ink mb-1" style={{ letterSpacing: '-0.7px' }}>
        {t('onboarding.whatDoYouListen')}
      </h2>
      <p className="text-[13px] text-muted mb-8">
        {t('onboarding.pickGenres')}
      </p>

      <div className="flex flex-wrap gap-2 mb-8">
        {GENRES.map((g) => {
          const on = selected.has(g);
          return (
            <button
              key={g}
              onClick={() => toggle(g)}
              className="px-[14px] py-[8px] rounded-full text-[13px] font-semibold border transition"
              style={
                on
                  ? { background: '#3DFFD1', borderColor: '#3DFFD1', color: '#00453A' }
                  : { background: 'white', borderColor: '#EBEBEB', color: '#6B6B6B' }
              }
            >
              {g}
            </button>
          );
        })}
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
            style={{ background: 'rgba(61,255,209,0.4)' }}
          >
            <div className="w-6 h-6 rounded-full flex items-center justify-center" style={{ background: '#3DFFD1' }}>
              <svg width="12" height="9" viewBox="0 0 14 10" fill="none">
                <path d="M1.5 5L5 8.5L12.5 1" stroke="#00453A" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
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
      .limit(GRID_SIZE * 2);
    const seen = new Set(canon.map(r => r.id));
    const extra = (data ?? [])
      .filter((r: any) => !seen.has(r.id))
      .map((r: any) => ({ id: r.id, title: r.title, artist: r.artist, cover_url: r.cover_url, release_type: r.release_type ?? 'Album' }));
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
      } catch {}
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
      <StepDots current={2} total={3} />
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
        {step === 2 && identity && (
          <StepAlbums
            genres={genres}
            selected={albumsSelected}
            onSelectionChange={setAlbumsSelected}
          />
        )}
      </div>

      {step === 2 && identity && (
        <div className="flex gap-3 w-full" style={{ maxWidth: 860 }}>
          <button
            onClick={() => setStep(1)}
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
