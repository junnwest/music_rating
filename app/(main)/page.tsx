import PersonalizedFeed from '../../components/PersonalizedFeed';
import RecommendationGrid from '../../components/RecommendationGrid';

export default function HomePage() {
  return (
    <div className="bg-white text-ink">
      <div className="max-w-[1440px] mx-auto px-5 py-11">
        <PersonalizedFeed />
      </div>
      <RecommendationGrid />
    </div>
  );
}
