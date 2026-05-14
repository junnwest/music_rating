'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { useState, useEffect, Suspense } from 'react';
import {
  User, Sliders, Bell, Shield, AlertTriangle,
  LogOut, Trash2, Camera
} from 'lucide-react';
import { supabase } from '../../../lib/supabaseClient';
import UserAvatar from '../../../components/UserAvatar';

type TabKey = 'account' | 'preferences' | 'notifications' | 'privacy' | 'danger';

const tabs = [
  { key: 'account' as TabKey, label: 'Account', icon: User },
  { key: 'preferences' as TabKey, label: 'Preferences', icon: Sliders },
  { key: 'notifications' as TabKey, label: 'Notifications', icon: Bell },
  { key: 'privacy' as TabKey, label: 'Privacy', icon: Shield },
  { key: 'danger' as TabKey, label: 'Danger Zone', icon: AlertTriangle },
];

const regions = ['Global', 'Korea', 'Japan', 'United States', 'United Kingdom', 'Philippines', 'Indonesia', 'Thailand', 'Vietnam', 'China'];
const allGenres = ['K-Pop', 'K-Indie', 'K-R&B', 'K-Rap', 'J-Pop', 'J-Rock', 'City Pop', 'Hip-Hop', 'R&B', 'Rock', 'Electronic', 'Pop', 'Jazz', 'Folk', 'Soul', 'Indie', 'Alternative', 'Metal', 'Classical'];
const visibilityOptions = ['Public', 'Followers only', 'Private'];

function SettingsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlTab = searchParams.get('tab') as TabKey | null;
  const validTabs: TabKey[] = ['account', 'preferences', 'notifications', 'privacy', 'danger'];
  const [activeTab, setActiveTab] = useState<TabKey>(
    urlTab && validTabs.includes(urlTab) ? urlTab : 'account'
  );

  const [userId, setUserId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [bio, setBio] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeGenres, setActiveGenres] = useState<Set<string>>(new Set(['K-R&B', 'K-Indie', 'Hip-Hop']));
  const [ratingDisplay, setRatingDisplay] = useState<'Stars' | 'Decimal'>('Stars');

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(async ({ data }) => {
      const uid = data.session?.user?.id;
      if (!uid) return;
      setUserId(uid);
      const { data: profile } = await supabase!
        .from('profiles')
        .select('display_name, username, bio')
        .eq('id', uid)
        .maybeSingle();
      if (profile) {
        setDisplayName(profile.display_name ?? '');
        setUsername(profile.username ?? data.session!.user.email?.split('@')[0] ?? '');
        setBio(profile.bio ?? '');
      } else {
        setUsername(data.session!.user.email?.split('@')[0] ?? '');
      }
    });
  }, []);

  const handleSave = async () => {
    if (!supabase || !userId) return;
    setSaving(true);
    setError(null);

    const { data: existing } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', userId)
      .maybeSingle();

    const { error: saveError } = existing
      ? await supabase
          .from('profiles')
          .update({ display_name: displayName, username, bio })
          .eq('id', userId)
      : await supabase
          .from('profiles')
          .insert({ id: userId, display_name: displayName, username, bio });

    if (saveError) {
      setError(saveError.message);
    } else {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
    setSaving(false);
  };

  const handleSignOut = async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    router.push('/login');
  };

  const toggleGenre = (g: string) => {
    setActiveGenres(prev => {
      const next = new Set(prev);
      next.has(g) ? next.delete(g) : next.add(g);
      return next;
    });
  };

  const avatarInitial = (displayName || username || '?')[0].toUpperCase();

  return (
    <div className="flex-1">
      <div className="max-w-[900px] mx-auto px-5 py-10 pb-20 w-full">
        <div className="mb-8">
          <h1 className="text-[28px] md:text-[32px] font-extrabold text-ink tracking-tight">Settings</h1>
          <p className="text-[13px] text-muted mt-1">Manage your account, preferences, and privacy.</p>
        </div>

        <div className="flex flex-col md:flex-row gap-6 md:gap-8">
          {/* Tab nav */}
          <nav className="md:w-[180px] flex-shrink-0 flex md:flex-col gap-1 overflow-x-auto md:overflow-visible scrollbar-hide pb-1 md:pb-0">
            {tabs.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[13px] font-semibold whitespace-nowrap transition md:w-full ${
                  activeTab === key
                    ? 'bg-mint-bg text-mint-dark'
                    : 'text-muted hover:bg-surface hover:text-ink'
                }`}
              >
                <Icon size={16} strokeWidth={activeTab === key ? 2.2 : 1.8} />
                {label}
              </button>
            ))}
          </nav>

          {/* Content */}
          <div className="flex-1 min-w-0">
            {activeTab === 'account' && (
              <Section title="Account">
                <div className="flex items-center gap-4 mb-6">
                  <UserAvatar size={64} />
                  <button className="flex items-center gap-2 px-4 py-2 rounded-lg border border-divider text-[12px] font-semibold text-muted hover:bg-surface transition">
                    <Camera size={14} /> Change photo
                  </button>
                </div>
                <Field label="Display name" value={displayName} onChange={setDisplayName} />
                <Field label="Username" value={username} onChange={setUsername} hint={username ? `@${username}` : undefined} />
                <Field label="Bio" value={bio} onChange={setBio} textarea />
                {error && <p className="text-[12px] text-red-500 mb-3">{error}</p>}
                <div className="flex gap-3 mt-6">
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="bg-ink text-white rounded-xl px-6 py-2.5 text-[13px] font-bold hover:opacity-80 transition disabled:opacity-50"
                  >
                    {saved ? 'Saved' : saving ? 'Saving…' : 'Save changes'}
                  </button>
                  <button onClick={handleSignOut} className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-divider text-[13px] font-semibold text-muted hover:bg-surface transition">
                    <LogOut size={14} /> Log out
                  </button>
                </div>

              </Section>
            )}

            {activeTab === 'preferences' && (
              <Section title="Preferences">
                <div className="mb-5">
                  <label className="block text-[13px] font-semibold text-ink mb-2">Default region</label>
                  <select className="w-full bg-surface border border-divider rounded-xl px-4 py-2.5 text-[13px] text-ink outline-none cursor-pointer hover:border-mid transition">
                    {regions.map(r => <option key={r}>{r}</option>)}
                  </select>
                </div>
                <div className="mb-5">
                  <label className="block text-[13px] font-semibold text-ink mb-2">Favorite genres</label>
                  <div className="flex flex-wrap gap-2">
                    {allGenres.map(g => {
                      const on = activeGenres.has(g);
                      return (
                        <button
                          key={g}
                          onClick={() => toggleGenre(g)}
                          className={`px-3 py-1.5 rounded-full text-[11px] font-semibold border-2 transition ${
                            on ? 'border-mint bg-mint-bg text-mint-dark' : 'border-divider text-muted hover:border-ink hover:text-ink'
                          }`}
                        >
                          {on ? '✓ ' : '+ '}{g}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="mb-5">
                  <label className="block text-[13px] font-semibold text-ink mb-2">Rating display</label>
                  <div className="flex gap-2">
                    {(['Stars', 'Decimal'] as const).map((opt) => (
                      <button key={opt} onClick={() => setRatingDisplay(opt)} className={`px-4 py-2 rounded-lg text-[12px] font-semibold border transition ${ratingDisplay === opt ? 'border-ink text-ink' : 'border-divider text-muted hover:border-mid'}`}>
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="mb-5">
                  <label className="block text-[13px] font-semibold text-ink mb-2">Default comment visibility</label>
                  <select className="w-full bg-surface border border-divider rounded-xl px-4 py-2.5 text-[13px] text-ink outline-none cursor-pointer hover:border-mid transition">
                    {visibilityOptions.map(v => <option key={v}>{v}</option>)}
                  </select>
                </div>
              </Section>
            )}

            {activeTab === 'notifications' && (
              <Section title="Notifications">
                <Toggle label="Likes on my comments" defaultOn />
                <Toggle label="Replies to my comments" defaultOn />
                <Toggle label="New followers" defaultOn />
                <Toggle label="Ranking updates" defaultOn />
                <Toggle label="Monthly capsule" />
              </Section>
            )}

            {activeTab === 'privacy' && (
              <Section title="Privacy">
                <div className="mb-5">
                  <label className="block text-[13px] font-semibold text-ink mb-2">Profile visibility</label>
                  <select className="w-full bg-surface border border-divider rounded-xl px-4 py-2.5 text-[13px] text-ink outline-none cursor-pointer hover:border-mid transition">
                    {visibilityOptions.map(v => <option key={v}>{v}</option>)}
                  </select>
                </div>
                <div className="mb-5">
                  <label className="block text-[13px] font-semibold text-ink mb-2">Catalog visibility</label>
                  <select className="w-full bg-surface border border-divider rounded-xl px-4 py-2.5 text-[13px] text-ink outline-none cursor-pointer hover:border-mid transition">
                    {visibilityOptions.map(v => <option key={v}>{v}</option>)}
                  </select>
                </div>
                <div className="mb-5">
                  <label className="block text-[13px] font-semibold text-ink mb-2">Listen Later visibility</label>
                  <select className="w-full bg-surface border border-divider rounded-xl px-4 py-2.5 text-[13px] text-ink outline-none cursor-pointer hover:border-mid transition">
                    {['Public', 'Private'].map(v => <option key={v}>{v}</option>)}
                  </select>
                </div>
              </Section>
            )}

            {activeTab === 'danger' && (
              <div className="border border-red-200 rounded-2xl p-6 bg-red-50/50">
                <h3 className="text-[15px] font-bold text-red-700 mb-1">Danger Zone</h3>
                <p className="text-[12px] text-red-600/80 mb-6">These actions are permanent and cannot be undone.</p>
                <div className="flex flex-col gap-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-[13px] font-semibold text-ink">Deactivate account</p>
                      <p className="text-[12px] text-muted mt-0.5">Temporarily hide your profile. You can reactivate anytime.</p>
                    </div>
                    <button className="flex-shrink-0 px-4 py-2 rounded-lg border border-red-200 text-[12px] font-semibold text-red-600 hover:bg-red-100 transition">
                      Deactivate
                    </button>
                  </div>
                  <div className="border-t border-red-100" />
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-[13px] font-semibold text-ink">Delete account</p>
                      <p className="text-[12px] text-muted mt-0.5">Permanently remove all your data. This cannot be undone.</p>
                    </div>
                    <button className="flex-shrink-0 px-4 py-2 rounded-lg bg-red-600 text-[12px] font-semibold text-white hover:bg-red-700 transition flex items-center gap-1.5">
                      <Trash2 size={13} /> Delete
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-divider rounded-2xl p-6 bg-white">
      <h2 className="text-[16px] font-bold text-ink mb-5">{title}</h2>
      {children}
    </div>
  );
}

function Field({ label, value, onChange, hint, type = 'text', textarea }: {
  label: string; value: string; onChange: (v: string) => void; hint?: string; type?: string; textarea?: boolean;
}) {
  return (
    <div className="mb-4">
      <label className="block text-[13px] font-semibold text-ink mb-1.5">{label}</label>
      {textarea ? (
        <textarea
          rows={3}
          value={value}
          onChange={e => onChange(e.target.value)}
          className="w-full bg-surface border border-divider rounded-xl px-4 py-2.5 text-[13px] text-ink outline-none resize-none hover:border-mid focus:border-ink transition"
        />
      ) : (
        <input
          type={type}
          value={value}
          onChange={e => onChange(e.target.value)}
          className="w-full bg-surface border border-divider rounded-xl px-4 py-2.5 text-[13px] text-ink outline-none hover:border-mid focus:border-ink transition"
        />
      )}
      {hint && <p className="text-[11px] text-muted mt-1">{hint}</p>}
    </div>
  );
}

function Toggle({ label, defaultOn = false }: { label: string; defaultOn?: boolean }) {
  const [on, setOn] = useState(defaultOn);
  return (
    <div className="flex items-center justify-between py-3 border-b border-divider last:border-0">
      <span className="text-[13px] text-ink">{label}</span>
      <button
        onClick={() => setOn(!on)}
        className={`w-10 h-6 rounded-full transition-colors relative flex-shrink-0 ${on ? 'bg-mint' : 'bg-subtle'}`}
        aria-pressed={on}
        aria-label={label}
      >
        <span className={`absolute top-[2px] left-0 w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${on ? 'translate-x-[18px]' : 'translate-x-[2px]'}`} />
      </button>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense>
      <SettingsContent />
    </Suspense>
  );
}
