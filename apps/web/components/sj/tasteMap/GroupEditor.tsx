'use client';

import { useState } from 'react';
import { Check, Plus, Trash2, X } from 'lucide-react';
import { LIMITS } from '../../../lib/tasteMap/apiTypes';
import type { TasteMapGroup } from '../../../lib/tasteMap/types';
import type { GroupEdits } from './useGroupEdits';
import { SectionLabel, pillPlain, pillSm, pillSolid, useCopy } from './ui';

/**
 * "Edit groups" panel under the group chips (TASTE_MAP_PLAN.md D7): create,
 * rename, recolor and delete groups. Edits apply at once (useGroupEdits);
 * delete asks in-page first.
 */

/**
 * Distinct hues that read on both the light and the dark surface (mid
 * lightness, saturated). The first nine are payload.ts's seed colors, so
 * adopted groups keep theirs.
 */
export const GROUP_PALETTE = [
  '#E4572E',
  '#4C9F70',
  '#3E7CB1',
  '#F2A541',
  '#9B5DE5',
  '#00A6A6',
  '#D7263D',
  '#7A9E3B',
  '#C17C74',
  '#D45D9C',
  '#5C6BC0',
  '#8D6E63',
] as const;

const MAX_NAME = 60;

const COPY = {
  en: {
    title: 'Edit groups',
    newGroup: 'New group',
    namePh: 'Group name',
    create: 'Create',
    rename: 'Rename',
    color: 'Color',
    del: 'Delete',
    delAsk: 'Delete “{name}”?',
    delBody: 'Nodes in it lose this group. The nodes themselves stay on your map.',
    cancel: 'Cancel',
    done: 'Done',
    full: `At most ${LIMITS.groups} groups.`,
    hint: 'Set how much a node belongs to each group from its panel (tap the node).',
  },
  ko: {
    title: '그룹 편집',
    newGroup: '새 그룹',
    namePh: '그룹 이름',
    create: '만들기',
    rename: '이름 바꾸기',
    color: '색',
    del: '삭제',
    delAsk: '“{name}” 그룹을 삭제할까요?',
    delBody: '이 그룹에 속한 노드는 그룹에서 빠져요. 노드는 지도에 그대로 남아요.',
    cancel: '취소',
    done: '완료',
    full: `그룹은 최대 ${LIMITS.groups}개예요.`,
    hint: '노드를 탭하면 패널에서 각 그룹에 얼마나 속하는지 정할 수 있어요.',
  },
};

function Swatches({ value, onPick, label }: { value: string; onPick: (c: string) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {GROUP_PALETTE.map((col) => {
        const on = col.toLowerCase() === value.toLowerCase();
        return (
          <button
            key={col}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={col}
            onClick={() => onPick(col)}
            className={`flex h-6 w-6 items-center justify-center rounded-full transition ${on ? 'ring-2 ring-ink ring-offset-2 ring-offset-surface' : 'hover:scale-110'}`}
            style={{ background: col }}
          >
            {on && <Check size={12} className="text-white" strokeWidth={3} />}
          </button>
        );
      })}
    </div>
  );
}

