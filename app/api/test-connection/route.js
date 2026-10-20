import { bootSession, fetchWithRetry } from '@/lib/scraper';
export async function POST(req){
  const start=Date.now(); const {zip}=await req.json().catch(()=>({zip:'90009'}));
  try{
    const session=await bootSession(zip);
    const html=await fetchWithRetry('https://www.amazon.com/s?k=ceramic+mugs',session,1);
    return Response.json({reachable: html.includes('s-search-result'), zipStatus:'applied', cookieCount: session.cookies.split(';').length, latency: Date.now()-start, ok:true});
  }catch(e){ return Response.json({ok:false,error:e.message,latency:Date.now()-start},{status:500}); }
}
