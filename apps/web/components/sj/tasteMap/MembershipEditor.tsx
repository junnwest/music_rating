'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import type { NodeKey, TasteMapGroup, TasteMapPayloadNode } from '../../../lib/tasteMap/types';
import { maxWeightFor } from './useGroupEdits';
import { SectionLabel, useCopy } from './ui';

/**
 * Soft membership of one node (TASTE_MAP_PLAN.md D7): a 0–100% slider per
 * group it's in, plus "Add to group". The sum across groups is capped at 100%:
 * a slider stops at whatever the node's other groups leave free (clamp, it
 * never moves the other sliders), and the free share is shown.
 */

const COPY = {
  en: {
    groups: 'Groups',
    add: 'Add to group…',
    remove: 'Remove from',
    free: 'unassigned',
    capped: 'Capped: a node’s groups add up to 100% at most. Lower another group to give this one more.',
    none: 'Not in any group yet.',
  },
  ko: {
    groups: '그룹',
    add: '그룹에 추가…',
    remove: '그룹에서 빼기',
    free: '미지정',
    capped: '한 노드의 그룹 비중 합은 최대 100%예요. 다른 그룹을 낮추면 더 줄 수 있어요.',
    none: '아직 속한 그룹이 없어요.',
  },
};

export default function MembershipEditor({
  node,
  groups,
  onSetWeight,
}: {
  node: TasteMapPayloadNode;
  groups: TasteMapGroup[];
  onSetWeight: (key: NodeKey, groupId: string, weight: number) => number;
}) {
  const c = useCopy(COPY);
  // Groups added from the menu stay listed at 0% until the slider moves (or the node changes).
  const [added, setAdded] = useState<{ key: NodeKey; ids: string[] }>({ key: node.key, ids: [] });
  const addedIds = added.key === node.key ? added.ids : [];
  const [cappedId, setCappedId] = useState<string | null>(null);

  const rows = groups
    .filter((g) => (node.groups[g.id] ?? 0) > 0 || addedIds.includes(g.id))
    .sort((a, b) => (node.groups[b.id] ?? 0) - (node.groups[a.id] ?? 0));
  const others = groups.filter((g) => !rows.includes(g));
  const total = Object.values(node.groups).reduce((s, w) => s + w, 0);
  const free = Math.max(0, 1 - total);

  return (
    <div className="mt-3.5">
      <div className="flex items-baseline justify-between gap-2">
        <SectionLabel>{c.groups}</SectionLabel>
        <span className="text-[10.5px] tabular-nums text-muted">
          {Math.round(free * 100)}% {c.free}
        </span>
      </div>
      {rows.length === 0 && <p className="mt-1 text-[11.5px] text-muted">{c.none}</p>}
      <ul className="mt-1 space-y-1.5">
        {rows.map((g) => {
          const w = node.groups[g.id] ?? 0;
          const max = maxWeightFor(node, g.id);
          return (
            <li key={g.id}>
              <div className="flex items-center justify-between gap-2 text-[11.5px]">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: g.color }} />
                  <span className="truncate font-semibold text-ink">{g.name}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <span className="tabular-nums text-muted" data-testid={`member-pct-${g.id}`}>
                    {Math.round(w * 100)}%
                  </span>
                  <button
                    type="button"
                    aria-label={`${c.remove} ${g.name}`}
                    onClick={() => {
                      onSetWeight(node.key, g.id, 0);
                      setAdded({ key: node.key, ids: addedIds.filter((id) => id !== g.id) });
                    }}
                    className="rounded-full p-0.5 text-muted/70 hover:text-ink"
                  >
                    <X size={12} />
                  </button>
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={Math.round(w * 100)}
                aria-label={g.name}
                aria-valuetext={`${Math.round(w * 100)}%`}
                onChange={(e) => {
                  const want = Number(e.target.value) / 100;
                  const got = onSetWeight(node.key, g.id, want);
                  setCappedId(want > got + 1e-6 ? g.id : null);
                }}
                className="mt-0.5 block h-4 w-full cursor-pointer"
                style={{
                  accentColor: g.color,
                  // The part above the cap is shown muted so the limit is visible before you hit it.
                  background: `linear-gradient(to right, transparent ${max * 100}%, rgb(var(--color-divider) / 0.9) ${max * 100}%)`,
                  borderRadius: 999,
                }}
              />
              {cappedId === g.id && <p className="mt-0.5 text-[10.5px] leading-snug text-muted">{c.capped}</p>}
            </li>
          );
        })}
      </ul>
      {others.length > 0 && (
        <select
          value=""
          aria-label={c.add}
          onChange={(e) => {
            const id = e.target.value;
            if (id) setAdded({ key: node.key, ids: [...addedIds, id] });
          }}
          className="mt-2 w-full rounded-full border border-divider bg-surface px-2.5 py-1 text-[11.5px] font-semibold text-ink outline-none"
        >
          <option value="">{c.add}</option>
          {others.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