function GroupRow({ g, edits, c }: { g: TasteMapGroup; edits: GroupEdits; c: typeof COPY.en }) {
  const [name, setName] = useState(g.name);
  const [colorOpen, setColorOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const commit = () => {
    const v = name.trim();
    if (!v) setName(g.name);
    else if (v !== g.name) edits.rename(g.id, v);
  };

  if (confirm) {
    return (
      <li role="alertdialog" aria-label={c.delAsk.replace('{name}', g.name)} className="rounded-xl border border-divider bg-page px-3 py-2.5">
        <p className="text-[12.5px] font-bold text-ink">{c.delAsk.replace('{name}', g.name)}</p>
        <p className="mt-0.5 text-[11.5px] leading-snug text-muted">{c.delBody}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button type="button" onClick={() => edits.remove(g.id)} className={`${pillSolid} ${pillSm}`}>
            <Trash2 size={12} />
            {c.del}
          </button>
          <button type="button" onClick={() => setConfirm(false)} className={`${pillPlain} ${pillSm}`}>
            {c.cancel}
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className="rounded-xl px-1 py-1">
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          aria-label={`${c.color}: ${g.name}`}
          aria-expanded={colorOpen}
          onClick={() => setColorOpen((o) => !o)}
          className="h-5 w-5 shrink-0 rounded-full ring-1 ring-divider transition hover:scale-110"
          style={{ background: g.color }}
        />
        <input
          value={name}
          maxLength={MAX_NAME}
          aria-label={`${c.rename}: ${g.name}`}
          onChange={(e) => setName(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') {
              setName(g.name);
              e.stopPropagation();
            }
          }}
          className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-1.5 py-1 text-[12.5px] font-semibold text-ink outline-none transition hover:border-divider focus:border-divider focus:bg-page"
        />
        <button
          type="button"
          aria-label={`${c.del}: ${g.name}`}
          onClick={() => setConfirm(true)}
          className="shrink-0 rounded-full p-1.5 text-muted transition hover:bg-ink/[0.05] hover:text-ink"
        >
          <Trash2 size={14} />
        </button>
      </div>
      {colorOpen && (
        <div className="mt-1.5 pl-7">
          <Swatches
            value={g.color}
            label={c.color}
            onPick={(col) => {
              if (col !== g.color) edits.recolor(g.id, col);
              setColorOpen(false);
            }}
          />
        </div>
      )}
    </li>
  );
}

export default function GroupEditor({ edits, onClose }: { edits: GroupEdits; onClose: () => void }) {
  const c = useCopy(COPY);
  const used = new Set(edits.groups.map((g) => g.color.toLowerCase()));
  const firstFree = GROUP_PALETTE.find((col) => !used.has(col.toLowerCase())) ?? GROUP_PALETTE[0];
  const [name, setName] = useState('');
  const [color, setColor] = useState<string>(firstFree);
  const full = edits.groups.length >= LIMITS.groups;

  const create = () => {
    const v = name.trim();
    if (!v || full) return;
    edits.create(v, color);
    setName('');
    // Next free hue for the next one.
    const nowUsed = new Set([...used, color.toLowerCase()]);
    setColor(GROUP_PALETTE.find((col) => !nowUsed.has(col.toLowerCase())) ?? GROUP_PALETTE[0]);
  };

  return (
    <section aria-label={c.title} className="mt-2 rounded-xl border border-divider bg-surface px-3.5 py-3">
      <div className="flex items-center gap-2">
        <SectionLabel className="flex-1">{c.title}</SectionLabel>
        <button type="button" aria-label={c.done} onClick={onClose} className="rounded-full p-1 text-muted hover:text-ink">
          <X size={15} />
        </button>
      </div>
      <ul className="mt-1.5 grid gap-x-4 gap-y-0.5 sm:grid-cols-2 lg:grid-cols-3">
        {edits.groups.map((g) => (
          <GroupRow key={g.id} g={g} edits={edits} c={c} />
        ))}
      </ul>

      <div className="mt-3 border-t border-divider/70 pt-3">
        <SectionLabel>{c.newGroup}</SectionLabel>
        <form
          className="mt-1.5 flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
        >
          <span className="h-5 w-5 shrink-0 rounded-full" style={{ background: color }} />
          <input
            value={name}
            maxLength={MAX_NAME}
            placeholder={c.namePh}
            aria-label={c.namePh}
            disabled={full}
            onChange={(e) => setName(e.target.value)}
            className="min-w-0 flex-1 basis-40 rounded-full border border-divider bg-page px-3 py-1.5 text-[12.5px] text-ink outline-none placeholder:text-muted/70 focus:border-ink/40"
          />
          <button type="submit" disabled={full || !name.trim()} className={`${pillSolid} ${pillSm}`}>
            <Plus size={12} />
            {c.create}
          </button>
        </form>
        <div className="mt-2">
          <Swatches value={color} onPick={setColor} label={c.color} />
        </div>
        <p className="mt-2 text-[11px] leading-snug text-muted">{full ? c.full : c.hint}</p>
      </div>
    </section>
  );
}
