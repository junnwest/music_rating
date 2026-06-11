export const dynamic = 'force-dynamic';

import PersonalizedFeed from '../../components/PersonalizedFeed';
import RecommendationGrid from '../../components/RecommendationGrid';
import { HomeReadyProvider } from '../../components/HomeReadyContext';
import RevealWhenReady from '../../components/RevealWhenReady';
import DailyQuestion from '../../components/DailyQuestion';

export default function HomePage() {
  return (
    <HomeReadyProvider>
      <div className="bg-page text-ink">
        <div className="max-w-[1440px] mx-auto px-5 py-11">
          <DailyQuestion />
          <PersonalizedFeed />
        </div>
        <RevealWhenReady>
          <RecommendationGrid />
        </RevealWhenReady>
      </div>
    </HomeReadyProvider>
  );
}
