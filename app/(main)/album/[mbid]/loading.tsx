export default function AlbumLoading() {
  return (
    <div className="bg-page min-h-screen animate-pulse">
      {/* Hero */}
      <div className="relative bg-surface/60">
        <div className="max-w-[1440px] mx-auto px-5 py-8 sm:py-11 pb-10 flex flex-col sm:flex-row gap-6 sm:gap-11">
          {/* Cover */}
          <div className="flex-shrink-0 flex sm:block justify-center">
            <div className="w-[160px] h-[160px] sm:w-[228px] sm:h-[228px] rounded-[10px] bg-muted/30" />
          </div>

          {/* Info */}
          <div className="flex-1 pt-0 sm:pt-1">
            <div className="flex gap-2 mb-4">
              <div className="h-5 w-14 bg-muted/30 rounded-full" />
              <div className="h-5 w-10 bg-muted/30 rounded-full" />
            </div>
            <div className="h-9 w-64 bg-muted/30 rounded mb-2" />
            <div className="h-5 w-40 bg-muted/30 rounded mb-6" />
            <div className="flex gap-3 mb-6">
              <div className="h-8 w-28 bg-muted/30 rounded-lg" />
              <div className="h-8 w-28 bg-muted/30 rounded-lg" />
            </div>
            <div className="flex gap-6">
              <div className="h-4 w-20 bg-muted/30 rounded" />
              <div className="h-4 w-20 bg-muted/30 rounded" />
            </div>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="max-w-[1440px] mx-auto px-5 py-10 grid gap-[52px] grid-cols-1 md:grid-cols-[1fr_1.3fr]">
        {/* Tracklist */}
        <div>
          <div className="h-5 w-24 bg-muted/20 rounded mb-5" />
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 py-2.5 border-b border-divider">
              <div className="h-3 w-4 bg-muted/20 rounded" />
              <div className="h-3 flex-1 bg-muted/20 rounded" />
              <div className="h-3 w-8 bg-muted/20 rounded" />
            </div>
          ))}
        </div>

        {/* Reviews */}
        <div>
          <div className="h-5 w-20 bg-muted/20 rounded mb-5" />
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="border border-divider rounded-xl p-4 mb-3">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-7 h-7 rounded-full bg-muted/20" />
                <div className="h-3 w-24 bg-muted/20 rounded" />
              </div>
              <div className="h-3 w-full bg-muted/20 rounded mb-1.5" />
              <div className="h-3 w-4/5 bg-muted/20 rounded" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
