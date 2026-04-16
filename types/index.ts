export type ReleaseType = 'Single' | 'EP' | 'Album' | 'Live' | 'Compilation';

export type RatingStatus = 'Listened' | 'Listening' | 'WantToListen' | 'ReListening';

export interface AlbumRelease {
  id: string;
  title: string;
  artist: string;
  date: string | null;
  country: string | null;
  releaseType: ReleaseType;
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
