'use client';

import { useEffect, useRef, useState } from 'react';
import { Info, X } from 'lucide-react';
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

/**
 * An (i) button that opens a short explanation (tap or click; outside click or
 * Esc closes). For places where a hover title isn't enough: phones have no
 * hover, and the stage's controls need a sentence, not a word.
 */
export function InfoTip({
  text,
  label,
  align = 'left',
  side = 'below',
  className = '',
}: {
  text: React.ReactNode;
  label: string;
  align?: 'left' | 'right' | 'center';
  side?: 'below' | 'above';
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const x = align === 'right' ? 'right-0' : align === 'center' ? 'left-1/2 -translate-x-1/2' : 'left-0';
  const y = side === 'above' ? 'bottom-full mb-1.5' : 'top-full mt-1.5';
  return (
    <span ref={ref} className={`pointer-events-auto relative inline-flex ${className}`}>
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex h-6 w-6 items-center justify-center rounded-full transition ${open ? 'text-ink' : 'text-muted hover:text-ink'}`}
      >
        <Info size={13} />
      </button>
      {open && (
        <span
          role="note"
          className={`absolute ${x} ${y} z-30 block w-[min(260px,80vw)] rounded-lg border border-divider bg-surface px-3 py-2 text-left text-[11.5px] font-normal normal-case leading-snug tracking-normal text-ink shadow-[0_8px_24px_rgba(0,0,0,0.25)]`}
        >
          {text}
        </span>
      )}
    </span>
  );
}
