-- daily_questions: one question per day, surfaced on the homepage
CREATE TABLE IF NOT EXISTS public.daily_questions (
  id            uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  question_text text    NOT NULL,
  question_date date    NOT NULL UNIQUE,
  created_at    timestamptz DEFAULT now()
);

ALTER TABLE public.daily_questions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "daily_questions_select" ON public.daily_questions FOR SELECT USING (true);

-- daily_answers: one answer per user per question (upserted by answer route)
CREATE TABLE IF NOT EXISTS public.daily_answers (
  id          uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid  REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  question_id uuid  REFERENCES public.daily_questions(id) ON DELETE CASCADE NOT NULL,
  release_id  text  NOT NULL,
  note        text,
  created_at  timestamptz DEFAULT now(),
  UNIQUE (user_id, question_id)
);

ALTER TABLE public.daily_answers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "daily_answers_select_own" ON public.daily_answers FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "daily_answers_insert_own" ON public.daily_answers FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "daily_answers_update_own" ON public.daily_answers FOR UPDATE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS daily_answers_question_id_idx ON public.daily_answers (question_id);
CREATE INDEX IF NOT EXISTS daily_answers_user_id_idx     ON public.daily_answers (user_id);
