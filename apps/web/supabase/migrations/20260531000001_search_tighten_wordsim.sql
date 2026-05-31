-- Raise word_similarity threshold from 0.3 → 0.4 to reduce false positives
-- on short queries (≤3 char Korean names like "윤하" shared only 1 trigram with
-- "윤수일" giving 0.33, which now correctly falls below the threshold).

CREATE OR REPLACE FUNCTION search_releases(
  q               text,
  yr              text           DEFAULT NULL,
  lim             int            DEFAULT 15,
  query_embedding vector(1024)   DEFAULT NULL
)
RETURNS TABLE (
  id            uuid,
  title         text,
  artist        text,
  title_native  text,
  artist_native text,
  release_date  text,
  release_type  text,
  cover_url     text
)
LANGUAGE sql STABLE AS $$
  SELECT
    r.id, r.title, r.artist, r.title_native, r.artist_native,
    r.release_date, r.release_type, r.cover_url
  FROM releases r
  LEFT JOIN artists a ON r.artist_id = a.id
  WHERE
    r.release_type NOT ILIKE 'single'
    AND (yr IS NULL OR r.release_date LIKE yr || '%')
    AND (
      r.title          ILIKE '%' || q || '%'
      OR r.artist        ILIKE '%' || q || '%'
      OR r.title_native  ILIKE '%' || q || '%'
      OR r.artist_native ILIKE '%' || q || '%'
      OR lower(coalesce(a.name,        '')) = lower(q)
      OR lower(coalesce(a.name,        '')) LIKE lower(q) || '%'
      OR lower(coalesce(a.name_native, '')) = lower(q)
      OR lower(coalesce(a.name_native, '')) LIKE lower(q) || '%'
      OR word_similarity(lower(q), lower(r.title))  > 0.4
      OR word_similarity(lower(q), lower(r.artist)) > 0.4
      OR (r.title_native  IS NOT NULL AND word_similarity(lower(q), lower(r.title_native))  > 0.4)
      OR (r.artist_native IS NOT NULL AND word_similarity(lower(q), lower(r.artist_native)) > 0.4)
      OR to_tsvector('simple',
           coalesce(r.title, '')        || ' ' || coalesce(r.artist, '')        || ' ' ||
           coalesce(r.title_native, '') || ' ' || coalesce(r.artist_native, ''))
         @@ plainto_tsquery('simple', q)
    )
  ORDER BY (
    CASE
      WHEN lower(r.title)  = lower(q) OR lower(coalesce(r.title_native,  '')) = lower(q) THEN 10000
      WHEN lower(r.artist) = lower(q) OR lower(coalesce(r.artist_native, '')) = lower(q) THEN  9000
      WHEN lower(coalesce(a.name,        '')) = lower(q)
        OR lower(coalesce(a.name_native, '')) = lower(q)                                  THEN  9000
      ELSE 0
    END
    + CASE
        WHEN lower(r.title)                      LIKE lower(q) || '%' THEN 500
        WHEN lower(r.artist)                     LIKE lower(q) || '%' THEN 400
        WHEN lower(coalesce(a.name,        ''))  LIKE lower(q) || '%' THEN 400
        ELSE 0
      END
    + GREATEST(
        word_similarity(lower(q), lower(r.title)),
        word_similarity(lower(q), lower(r.artist)),
        COALESCE(word_similarity(lower(q), lower(r.title_native)),  0),
        COALESCE(word_similarity(lower(q), lower(r.artist_native)), 0)
      ) * 1000
    + ts_rank(
        to_tsvector('simple',
          coalesce(r.title, '')        || ' ' || coalesce(r.artist, '')        || ' ' ||
          coalesce(r.title_native, '') || ' ' || coalesce(r.artist_native, '')),
        plainto_tsquery('simple', q)
      ) * 100
    + ln(GREATEST(r.ratings_count::float, 0) + 1) * 8
    + CASE
        WHEN query_embedding IS NOT NULL AND r.embedding IS NOT NULL
        THEN (1.0 - (r.embedding <=> query_embedding)) * 1500
        ELSE 0
      END
  ) DESC
  LIMIT lim;
$$;
