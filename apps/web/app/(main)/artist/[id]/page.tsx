import ArtistPageClient from './ArtistPageClient';
import { loadArtistInitial } from '../../../../lib/sj/serverCatalog';
import { ServerLanguage } from '../../../../lib/i18n';
import { getServerLang } from '../../../../lib/i18n/server';

// Server wrapper (2026-11-12): sends the artist's name, photo, stats and discography in the first
// HTML (crawlers used to get "Artist — community avg 0 · 0 ratings" and a dash for the name).
// Name-slug URLs (not a uuid) get null and load in the browser as before; they're noindex anyway.
// Keyed by id so moving between artists remounts with that artist's data.
export default async function ArtistPage({ params }: { params: { id: string } }) {
  const initial = await loadArtistInitial(decodeURIComponent(params.id));
  // Korean HTML for Korean visitors / crawlers (sj-lang cookie or Accept-Language); see ServerLanguage.
  return (
    <ServerLanguage lang={getServerLang()}>
      <ArtistPageClient key={params.id} initial={initial} />
    </ServerLanguage>
  );
}
