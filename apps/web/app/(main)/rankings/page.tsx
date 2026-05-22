import { redirect } from 'next/navigation';
import { createServerClient } from '../../../lib/supabaseServer';

export const revalidate = 60;

export default async function RankingsPage() {
  const supabase = createServerClient();

  if (supabase) {
    const { data: topCat } = await supabase
      .from('ranking_categories')
      .select('slug')
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (topCat) redirect(`/rankings/${topCat.slug}`);
  }

  return (
    <div className="bg-page min-h-screen flex items-center justify-center">
      <p className="text-sm text-muted">No rankings yet.</p>
    </div>
  );
}
