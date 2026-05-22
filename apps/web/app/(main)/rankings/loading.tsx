export default function RankingsLoading() {
  return (
    <div className="bg-page min-h-screen animate-pulse">
      {/* Hero */}
      <div className="bg-surface border-b border-divider">
        <div className="max-w-[1440px] mx-auto px-5 py-12">
          <div className="h-3 w-20 bg-muted/20 rounded mb-4" />
          <div className="h-10 w-48 bg-muted/20 rounded mb-3" />
          <div className="h-4 w-80 bg-muted/20 rounded" />
        </div>
      </div>

      {/* Grid */}
      <div className="max-w-[1440px] mx-auto px-5 py-10">
        <div className="h-3 w-36 bg-muted/20 rounded mb-5" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="border border-divider rounded-[12px] p-5">
              <div className="flex gap-[5px] mb-5">
                {Array.from({ length: 5 }).map((_, j) => (
                  <div key={j} className="w-[46px] h-[46px] rounded-[5px] bg-muted/20 flex-shrink-0" />
                ))}
              </div>
              <div className="h-5 w-3/4 bg-muted/20 rounded mb-2" />
              <div className="h-5 w-1/2 bg-muted/20 rounded mt-auto" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
