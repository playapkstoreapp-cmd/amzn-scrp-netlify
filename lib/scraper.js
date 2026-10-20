import * as cheerio from 'cheerio';
import { USER_AGENTS } from './userAgents';

function getHeaders() {
  const ua = USER_AGENTS[Math.floor(Math.random()*USER_AGENTS.length)];
  return {
    'User-Agent': ua,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'sec-ch-ua': '"Not A(Brand";v="99", "Google Chrome";v="121", "Chromium";v="121"',
    'sec-ch-ua-platform': '"Windows"',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache'
  };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// 1. Boot session + apply ZIP 90009 via glow endpoint
export async function bootSession(zip = '90009') {
  const jar = [];
  let headers = getHeaders();
  
  // Initial hit to get cookies
  let res = await fetch('https://www.amazon.com/', { headers, redirect: 'manual' });
  let cookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean);
  
  // Apply ZIP via Amazon's glow address-change endpoint
  try {
    const glowRes = await fetch('https://www.amazon.com/gp/glow/get-address-selections.html?deviceType=web&pageType=Gateway&storeContext=0&actionSource=glow', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': cookies.join('; ') },
      body: `locationType=LOCATION_INPUT&zipCode=${zip}&storeContext=generic&deviceType=web&pageType=Gateway&actionSource=glow`
    });
    const glowCookies = glowRes.headers.getSetCookie ? glowRes.headers.getSetCookie() : [];
    cookies = [...cookies, ...glowCookies];
  } catch(e) { console.log('Glow ZIP apply failed, continuing', e.message); }

  return { cookies: cookies.join('; '), headers };
}

// 2. Parse listing page with exact-listing fidelity
export function parseListingPage(html, url) {
  const $ = cheerio.load(html);
  const products = [];
  const seenAsins = new Set();
  
  // Check pagination selected
  const selectedPage = parseInt($('.s-pagination-selected').text()) || 1;
  
  // Detect cutoff markers
  let cutoffReached = false;
  
  // ONLY organic cards inside s-main-slot BEFORE related/similar/no exact match
  $('#s-main-slot [data-component-type="s-search-result"]').each((_, el) => {
    if (cutoffReached) return;
    
    const $el = $(el);
    const text = $el.text().toLowerCase();
    
    // Stop at Amazon's injection points
    if (text.includes('no exact matches') || text.includes('related to this search') || text.includes('similar items')) {
      cutoffReached = true;
      return;
    }
    
    // Skip sponsored unless allowed (we skip by default)
    const isSponsored = $el.find('[data-component-type="s-search-result"] .puis-label-popover').length > 0 || 
                        $el.find('span:contains("Sponsored")').length > 0;
    if (isSponsored) return;
    
    const asin = $el.attr('data-asin');
    if (!asin || seenAsins.has(asin) || asin.length !== 10) return;
    
    const title = $el.find('h2 a span').first().text().trim();
    if (!title) return;
    
    seenAsins.add(asin);
    products.push({
      asin,
      title,
      link: `https://www.amazon.com/dp/${asin}`,
      image: $el.find('img.s-image').attr('src') || '',
      price: $el.find('.a-price .a-offscreen').first().text() || ''
    });
  });

  // Next page link
  const nextHref = $('.s-pagination-next:not(.s-pagination-disabled)').attr('href');
  const nextPageUrl = nextHref ? `https://www.amazon.com${nextHref}` : null;

  return { products, selectedPage, nextPageUrl, cutoff: cutoffReached };
}

// 3. Parse product detail page
export async function parseProductPage(html, asin) {
  const $ = cheerio.load(html);
  
  const title = $('#productTitle').text().trim() || $('h1 span').first().text().trim();
  const description = $('#feature-bullets ul').text().trim().replace(/\s+/g,' ') + ' ' + $('#productDescription p').text().trim();
  
  // Get high-res images and force to *AC_SL1500_
  let images = [];
  const imgData = $('#imgTagWrapperId img').attr('data-a-dynamic-image') || 
                  $('script:contains("colorImages")').html() || '';
  try {
    const json = JSON.parse(imgData);
    images = Object.keys(json);
  } catch {
    // Fallback: extract from inline scripts
    const matches = html.matchAll(/https:\/\/[^"]+_AC_[^"]+\.jpg/g);
    for (const m of matches) images.push(m[0]);
  }
  images = [...new Set(images)].slice(0,10).map(u => u.replace(/_AC_.*_\.jpg/, '_AC_SL1500_.jpg').replace(/_AC_[^.]+\./, '_AC_SL1500_.'));

  return {
    asin,
    full_title: title,
    amazon_link: `https://www.amazon.com/dp/${asin}`,
    description: description.substring(0, 2000),
    first_image: images[0] || '',
    second_image: images[1] || images[0] || ''
  };
}

export async function fetchWithRetry(url, session, retries=3, delayMin=1200, delayMax=2800) {
  for (let i=0; i<retries; i++) {
    try {
      await sleep(delayMin + Math.random()*(delayMax-delayMin));
      const res = await fetch(url, { headers: { ...session.headers, 'Cookie': session.cookies }, cache: 'no-store' });
      if (res.status === 503 || res.status === 429) throw new Error(`Amazon rate-limited: ${res.status}`);
      const text = await res.text();
      if (text.includes('To discuss automated access to Amazon data') || text.includes('api-services-support@amazon.com')) {
        throw new Error('DATACENTER_BLOCKED');
      }
      return text;
    } catch(e) {
      if (i===retries-1) throw e;
      await sleep(2000*(i+1));
    }
  }
}
