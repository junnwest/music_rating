'use client';

import { useState } from 'react';
import { Globe } from 'lucide-react';
import Modal from './Modal';
import MixMosaic from './MixMosaic';
import { useSession } from './SessionContext';
import { useMixName, useMixTarget } from './MixTargetContext';
import { supabase } from '../../lib/supabaseClient';
import { useLanguage } from '../../lib/i18n';
import { MIX_SHARE_CAPTION_MAX, postMix } from '../../lib/sj/mixShares';

/**
 * P4 — "Post" a mix to the feed (mirror of iOS MixShareComposerView). Anyone
 * can post a public mix; only public mixes can be posted (RLS), so the owner
 * of a private one gets "Make public & post" instead of a dead button.
 */
export default function MixPostComposer({
  open,
  onClose,
  mix,
  covers,
  itemCount,
  isOwner,
  onPosted,
  onMadePublic,
}: {
  open: boolean;
  onClose: () => void;
  mix: { id: string; name: string; is_default: boolean; is_public: boolean; description?: string | null };
  covers: string[];
  itemCount: number;
  isOwner: boolean;
  onPosted: () => void;
  onMadePublic: () => void;
}) {
  const { t } = useLanguage();
  const mixName = useMixName();
  const { userId, requireAuth } = useSession();
  const { refresh } = useMixTarget();
  const [caption, setCaption] = useState('');
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsPublic = !mix.is_public;

  async function submit() {
    if (!requireAuth() || !userId || !supabase || posting) return;
    setPosting(true);
    setError(null);
    if (needsPublic) {
      if (!isOwner) {
        setPosting(false);
        return;
      }
      const { error: pubErr } = await supabase.from('mixes').update({ is_public: true }).eq('id', mix.id);
      if (pubErr) {
        setError(t('sj.mixPost.failed'));
        setPosting(false);
        return;
      }
      onMadePublic();
      void refresh();
    }
    const { error: postErr } = await postMix(userId, mix.id, caption);
    setPosting(false);
    if (postErr) {
      console.error('[mix post] failed:', postErr.message);
      setError(t('sj.mixPost.failed'));
      return;
    }
    setCaption('');
    onPosted();
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title={t('sj.mixPost.composerTitle')}>
      <div className="px-5 pb-5 pt-1 flex flex-col gap-3.5">
        {/* Preview — what followers will see */}
        <div className="flex items-center gap-3 p-2.5 rounded-xl bg-page border border-divider/60">
          <MixMosaic covers={covers} isDefault={mix.is_default} className="w-14 h-14" rounded="rounded-lg" />
          <div className="min-w-0">
            <p className="text-[15px] font-bold text-ink truncate">{mixName(mix)}</p>
            <p className="text-[12px] text-muted">
              {itemCount === 1 ? t('sj.mix.oneItem') : t('sj.mix.nItems').replace('{n}', String(itemCount))}
            </p>
            {mix.description && (
              <p className="text-[12px] text-muted line-clamp-1">{mix.description}</p>
            )}
          </div>
        </div>

        <div>
          <textarea
            autoFocus
            value={caption}
            onChange={(e) => setCaption(e.target.value.slice(0, MIX_SHARE_CAPTION_MAX))}
            placeholder={t('sj.mixPost.captionPlaceholder')}
            rows={3}
            className="w-full px-3.5 py-2.5 rounded-xl bg-page border border-divider text-[14px] text-ink placeholder-placeholder outline-none focus:border-accent/60 resize-none transition"
          />
          <p
            className={`text-right text-[11px] tabular-nums ${
              caption.length >= MIX_SHARE_CAPTION_MAX ? 'text-red-500' : 'text-muted'
            }`}
          >
            {caption.length}/{MIX_SHARE_CAPTION_MAX}
          </p>
        </div>

        {needsPublic && (
          <p className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-accent/[0.07] border border-accent/20 text-[12.5px] text-ink">
            <Globe size={14} className="text-accent shrink-0 mt-0.5" />
            {t('sj.mixPost.needsPublic')}
          </p>
        )}

        {error && <p className="text-[12.5px] text-red-500">{error}</p>}

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-[10px] text-[13.5px] font-medium text-muted hover:text-ink transition"
          >
            {t('sj.common.cancel')}
          </button>
          <button
            onClick={submit}
            disabled={posting || (needsPublic && !isOwner)}
            className="px-4 py-2 rounded-[10px] bg-accent text-white text-[13.5px] font-semibold hover:opacity-90 disabled:opacity-50 transition"
          >
            {needsPublic ? t('sj.mixPost.makePublicAndPost') : t('sj.mixPost.post')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
