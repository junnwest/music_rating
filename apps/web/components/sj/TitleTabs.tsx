'use client';

/**
 * Page-title tab switcher (Explore/Following, Albums/Songs, …) — the big
 * bold-vs-muted text pair used as each page's h1 row, upgraded from bare
 * buttons to a real tablist: role/aria attributes, arrow-key switching,
 * visible focus ring, and an animated active underline.
 */
export default function TitleTabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { key: T; label: string }[];
  value: T;
  onChange: (key: T) => void;
}) {
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const i = tabs.findIndex((t) => t.key === value);
    const next =
      e.key === 'ArrowRight'
        ? tabs[(i + 1) % tabs.length]
        : tabs[(i - 1 + tabs.length) % tabs.length];
    onChange(next.key);
    (e.currentTarget.querySelector(`[data-key="${next.key}"]`) as HTMLElement | null)?.focus();
  }

  return (
    <div role="tablist" className="flex items-center gap-6" onKeyDown={onKeyDown}>
      {tabs.map(({ key, label }) => {
        const selected = key === value;
        return (
          <button
            key={key}
            data-key={key}
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(key)}
            className={`relative pb-1 text-[17px] transition outline-none focus-visible:ring-2 focus-visible:ring-accent/50 rounded-sm ${
              selected ? 'font-bold text-ink' : 'font-normal text-muted hover:text-ink'
            }`}
          >
            {label}
            <span
              aria-hidden
              className={`absolute left-0 right-0 -bottom-0.5 h-[2.5px] rounded-full bg-accent transition-all duration-200 ${
                selected ? 'opacity-100 scale-x-100' : 'opacity-0 scale-x-50'
              }`}
            />
          </button>
        );
      })}
    </div>
  );
}
