export async function fetchCoverArtUrl(mbid: string): Promise<string | null> {
  try {
    const res = await fetch(`https://coverartarchive.org/release/${mbid}`, {
      headers: { 'User-Agent': 'BsideApp/0.1 (music-rating app)' },
      next: { revalidate: 86400 } // cache for 24 hours
    });
    if (!res.ok) return null;
    const data = await res.json();
    const front = (data.images ?? []).find((img: any) => img.front);
    return front?.thumbnails?.['250'] ?? front?.image ?? null;
  } catch {
    return null;
  }
}
