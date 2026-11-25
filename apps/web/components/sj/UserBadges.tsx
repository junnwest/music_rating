'use client';

import { useState } from 'react';
import { BadgeCheck, Check } from 'lucide-react';
import FoundingNumberBadge from './FoundingNumberBadge';
import Modal from './Modal';
import { supabase } from '../../lib/supabaseClient';
import { useLanguage } from '../../lib/i18n';

/**
 * User badges — web mirror of iOS FeaturedBadge.swift / QuestBadge.swift.
 *
 * Posts show ONE badge beside the @handle (the user's pick, profiles.featured_badge,
 * if they still own it; else the first owned in the order verified > founding > quest).
 * The profile header shows every badge, and on your own profile they open the picker.
 */

export type FeaturedBadge = 'verified' | 'founding' | 'quest';

/** The profile columns the badges read. Every field optional so partial selects still type. */
export interface BadgeFields {
  is_verified?: boolean | null;
  founding_number?: number | null;
  badge_color?: string | null;
  featured_badge?: string | null;
}

/** Comma-separated, for appending to a profiles select / embed. */
export const BADGE_COLUMNS = 'is_verified,founding_number,badge_color,featured_badge';

/** Quest badge colors (iOS QuestBadgeColor). */
const QUEST_COLORS: Record<string, string> = {
  gold: '#C6902A',
  coral: '#EA6A5D',
  violet: '#855CD0',
  mint: '#35B596',
  rose: '#E06092',
};

/** Every badge this user owns, in priority order. */
export function ownedBadges(p: BadgeFields | null | undefined): FeaturedBadge[] {
  if (!p) return [];
  const out: FeaturedBadge[] = [];
  if (p.is_verified) out.push('verified');
  if (p.founding_number != null) out.push('founding');
  if (p.badge_color && QUEST_COLORS[p.badge_color]) out.push('quest');
  return out;
}

/** The one badge posts show: the user's choice if still owned, else the first owned. */
export function resolveFeaturedBadge(p: BadgeFields | null | undefined): FeaturedBadge | null {
  const owned = ownedBadges(p);
  const choice = p?.featured_badge as FeaturedBadge | null | undefined;
  if (choice && owned.includes(choice)) return choice;
  return owned[0] ?? null;
}

/** The flower silhouette (iOS icon-flower), tinted the user's claimed quest color. */
function QuestFlower({ color, size, label }: { color: string; size: number; label: string }) {
  return (
    <svg
      viewBox="0 0 26.78 25.76"
      width={size}
      height={size}
      fill={color}
      role="img"
      aria-label={label}
      className="shrink-0"
    >
      <title>{label}</title>
      <path d="M13.4,19c-.13.68-.25,1.38-.44,2.09-.55,2.03-1.9,3.88-3.97,4.48-1.61.47-3.38.03-4.5-1.21-1.01-1.12-1.29-2.64-.92-4.08.61-2.4,2.69-3.78,4.84-4.83-1.01.1-1.93.23-2.91.17-1.51-.1-2.94-.57-4.06-1.58-1.82-1.64-1.99-4.55-.06-6.2,1.02-.88,2.37-1.22,3.72-1.11,2.15.19,3.74,1.44,5.24,2.94-1.39-2.57-2.14-5.6-.27-8.01C10.84.65,11.99.06,13.21,0c1.32-.06,2.5.49,3.37,1.49,2.02,2.33,1.33,5.52-.1,8.13,1.77-1.72,3.69-3.12,6.23-2.89,1.11.1,2.17.54,2.95,1.34,1.58,1.62,1.45,4.2-.19,5.82-1.13,1.12-2.64,1.65-4.23,1.73-.96.05-1.86-.08-2.86-.18,2.18,1.08,4.3,2.5,4.84,4.95.34,1.53-.02,3.11-1.16,4.18-1.28,1.2-3.09,1.5-4.71.84-1.3-.53-2.25-1.49-2.91-2.71-.61-1.14-.84-2.35-1.05-3.71ZM14.93,13.89c0-.84-.69-1.52-1.54-1.52s-1.54.68-1.54,1.52.69,1.52,1.54,1.52,1.54-.68,1.54-1.52Z" />
    </svg>
  );
}

/** Rocket-only founding tile for small rows, where three digits would be unreadable. */
function FoundingRocket({ number, size }: { number: number; size: number }) {
  const digits = String(number).padStart(3, '0');
  return (
    <span
      role="img"
      aria-label={`Founding member #${digits}`}
      title={`Founding member #${digits}`}
      className="inline-grid place-items-center shrink-0 text-white"
      style={{ width: size, height: size, borderRadius: size * 0.2, background: '#CF7A45' }}
    >
      <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: size * 0.6, height: size * 0.6 }} aria-hidden>
        <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
        <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09" />
        <path d="M9 12a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.4 22.4 0 0 1-4 2z" />
        <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 .05 5 .05" />
      </svg>
    </span>
  );
}

