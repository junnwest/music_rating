'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import {
  Sun,
  Moon,
  Monitor,
  Star,
  ArrowLeftRight,
  ExternalLink,
} from 'lucide-react';
import Modal from '../../../components/sj/Modal';
import { useSession } from '../../../components/sj/SessionContext';
import { supabase } from '../../../lib/supabaseClient';
import { useLanguage } from '../../../lib/i18n';

/**
 * Settings — web sibling of iOS SettingsView: profile, appearance, rating
 * mode + precision, notification toggles, privacy visibility, legal links,
 * sign out + delete account. Adds the web-only language picker.
 */
export default function SettingsPage() {
  const { t, lang, setLang } = useLanguage();
  const { theme, setTheme } = useTheme();
  const router = useRouter();
  const { userId, profile, ready, refreshProfile, signOut } = useSession();

  const [displayNameDraft, setDisplayNameDraft] = useState('');
  const [bioDraft, setBioDraft] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);

  const [showSignOut, setShowSignOut] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [deleteInput, setDeleteInput] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (ready && !userId) router.replace('/login');
  }, [ready, userId, router]);

  useEffect(() => {
    if (profile) {
      setDisplayNameDraft(profile.display_name ?? '');
      setBioDraft(profile.bio ?? '');
    }
  }, [profile]);

  async function patch(fields: Record<string, unknown>) {
    if (!supabase || !userId) return;
    await supabase.from('profiles').update(fields).eq('id', userId);
    refreshProfile();
  }

  async function saveProfile() {
    setSavingProfile(true);
    await patch({ display_name: displayNameDraft.trim(), bio: bioDraft.trim() || null });
    setSavingProfile(false);
    setProfileSaved(true);
    setTimeout(() => setProfileSaved(false), 2000);
  }

  async function deleteAccount() {
    if (!supabase) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error('not signed in');
      const res = await fetch('/api/account/delete', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        await signOut();
        return;
      }
      const body = await res.json().catch(() => null);
      setDeleteError(body?.error ?? t('sj.settings.deleteFailed'));
    } catch {
      setDeleteError(t('sj.settings.deleteFailed'));
    }
    setDeleting(false);
  }

  if (!ready || !profile) {
    return <div className="py-32 text-center text-muted text-[13px]">…</div>;
  }

  const ratingMode = profile.rating_mode ?? 'manual';
  const ratingStep = profile.manual_rating_step ?? 0.5;

  return (
    <div className="mx-auto max-w-2xl px-4 md:px-6 py-7 pb-16">
      <h1 className="text-[20px] font-bold text-ink mb-6">{t('sj.nav.settings')}</h1>

      {/* ── Account ── */}
      <Section title={t('sj.settings.account')}>
        <div className="px-4 py-4 space-y-3.5">
          <Field label={t('sj.settings.displayName')}>
            <input
              value={displayNameDraft}
              onChange={(e) => setDisplayNameDraft(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-[10px] bg-page border border-divider text-[14px] text-ink outline-none focus:border-accent/60 transition"
            />
          </Field>
          <Field label={t('sj.settings.username')}>
            <p className="px-3.5 py-2.5 rounded-[10px] bg-page border border-divider text-[14px] text-muted">
              @{profile.username}
            </p>
          </Field>
          <Field label={t('sj.settings.bio')}>
            <textarea
              value={bioDraft}
              onChange={(e) => setBioDraft(e.target.value)}
              rows={2}
              className="w-full px-3.5 py-2.5 rounded-[10px] bg-page border border-divider text-[14px] text-ink outline-none focus:border-accent/60 resize-none transition"
            />
          </Field>
          <div className="flex justify-end">
            <button
              onClick={saveProfile}
              disabled={savingProfile}
              className="px-4 py-2 rounded-[10px] bg-accent text-white text-[13px] font-semibold hover:opacity-90 disabled:opacity-50 transition"
            >
              {profileSaved ? '✓' : t('sj.common.save')}
            </button>
          </div>
        </div>
      </Section>

      {/* ── Preferences ── */}
      <Section title={t('sj.settings.preferences')}>
        <div className="px-4 py-4 space-y-5">
          <Field label={t('sj.settings.appearance')}>
            <Segmented
              options={[
                { value: 'light', label: t('sj.settings.light'), icon: <Sun size={13} /> },
                { value: 'system', label: t('sj.settings.system'), icon: <Monitor size={13} /> },
                { value: 'dark', label: t('sj.settings.dark'), icon: <Moon size={13} /> },
              ]}
              value={theme ?? 'system'}
              onChange={setTheme}
            />
          </Field>
          <Field label={t('sj.settings.language')}>
            <Segmented
              options={[
                { value: 'en', label: 'English' },
                { value: 'ko', label: '한국어' },
              ]}
              value={lang}
              onChange={(v) => setLang(v as 'en' | 'ko')}
            />
          </Field>
          <Field label={t('sj.settings.ratingMode')}>
            <Segmented
              options={[
                {
                  value: 'manual',
                  label: t('sj.onboarding.modeManual'),
                  icon: <Star size={13} />,
                },
                {
                  value: 'instinct',
                  label: t('sj.onboarding.modeInstinct'),
                  icon: <ArrowLeftRight size={13} />,
                },
              ]}
              value={ratingMode}
              onChange={(v) => patch({ rating_mode: v })}
            />
            <p className="mt-1.5 text-[11.5px] text-muted">{t('sj.settings.ratingModeNote')}</p>
          </Field>
          {ratingMode === 'manual' && (
            <Field label={t('sj.settings.ratingPrecision')}>
              <Segmented
                options={[
                  { value: '0.5', label: t('sj.settings.halfStar') },
                  { value: '0.1', label: t('sj.settings.tenth') },
                ]}
                value={String(ratingStep)}
                onChange={(v) => patch({ manual_rating_step: parseFloat(v) })}
              />
            </Field>
          )}
        </div>
      </Section>

      {/* ── Notifications ── */}
      <Section title={t('sj.settings.notifications')}>
        <div className="divide-y divide-divider">
          <ToggleRow
            label={t('sj.settings.notifyLikes')}
            checked={profile.notify_likes ?? true}
            onChange={(v) => patch({ notify_likes: v })}
          />
          <ToggleRow
            label={t('sj.settings.notifyReplies')}
            checked={profile.notify_replies ?? true}
            onChange={(v) => patch({ notify_replies: v })}
          />
          <ToggleRow
            label={t('sj.settings.notifyFollowers')}
            checked={profile.notify_followers ?? true}
            onChange={(v) => patch({ notify_followers: v })}
          />
          <ToggleRow
            label={t('sj.settings.notifyRankings')}
            checked={profile.notify_rankings ?? true}
            onChange={(v) => patch({ notify_rankings: v })}
          />
          <ToggleRow
            label={t('sj.settings.notifyCapsule')}
            checked={profile.notify_capsule ?? true}
            onChange={(v) => patch({ notify_capsule: v })}
          />
        </div>
      </Section>

      {/* ── Privacy ── */}
      <Section title={t('sj.settings.privacy')}>
        <div className="divide-y divide-divider">
          <VisibilityRow
            label={t('sj.settings.profileVisibility')}
            value={profile.profile_visibility ?? 'Public'}
            onChange={(v) => patch({ profile_visibility: v })}
          />
          <VisibilityRow
            label={t('sj.settings.catalogVisibility')}
            value={profile.catalog_visibility ?? 'Public'}
            onChange={(v) => patch({ catalog_visibility: v })}
          />
          <VisibilityRow
            label={t('sj.settings.listenLaterVisibility')}
            value={profile.library_visibility ?? 'Public'}
            onChange={(v) => patch({ library_visibility: v })}
          />
        </div>
      </Section>

      {/* ── Support + Legal ── */}
      <Section title={t('sj.settings.supportLegal')}>
        <div className="divide-y divide-divider">
          <LinkRow href="/help" label={t('sj.settings.helpFeedback')} />
          <LinkRow href="/terms" label={t('sj.settings.terms')} />
          <LinkRow href="/privacy" label={t('sj.settings.privacyPolicy')} />
        </div>
      </Section>

      {/* ── Danger zone ── */}
      <Section title={t('sj.settings.dangerZone')}>
        <div className="divide-y divide-divider">
          <button
            onClick={() => setShowSignOut(true)}
            className="w-full px-4 py-3.5 text-left text-[14px] font-medium text-red-500 hover:bg-page/60 transition"
          >
            {t('sj.settings.signOut')}
          </button>
          <button
            onClick={() => {
              setDeleteInput('');
              setDeleteError(null);
              setShowDelete(true);
            }}
            className="w-full px-4 py-3.5 text-left text-[14px] font-medium text-red-500 hover:bg-page/60 transition"
          >
            {t('sj.settings.deleteAccount')}
          </button>
        </div>
      </Section>

      {/* Sign out confirm */}
      <Modal
        open={showSignOut}
        onClose={() => setShowSignOut(false)}
        title={t('sj.settings.signOutTitle')}
        maxWidth="max-w-sm"
      >
        <div className="px-5 pb-5 flex justify-end gap-2">
          <button
            onClick={() => setShowSignOut(false)}
            className="px-4 py-2 rounded-[10px] text-[13.5px] font-medium text-muted hover:text-ink transition"
          >
            {t('sj.common.cancel')}
          </button>
          <button
            onClick={signOut}
            className="px-4 py-2 rounded-[10px] bg-red-500 text-white text-[13.5px] font-semibold hover:opacity-90 transition"
          >
            {t('sj.settings.signOut')}
          </button>
        </div>
      </Modal>

      {/* Delete account */}
      <Modal
        open={showDelete}
        onClose={() => !deleting && setShowDelete(false)}
        title={t('sj.settings.deleteAccount')}
        maxWidth="max-w-sm"
      >
        <div className="px-5 pb-5">
          <p className="text-[13.5px] text-muted">{t('sj.settings.deleteWarning')}</p>
          <p className="mt-4 text-[13px] font-semibold text-ink">
            {t('sj.settings.deleteConfirmLabel')}
          </p>
          <div className="flex items-center gap-1 mt-1.5 px-3.5 py-2.5 rounded-[10px] bg-surface border border-divider">
            <span className="text-muted text-[14px]">@</span>
            <input
              value={deleteInput}
              onChange={(e) => setDeleteInput(e.target.value)}
              placeholder={profile.username ?? ''}
              autoCapitalize="none"
              className="w-full bg-transparent text-[14px] text-ink placeholder-placeholder outline-none"
            />
          </div>
          {deleteError && <p className="mt-2 text-[12.5px] text-red-500">{deleteError}</p>}
          <button
            onClick={deleteAccount}
            disabled={deleting || deleteInput !== (profile.username ?? '')}
            className="mt-4 w-full py-3 rounded-xl bg-red-500 text-white text-[15px] font-semibold hover:opacity-90 disabled:opacity-40 transition"
          >
            {deleting ? '…' : t('sj.settings.deleteMyAccount')}
          </button>
        </div>
      </Modal>
    </div>
  );
}

// ── Bits ────────────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="px-1 mb-2 text-[11px] font-semibold tracking-[0.06em] uppercase text-muted">
        {title}
      </h2>
      <div className="rounded-2xl bg-surface border border-divider/60 overflow-hidden">
        {children}
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[13px] font-semibold text-ink mb-1.5">{label}</p>
      {children}
    </div>
  );
}

