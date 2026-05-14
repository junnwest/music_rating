import PersonalizedFeed from '../../components/PersonalizedFeed';
import RecommendationGrid from '../../components/RecommendationGrid';
import { HomeReadyProvider } from '../../components/HomeReadyContext';
import RevealWhenReady from '../../components/RevealWhenReady';

export default function HomePage() {
  return (
    <HomeReadyProvider>
      <div className="bg-white text-ink">
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
