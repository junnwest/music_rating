import { createClient } from '@supabase/supabase-js';
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const { count } = await db.from('artist_ingestion_queue').update({ status: 'pending' }).eq('status', 'processing').select('*', { count: 'exact', head: true });
console.log('Reset to pending:', count);
