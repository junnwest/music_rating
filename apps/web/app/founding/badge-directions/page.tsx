'use client';

import FoundingBadge, { type BadgeDirection } from '../../../components/sj/FoundingBadge';
import Avatar from '../../../components/sj/Avatar';

/**
 * Review harness — NOT a real route, just a side-by-side comparison of the
 * three FoundingBadge directions in both states, in and out of context.
 * Delete once a direction is picked (same pattern as the old /about
 * switcher).
 */
const DIRECTIONS: { key: BadgeDirection; label: string; thesis: string }[] = [
  { key: 'chip', label: 'A · Numeral chip', thesis: 'Plain, text-forward — closest to a verified-style mark.' },
  { key: 'ring', label: 'B · Ring badge', thesis: 'Reuses ScoreBadge\'s existing ring language for a new signal.' },
  { key: 'flower', label: 'C · Flower mark', thesis: 'Ties the badge into the core brand motif directly.' },
];

export default function BadgeDirectionsPage() {
  return (
    <div className="min-h-screen bg-page px-6 py-16">
      <div className="max-w-[760px] mx-auto">
        <h1 className="text-[28px] font-extrabold tracking-tight text-ink mb-2">Founding badge — 3 directions</h1>
        <p className="text-[14px] text-muted mb-12">
          Pending = muted / dashed / incomplete. Locked-in = solid / confident. Same grammar, three shapes.
        </p>

        {DIRECTIONS.map((d) => (
          <section key={d.key} className="mb-14">
            <p className="text-[13px] font-semibold text-muted mb-1">{d.label}</p>
            <p className="text-[13px] text-ink/70 mb-6">{d.thesis}</p>

            <div className="grid grid-cols-2 gap-6">
              <div className="rounded-2xl border border-divider bg-surface p-6">
                <p className="text-[11px] font-semibold text-muted mb-4 uppercase tracking-wide">Pending</p>
                <div className="flex items-center gap-3 mb-6">
                  <Avatar url={null} size={44} />
                  <div className="flex items-center gap-2">
                    <span className="text-[15px] font-semibold text-ink">@mina.k</span>
                    <FoundingBadge direction={d.key} status="pending" number={247} size={20} />
                  </div>
                </div>
                <div className="flex justify-center py-4">
                  <FoundingBadge direction={d.key} status="pending" number={247} size={56} />
                </div>
              </div>

              <div className="rounded-2xl border border-divider bg-surface p-6">
                <p className="text-[11px] font-semibold text-muted mb-4 uppercase tracking-wide">Locked in</p>
                <div className="flex items-center gap-3 mb-6">
                  <Avatar url={null} size={44} />
                  <div className="flex items-center gap-2">
                    <span className="text-[15px] font-semibold text-ink">@mina.k</span>
                    <FoundingBadge direction={d.key} status="locked_in" number={247} size={20} />
                  </div>
                </div>
                <div className="flex justify-center py-4">
                  <FoundingBadge direction={d.key} status="locked_in" number={247} size={56} />
                </div>
              </div>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
