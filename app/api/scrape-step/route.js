import { bootSession, parseListingPage, parseProductPage, fetchWithRetry } from '@/lib/scraper';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export async function POST(req) {
  const { jobId, url, count, zip, step, accumulatedAsins, sessionCookies } = await req.json();
  
  try {
    let session = sessionCookies ? { cookies: sessionCookies, headers: {} } : await bootSession(zip);
    
    // Step 0 = listing pagination
    if (step === 'listing') {
      let currentUrl = url;
      let allProducts = [];
      let pageNum = 1;
      let requestedPage = 1;
      try { requestedPage = parseInt(new URL(url).searchParams.get('page')) || 1; } catch {}
      
      while (allProducts.length < count) {
        const html = await fetchWithRetry(currentUrl, session);
        const { products, selectedPage, nextPageUrl } = parseListingPage(html, currentUrl);
        
        // Verify pagination - halt if Amazon clamps back to different page
        if (selectedPage !== pageNum + requestedPage -1 && pageNum > 1) {
          break;
        }
        
        // De-duplicate ASINs
        const newProducts = products.filter(p => !accumulatedAsins.includes(p.asin));
        allProducts.push(...newProducts);
        
        if (!nextPageUrl || newProducts.length === 0) break;
        currentUrl = nextPageUrl;
        pageNum++;
        if (pageNum > 20) break; // safety
      }
      
      const sliced = allProducts.slice(0, count);
      return Response.json({ 
        step: 'listing_done', 
        products: sliced, 
        nextStep: 'details',
        sessionCookies: session.cookies,
        log: `Listing pages parsed: ${pageNum} pages, ${sliced.length} organic ASINs (exact-listing fidelity)`
      });
    }
    
    // Step 1 = product details batch
    if (step === 'details') {
      const { asins, batchIndex } = await req.json().catch(()=>({})) || req.json ? await req.json() : {};
      // Actually reuse same body
      const body = await req.clone?.()?.json() || { asins: accumulatedAsins };
      const batchAsins = (accumulatedAsins || []).slice(batchIndex*5, (batchIndex+1)*5);
      
      const detailed = [];
      for (const asin of batchAsins) {
        const html = await fetchWithRetry(`https://www.amazon.com/dp/${asin}`, session, 3);
        const parsed = await parseProductPage(html, asin);
        detailed.push(parsed);
      }
      
      return Response.json({ step: 'details_batch', products: detailed, done: (batchIndex+1)*5 >= accumulatedAsins.length });
    }

    return Response.json({ error: 'invalid step' }, { status: 400 });
  } catch(e) {
    if (e.message === 'DATACENTER_BLOCKED') {
      return Response.json({ 
        error: 'Amazon rate-limited this datacenter IP. Add a US residential proxy in Settings → Network or set SCRAPERAPI_KEY env var.',
        code: 'DATACENTER_BLOCKED'
      }, { status: 429 });
    }
    return Response.json({ error: e.message }, { status: 500 });
  }
}
