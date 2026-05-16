'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { useState, useEffect, Suspense } from 'react';
import { useTheme } from 'next-themes';
import {
  User, Sliders, Bell, Shield, AlertTriangle,
  LogOut, Trash2, Camera, Sun, Moon, Monitor
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

  const urlError = searchParams.get('error');
  const [userId, setUserId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [bio, setBio] = useState('');
  const [currentEmail, setCurrentEmail] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailMessage, setEmailMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [showEmailChange, setShowEmailChange] = useState(false);
  const [identities, setIdentities] = useState<{ provider: string; id: string }[]>([]);
  const [identityLoading, setIdentityLoading] = useState<string | null>(null);
  const [identityError, setIdentityError] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState<string | null>(null);
  const [activeGenres, setActiveGenres] = useState<Set<string>>(new Set(['K-R&B', 'K-Indie', 'Hip-Hop']));
  const [ratingDisplay, setRatingDisplay] = useState<'Stars' | 'Decimal'>('Stars');
  const { theme, setTheme } = useTheme();

  const refreshUser = async () => {
    if (!supabase) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setUserId(user.id);
    setCurrentEmail(user.email ?? '');
    setIdentities((user.identities ?? []).map((i: any) => ({ provider: i.provider, id: i.id })));
    const { data: profile } = await supabase
      .from('profiles')
      .select('display_name, username, bio')
      .eq('id', user.id)
      .maybeSingle();
    if (profile) {
      setDisplayName(profile.display_name ?? '');
      setUsername(profile.username ?? user.email?.split('@')[0] ?? '');
      setBio(profile.bio ?? '');
    } else {
      setUsername(user.email?.split('@')[0] ?? '');
    }
  };

  useEffect(() => {
    refreshUser();
    // Re-fetch when tab regains focus (handles OAuth redirect back)
    const onFocus = () => refreshUser();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
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

  const handleEmailChange = async () => {
    if (!supabase || !newEmail.trim()) return;
    setEmailSaving(true);
    setEmailMessage(null);
    const { error } = await supabase.auth.updateUser(
      { email: newEmail.trim() },
      { emailRedirectTo: `${window.location.origin}/auth/callback?next=/settings` },
    );
    if (error) {
      setEmailMessage({ text: error.message, ok: false });
    } else {
      setEmailMessage({ text: `Confirmation sent to ${newEmail.trim()}. Click the link in that email to confirm the change.`, ok: true });
      setNewEmail('');
    }
    setEmailSaving(false);
  };

  const handleConnect = async (provider: 'google' | 'spotify') => {
    if (!supabase) return;
    setIdentityLoading(provider);
    setIdentityError(null);
    const { error } = await supabase.auth.linkIdentity({
      provider,
      options: { redirectTo: `${window.location.origin}/auth/callback?next=/settings` },
    });
    if (error) { setIdentityError(error.message); setIdentityLoading(null); }
  };

  const handleDisconnect = async (provider: string) => {
    if (!supabase) return;
    if (identities.length <= 1) {
      setIdentityError('You can\'t disconnect your only login method.');
      return;
    }
    const identity = identities.find(i => i.provider === provider);
    if (!identity) return;
    setIdentityLoading(provider);
    setIdentityError(null);
    const { data: { user } } = await supabase.auth.getUser();
    const fullIdentity = user?.identities?.find((i: any) => i.provider === provider);
    if (!fullIdentity) { setIdentityLoading(null); return; }
    const { error } = await supabase.auth.unlinkIdentity(fullIdentity);
    if (error) {
      setIdentityError(error.message);
    } else {
      await refreshUser();
    }
    setIdentityLoading(null);
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
                    className="bg-ink text-white dark:bg-[#F0F0EE] dark:text-[#111111] rounded-xl px-6 py-2.5 text-[13px] font-bold hover:opacity-80 transition disabled:opacity-50"
                  >
                    {saved ? 'Saved' : saving ? 'Saving…' : 'Save changes'}
                  </button>
                  <button onClick={handleSignOut} className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-divider text-[13px] font-semibold text-muted hover:bg-surface transition">
                    <LogOut size={14} /> Log out
                  </button>
                </div>

                {/* Change email */}
                <div className="mt-8 pt-6 border-t border-divider">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="text-[14px] font-bold text-ink">Email address</h3>
                      <p className="text-[12px] text-muted mt-0.5">{currentEmail}</p>
                    </div>
                    <button
                      onClick={() => { setShowEmailChange(v => !v); setEmailMessage(null); setNewEmail(''); }}
                      className="px-4 py-2 rounded-lg border border-divider text-[12px] font-semibold text-muted hover:bg-surface transition"
                    >
                      {showEmailChange ? 'Cancel' : 'Change email'}
                    </button>
                  </div>
                  {showEmailChange && (
                    <div>
                      <Field label="New email address" value={newEmail} onChange={setNewEmail} type="email" />
                      {emailMessage && (
                        <p className={`text-[12px] mb-3 ${emailMessage.ok ? 'text-mint-dark' : 'text-red-500'}`}>
                          {emailMessage.text}
                        </p>
                      )}
                      <button
                        onClick={handleEmailChange}
                        disabled={emailSaving || !newEmail.trim()}
                        className="bg-ink text-white dark:bg-[#F0F0EE] dark:text-[#111111] rounded-xl px-6 py-2.5 text-[13px] font-bold hover:opacity-80 transition disabled:opacity-50"
                      >
                        {emailSaving ? 'Sending…' : 'Send confirmation'}
                      </button>
                    </div>
                  )}
                </div>

                {/* Connected accounts */}
                <div className="mt-8 pt-6 border-t border-divider">
                  <h3 className="text-[14px] font-bold text-ink mb-1">Connected accounts</h3>
                  <p className="text-[12px] text-muted mb-4">Log in with these accounts or disconnect them.</p>
                  {(identityError || urlError) && <p className="text-[12px] text-red-500 mb-3">{identityError ?? urlError}</p>}
                  <div className="flex flex-col gap-3">
                    {[
                      { provider: 'google', label: 'Google', color: 'bg-white border border-divider', available: true },
                      { provider: 'spotify', label: 'Spotify', color: 'bg-[#1DB954]', available: true },
                      { provider: 'kakao', label: 'KakaoTalk', color: 'bg-[#FEE500]', available: false },
                      { provider: 'apple', label: 'Apple', color: 'bg-black', available: false },
                    ].map(({ provider, label, color, available }) => {
                      const connected = identities.some(i => i.provider === provider);
                      const socialIdentities = identities.filter(i => i.provider !== 'email');
                      const isOnly = socialIdentities.length <= 1 && connected;
                      const loading = identityLoading === provider;
                      return (
                        <div key={provider} className="flex items-center justify-between py-2.5 px-3 rounded-xl border border-divider bg-page">
                          <div className="flex items-center gap-3">
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${color}`}>
                              <ProviderIcon provider={provider} />
                            </div>
                            <div>
                              <p className="text-[13px] font-semibold text-ink">{label}</p>
                              <p className="text-[11px] text-muted">{connected ? 'Connected' : available ? 'Not connected' : 'Coming soon'}</p>
                            </div>
                          </div>
                          {available ? (
                            connected ? (
                              <button
                                onClick={() => !isOnly && setConfirmDisconnect(provider)}
                                disabled={loading || isOnly}
                                title={isOnly ? 'Keep at least one social account connected' : undefined}
                                className="w-[90px] py-1.5 rounded-lg border border-ink bg-page text-[11px] font-semibold text-ink hover:border-red-300 hover:bg-red-50 hover:text-red-500 transition disabled:opacity-40 disabled:cursor-not-allowed text-center"
                              >
                                {loading ? '…' : 'Connected'}
                              </button>
                            ) : (
                              <button
                                onClick={() => handleConnect(provider as 'google' | 'spotify')}
                                disabled={loading}
                                className="w-[90px] py-1.5 rounded-lg bg-ink text-white dark:bg-[#F0F0EE] dark:text-[#111111] text-[11px] font-semibold hover:opacity-80 transition disabled:opacity-50 text-center"
                              >
                                {loading ? '…' : 'Connect'}
                              </button>
                            )
                          ) : (
                            <span className="w-[90px] text-center text-[11px] text-subtle font-medium">Soon</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

              </Section>
            )}

            {/* Disconnect confirmation modal */}
            {confirmDisconnect && (
              <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setConfirmDisconnect(null)}>
                <div className="bg-page rounded-2xl p-7 max-w-[320px] w-full mx-4 shadow-xl" onClick={e => e.stopPropagation()}>
                  <h3 className="text-[15px] font-bold text-ink mb-2">Disconnect {confirmDisconnect.charAt(0).toUpperCase() + confirmDisconnect.slice(1)}?</h3>
                  <p className="text-[13px] text-muted leading-relaxed mb-6">You won't be able to log in with {confirmDisconnect} anymore. Make sure you have another way to access your account.</p>
                  <div className="flex gap-3">
                    <button
                      onClick={() => setConfirmDisconnect(null)}
                      className="flex-1 py-2.5 rounded-xl border border-divider text-[13px] font-semibold text-muted hover:bg-surface transition"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => { handleDisconnect(confirmDisconnect); setConfirmDisconnect(null); }}
                      className="flex-1 py-2.5 rounded-xl bg-red-600 text-white text-[13px] font-bold hover:bg-red-700 transition"
                    >
                      Disconnect
                    </button>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'preferences' && (
              <Section title="Preferences">
                <div className="mb-5">
                  <label className="block text-[13px] font-semibold text-ink mb-2">Appearance</label>
                  <div className="flex gap-2">
                    {([
                      { value: 'light', label: 'Light', Icon: Sun },
                      { value: 'system', label: 'System', Icon: Monitor },
                      { value: 'dark', label: 'Dark', Icon: Moon },
                    ] as const).map(({ value, label, Icon }) => (
                      <button
                        key={value}
                        onClick={() => setTheme(value)}
                        className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-[12px] font-semibold border transition ${theme === value ? 'border-ink text-ink' : 'border-divider text-muted hover:border-mid'}`}
                      >
                        <Icon size={13} strokeWidth={1.8} />
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
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
    <div className="border border-divider rounded-2xl p-6 bg-page">
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

function ProviderIcon({ provider }: { provider: string }) {
  if (provider === 'google') return (
    <svg width="16" height="16" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  );
  if (provider === 'spotify') return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm4.586 14.424a.622.622 0 0 1-.857.207c-2.348-1.435-5.304-1.76-8.785-.964a.623.623 0 0 1-.277-1.215c3.809-.87 7.077-.496 9.712 1.115a.622.622 0 0 1 .207.857zm1.223-2.722a.78.78 0 0 1-1.072.257c-2.687-1.652-6.785-2.131-9.965-1.166a.78.78 0 0 1-.973-.519.781.781 0 0 1 .52-.973c3.632-1.102 8.147-.568 11.233 1.329a.78.78 0 0 1 .257 1.072zm.105-2.835C14.692 8.95 9.375 8.775 6.297 9.71a.937.937 0 1 1-.543-1.793c3.532-1.072 9.404-.865 13.115 1.338a.937.937 0 0 1-.954 1.612z"/>
    </svg>
  );
  if (provider === 'kakao') return (
    <svg width="16" height="16" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 3C6.477 3 2 6.477 2 10.8c0 2.7 1.607 5.086 4.035 6.534l-.963 3.574a.3.3 0 0 0 .453.328L9.941 18.9A11.66 11.66 0 0 0 12 19.1c5.523 0 10-3.477 10-7.8C22 6.477 17.523 3 12 3z" fill="#3C1E1E"/>
    </svg>
  );
  if (provider === 'apple') return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg">
      <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.7 9.05 7.4c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.39-1.32 2.76-2.54 3.99zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
    </svg>
  );
  return null;
}

export default function SettingsPage() {
  return (
    <Suspense>
      <SettingsContent />
    </Suspense>
  );
}
