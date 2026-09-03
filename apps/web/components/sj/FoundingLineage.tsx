'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import Avatar from './Avatar';
import FoundingBadge from './FoundingBadge';
import type { Invitee, FoundingMember } from '../../lib/sj/founding';

/**
 * Lineage on a profile — who invited this person, and who they've invited.
 * Deliberately not a tree/graph visual: at any real scale a graph gets
 * unreadable fast, and most of the information a viewer actually wants
 * ("who vouched for them," "roughly how many people have they brought in")
 * is served just as well by two plain lines + an expandable list. Default
 * direction here is 'chip' — swap once a badge direction is picked.
 *
 * Status by association was a deliberate non-goal (see design notes): the
 * inviter's own badge/number never renders larger or more prominent just
 * because they're shown as an inviter — same small chip either way.
 */
export default function FoundingLineage({
  member,
  inviter,
  invitees,
  totalInvitees,
  onLoadMore,
  isSelf = false,
  onToggleTeamTag,
}: {
  member: FoundingMember;
  inviter: { username: string | null; display_name: string | null; avatar_url: string | null } | null;
  invitees: Invitee[];
  totalInvitees: number;
  onLoadMore?: () => void;
  /** Only the team-issued member themself can toggle their own tag. */
  isSelf?: boolean;
  onToggleTeamTag?: (visible: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasMore = totalInvitees > invitees.length;

  return (
    <div className="rounded-2xl border border-divider bg-surface px-5 py-4">
      {/* Who invited them */}
      <div className="flex items-center gap-2.5 mb-3.5 pb-3.5 border-b border-divider">
        {member.invite_source === 'team' ? (
          member.show_team_tag ? (
            <>
              <span className="w-7 h-7 rounded-full bg-ink/[0.06] flex items-center justify-center shrink-0">
                <span className="text-[13px]">✦</span>
              </span>
              <p className="text-[13.5px] text-ink/80 flex-1">
                <span className="font-semibold">Invited by sillajuku</span> — founding-cohort outreach
              </p>
              {isSelf && onToggleTeamTag && (
                <button
                  onClick={() => onToggleTeamTag(false)}
                  className="text-[11.5px] text-muted hover:text-ink transition-colors shrink-0"
                >
                  Hide
                </button>
              )}
            </>
          ) : (
            <>
              <p className="text-[13.5px] text-muted flex-1">Founding member</p>
              {isSelf && onToggleTeamTag && (
                <button
                  onClick={() => onToggleTeamTag(true)}
                  className="text-[11.5px] text-muted hover:text-ink transition-colors shrink-0"
                >
                  Show "invited by sillajuku"
                </button>
              )}
            </>
          )
        ) : inviter ? (
          <Link href={`/profile/${inviter.username ?? ''}`} className="flex items-center gap-2.5 group">
            <Avatar url={inviter.avatar_url} size={28} />
            <p className="text-[13.5px] text-ink/80">
              Invited by{' '}
              <span className="font-semibold group-hover:underline">
                {inviter.display_name || `@${inviter.username}`}
              </span>
            </p>
          </Link>
        ) : (
          <p className="text-[13.5px] text-muted">Inviter no longer available</p>
        )}
      </div>

      {/* Who they've invited */}
      <div>
        <p className="text-[13px] text-muted mb-2.5">
          {totalInvitees === 0
            ? "Hasn't invited anyone yet"
            : totalInvitees === 1
              ? 'Invited 1 person'
              : `Invited ${totalInvitees} people`}
        </p>

        {invitees.length > 0 && (
          <div className="flex flex-col gap-2">
            {invitees.map((inv) => (
              <Link
                key={inv.profile_id}
                href={`/profile/${inv.username ?? ''}`}
                className="flex items-center gap-2.5 group"
              >
                <Avatar url={inv.avatar_url} size={26} />
                <span className="text-[13px] text-ink/80 group-hover:text-ink">
                  {inv.display_name || `@${inv.username}`}
                </span>
                {inv.status && inv.number != null && (
                  <FoundingBadge direction="chip" status={inv.status} number={inv.number} size={16} />
                )}
              </Link>
            ))}
          </div>
        )}

        {hasMore && (
          <button
            onClick={() => {
              setExpanded(true);
              onLoadMore?.();
            }}
            className="mt-2.5 flex items-center gap-1 text-[12.5px] font-semibold text-muted hover:text-ink transition-colors"
          >
            {expanded ? 'Show more' : `Show all ${totalInvitees}`}
            <ChevronDown size={13} />
          </button>
        )}
      </div>
    </div>
  );
}
