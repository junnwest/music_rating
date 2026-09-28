import type { FeedItemRow, ReleaseGroupEmbed } from '../sj/data';
import type { MixSharePost } from '../sj/mixShares';

export type FeedTab = 'explore' | 'following';
export type FeedBucket = 'taste' | 'adjacent' | 'social' | 'community' | 'exploration';
export type FeedEntry = { kind: 'rating'; item: FeedItemRow } | { kind: 'mix'; post: MixSharePost };
export const entryKey = (entry: FeedEntry) => `${entry.kind}:${entry.kind === 'rating' ? entry.item.id : entry.post.id}`;
export const entryAuthor = (entry: FeedEntry) => entry.kind === 'rating' ? entry.item.user_id : entry.post.userId;
export const entryTime = (entry: FeedEntry) => entry.kind === 'rating' ? entry.item.created_at : entry.post.createdAt;

export interface RankedRef {
  key: string;
  bucket: FeedBucket | 'following';
}

export interface HomeFeedPage {
  entries: FeedEntry[];
  nextCursor: string | null;
  sessionId: string;
  version: string;
  positions: Record<string, number>;
  reasons: Record<string, string>;
  likeCounts: Record<string, number>;
  commentCounts: Record<string, number>;
  likedKeys: string[];
}

export interface Candidate {
  key: string;
  author: string;
  createdAt: string;
  format: 'review' | 'rating' | 'mix';
  albums: ReleaseGroupEmbed[];
  text: string;
  relevance: number;
  authorAffinity: number;
  response: number;
  seen: boolean;
  knownArtist: boolean;
  followed: boolean;
}
