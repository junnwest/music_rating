'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { useState, useEffect, Suspense } from 'react';
import { useTheme } from 'next-themes';
import {
  User, Sliders, Bell, Shield,
  LogOut, Trash2, Camera, Sun, Moon, Monitor
} from 'lucide-react';
import { supabase } from '../../../lib/supabaseClient';
import UserAvatar from '../../../components/UserAvatar';
import InstinctImportModal from '../../../components/InstinctImportModal';
import { useLanguage, type Lang } from '../../../lib/i18n';
import { useStreamingPlatform, type StreamingPlatform } from '../../../components/StreamingPlatformContext';

type TabKey = 'account' | 'preferences' | 'notifications' | 'privacy' | 'danger';

const regions = ['Global', 'Korea', 'Japan', 'United States', 'United Kingdom', 'Philippines', 'Indonesia', 'Thailand', 'Vietnam', 'China'];
const allGenres = ['K-Pop', 'K-Indie', 'K-R&B', 'K-Rap', 'J-Pop', 'J-Rock', 'City Pop', 'Hip-Hop', 'R&B', 'Rock', 'Electronic', 'Pop', 'Jazz', 'Folk', 'Soul', 'Indie', 'Alternative', 'Metal', 'Classical'];
const visibilityOptions = ['Public', 'Followers only', 'Private'];

function SettingsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlTab = searchParams.get('tab') as TabKey | null;
  const validTabs: TabKey[] = ['account', 'preferences', 'notifications', 'privacy'];
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
  const [manualRatingStep, setManualRatingStep] = useState(0.5);
  const [ratingStepSaving, setRatingStepSaving] = useState(false);
  const [ratingMode, setRatingMode] = useState<'manual' | 'instinct'>('manual');
  const [ratingModeSaving, setRatingModeSaving] = useState(false);
  const [importCount, setImportCount] = useState(0);
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const { preferred: preferredPlatform, savePreferred } = useStreamingPlatform();
  const [platformSaving, setPlatformSaving] = useState(false);
  const [platformError, setPlatformError] = useState<string | null>(null);
  const [adventurousness, setAdventurousness] = useState(50);
  const [adventurousnessSaving, setAdventurousnessSaving] = useState(false);
  const { theme, setTheme } = useTheme();
  const { lang, setLang, t } = useLanguage();

  const tabs = [
    { key: 'account' as TabKey,       label: t('settings.tabs.account'),       icon: User },
    { key: 'preferences' as TabKey,   label: t('settings.tabs.preferences'),   icon: Sliders },
    { key: 'notifications' as TabKey, label: t('settings.tabs.notifications'), icon: Bell },
    { key: 'privacy' as TabKey,       label: t('settings.tabs.privacy'),       icon: Shield },
  ];

  const refreshUser = async () => {
    if (!supabase) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.replace('/login'); return; }
    setUserId(user.id);
    setCurrentEmail(user.email ?? '');
    setIdentities((user.identities ?? []).map((i: any) => ({ provider: i.provider, id: i.id })));
    const { data: profile } = await supabase
      .from('profiles')
      .select('display_name, username, bio, recommendation_adventurousness, manual_rating_step, rating_mode')
      .eq('id', user.id)
      .maybeSingle();
    if (profile) {
      setDisplayName(profile.display_name ?? '');
      setUsername(profile.username ?? user.email?.split('@')[0] ?? '');
      setBio(profile.bio ?? '');
      setAdventurousness(profile.recommendation_adventurousness ?? 50);
      if (profile.manual_rating_step) setManualRatingStep(Number(profile.manual_rating_step));
      if (profile.rating_mode === 'instinct' || profile.rating_mode === 'manual') setRatingMode(profile.rating_mode);
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

  const handleDeleteAccount = async () => {
    if (!supabase) return;
    setDeleting(true);
    setDeleteError(null);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setDeleteError('Not signed in.'); setDeleting(false); return; }
    const res = await fetch('/api/account/delete', {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: 'Failed to delete account.' }));
      setDeleteError(error ?? 'Failed to delete account.');
      setDeleting(false);
      return;
    }
    await supabase.auth.signOut();
    router.push('/');
  };

  const handlePlatformChange = async (platform: StreamingPlatform | null) => {
    setPlatformError(null);
    setPlatformSaving(true);
    const { error } = await savePreferred(platform);
    if (error) setPlatformError(error);
    setPlatformSaving(false);
  };

  const handleAdventurousnessSave = async (value: number) => {
    if (!supabase || !userId) return;
    setAdventurousnessSaving(true);
    await supabase
      .from('profiles')
      .update({ recommendation_adventurousness: value })
      .eq('id', userId);
    setAdventurousnessSaving(false);
  };

  const handleRatingStepSave = async (value: number) => {
    if (!supabase || !userId) return;
    setManualRatingStep(value);
    setRatingStepSaving(true);
    await supabase
      .from('profiles')
      .update({ manual_rating_step: value })
      .eq('id', userId);
    setRatingStepSaving(false);
  };

  const writeRatingMode = async (value: 'manual' | 'instinct') => {
    if (!supabase || !userId) return;
    setRatingMode(value);
    setRatingModeSaving(true);
    await supabase
      .from('profiles')
      .update({ rating_mode: value })
      .eq('id', userId);
    setRatingModeSaving(false);
  };

  const handleRatingModeSave = async (value: 'manual' | 'instinct') => {
    if (!supabase || !userId || value === ratingMode) return;

    // Switching Manual → Instinct: offer to import existing star ratings as Elo
    // seeds (albums + songs). Only ask if there's anything to import (star score,
    // no Elo yet).
    if (value === 'instinct') {
      const [albumCountRes, songCountRes] = await Promise.all([
        supabase.from('ratings')
          .select('release_id', { count: 'exact', head: true })
          .eq('user_id', userId).not('score', 'is', null).is('elo_score', null),
        supabase.from('track_ratings')
          .select('release_id', { count: 'exact', head: true })
          .eq('user_id', userId).not('score', 'is', null).is('elo_score', null),
      ]);
      const total = (albumCountRes.count ?? 0) + (songCountRes.count ?? 0);
      if (total > 0) {
        setImportCount(total);
        setImportError(null);
        setShowImportModal(true);
        return; // defer the rating_mode write until the user chooses
      }
    }

    await writeRatingMode(value);
  };

  // Import modal — "Use my ratings": flip to Instinct, then seed Elo from stars.
  const handleImportUse = async () => {
    if (!supabase || !userId) return;
    setImportBusy(true);
    setImportError(null);
    await writeRatingMode('instinct');
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    const res = await fetch('/api/rate/seed-from-manual', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token ?? ''}` },
    });
    setImportBusy(false);
    if (!res.ok) {
      const { error: e } = await res.json().catch(() => ({ error: 'Import failed.' }));
      setImportError(e ?? 'Import failed.');
      return;
    }
    setShowImportModal(false);
  };

  // Import modal — "Start fresh": flip to Instinct without seeding.
  const handleImportFresh = async () => {
    setShowImportModal(false);
    await writeRatingMode('instinct');
  };

  const toggleGenre = (g: string) => {
    setActiveGenres(prev => {
      const next = new Set(prev);
      next.has(g) ? next.delete(g) : next.add(g);
      return next;
    });
  };

  const avatarInitial = (displayName || username || '?')[0].toUpperCase();

  const scrollToSection = (key: TabKey) => {
    setActiveTab(key);
    document.getElementById(`section-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Scroll to the deep-linked section on mount (?tab=danger), and keep the left
  // nav highlight in sync with scroll position via an IntersectionObserver.
  useEffect(() => {
    if (urlTab && validTabs.includes(urlTab)) {
      document.getElementById(`section-${urlTab}`)?.scrollIntoView({ block: 'start' });
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length === 0) return;
        const topmost = visible.reduce((a, b) =>
          a.boundingClientRect.top < b.boundingClientRect.top ? a : b,
        );
        const id = topmost.target.id.replace('section-', '') as TabKey;
        if (validTabs.includes(id)) setActiveTab(id);
      },
      { rootMargin: '-20% 0px -70% 0px' },
    );
    validTabs.forEach((key) => {
      const el = document.getElementById(`section-${key}`);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex-1">
      <div className="max-w-[900px] mx-auto px-5 py-10 pb-20 w-full">
        <div className="mb-8">
          <h1 className="text-[28px] md:text-[32px] font-extrabold text-ink tracking-tight">{t('settings.title')}</h1>
          <p className="text-[13px] text-muted mt-1">{t('settings.subtitle')}</p>
        </div>

        <div className="flex flex-col md:flex-row gap-6 md:gap-8">
          {/* Tab nav */}
          <nav className="md:w-[180px] flex-shrink-0 flex md:flex-col gap-1 overflow-x-auto md:overflow-visible scrollbar-hide pb-1 md:pb-0 md:sticky md:top-20 md:self-start">
            {tabs.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => scrollToSection(key)}
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
          <div className="flex-1 min-w-0 flex flex-col gap-6">
            <section id="section-account" className="scroll-mt-24">
              <Section title={t('settings.tabs.account')}>
                <div className="flex items-center gap-4 mb-6">
                  <UserAvatar size={64} />
                  <button className="flex items-center gap-2 px-4 py-2 rounded-lg border border-divider text-[12px] font-semibold text-muted hover:bg-surface transition">
                    <Camera size={14} /> {t('settings.account.changePhoto')}
                  </button>
                </div>
                <Field label={t('settings.account.displayName')} value={displayName} onChange={setDisplayName} />
                <Field label={t('settings.account.username')} value={username} onChange={setUsername} hint={username ? `@${username}` : undefined} />
                <Field label={t('settings.account.bio')} value={bio} onChange={setBio} textarea />
                {error && <p className="text-[12px] text-red-500 mb-3">{error}</p>}
                <div className="flex gap-3 mt-6">
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="bg-ink text-white dark:bg-[#F0F0EE] dark:text-[#111111] rounded-xl px-6 py-2.5 text-[13px] font-bold hover:opacity-80 transition disabled:opacity-50"
                  >
                    {saved ? t('settings.account.saved') : saving ? t('settings.account.saving') : t('settings.account.saveChanges')}
                  </button>
                </div>

                {/* Change email */}
                <div className="mt-8 pt-6 border-t border-divider">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="text-[14px] font-bold text-ink">{t('settings.account.emailTitle')}</h3>
                      <p className="text-[12px] text-muted mt-0.5">{currentEmail}</p>
                    </div>
                    <button
                      onClick={() => { setShowEmailChange(v => !v); setEmailMessage(null); setNewEmail(''); }}
                      className="px-4 py-2 rounded-lg border border-divider text-[12px] font-semibold text-muted hover:bg-surface transition"
                    >
                      {showEmailChange ? t('settings.account.cancelEmail') : t('settings.account.changeEmail')}
                    </button>
                  </div>
                  {showEmailChange && (
                    <div>
                      <Field label={t('settings.account.newEmail')} value={newEmail} onChange={setNewEmail} type="email" />
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
                        {emailSaving ? t('settings.account.sending') : t('settings.account.sendConfirmation')}
                      </button>
                    </div>
                  )}
                </div>

                {/* Connected accounts */}
                <div className="mt-8 pt-6 border-t border-divider">
                  <h3 className="text-[14px] font-bold text-ink mb-1">{t('settings.account.connectedTitle')}</h3>
                  <p className="text-[12px] text-muted mb-4">{t('settings.account.connectedSubtitle')}</p>
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
                              <p className="text-[11px] text-muted">{connected ? t('settings.account.connected') : available ? t('settings.account.notConnected') : t('settings.account.comingSoon')}</p>
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
                                {loading ? '…' : t('settings.account.connected')}
                              </button>
                            ) : (
                              <button
                                onClick={() => handleConnect(provider as 'google' | 'spotify')}
                                disabled={loading}
                                className="w-[90px] py-1.5 rounded-lg bg-ink text-white dark:bg-[#F0F0EE] dark:text-[#111111] text-[11px] font-semibold hover:opacity-80 transition disabled:opacity-50 text-center"
                              >
                                {loading ? '…' : t('settings.account.connect')}
                              </button>
                            )
                          ) : (
                            <span className="w-[90px] text-center text-[11px] text-subtle font-medium">{t('settings.account.soon')}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

              </Section>

            {/* Disconnect confirmation modal */}
            {confirmDisconnect && (
              <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setConfirmDisconnect(null)}>
                <div className="bg-page rounded-2xl p-7 max-w-[320px] w-full mx-4 shadow-xl" onClick={e => e.stopPropagation()}>
                  <h3 className="text-[15px] font-bold text-ink mb-2">{t('settings.account.disconnectModalTitle')} {confirmDisconnect.charAt(0).toUpperCase() + confirmDisconnect.slice(1)}?</h3>
                  <p className="text-[13px] text-muted leading-relaxed mb-6">{t('settings.account.disconnectModalDesc').replace('{provider}', confirmDisconnect)}</p>
                  <div className="flex gap-3">
                    <button
                      onClick={() => setConfirmDisconnect(null)}
                      className="flex-1 py-2.5 rounded-xl border border-divider text-[13px] font-semibold text-muted hover:bg-surface transition"
                    >
                      {t('settings.account.cancel')}
                    </button>
                    <button
                      onClick={() => { handleDisconnect(confirmDisconnect); setConfirmDisconnect(null); }}
                      className="flex-1 py-2.5 rounded-xl bg-red-600 text-white text-[13px] font-bold hover:bg-red-700 transition"
                    >
                      {t('settings.account.disconnect')}
                    </button>
                  </div>
                </div>
              </div>
            )}

            </section>
            <section id="section-preferences" className="scroll-mt-24">
              <Section title={t('settings.tabs.preferences')}>
                <div className="mb-5">
                  <label className="block text-[13px] font-semibold text-ink mb-2">{t('settings.preferences.appearance')}</label>
                  <div className="flex gap-2">
                    {([
                      { value: 'light',  label: t('settings.preferences.light'),  Icon: Sun },
                      { value: 'system', label: t('settings.preferences.system'), Icon: Monitor },
                      { value: 'dark',   label: t('settings.preferences.dark'),   Icon: Moon },
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
                  <label className="block text-[13px] font-semibold text-ink mb-2">{t('settings.preferences.language')}</label>
                  <div className="flex gap-2">
                    {([
                      { value: 'en', label: 'English' },
                      { value: 'ko', label: '한국어' },
                    ] as const).map(({ value, label }) => (
                      <button
                        key={value}
                        onClick={() => setLang(value as Lang)}
                        className={`px-4 py-2 rounded-lg text-[12px] font-semibold border transition ${lang === value ? 'border-ink text-ink' : 'border-divider text-muted hover:border-mid'}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="mb-5">
                  <label className="block text-[13px] font-semibold text-ink mb-2">{t('settings.preferences.region')}</label>
                  <select className="w-full bg-surface border border-divider rounded-xl px-4 py-2.5 text-[13px] text-ink outline-none cursor-pointer hover:border-mid transition">
                    {regions.map(r => <option key={r}>{r}</option>)}
                  </select>
                </div>
                <div className="mb-5">
                  <label className="block text-[13px] font-semibold text-ink mb-2">{t('settings.preferences.genres')}</label>
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
                  <label className="block text-[13px] font-semibold text-ink mb-2">{t('settings.preferences.ratingDisplay')}</label>
                  <div className="flex gap-2">
                    {(['Stars', 'Decimal'] as const).map((opt) => (
                      <button key={opt} onClick={() => setRatingDisplay(opt)} className={`px-4 py-2 rounded-lg text-[12px] font-semibold border transition ${ratingDisplay === opt ? 'border-ink text-ink' : 'border-divider text-muted hover:border-mid'}`}>
                        {opt === 'Stars' ? t('settings.preferences.stars') : t('settings.preferences.decimal')}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="mb-5">
                  <label className="block text-[13px] font-semibold text-ink mb-2">
                    {t('settings.preferences.ratingMode')}
                    {ratingModeSaving && <span className="ml-2 text-[11px] font-normal text-muted">Saving…</span>}
                  </label>
                  <div className="flex gap-2">
                    {([
                      { value: 'manual', label: t('settings.preferences.ratingModeManual') },
                      { value: 'instinct', label: t('settings.preferences.ratingModeInstinct') },
                    ] as const).map(({ value, label }) => (
                      <button
                        key={value}
                        disabled={ratingModeSaving}
                        onClick={() => handleRatingModeSave(value)}
                        className={`px-4 py-2 rounded-lg text-[12px] font-semibold border transition disabled:opacity-60 ${ratingMode === value ? 'border-ink text-ink' : 'border-divider text-muted hover:border-mid'}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted mt-2">
                    {ratingMode === 'instinct'
                      ? t('settings.preferences.ratingModeInstinctNote')
                      : t('settings.preferences.ratingModeManualNote')}
                  </p>
                </div>
                {ratingMode === 'manual' && (
                  <div className="mb-5">
                    <label className="block text-[13px] font-semibold text-ink mb-2">
                      {t('settings.preferences.ratingPrecision')}
                      {ratingStepSaving && <span className="ml-2 text-[11px] font-normal text-muted">Saving…</span>}
                    </label>
                    <div className="flex gap-2">
                      {([
                        { value: 0.5, label: t('settings.preferences.ratingPrecisionHalf') },
                        { value: 0.1, label: t('settings.preferences.ratingPrecisionTenth') },
                      ] as const).map(({ value, label }) => (
                        <button
                          key={value}
                          disabled={ratingStepSaving}
                          onClick={() => handleRatingStepSave(value)}
                          className={`px-4 py-2 rounded-lg text-[12px] font-semibold border transition disabled:opacity-60 ${manualRatingStep === value ? 'border-ink text-ink' : 'border-divider text-muted hover:border-mid'}`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <p className="text-[11px] text-muted mt-2">
                      {manualRatingStep === 0.1
                        ? t('settings.preferences.ratingPrecisionTenthNote')
                        : t('settings.preferences.ratingPrecisionHalfNote')}
                    </p>
                  </div>
                )}
                <div className="mb-5">
                  <label className="block text-[13px] font-semibold text-ink mb-2">{t('settings.preferences.commentVisibility')}</label>
                  <select className="w-full bg-surface border border-divider rounded-xl px-4 py-2.5 text-[13px] text-ink outline-none cursor-pointer hover:border-mid transition">
                    {[t('settings.visibility.public'), t('settings.visibility.followersOnly'), t('settings.visibility.private')].map(v => <option key={v}>{v}</option>)}
                  </select>
                </div>
                <div className="mb-5">
                  <label className="block text-[13px] font-semibold text-ink mb-2">
                    {t('settings.preferences.streamingPlatform')}
                    {platformSaving && <span className="ml-2 text-[11px] font-normal text-muted">Saving…</span>}
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {([
                      { id: 'spotify', label: 'Spotify' },
                      { id: 'youtube_music', label: 'YouTube Music' },
                      { id: 'tidal', label: 'Tidal' },
                      { id: 'apple_music', label: 'Apple Music' },
                    ] as const).map(({ id, label }) => (
                      <button
                        key={id}
                        disabled={platformSaving}
                        onClick={() => handlePlatformChange(preferredPlatform === id ? null : id)}
                        className={`px-4 py-2 rounded-lg text-[12px] font-semibold border transition disabled:opacity-60 ${preferredPlatform === id ? 'border-ink text-ink' : 'border-divider text-muted hover:border-mid'}`}
                      >
                        {label}
                      </button>
                    ))}
                    <button
                      disabled={platformSaving}
                      onClick={() => handlePlatformChange(null)}
                      className={`px-4 py-2 rounded-lg text-[12px] font-semibold border transition disabled:opacity-60 ${preferredPlatform == null ? 'border-ink text-ink' : 'border-divider text-muted hover:border-mid'}`}
                    >
                      {t('settings.preferences.streamingNone')}
                    </button>
                  </div>
                  <p className="text-[11px] text-muted mt-2">
                    {preferredPlatform == null
                      ? 'All services are shown on album and track pages.'
                      : 'Only your chosen service is shown on album and track pages.'}
                  </p>
                  {platformError && <p className="text-[11px] text-red-500 mt-1">{platformError}</p>}
                </div>
                <div className="mb-5">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-[13px] font-semibold text-ink">
                      {t('settings.preferences.discovery')}
                      {adventurousnessSaving && <span className="ml-2 text-[11px] font-normal text-muted">Saving…</span>}
                    </label>
                    <span className="text-[11px] text-muted">
                      {adventurousness < 33
                        ? t('settings.preferences.discoveryConservative')
                        : adventurousness < 67
                        ? t('settings.preferences.discoveryBalanced')
                        : t('settings.preferences.discoveryAdventurous')}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={adventurousness}
                    onChange={(e) => setAdventurousness(Number(e.target.value))}
                    onMouseUp={(e) => void handleAdventurousnessSave(Number((e.target as HTMLInputElement).value))}
                    onTouchEnd={(e) => void handleAdventurousnessSave(Number((e.target as HTMLInputElement).value))}
                    className="w-full h-1.5 rounded-full cursor-pointer accent-ink"
                  />
                  <div className="flex justify-between mt-1.5">
                    <span className="text-[11px] text-muted">{t('settings.preferences.discoveryConservative')}</span>
                    <span className="text-[11px] text-muted">{t('settings.preferences.discoveryAdventurous')}</span>
                  </div>
                </div>
              </Section>

            </section>
            <section id="section-notifications" className="scroll-mt-24">
              <Section title={t('settings.tabs.notifications')}>
                <Toggle label={t('settings.notifications.likes')} defaultOn />
                <Toggle label={t('settings.notifications.replies')} defaultOn />
                <Toggle label={t('settings.notifications.followers')} defaultOn />
                <Toggle label={t('settings.notifications.rankingUpdates')} defaultOn />
                <Toggle label={t('settings.notifications.capsule')} />
              </Section>

            </section>
            <section id="section-privacy" className="scroll-mt-24">
              <Section title={t('settings.tabs.privacy')}>
                <div className="mb-5">
                  <label className="block text-[13px] font-semibold text-ink mb-2">{t('settings.privacy.profileVisibility')}</label>
                  <select className="w-full bg-surface border border-divider rounded-xl px-4 py-2.5 text-[13px] text-ink outline-none cursor-pointer hover:border-mid transition">
                    {[t('settings.visibility.public'), t('settings.visibility.followersOnly'), t('settings.visibility.private')].map(v => <option key={v}>{v}</option>)}
                  </select>
                </div>
                <div className="mb-5">
                  <label className="block text-[13px] font-semibold text-ink mb-2">{t('settings.privacy.catalogVisibility')}</label>
                  <select className="w-full bg-surface border border-divider rounded-xl px-4 py-2.5 text-[13px] text-ink outline-none cursor-pointer hover:border-mid transition">
                    {[t('settings.visibility.public'), t('settings.visibility.followersOnly'), t('settings.visibility.private')].map(v => <option key={v}>{v}</option>)}
                  </select>
                </div>
                <div className="mb-5">
                  <label className="block text-[13px] font-semibold text-ink mb-2">{t('settings.privacy.listenLaterVisibility')}</label>
                  <select className="w-full bg-surface border border-divider rounded-xl px-4 py-2.5 text-[13px] text-ink outline-none cursor-pointer hover:border-mid transition">
                    {[t('settings.visibility.public'), t('settings.visibility.private')].map(v => <option key={v}>{v}</option>)}
                  </select>
                </div>
              </Section>

            </section>
            <section className="scroll-mt-24">
              <div className="border border-red-200 dark:border-red-900/50 rounded-2xl p-6 bg-red-50/50 dark:bg-red-950/20">
                <div className="flex flex-col gap-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-[13px] font-semibold text-ink">{t('nav.logOut')}</p>
                      <p className="text-[12px] text-muted mt-0.5">{t('settings.danger.logOutDesc')}</p>
                    </div>
                    <button
                      onClick={handleSignOut}
                      className="flex-shrink-0 px-4 py-2 rounded-lg border border-red-200 dark:border-red-900/50 text-[12px] font-semibold text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-950/40 transition flex items-center gap-1.5"
                    >
                      <LogOut size={13} /> {t('nav.logOut')}
                    </button>
                  </div>
                  <div className="border-t border-red-100 dark:border-red-900/40" />
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-[13px] font-semibold text-ink">{t('settings.danger.deleteTitle')}</p>
                      <p className="text-[12px] text-muted mt-0.5">{t('settings.danger.deleteDesc')}</p>
                    </div>
                    <button
                      onClick={() => { setDeleteConfirm(''); setDeleteError(null); setShowDeleteModal(true); }}
                      className="flex-shrink-0 px-4 py-2 rounded-lg bg-red-600 text-[12px] font-semibold text-white hover:bg-red-700 transition flex items-center gap-1.5"
                    >
                      <Trash2 size={13} /> {t('settings.danger.deleteBtn')}
                    </button>
                  </div>
                </div>
              </div>
            </section>

            {/* Delete account confirmation modal */}
            {showDeleteModal && (
              <div
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
                onClick={() => { if (!deleting) setShowDeleteModal(false); }}
              >
                <div className="rounded-2xl bg-page p-6 shadow-xl w-[360px] mx-4" onClick={(e) => e.stopPropagation()}>
                  <h2 className="text-[15px] font-bold text-ink">{t('settings.danger.deleteTitle')}</h2>
                  <p className="mt-2 text-[13px] text-muted leading-relaxed">{t('settings.danger.deleteDesc')}</p>
                  <p className="mt-4 text-[12px] font-semibold text-ink">
                    {t('settings.danger.deleteConfirm')} <span className="text-red-600">{username}</span>
                  </p>
                  <input
                    type="text"
                    value={deleteConfirm}
                    onChange={(e) => setDeleteConfirm(e.target.value)}
                    placeholder={username}
                    autoFocus
                    className="mt-2 w-full bg-surface border border-divider rounded-lg px-3 py-2 text-[13px] text-ink outline-none focus:border-ink transition"
                  />
                  {deleteError && <p className="mt-2 text-[12px] text-red-500">{deleteError}</p>}
                  <div className="mt-5 flex gap-3">
                    <button
                      onClick={() => setShowDeleteModal(false)}
                      disabled={deleting}
                      className="flex-1 rounded-xl border border-divider px-4 py-2.5 text-[13px] font-semibold text-ink hover:bg-surface transition disabled:opacity-50"
                    >
                      {t('settings.account.cancel')}
                    </button>
                    <button
                      onClick={handleDeleteAccount}
                      disabled={deleting || !username || deleteConfirm !== username}
                      className="flex-1 rounded-xl bg-red-600 px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-red-700 transition disabled:opacity-40"
                    >
                      {deleting ? t('settings.danger.deleting') : t('settings.danger.deleteConfirmBtn')}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {showImportModal && (
        <InstinctImportModal
          count={importCount}
          busy={importBusy}
          error={importError}
          onUse={handleImportUse}
          onFresh={handleImportFresh}
          onCancel={() => { if (!importBusy) setShowImportModal(false); }}
        />
      )}
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
