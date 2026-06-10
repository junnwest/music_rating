import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../lib/supabaseServer';

// GET /api/daily-question
// Returns today's question and, if userId is provided, the user's existing answer.
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const userId = searchParams.get('userId') ?? '';

  const supabase = createServerClient();
  if (!supabase) return NextResponse.json({ question: null }, { status: 503 });

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD in UTC

  const { data: question, error } = await supabase
    .from('daily_questions')
    .select('id, question_text, question_date')
    .eq('question_date', today)
    .maybeSingle();

  if (error) {
    console.error('[daily-question] fetch error:', error.message);
    return NextResponse.json({ question: null }, { status: 500 });
  }

  if (!question) {
    return NextResponse.json({ question: null });
  }

  // Count how many users answered today
  const { count: totalAnswers } = await supabase
    .from('daily_answers')
    .select('id', { count: 'exact', head: true })
    .eq('question_id', question.id);

  let userAnswer: {
    id: string;
    release_id: string;
    note: string | null;
    release: { title: string; artist: string; cover_url: string | null } | null;
  } | null = null;

  if (userId) {
    const { data: answer } = await supabase
      .from('daily_answers')
      .select('id, release_id, note')
      .eq('question_id', question.id)
      .eq('user_id', userId)
      .maybeSingle();

    if (answer) {
      const { data: release } = await supabase
        .from('releases')
        .select('title, artist, cover_url')
        .eq('id', answer.release_id)
        .maybeSingle();

      userAnswer = {
        id: answer.id,
        release_id: answer.release_id,
        note: answer.note,
        release: release ?? null,
      };
    }
  }

  return NextResponse.json({
    question,
    userAnswer,
    totalAnswers: totalAnswers ?? 0,
  });
}
