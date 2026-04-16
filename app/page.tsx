import RecommendationGrid from '../components/RecommendationGrid';

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-screen-xl items-center justify-center bg-slate-50 text-slate-950 py-10 px-4">
      <div className="w-full max-w-7xl">
        <RecommendationGrid />
      </div>
    </main>
  );
}
