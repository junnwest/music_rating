import ScrollRow from './ScrollRow';
import { getSpotifyRecommendations } from '../lib/spotify';

const categories = [
  {
    name: 'K-Pop Sensations',
    description: 'Popular K-Pop albums you might enjoy',
    query: 'k-pop',
  },
  {
    name: 'Korean Indie & Ballad',
    description: 'Thoughtful indie and ballad albums',
    query: 'korean indie',
  },
];

export default async function RecommendationGrid() {
  const categoriesWithAlbums = await Promise.all(
    categories.map(async (cat) => {
      const albums = await getSpotifyRecommendations(cat.query, 10);
      return { ...cat, albums };
    })
  );

  return (
    <section className="w-full px-[11.25rem] py-8 space-y-10">
      {categoriesWithAlbums.map((cat) => (
        <div key={cat.name}>
          <div className="mb-4">
            <h2 className="text-xl font-bold text-slate-900">{cat.name}</h2>
            <p className="text-sm text-slate-600">{cat.description}</p>
          </div>
          <ScrollRow albums={cat.albums} />
        </div>
      ))}
    </section>
  );
}
