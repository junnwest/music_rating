'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ExportGroup, GroupsAdoptBody } from '../../../lib/tasteMap/apiTypes';
import { adoptGroups, createGroup, deleteGroup, patchGroup, putGroupMembers } from '../../../lib/tasteMap/client';
import type { NodeKey, TasteMapGroup, TasteMapPayloadNode } from '../../../lib/tasteMap/types';

/**
 * Group CRUD + soft membership for the Taste Map shell (TASTE_MAP_PLAN.md D7,
 * Phase 4), optimistic: every edit applies to the local state at once and, with
 * `api` on, a server call is queued behind it.
 *
 * - Memberships live on the shell's working nodes (`n.groups`, replaced per
 *   edit, never mutated) so the scenes keep reading one source; `onChange`
 *   asks the shell to re-render them.
 * - Seeded groups ('w:<world>' ids) aren't stored. Before the FIRST edit of any
 *   kind, POST /groups/adopt is queued with the seeds and their memberships as
 *   they are right before that edit; its idMap renames every local id.
 *   A new group gets a 'tmp:n' id until its POST returns. Queued calls resolve
 *   ids when they run, so an edit made before an id arrived still lands.
 * - Calls run one at a time, in order. A failed call leaves the local state as
 *   the user made it and shows "Not saved"; a failed adopt is retried on the
 *   next edit (with that moment's state).
 * - The sum of a node's weights across groups is capped at 1 by clamping the
 *   edited slider (never by moving the others), so a single PUT can't overflow
 *   the route's ≤ 1 check.
 * - Members PUT replaces the group's whole member list. The payload doesn't say
 *   which memberships were set by hand, so a key edited in this session is
 *   sent `manual: true` and every other member `manual: false`.
 *
 * With `api` off (fixture / mock) everything stays in memory.
 */

export type GroupSync = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved' } | { kind: 'error'; reason: string };

export const isSeedId = (id: string) => id.startsWith('w:');

/** Membership edits wait this long after the last slider move before the PUT. */
const MEMBERS_DEBOUNCE_MS = 600;
const round4 = (x: number) => Math.round(x * 1e4) / 1e4;

/** The adopt body: every seed group with its current members (weight > 0). */
export function buildAdoptBody(groups: readonly TasteMapGroup[], nodes: readonly TasteMapPayloadNode[]): GroupsAdoptBody {
  return {
    groups: groups.map(
      (g): ExportGroup => ({
        id: g.id,
        name: g.name,
        color: g.color,
        seedWorld: g.seedWorld,
        members: nodes
          .filter((n) => (n.groups[g.id] ?? 0) > 0)
          .map((n) => ({ key: n.key, weight: n.groups[g.id], manual: false })),
      }),
    ),
  };
}

/** The most `key` may get in `groupId` while its other groups stay as they are. */
export function maxWeightFor(node: TasteMapPayloadNode, groupId: string): number {
  let others = 0;
  for (const [g, w] of Object.entries(node.groups)) if (g !== groupId) others += w;
  return Math.max(0, Math.floor((1 - others) * 1e4 + 1e-6) / 1e4);
}

export interface GroupEdits {
  groups: TasteMapGroup[];
  /** Bumped on every membership change (the nodes' `groups` records were replaced). */
  version: number;
  sync: GroupSync;
  create: (name: string, color: string) => void;
  rename: (id: string, name: string) => void;
  recolor: (id: string, color: string) => void;
  remove: (id: string) => void;
  /** Sets `key`'s weight in `groupId`, clamped so its weights sum to ≤ 1. Returns the weight applied. */
  setWeight: (key: NodeKey, groupId: string, weight: number) => number;
}

