export interface LeaderboardEntry {
  rank: number;
  releaseId: string;
  title: string;
  artist: string;
  coverUrl: string | null;
  sillaScore: number;   // normalized 0–100
  avgRating: number | null;
}

import Link from 'next/link';

export default function RankingVoteWidget({
  leaderboard,
}: {
  categoryId: string;
  leaderboard: LeaderboardEntry[];
  totalRankers: number;
}) {
  if (leaderboard.length === 0) {
    return (
      <div className="py-16 text-center">
        <p className="text-[14px] text-muted">No rankings yet. Be the one to start it.</p>
      </div>
    );
  }

  return (
    <div>
      {/* Column headers */}
      <div className="flex items-center gap-4 px-4 pb-2 mb-1 border-b border-divider">
        <div className="w-[28px] flex-shrink-0" />
        <div className="w-[48px] flex-shrink-0" />
        <div className="flex-1 min-w-0" />
        <div className="w-[120px] flex-shrink-0 text-right text-[10px] font-semibold text-muted uppercase tracking-wider">
          Silla Score
        </div>
        <div className="w-[56px] flex-shrink-0 text-right text-[10px] font-semibold text-muted uppercase tracking-wider">
          Avg Rating
        </div>
      </div>

      <div className="flex flex-col gap-[2px]">
        {leaderboard.map((entry) => (
          <Link
            key={entry.releaseId}
            href={`/album/${entry.releaseId}`}
            className="flex items-center gap-4 rounded-[10px] px-4 py-3 hover:bg-surface transition"
          >
            {/* Rank */}
            <div
              className="w-[28px] text-right flex-shrink-0 font-bold text-ink tabular-nums"
              style={{ fontSize: entry.rank <= 3 ? 18 : 14 }}
            >
              {String(entry.rank).padStart(2, '0')}
            </div>

            {/* Cover */}
            <div className="w-[48px] h-[48px] rounded-[6px] overflow-hidden flex-shrink-0 border border-divider bg-surface">
              {entry.coverUrl ? (
                <img src={entry.coverUrl} alt={entry.title} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full bg-surface" />
              )}
            </div>

            {/* Title + artist */}
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-bold text-ink truncate">{entry.title}</div>
              <div className="text-[11px] text-muted truncate">{entry.artist}</div>
            </div>

            {/* Silla Score — bar + value */}
            <div className="w-[120px] flex-shrink-0 flex items-center gap-2">
              <div className="flex-1 h-[4px] bg-[#EBEBEB] rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full bg-[#E8A020]"
                  style={{ width: `${entry.sillaScore}%` }}
                />
              </div>
              <span className="text-[12px] font-semibold text-[#E8A020] tabular-nums w-[36px] text-right">
                {entry.sillaScore.toFixed(1)}
              </span>
            </div>

            {/* Avg Rating */}
            <div className="w-[56px] flex-shrink-0 text-right">
              {entry.avgRating != null ? (
                <span className="text-[13px] font-semibold text-ink tabular-nums">
                  {entry.avgRating.toFixed(2)}
                </span>
              ) : (
                <span className="text-[12px] text-muted">—</span>
              )}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
