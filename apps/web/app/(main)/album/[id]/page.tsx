import AlbumPageClient from './AlbumPageClient';
import { loadAlbumInitial } from '../../../../lib/sj/serverCatalog';
import { ServerLanguage } from '../../../../lib/i18n';
import { getServerLang } from '../../../../lib/i18n/server';

// Server wrapper (2026-11-12): fetches the album's public data so the first HTML has the title,
// artist, tracklist and community score -- crawlers used to get only the nav and an empty shell.
// The interactive page is AlbumPageClient. Keyed by id so moving between albums remounts it with
// that album's data instead of keeping the previous one's state.
// layout.tsx already 404s an id with no release group.
export default async function AlbumPage({ params }: { params: { id: string } }) {
  const initial = await loadAlbumInitial(params.id);
  // Korean HTML for Korean visitors / crawlers (sj-lang cookie or Accept-Language); see ServerLanguage.
  return (
    <ServerLanguage lang={getServerLang()}>
      <AlbumPageClient key={params.id} initial={initial} />
    </ServerLanguage>
  );
}
