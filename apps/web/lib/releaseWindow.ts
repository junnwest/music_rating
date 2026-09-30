// Unreleased albums must not surface anywhere. MusicBrainz legitimately lists announced releases and
// the catalogue carries 126 of them, so every surface that orders by first_release_date DESC would
// otherwise be led by records that do not exist yet — permanently, in the case of a typo dated 2045.
//
// Undated rows are KEPT. A missing date is not evidence that something is unreleased, and excluding
// them would hide real albums: a bare `.lte()` drops NULLs in PostgREST, which is why this is an
// explicit or-filter rather than a comparison. The one exception is a strictly newest-first feed
// (/api/discovery newReleases), where a row with no date has no claim to being new.
export const releasedFilter = (): string => {
  const today = new Date().toISOString().slice(0, 10);
  return `first_release_date.is.null,first_release_date.lte.${today}`;
};
