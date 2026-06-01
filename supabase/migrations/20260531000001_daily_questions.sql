-- Daily question of the day feature
-- Each day has one question; users answer by picking a release from the catalog.

CREATE TABLE IF NOT EXISTS daily_questions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_text TEXT NOT NULL,
  question_date DATE NOT NULL UNIQUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS daily_answers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES daily_questions(id) ON DELETE CASCADE,
  release_id  TEXT NOT NULL,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, question_id)
);

CREATE INDEX IF NOT EXISTS daily_answers_user_idx     ON daily_answers (user_id);
CREATE INDEX IF NOT EXISTS daily_answers_question_idx ON daily_answers (question_id);
CREATE INDEX IF NOT EXISTS daily_questions_date_idx   ON daily_questions (question_date DESC);

-- RLS
ALTER TABLE daily_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_answers   ENABLE ROW LEVEL SECURITY;

CREATE POLICY "daily_questions_public_read"
  ON daily_questions FOR SELECT USING (true);

CREATE POLICY "daily_answers_public_read"
  ON daily_answers FOR SELECT USING (true);

CREATE POLICY "daily_answers_insert_own"
  ON daily_answers FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "daily_answers_update_own"
  ON daily_answers FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "daily_answers_delete_own"
  ON daily_answers FOR DELETE
  USING (auth.uid() = user_id);

-- Seed questions (2026-05-31 onwards)
INSERT INTO daily_questions (question_text, question_date) VALUES
  ('What album defined a decade for you?',                                        '2026-05-31'),
  ('An album you discovered by accident that became a favourite?',                '2026-06-01'),
  ('What album do you put on when you need to focus?',                            '2026-06-02'),
  ('An album that sounds exactly like where it was made?',                        '2026-06-03'),
  ('What record changed how you think about music?',                              '2026-06-04'),
  ('An album you love but rarely recommend to others?',                           '2026-06-05'),
  ('What album perfectly captures a season for you?',                             '2026-06-06'),
  ('An album you return to every year?',                                          '2026-06-07'),
  ('What was the last album that genuinely surprised you?',                       '2026-06-08'),
  ('An album you listened to on repeat when you were younger?',                   '2026-06-09'),
  ('What album would you play to someone who doesn''t usually listen to music?',  '2026-06-10'),
  ('An album that hits differently at 3am?',                                      '2026-06-11'),
  ('What''s the best debut album you know?',                                      '2026-06-12'),
  ('An album where you love every single track?',                                 '2026-06-13'),
  ('What album do you wish more people had heard?',                               '2026-06-14'),
  ('An album that made you feel less alone?',                                     '2026-06-15'),
  ('What record is the perfect road trip companion?',                             '2026-06-16'),
  ('An album that aged better than you expected?',                                '2026-06-17'),
  ('What album do you associate with a specific memory?',                         '2026-06-18'),
  ('An album that taught you something new about a genre?',                       '2026-06-19'),
  ('What''s your comfort album — the one you always go back to?',                 '2026-06-20'),
  ('An album that is front-to-back perfect for you?',                             '2026-06-21'),
  ('What album do you think deserves a second listen from more people?',          '2026-06-22'),
  ('An album that surprised you with how much you loved it?',                     '2026-06-23'),
  ('What record sounds best on vinyl — or would?',                                '2026-06-24'),
  ('An album that got you through a tough time?',                                 '2026-06-25'),
  ('What album have you recommended the most?',                                   '2026-06-26'),
  ('An album that still sounds ahead of its time?',                               '2026-06-27'),
  ('What was the first album you ever truly loved?',                              '2026-06-28'),
  ('An album you put on at the start of a long evening?',                         '2026-06-29')
ON CONFLICT (question_date) DO NOTHING;
