'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { supabase } from '../../../lib/supabaseClient';
import { useLanguage } from '../../../lib/i18n';
import { USERNAME_REGEX, normalizeUsername } from '../../../lib/username';

type Step = 'name' | 'username' | 'notifications';

/**
 * Onboarding — one question per screen, mirroring iOS OnboardingView:
 * name → username → rating style → notifications. Display name pre-fills
 * from the OAuth provider metadata.
 *
 * The name step is skipped entirely for Sign in with Apple (matches iOS's
 * `OnboardingView.init`, fixed 2026-07-28 after two App Store rejections on
 * Guideline 4): Apple's Authentication Services already supplied whatever
 * name it had, or supplied nothing on a repeat authorization — either way,
 * this app must not ask again. Google/Spotify still see the step.
 */
export default function OnboardingPage() {
  const { t } = useLanguage();
  const [stepIndex, setStepIndex] = useState(0);
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [usernameStatus, setUsernameStatus] = useState<'idle' | 'checking' | 'ok' | 'taken' | 'invalid'>('idle');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [provider, setProvider] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const usernameInput = useRef<HTMLInputElement>(null);
  const checkTimer = useRef<ReturnType<typeof setTimeout>>();

  const steps = useMemo<Step[]>(
    () =>
      provider === 'apple'
        ? ['username', 'notifications']
        : ['name', 'username', 'notifications'],
    [provider]
  );
  const step = steps[stepIndex];

  // Pre-fill name from OAuth metadata (full_name / name) and read the sign-in
  // provider, like iOS. `getSession()` reads the already-established local
  // session (no network round-trip), so `steps` resolves before the first
  // paint would otherwise show the wrong step list.
  useEffect(() => {
    if (!supabase) {
      setReady(true);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      const user = data.session?.user;
      const meta = user?.user_metadata ?? {};
      const provided = (meta.full_name as string) || (meta.name as string) || '';
      if (provided) setDisplayName((v) => v || provided);
      setProvider(user?.app_metadata?.provider ?? null);
      setReady(true);
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
    if (!USERNAME_REGEX.test(u)) {
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

  // Continue is never gated on the name field — matches iOS's StepName,
  // which stays unconditional so an empty/optional name never blocks
  // onboarding; `finish()` falls back to the username.
  const canContinue = step === 'username' ? usernameStatus === 'ok' : true;

  function advance() {
    if (stepIndex + 1 < steps.length) setStepIndex(stepIndex + 1);
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
      // Falls back to the username, not the email's local part — an Apple
      // private-relay address's random local part reads far worse, and by
      // this point the username step has already validated a real one.
      const finalName = typed || username;
      const { error } = await supabase.from('profiles').upsert({
        id: user.id,
        display_name: finalName,
        username: username.trim().toLowerCase(),
      });
      if (error) throw error;
      // Full reload so SessionProvider picks up the fresh profile
      window.location.href = '/';
    } catch {
      setSaveError(t('sj.onboarding.saveError'));
      setSaving(false);
    }
  }

  if (!ready) {
    return <div className="min-h-screen bg-page" />;
  }

  return (
    <div className="min-h-screen bg-page flex flex-col items-center px-6">
      {/* Progress capsules */}
      <div className="flex items-center gap-1.5 pt-16">
        {steps.map((s, i) => (
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
                onChange={(e) => setUsername(normalizeUsername(e.target.value))}
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
            {/*
              A custom pre-permission screen must always lead into the real
              system prompt — no "Skip for now" escape hatch (App Review,
              Guideline 5.1.1(iv); iOS's StepAppleMusic/StepNotifications hit
              this exact issue, fixed 2026-07-28, ported here for parity even
              though App Review doesn't review the web app). "Continue" is the
              only action and always calls requestNotifications(), which
              resolves to finish() either way the browser's own prompt goes.
            */}
            <button
              onClick={requestNotifications}
              disabled={saving}
              className="w-full py-4 rounded-xl bg-ink text-page text-[15px] font-semibold hover:opacity-90 disabled:opacity-60 transition"
            >
              {saving ? '…' : t('sj.onboarding.continue')}
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
