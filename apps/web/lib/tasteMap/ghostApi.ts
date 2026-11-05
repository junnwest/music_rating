/**
 * Contract for the ghost-node routes (thin / misfit nodes, thin.ts):
 *
 *   PUT  /api/taste/map/node-state   NodeStatePutBody → NodeStatePutResponse
 *   GET  /api/taste/map/questions    → QuestionsResponse
 *   POST /api/taste/map/questions    AnswerPostBody → AnswerPostResponse
 *
 * Per-user state lives in taste_map_node_state (migration 20261105000000),
 * keyed by node key. Shared by the routes (server) and GhostTray (client).
 */
import type { NodeKey } from './types';

/**
 * What the user decided for a ghost:
 *   placed    dragged it onto the map (a pin carries the position)
 *   hidden    "leave it out": listed in the tray only, not drawn
 *   included  "include anyway": a normal node, wherever the data puts it
 */
export type NodeStateValue = 'placed' | 'hidden' | 'included';
export const NODE_STATE_VALUES: readonly NodeStateValue[] = ['placed', 'hidden', 'included'];

/** taste_map_node_state.answer. */
export type NodeAnswer =
  | {
      /** Taxonomy id (lib/genres/taxonomy.ts) the user picked. */
      genreId: string;
      at: string;
      /** release_groups the catalog write put `manual` rows on (allowlisted users only), so a re-answer may replace them. */
      catalogRgIds?: string[];
    }
  | { none: true; at: string };

export interface NodeState {
  state: NodeStateValue | null;
  answer: NodeAnswer | null;
}

export interface NodeStatePutBody {
  key: NodeKey;
  /** null clears the choice (the node is classified from its data again). */
  state: NodeStateValue | null;
}

export interface NodeStatePutResponse {
  ok: true;
  key: NodeKey;
  state: NodeStateValue | null;
}

export interface QuestionOption {
  /** Taxonomy id (plain, not language-qualified) — what an answer sends back. */
  genreId: string;
  /** In-language form for the artist ("Korean Folk"). */
  label: string;
  labelKo: string;
}

export interface GhostQuestion {
  key: NodeKey;
  artistId: string;
  label: string;
  eraLabel: string | null;
  /** "Is 이상순 closer to Folk, Korean Indie or R&B?" */
  prompt: string;
  /** 2–4 candidates, most likely first. "None of these" / "Leave it out" are the client's own buttons. */
  options: QuestionOption[];
}

export interface QuestionsResponse {
  questions: GhostQuestion[];
}

export type AnswerPostBody = { key: NodeKey; genreId: string } | { key: NodeKey; none: true };

export interface AnswerPostResponse {
  ok: true;
  key: NodeKey;
  /** Catalog write (allowlisted users only): release groups given a `manual` genre, or null when nothing was written. */
  catalog: { releaseGroups: number } | null;
}
