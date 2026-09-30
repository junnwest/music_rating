-- Follow-up to 20260929000000_normalize_text_nfc (Windows) and
-- 20260929000000_short_query_search_indexes (Mac), which landed the same day.
--
-- normalize_text() now NFC-normalizes. The NFC migration made every indexed
-- column NFC first so no index entry changed -- but it predates the new
-- idx_recordings_title_norm_prefix (normalize_text(recordings.title)), so
-- recordings.title was never checked. If that index was built before the
-- function change, any non-NFC title still has an entry computed by the old
-- definition and short song searches would silently miss it.
--
-- Normalizing those titles fixes it either way: an UPDATE recomputes the row's
-- index entries with the current function. (If the index was built after the
-- change, this is a harmless no-op for the index.) Same approach as the
-- release_groups step in the NFC migration. One sequential pass over
-- recordings; only non-NFC rows are written.

update recordings set title = normalize(title, NFC)
 where title is distinct from normalize(title, NFC);
