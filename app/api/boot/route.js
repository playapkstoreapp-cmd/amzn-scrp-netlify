import { bootSession } from '@/lib/scraper';
export async function POST(req) {
  const { zip } = await req.json();
  try {
    const session = await bootSession(zip || '90009');
    return Response.json({ ok: true, cookies: session.cookies.split(';').length, zipApplied: true });
  } catch(e) {
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }
}