export function useGroupEdits({
  initial,
  nodes,
  api,
  onChange,
  onRemap,
}: {
  initial: TasteMapGroup[];
  /** The shell's working nodes; their `groups` records are replaced in place on edit. */
  nodes: TasteMapPayloadNode[];
  api: boolean;
  onChange: () => void;
  /** Local ids were renamed (adopt / create landed): old id → new id. */
  onRemap: (map: Record<string, string>) => void;
}): GroupEdits {
  const [groups, setGroupsState] = useState<TasteMapGroup[]>(initial);
  const groupsRef = useRef(groups);
  const setGroups = useCallback((fn: (prev: TasteMapGroup[]) => TasteMapGroup[]) => {
    groupsRef.current = fn(groupsRef.current);
    setGroupsState(groupsRef.current);
  }, []);
  const [version, setVersion] = useState(0);
  const [sync, setSync] = useState<GroupSync>({ kind: 'idle' });

  const byKey = useRef(new Map<NodeKey, TasteMapPayloadNode>());
  byKey.current = new Map(nodes.map((n) => [n.key, n]));

  // Server sync bookkeeping.
  const idMap = useRef<Record<string, string>>({});
  const resolve = (id: string) => {
    let cur = id;
    for (let i = 0; i < 4 && idMap.current[cur]; i++) cur = idMap.current[cur];
    return cur;
  };
  const chain = useRef<Promise<void>>(Promise.resolve());
  const pending = useRef(0);
  const lastError = useRef<string | null>(null);
  const adopt = useRef<'none' | 'queued' | 'done'>('none');
  const manualKeys = useRef(new Set<string>());
  const memberTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const tmpSeq = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const timers = memberTimers.current;
    return () => {
      mounted.current = false;
      for (const t of timers.values()) clearTimeout(t);
    };
  }, []);

  const changed = useCallback(() => {
    setVersion((v) => v + 1);
    onChange();
  }, [onChange]);

  /** Renames local ids everywhere (groups list, node records), then tells the shell. */
  const remapLocal = useCallback(
    (map: Record<string, string>) => {
      if (!Object.keys(map).length) return;
      setGroups((prev) => prev.map((g) => (map[g.id] ? { ...g, id: map[g.id] } : g)));
      for (const n of byKey.current.values()) {
        if (!Object.keys(n.groups).some((id) => map[id])) continue;
        n.groups = Object.fromEntries(Object.entries(n.groups).map(([id, w]) => [map[id] ?? id, w]));
      }
      onRemap(map);
      changed();
    },
    [setGroups, onRemap, changed],
  );

  /** Queue a server call; ids are resolved when it runs. */
  const enqueue = useCallback((run: () => Promise<void>) => {
    pending.current += 1;
    if (mounted.current) setSync({ kind: 'saving' });
    chain.current = chain.current
      .then(run)
      .catch((e: Error) => {
        lastError.current = e.message || 'error';
      })
      .finally(() => {
        pending.current -= 1;
        if (!mounted.current || pending.current > 0) return;
        const err = lastError.current;
        lastError.current = null;
        setSync(err ? { kind: 'error', reason: err } : { kind: 'saved' });
      });
  }, []);

  /** Before the first edit: queue the adopt with the seeds as they are now. */
  const ensureAdopted = useCallback(() => {
    if (!api || adopt.current !== 'none') return;
    const seeds = groupsRef.current.filter((g) => isSeedId(g.id));
    if (!seeds.length) {
      adopt.current = 'done';
      return;
    }
    adopt.current = 'queued';
    const body = buildAdoptBody(seeds, [...byKey.current.values()]);
    enqueue(async () => {
      try {
        const res = await adoptGroups(body);
        Object.assign(idMap.current, res.idMap);
        adopt.current = 'done';
        remapLocal(res.idMap);
      } catch (e) {
        adopt.current = 'none';
        throw e;
      }
    });
  }, [api, enqueue, remapLocal]);

  /** Seed ids that never got adopted can't be written; skip the call and keep the error visible. */
  const writable = (id: string) => {
    const real = resolve(id);
    if (isSeedId(real) || real.startsWith('tmp:')) throw new Error('groups not adopted yet; edit again to retry');
    return real;
  };

  const create = useCallback(
    (name: string, color: string) => {
      ensureAdopted();
      const local = api ? `tmp:${++tmpSeq.current}` : `local:${Date.now().toString(36)}${++tmpSeq.current}`;
      setGroups((prev) => [...prev, { id: local, name, color, seedWorld: null }]);
      changed();
      if (!api) return;
      enqueue(async () => {
        const { group } = await createGroup({ name, color });
        idMap.current[local] = group.id;
        remapLocal({ [local]: group.id });
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api, ensureAdopted, setGroups, changed, enqueue, remapLocal],
  );

  const patch = useCallback(
    (id: string, body: { name?: string; color?: string }) => {
      ensureAdopted();
      setGroups((prev) => prev.map((g) => (g.id === id ? { ...g, ...body } : g)));
      changed();
      if (!api) return;
      enqueue(async () => {
        await patchGroup(writable(id), body);
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api, ensureAdopted, setGroups, changed, enqueue],
  );

  const rename = useCallback((id: string, name: string) => patch(id, { name }), [patch]);
  const recolor = useCallback((id: string, color: string) => patch(id, { color }), [patch]);

  const remove = useCallback(
    (id: string) => {
      ensureAdopted();
      setGroups((prev) => prev.filter((g) => g.id !== id));
      for (const n of byKey.current.values()) {
        if (!(id in n.groups)) continue;
        const next = { ...n.groups };
        delete next[id];
        n.groups = next;
      }
      const t = memberTimers.current.get(id);
      if (t) clearTimeout(t);
      memberTimers.current.delete(id);
      changed();
      if (!api) return;
      enqueue(async () => {
        await deleteGroup(writable(id));
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api, ensureAdopted, setGroups, changed, enqueue],
  );

  /** Edited by hand this session, under the group's current id or any id it had before adopt/create renamed it. */
  const isManual = (real: string, key: NodeKey) => {
    if (manualKeys.current.has(`${real}|${key}`)) return true;
    for (const old of Object.keys(idMap.current)) if (resolve(old) === real && manualKeys.current.has(`${old}|${key}`)) return true;
    return false;
  };

  /** PUT a group's whole member list as it is when the call runs. */
  const flushMembers = useCallback(
    (id: string) => {
      memberTimers.current.delete(id);
      enqueue(async () => {
        const real = writable(id);
        if (!groupsRef.current.some((g) => g.id === real)) return; // deleted meanwhile
        const members = [...byKey.current.values()]
          .filter((n) => (n.groups[real] ?? 0) > 0)
          .map((n) => ({ key: n.key, weight: round4(n.groups[real]), manual: isManual(real, n.key) }));
        await putGroupMembers(real, { members });
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enqueue],
  );

  const setWeight = useCallback(
    (key: NodeKey, groupId: string, weight: number) => {
      const n = byKey.current.get(key);
      if (!n) return 0;
      ensureAdopted();
      const w = round4(Math.max(0, Math.min(weight, maxWeightFor(n, groupId))));
      const next = { ...n.groups };
      if (w > 0) next[groupId] = w;
      else delete next[groupId];
      n.groups = next;
      changed();
      if (!api) return w;
      manualKeys.current.add(`${groupId}|${key}`);
      const t = memberTimers.current.get(groupId);
      if (t) clearTimeout(t);
      if (mounted.current) setSync({ kind: 'saving' });
      memberTimers.current.set(
        groupId,
        setTimeout(() => flushMembers(groupId), MEMBERS_DEBOUNCE_MS),
      );
      return w;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api, ensureAdopted, changed, flushMembers],
  );

  return { groups, version, sync, create, rename, recolor, remove, setWeight };
}