/** Draws one badge. `compact` = rocket-only founding tile (rows); else the numbered tile. */
export function BadgeGlyph({
  badge,
  fields,
  size = 13,
  compact = true,
}: {
  badge: FeaturedBadge;
  fields: BadgeFields;
  size?: number;
  compact?: boolean;
}) {
  const { t } = useLanguage();
  switch (badge) {
    case 'verified':
      return (
        <BadgeCheck
          size={size}
          className="text-accent shrink-0"
          role="img"
          aria-label={t('sj.badges.verified')}
        />
      );
    case 'founding':
      if (fields.founding_number == null) return null;
      return compact ? (
        <FoundingRocket number={fields.founding_number} size={size} />
      ) : (
        <FoundingNumberBadge number={fields.founding_number} size={size} />
      );
    case 'quest': {
      const color = fields.badge_color ? QUEST_COLORS[fields.badge_color] : undefined;
      if (!color) return null;
      return <QuestFlower color={color} size={size} label={t('sj.badges.quest')} />;
    }
  }
}

/** The single badge beside an @handle on posts and comments. */
export function PostBadge({ profile, size = 13 }: { profile: BadgeFields | null | undefined; size?: number }) {
  const badge = resolveFeaturedBadge(profile);
  if (!badge || !profile) return null;
  return <BadgeGlyph badge={badge} fields={profile} size={size} />;
}

/**
 * Profile header: every owned badge (quest, verified, founding — iOS's header order).
 * On your own profile, clicking them opens the picker for which one your posts show.
 */
export function ProfileBadges({
  profile,
  isSelf,
  userId,
  onFeaturedChange,
}: {
  profile: BadgeFields | null;
  isSelf: boolean;
  userId: string | null;
  onFeaturedChange: (featured: FeaturedBadge) => void;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const owned = ownedBadges(profile);
  if (!profile || owned.length === 0) return null;

  const order: FeaturedBadge[] = ['quest', 'verified', 'founding'];
  const glyphs = order
    .filter((b) => owned.includes(b))
    .map((b) => (
      <BadgeGlyph key={b} badge={b} fields={profile} size={b === 'founding' ? 18 : 16} compact={false} />
    ));

  if (!isSelf || !userId) return <span className="inline-flex items-center gap-1">{glyphs}</span>;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={t('sj.badges.pickHint')}
        aria-label={t('sj.badges.pickHint')}
        className="inline-flex items-center gap-1 rounded-md p-0.5 -m-0.5 hover:bg-surface transition"
      >
        {glyphs}
      </button>
      <BadgePickerModal
        open={open}
        onClose={() => setOpen(false)}
        profile={profile}
        userId={userId}
        onSaved={(b) => {
          onFeaturedChange(b);
          setOpen(false);
        }}
      />
    </>
  );
}

/** iOS FeaturedBadgePickerSheet. */
function BadgePickerModal({
  open,
  onClose,
  profile,
  userId,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  profile: BadgeFields;
  userId: string;
  onSaved: (b: FeaturedBadge) => void;
}) {
  const { t } = useLanguage();
  const owned = ownedBadges(profile);
  const [selection, setSelection] = useState<FeaturedBadge | null>(() => resolveFeaturedBadge(profile));
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  const title = (b: FeaturedBadge) =>
    b === 'verified'
      ? t('sj.badges.verified')
      : b === 'quest'
        ? t('sj.badges.quest')
        : t('sj.badges.founding').replace('{n}', String(profile.founding_number ?? 0).padStart(3, '0'));

  async function save() {
    if (!selection || !supabase) return;
    setSaving(true);
    setFailed(false);
    const { error } = await supabase.from('profiles').update({ featured_badge: selection }).eq('id', userId);
    setSaving(false);
    if (error) {
      console.error('[badges] save featured_badge failed:', error.message);
      setFailed(true);
      return;
    }
    onSaved(selection);
  }

  return (
    <Modal open={open} onClose={onClose} title={t('sj.badges.title')} maxWidth="max-w-sm">
      <ul className="flex flex-col">
        {owned.map((b) => (
          <li key={b}>
            <button
              type="button"
              onClick={() => setSelection(b)}
              aria-pressed={selection === b}
              className="w-full flex items-center gap-3 px-2 py-2.5 rounded-lg hover:bg-page transition text-left"
            >
              <span className="w-[30px] grid place-items-center">
                <BadgeGlyph badge={b} fields={profile} size={26} compact={b !== 'founding'} />
              </span>
              <span className="flex-1 text-[15px] font-semibold text-ink">{title(b)}</span>
              {selection === b && <Check size={16} className="text-accent" />}
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-2 px-2 text-[12px] text-muted">{t('sj.badges.pickFooter')}</p>
      {failed && <p className="mt-2 px-2 text-[12px] text-red-500">{t('sj.badges.saveFailed')}</p>}
      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={save}
          disabled={!selection || saving}
          className="px-4 py-2 rounded-lg bg-ink text-page text-[14px] font-semibold disabled:opacity-50 transition"
        >
          {t('sj.badges.save')}
        </button>
      </div>
    </Modal>
  );
}
