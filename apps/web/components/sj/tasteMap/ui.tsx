'use client';

import { X } from 'lucide-react';
import { useLanguage } from '../../../lib/i18n';

/**
 * Small shared pieces for the Taste Map's Phase 4 panels (same tokens as the
 * TasteMapView toolbar: rounded-full pills, 10px uppercase section labels).
 */

// No conflicting utilities in one class string (bg-surface vs bg-ink, py-1 vs py-1.5).
const pillBase = 'inline-flex items-center gap-1.5 rounded-full border px-3 font-semibold transition';
export const pillPlain = `${pillBase} border-divider bg-surface text-ink hover:bg-ink/[0.04] disabled:cursor-not-allowed disabled:text-muted/60`;
export const pillSolid = `${pillBase} border-ink bg-ink text-page disabled:cursor-not-allowed disabled:opacity-50`;
export const pillLg = 'py-1.5 text-[12px]';
export const pillSm = 'py-1 text-[11.5px]';

/** Inline en/ko copy for a panel (the shell's dictionaries aren't in lib/i18n yet). */
export function useCopy<T extends Record<string, string>>(copy: { en: T; ko: { [K in keyof T]: string } }): T {
  const { lang } = useLanguage();
  return (lang === 'ko' ? copy.ko : copy.en) as T;
}

export function SectionLabel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <p className={`text-[10px] font-bold uppercase tracking-[0.08em] text-muted/60 ${className}`}>{children}</p>;
}

export function PanelHeader({ label, title, onClose, closeLabel }: { label: string; title: string; onClose: () => void; closeLabel: string }) {
  return (
    <div className="flex items-start gap-2">
      <div className="min-w-0 flex-1">
        <SectionLabel>{label}</SectionLabel>
        <h2 className="mt-1 truncate text-[17px] font-extrabold leading-tight text-ink">{title}</h2>
      </div>
      <button type="button" aria-label={closeLabel} onClick={onClose} className="shrink-0 rounded-full p-1 text-muted hover:text-ink">
        <X size={16} />
      </button>
    </div>
  );
}

/** Shown in place of server-only controls in fixture / mock mode. */
export function SignInNote({ text }: { text: string }) {
  return <p className="mt-2 rounded-lg bg-ink/[0.04] px-2.5 py-1.5 text-[11.5px] font-semibold text-muted">{text}</p>;
}
