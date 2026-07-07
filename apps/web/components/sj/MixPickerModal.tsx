'use client';

import { useEffect, useState } from 'react';
import { Clock, ListMusic, CheckCircle2 } from 'lucide-react';
import Modal from './Modal';
import { supabase } from '../../lib/supabaseClient';
import { useLanguage } from '../../lib/i18n';
import type { MixRow } from '../../lib/db/types';

/**
 * "Save to Mix" picker — mirrors iOS MixPickerView: multi-select of the
 * user's mixes, pre-selected where the release already belongs; saving
 * upserts selected and removes deselected.
 */
export default function MixPickerModal({
  open,
  onClose,
  releaseGroupId,
}: {
  open: boolean;
  onClose: () => void;
  releaseGroupId: string;
}) {
  const { t } = useLanguage();
  const [mixes, setMixes] = useState<MixRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !supabase) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: userData } = await supabase!.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) {
        setLoading(false);
        return;
      }
      const { data: mixRows } = await supabase!
        .from('mixes')
        .select('*')
        .eq('user_id', uid)
        .order('is_default', { ascending: false })
        .order('created_at', { ascending: true });
      const loaded = (mixRows as MixRow[] | null) ?? [];
      if (cancelled) return;
      setMixes(loaded);
      if (loaded.length) {
        const { data: existing } = await supabase!
          .from('mix_items')
          .select('mix_id')
          .eq('release_group_id', releaseGroupId)
          .in('mix_id', loaded.map((m) => m.id));
        if (!cancelled) {
          setSelected(new Set(((existing as { mix_id: string }[] | null) ?? []).map((r) => r.mix_id)));
        }
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, releaseGroupId]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save() {
    if (!supabase) return;
    setSaving(true);
    for (const mixId of Array.from(selected)) {
      await supabase
        .from('mix_items')
        .upsert(
          { mix_id: mixId, release_group_id: releaseGroupId },
          { onConflict: 'mix_id,release_group_id' },
        );
    }
    for (const mix of mixes) {
      if (!selected.has(mix.id)) {
        await supabase
          .from('mix_items')
          .delete()
          .eq('mix_id', mix.id)
          .eq('release_group_id', releaseGroupId);
      }
    }
    setSaving(false);
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title={t('sj.mix.saveToMix')}>
      <div className="p-2">
        {loading ? (
          <p className="py-10 text-center text-[13px] text-muted">…</p>
        ) : mixes.length === 0 ? (
          <p className="py-10 text-center text-[13px] text-muted">{t('sj.mix.none')}</p>
        ) : (
          <ul>
            {mixes.map((mix) => (
              <li key={mix.id}>
                <button
                  onClick={() => toggle(mix.id)}
                  className="w-full flex items-center gap-3.5 px-3 py-3 rounded-xl hover:bg-surface transition text-left"
                >
                  {mix.is_default ? (
                    <Clock size={17} className="text-accent shrink-0" />
                  ) : (
                    <ListMusic size={17} className="text-accent shrink-0" />
                  )}
                  <span className="flex-1 text-[14.5px] text-ink">{mix.name}</span>
                  {selected.has(mix.id) && (
                    <CheckCircle2 size={19} className="text-accent shrink-0" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-end gap-2 p-3 pt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-[10px] text-[13.5px] font-medium text-muted hover:text-ink transition"
          >
            {t('sj.common.cancel')}
          </button>
          <button
            onClick={save}
            disabled={saving || loading}
            className="px-4 py-2 rounded-[10px] bg-accent text-white text-[13.5px] font-semibold hover:opacity-90 disabled:opacity-50 transition"
          >
            {t('sj.common.save')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
