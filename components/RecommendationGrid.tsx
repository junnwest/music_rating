import Link from 'next/link';

const categories = [
  {
    name: 'K-Pop Sensations',
    description: 'Popular K-Pop albums you might enjoy',
    albums: [
      {
        id: '3',
        title: 'Map of the Soul',
        artist: 'BTS',
        year: 2020,
        country: 'KR',
        rating: undefined,
        expectedRating: 8.2,
        cover: 'https://picsum.photos/seed/bts/360/360'
      },
      {
        id: '4',
        title: 'The Album',
        artist: 'BLACKPINK',
        year: 2020,
        country: 'KR',
        rating: 9,
        expectedRating: 8.1,
        cover: 'https://picsum.photos/seed/blackpink/360/360'
      },
      {
        id: '5',
        title: 'Neo Culture Technology',
        artist: 'NCT 127',
        year: 2018,
        country: 'KR',
        rating: undefined,
        expectedRating: 7.6,
        cover: 'https://picsum.photos/seed/nct/360/360'
      },
      {
        id: '9',
        title: 'WAVE',
        artist: 'ATEEZ',
        year: 2022,
        country: 'KR',
        rating: undefined,
        expectedRating: 7.7,
        cover: 'https://picsum.photos/seed/ateez/360/360'
      },
      {
        id: '10',
        title: 'Proof',
        artist: 'BTS',
        year: 2022,
        country: 'KR',
        rating: undefined,
        expectedRating: 8.3,
        cover: 'https://picsum.photos/seed/proof/360/360'
      },
      {
        id: '11',
        title: 'Born Pink',
        artist: 'BLACKPINK',
        year: 2022,
        country: 'KR',
        rating: undefined,
        expectedRating: 8.0,
        cover: 'https://picsum.photos/seed/bornpink/360/360'
      }
    ]
  },
  {
    name: 'Korean Indie & Ballad',
    description: 'Thoughtful indie and ballad albums',
    albums: [
      {
        id: '1',
        title: 'Pink Season',
        artist: 'IU',
        year: 2017,
        country: 'KR',
        rating: undefined,
        expectedRating: 7.8,
        cover: 'https://picsum.photos/seed/iu/360/360'
      },
      {
        id: '2',
        title: 'Melomance',
        artist: 'MeloMance',
        year: 2019,
        country: 'KR',
        rating: 8,
        expectedRating: 7.5,
        cover: 'https://picsum.photos/seed/melomance/360/360'
      },
      {
        id: '6',
        title: 'Love Poem',
        artist: 'IU',
        year: 2019,
        country: 'KR',
        rating: 7,
        expectedRating: 7.9,
        cover: 'https://picsum.photos/seed/lovepoem/360/360'
      },
      {
        id: '7',
        title: 'Goodbye Summer',
        artist: 'BOL4',
        year: 2018,
        country: 'KR',
        rating: undefined,
        expectedRating: 7.4,
        cover: 'https://picsum.photos/seed/bol4/360/360'
      },
      {
        id: '8',
        title: 'Seoul',
        artist: 'BTS',
        year: 2015,
        country: 'KR',
        rating: 8,
        expectedRating: 8.0,
        cover: 'https://picsum.photos/seed/seoul/360/360'
      },
      {
        id: '12',
        title: 'Four Walls',
        artist: 'IU',
        year: 2014,
        country: 'KR',
        rating: undefined,
        expectedRating: 7.6,
        cover: 'https://picsum.photos/seed/fourwalls/360/360'
      }
    ]
  }
];

export default function RecommendationGrid() {
  return (
    <section className="mx-auto w-full max-w-5xl px-6 py-10 space-y-12">
      {categories.map((category) => (
        <div key={category.name}>
          {/* Category Header */}
          <div className="mb-4">
            <h2 className="text-xl font-bold text-slate-900">{category.name}</h2>
            <p className="text-sm text-slate-600">{category.description}</p>
          </div>

          {/* Horizontal Scrollable Row */}
          <div className="group relative">
            <div className="overflow-x-auto scrollbar-hide">
              <div className="flex gap-4 pb-2">
                {category.albums.map((album) => (
                  <div key={album.id} className="flex-shrink-0 w-32">
                    <div className="space-y-2">
                      {/* Album Cover */}
                      <div className="relative overflow-hidden bg-slate-100 rounded-sm">
                        <img 
                          src={album.cover} 
                          alt={album.title} 
                          className="aspect-square w-full object-cover" 
                        />
                      </div>
                      
                      {/* Album Info */}
                      <div className="space-y-1">
                        <p className="text-xs font-semibold text-slate-900 line-clamp-2">{album.title}</p>
                        <p className="text-xs text-slate-600">{album.year} · {album.artist}</p>
                        <p className="text-xs text-slate-500">
                          {album.rating ? `Given Rating: ${album.rating}/10` : `Expected Rating: ${album.expectedRating}/10`}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Scroll Indicators */}
            <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-slate-50 to-transparent pointer-events-none group-hover:from-slate-100"></div>
          </div>
        </div>
      ))}
    </section>
  );
}