function Segmented({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string; icon?: React.ReactNode }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex gap-2">
      {options.map((opt) => {
        const selected = value === opt.value;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[12px] font-semibold transition ${
              selected
                ? 'bg-ink text-page'
                : 'text-muted border border-divider hover:text-ink'
            }`}
          >
            {opt.icon}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-page/40 transition">
      <span className="text-[14px] text-ink">{label}</span>
      <button
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={(e) => {
          e.preventDefault();
          onChange(!checked);
        }}
        className={`relative w-10 h-6 rounded-full transition ${
          checked ? 'bg-accent' : 'bg-divider'
        }`}
      >
        <span
          className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${
            checked ? 'left-[18px]' : 'left-0.5'
          }`}
        />
      </button>
    </label>
  );
}

function VisibilityRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const { t } = useLanguage();
  // 20260706000012 folded 'Followers only' into 'Private' (Private = followers
  // only now); the live check constraint rejects 'Followers only' writes.
  const options: [string, string][] = [
    ['Public', t('sj.settings.visPublic')],
    ['Private', t('sj.settings.visPrivate')],
  ];
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <span className="text-[14px] text-ink">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="bg-transparent text-[13px] font-medium text-accent outline-none cursor-pointer text-right"
      >
        {options.map(([v, label2]) => (
          <option key={v} value={v}>
            {label2}
          </option>
        ))}
      </select>
    </div>
  );
}

function LinkRow({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between px-4 py-3.5 text-[14px] text-ink hover:bg-page/60 transition"
    >
      {label}
      <ExternalLink size={13} className="text-muted" />
    </Link>
  );
}
