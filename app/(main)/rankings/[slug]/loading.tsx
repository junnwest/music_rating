export default function RankingDetailLoading() {
  return (
    <div className="bg-page min-h-screen animate-pulse">
      {/* Hero */}
      <div className="bg-surface border-b border-divider">
        <div className="max-w-[1440px] mx-auto px-5 py-12">
          <div className="h-3 w-20 bg-muted/20 rounded mb-5" />
          <div className="flex gap-2 mb-3">
            <div className="h-5 w-16 bg-muted/20 rounded-full" />
          </div>
          <div className="h-10 w-72 bg-muted/20 rounded mb-5" />
          <div className="flex items-center gap-4">
            <div className="h-6 w-24 bg-muted/20 rounded" />
            <div className="h-8 w-36 bg-muted/20 rounded-lg" />
          </div>
        </div>
      </div>

      {/* Leaderboard rows */}
      <div className="mx-auto px-5 py-10" style={{ maxWidth: 820 }}>
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 py-4 border-b border-divider">
            <div className="w-7 h-4 bg-muted/20 rounded flex-shrink-0" />
            <div className="w-10 h-10 bg-muted/20 rounded-[4px] flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="h-4 w-40 bg-muted/20 rounded mb-1.5" />
              <div className="h-3 w-24 bg-muted/20 rounded" />
            </div>
            <div className="h-3 w-16 bg-muted/20 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
