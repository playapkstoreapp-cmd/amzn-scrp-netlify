import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export async function GET() {
  const { data } = await supabase.from('scrapes').select('*').order('created_at', { ascending: false }).limit(50);
  return Response.json(data || []);
}
export async function POST(req) {
  const body = await req.json();
  const { data } = await supabase.from('scrapes').insert(body).select().single();
  return Response.json(data);
}
