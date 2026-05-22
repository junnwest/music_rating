const API_URL = process.env.EXPO_PUBLIC_API_URL ?? '';

export interface SearchRelease {
  id: string;
  title: string;
  artist: string;
  coverUrl: string | null;
  releaseType: string | null;
  date: string | null;
}

export async function searchSpotify(query: string): Promise<SearchRelease[]> {
  if (!API_URL || !query.trim()) return [];
  try {
    const res = await fetch(
      `${API_URL}/api/search?query=${encodeURIComponent(query)}&type=releases`,
      { headers: { Accept: 'application/json' } }
    );
    if (!res.ok) return [];
    const json = await res.json();
    return (json.releases ?? []) as SearchRelease[];
  } catch {
    return [];
  }
}
