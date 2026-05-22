export type ReleaseType = 'Single' | 'EP' | 'Album' | 'Live' | 'Compilation';

export type RatingStatus = 'Listened' | 'Listening' | 'WantToListen' | 'ReListening';

export interface AlbumRelease {
  id: string;
  title: string;
  artist: string;
  date: string | null;
  country: string | null;
  releaseType: ReleaseType;
  coverUrl?: string | null;
}

export interface UserRating {
  id: string;
  userId: string;
  releaseId: string;
  score: number;
  status: RatingStatus;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Profile {
  id: string;
  username: string;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  created_at: string;
}

export interface RankingCategory {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  country: string | null;
  genre: string | null;
  time_period: string | null;
}
