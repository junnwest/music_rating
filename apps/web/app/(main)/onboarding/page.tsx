'use client';

import { useEffect, useRef, useState } from 'react';
import { Star, ArrowLeftRight, CheckCircle2, Circle, Bell } from 'lucide-react';
import { supabase } from '../../../lib/supabaseClient';
import { useLanguage } from '../../../lib/i18n';

type Step = 'name' | 'username' | 'ratingMode' | 'notifications';
const STEPS: Step[] = ['name', 'username', 'ratingMode', 'notifications'];

/**
 * Onboarding — one question per screen, mirroring iOS OnboardingView:
 * name → username → rating style → notifications. Display name pre-fills
 * from the OAuth provider metadata.
 */
export default function OnboardingPage() {
  const { t } = useLanguage();
  const [stepIndex, setStepIndex] = useState(0);
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [usernameStatus, setUsernameStatus] = useState<'idle' | 'checking' | 'ok' | 'taken' | 'invalid'>('idle');
  const [ratingMode, setRatingMode] = useState<'manual' | 'instinct'>('manual');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const usernameInput = useRef<HTMLInputElement>(null);
  const checkTimer = useRef<ReturnType<typeof setTimeout>>();

  const step = STEPS[stepIndex];

  // Pre-fill name from OAuth metadata (full_name / name), like iOS
  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getUser().then(({ data }) => {
      const meta = data.user?.user_metadata ?? {};
      const provided = (meta.full_name as string) || (meta.name as string) || '';
      if (provided) setDisplayName((v) => v || provided);
    });
  }, []);

  useEffect(() => {
    if (step === 'name') nameInput.current?.focus();
    if (step === 'username') usernameInput.current?.focus();
  }, [step]);

  // Debounced username availability check
  useEffect(() => {
    clearTimeout(checkTimer.current);
    const u = username.trim().toLowerCase();
    if (!u) {
      setUsernameStatus('idle');
      return;
    }
    if (!/^[a-z0-9_.]{3,24}$/.test(u)) {
      setUsernameStatus('invalid');
      return;
    }
    setUsernameStatus('checking');
    checkTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/check-username?username=${encodeURIComponent(u)}`);
        const body = await res.json();
        setUsernameStatus(body.available ? 'ok' : 'taken');
      } catch {
        // On check failure allow continuing — the DB unique constraint is the backstop
        setUsernameStatus('ok');
      }
    }, 350);
    return () => clearTimeout(checkTimer.current);
  }, [username]);

  const canContinue =
    step === 'name'
      ? displayName.trim().length > 0
      : step === 'username'
        ? usernameStatus === 'ok'
        : true;

  function advance() {
    if (stepIndex + 1 < STEPS.length) setStepIndex(stepIndex + 1);
  }

  async function requestNotifications() {
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        await Notification.requestPermission();
      }
    } catch {
      /* unsupported browsers just skip */
    }
    await finish();
  }

  async function finish() {
    if (!supabase) return;
    setSaving(true);
    setSaveError(null);
    try {
      const { data } = await supabase.auth.getUser();
      const user = data.user;
      if (!user) throw new Error('not signed in');
      const typed = displayName.trim();
      const finalName = typed || user.email?.split('@')[0] || '';
      const { error } = await supabase.from('profiles').upsert({
        id: user.id,
        display_name: finalName,
        username: username.trim().toLowerCase(),
        rating_mode: ratingMode,
      });
      if (error) throw error;
      // Full reload so SessionProvider picks up the fresh profile
      window.location.href = '/';
    } catch {
      setSaveError(t('sj.onboarding.saveError'));
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-page flex flex-col items-center px-6">
      {/* Progress capsules */}
      <div className="flex items-center gap-1.5 pt-16">
        {STEPS.map((s, i) => (
          <span
            key={s}
            className={`h-1.5 rounded-full transition-all duration-300 ${
              i === stepIndex ? 'w-5 bg-ink' : 'w-1.5 bg-divider'
            }`}
          />
        ))}
      </div>

      <div className="w-full max-w-md flex-1 flex flex-col pt-16 pb-12">
        {step === 'name' && (
          <StepShell
            title={t('sj.onboarding.nameTitle')}
            canContinue={canContinue}
            continueLabel={t('sj.onboarding.continue')}
            onContinue={advance}
          >
            <input
              ref={nameInput}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && canContinue && advance()}
              placeholder={t('sj.onboarding.namePlaceholder')}
              className="w-full px-4 py-3.5 rounded-[10px] bg-surface border border-divider text-[15px] text-ink placeholder-placeholder outline-none focus:border-accent/60 transition"
            />
          </StepShell>
        )}

        {step === 'username' && (
          <StepShell
            title={t('sj.onboarding.usernameTitle')}
            canContinue={canContinue}
            continueLabel={t('sj.onboarding.continue')}
            onContinue={advance}
          >
            <div className="flex items-center gap-1 px-4 py-3.5 rounded-[10px] bg-surface border border-divider focus-within:border-accent/60 transition">
              <span className="text-muted text-[15px]">@</span>
              <input
                ref={usernameInput}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && canContinue && advance()}
                placeholder={t('sj.onboarding.usernamePlaceholder')}
                autoCapitalize="none"
                autoCorrect="off"
                className="w-full bg-transparent text-[15px] text-ink placeholder-placeholder outline-none"
              />
            </div>
            <p className="mt-2 text-[12px] h-4">
              {usernameStatus === 'taken' && (
                <span className="text-red-500">{t('sj.onboarding.usernameTaken')}</span>
              )}
              {usernameStatus === 'invalid' && username.trim() !== '' && (
                <span className="text-muted">{t('sj.onboarding.usernameRules')}</span>
              )}
              {usernameStatus === 'ok' && (
                <span className="text-accent">{t('sj.onboarding.usernameAvailable')}</span>
              )}
            </p>
          </StepShell>
        )}

        {step === 'ratingMode' && (
          <StepShell
            title={t('sj.onboarding.ratingModeTitle')}
            subtitle={t('sj.onboarding.ratingModeSubtitle')}
            canContinue
            continueLabel={t('sj.onboarding.continue')}
            onContinue={advance}
          >
            <div className="flex flex-col gap-3">
              <ModeCard
                icon={<Star size={22} />}
                title={t('sj.onboarding.modeManual')}
                description={t('sj.onboarding.modeManualDesc')}
                selected={ratingMode === 'manual'}
                onClick={() => setRatingMode('manual')}
              />
              <ModeCard
                icon={<ArrowLeftRight size={22} />}
                title={t('sj.onboarding.modeInstinct')}
                description={t('sj.onboarding.modeInstinctDesc')}
                selected={ratingMode === 'instinct'}
                onClick={() => setRatingMode('instinct')}
              />
            </div>
          </StepShell>
        )}

        {step === 'notifications' && (
          <div className="flex-1 flex flex-col">
            <h1 className="text-[26px] font-bold text-ink">
              {t('sj.onboarding.notificationsTitle')}
            </h1>
            <p className="mt-2 text-[15px] text-muted">
              {t('sj.onboarding.notificationsDesc')}
            </p>
            <div className="flex-1 flex items-center justify-center py-10">
              <span className="flex w-20 h-20 rounded-full bg-accent-soft text-accent items-center justify-center">
                <Bell size={34} />
              </span>
            </div>
            {saveError && (
              <p className="mb-3 text-[13px] text-red-500 text-center">{saveError}</p>
            )}
            <button
              onClick={requestNotifications}
              disabled={saving}
              className="w-full py-4 rounded-xl bg-ink text-page text-[15px] font-semibold hover:opacity-90 disabled:opacity-60 transition"
            >
              {saving ? '…' : t('sj.onboarding.allowNotifications')}
            </button>
            <button
              onClick={finish}
              disabled={saving}
              className="mt-3 py-1 text-[13px] text-muted hover:text-ink transition"
            >
              {t('sj.onboarding.skipForNow')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function StepShell({
  title,
  subtitle,
  children,
  canContinue,
  continueLabel,
  onContinue,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  canContinue: boolean;
  continueLabel: string;
  onContinue: () => void;
}) {
  return (
    <div className="flex-1 flex flex-col">
      <h1 className="text-[26px] font-bold text-ink">{title}</h1>
      {subtitle && <p className="mt-2 text-[15px] text-muted">{subtitle}</p>}
      <div className="mt-8">{children}</div>
      <div className="flex-1" />
      <button
        onClick={onContinue}
        disabled={!canContinue}
        className={`w-full py-4 rounded-xl text-[15px] font-semibold transition ${
          canContinue
            ? 'bg-ink text-page hover:opacity-90'
            : 'bg-divider text-muted cursor-not-allowed'
        }`}
      >
        {continueLabel}
      </button>
    </div>
  );
}

function ModeCard({
  icon,
  title,
  description,
  selected,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-4 px-4 py-4 rounded-2xl border-[1.5px] text-left transition ${
        selected
          ? 'bg-ink border-ink text-page'
          : 'bg-surface border-divider text-ink hover:border-muted'
      }`}
    >
      <span className={selected ? 'text-page' : 'text-muted'}>{icon}</span>
      <span className="flex-1">
        <span className="block text-[16px] font-semibold">{title}</span>
        <span className={`block text-[13px] mt-0.5 ${selected ? 'text-page/75' : 'text-muted'}`}>
          {description}
        </span>
      </span>
      {selected ? (
        <CheckCircle2 size={20} className="text-page" />
      ) : (
        <Circle size={20} className="text-divider" />
      )}
    </button>
  );
}
