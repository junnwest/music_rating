import PersonalizedFeed from '../../components/PersonalizedFeed';
import RecommendationGrid from '../../components/RecommendationGrid';
import { HomeReadyProvider } from '../../components/HomeReadyContext';
import RevealWhenReady from '../../components/RevealWhenReady';

// Cache the rendered homepage for 1 hour. The recommendation grid + its
// underlying DB queries only run once per hour regardless of traffic.
export const revalidate = 3600;

export default function HomePage() {
  return (
    <HomeReadyProvider>
      <div className="bg-page text-ink">
        <div className="max-w-[1440px] mx-auto px-5 py-11">
          <PersonalizedFeed />
        </div>
        <RevealWhenReady>
          <RecommendationGrid />
        </RevealWhenReady>
      </div>
    </HomeReadyProvider>
  );
}
