-- View encapsulating shared eligibility rules for recommendations.
-- Both web and mobile query this view instead of releases directly,
-- so any rule change here applies to both apps without a code deploy.
CREATE OR REPLACE VIEW recommendable_releases AS
  SELECT *
  FROM releases
  WHERE LOWER(release_type) IN ('album', 'ep')
    AND cover_url IS NOT NULL;
