/**
 * Where a song links to now that song pages are retired: its album, scrolled to
 * the track. Tracklist rows carry `id={trackAnchorId(recordingId)}`.
 */
export const trackAnchorId = (recordingId: string) => `track-${recordingId}`;

export const trackAnchorHref = (releaseGroupId: string, recordingId: string) =>
  `/album/${releaseGroupId}#${trackAnchorId(recordingId)}`;

/** A song link when the album may be unknown: `/song/<id>` resolves it server-side and redirects. */
export const songHref = (recordingId: string, releaseGroupId?: string | null) =>
  releaseGroupId ? trackAnchorHref(releaseGroupId, recordingId) : `/song/${recordingId}`;
