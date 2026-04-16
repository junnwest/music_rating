import AlbumSearchForm from '../../components/AlbumSearchForm';

export default function SearchPage() {
  return (
    <main className="min-h-screen bg-slate-950 px-6 py-12 text-slate-100">
      <div className="mx-auto max-w-4xl space-y-8">
        <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-10 shadow-2xl shadow-slate-950/40">
          <h1 className="text-3xl font-semibold tracking-tight text-white">Search albums</h1>
          <p className="mt-3 text-slate-300">
            Search MusicBrainz for releases and start rating your favorite Korean albums, singles, EPs, live records, and compilations.
          </p>
        </div>

        <AlbumSearchForm />
      </div>
    </main>
  );
}
