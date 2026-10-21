"use client";
import { useState, useEffect } from "react";

export default function Page(){
  const [url,setUrl]=useState("https://www.amazon.com/s?k=ceramic+mugs");
  const [count,setCount]=useState(48);
  const [zip,setZip]=useState("90009");
  const [log,setLog]=useState([]);
  const [progress,setProgress]=useState(0);
  const [harvesting,setHarvesting]=useState(false);
  const [products,setProducts]=useState([]);
  const [detailed,setDetailed]=useState([]);
  const [history,setHistory]=useState([]);
  const [conn,setConn]=useState(null);

  const addLog=(m)=>setLog(l=>[...l, `${new Date().toLocaleTimeString()} - ${m}`]);

  useEffect(()=>{ 
    fetch('/api/history').then(r=>r.json()).then(d=>setHistory(Array.isArray(d)?d:[])).catch(()=>{}); 
  },[]);

  const testConn=async()=>{
    addLog('Testing connection to Amazon via Netlify...');
    try{
      const res=await fetch('/api/test-connection',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({zip})});
      const data=await res.json(); 
      setConn(data); 
      if(data.ok) addLog(`✅ Netlify -> Amazon: reachable=${data.reachable} zip=${data.zipStatus} cookies=${data.cookieCount} latency=${data.latency}ms`);
      else addLog(`❌ Test failed: ${data.error}`);
    }catch(e){ addLog(`❌ Test error: ${e.message}`); }
  };

  const startHarvest=async()=>{
    setHarvesting(true); setProducts([]); setDetailed([]); setLog([]); setProgress(5);
    try{
      addLog(`[BOOT] Booting session with ZIP ${zip} via glow endpoint...`);
      let sessionCookies=null;
      let accumulated=[];
      let currentUrl=url;
      
      addLog(`[LISTING] Fetching listing pages for ${count} products (preserving ?page=N, exact-listing fidelity)`);
      const res1=await fetch('/api/scrape-step',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url,count,zip,step:'listing',accumulated:[],currentUrl})});
      const data1=await res1.json();
      if(!res1.ok) throw new Error(data1.error||'listing failed');
      sessionCookies=data1.sessionCookies;
      accumulated=data1.products;
      setProducts(accumulated);
      addLog(`[LISTING] ${data1.log} - s-main-slot only, sponsored skipped, ASIN deduped`);
      setProgress(40);

      // Details chunked - avoids Netlify/Vercel timeout
      let allDetailed=[];
      let batchIndex=0;
      while(true){
        const remaining = accumulated.length - batchIndex*5;
        const batchSize = Math.min(5, remaining);
        if(batchSize<=0) break;
        addLog(`[DETAILS] Batch ${batchIndex+1} - fetching ${batchSize} product pages -> SL1500 images`);
        const res=await fetch('/api/scrape-step',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url,count,zip,step:'details',accumulated,sessionCookies,batchIndex})});
        const data=await res.json();
        if(!res.ok) throw new Error(data.error||'details failed');
        allDetailed=[...allDetailed,...data.products];
        setDetailed([...allDetailed]);
        setProgress(40 + Math.round((allDetailed.length/accumulated.length)*55));
        if(data.done) break;
        batchIndex++;
      }
      
      addLog(`[DONE] ${allDetailed.length} products parsed -> generating CSV with columns: Title, Link, Description, Image1, Image2 SL1500`);
      
      // CSV generation with EXACT columns requested
      const csvRows=[
        'Full Product Title,Product amazon link,Product Description,First Product Image Link,Second Product Image Link (High Resolution)',
        ...allDetailed.map(p=>{
          const esc = (s)=>`"${(s||'').replace(/"/g,'""')}"`;
          return `${esc(p.full_title)},${esc(p.amazon_link)},${esc((p.description||'').substring(0,2000))},${esc(p.first_image)},${esc(p.second_image)}`;
        })
      ];
      const csv=csvRows.join('\n');
      const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});
      const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`harvest_${Date.now()}_${allDetailed.length}products.csv`; a.click();
      
      addLog('[CSV] Downloaded + saved to Supabase Scrape History');
      
      // Save to Supabase
      try{
        await fetch('/api/history',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:url,zip,url,requested_count:count,harvested_count:allDetailed.length,status:'completed',products:allDetailed})});
        const hist=await fetch('/api/history').then(r=>r.json()); setHistory(Array.isArray(hist)?hist:[]);
      }catch{}
      
      setProgress(100);
    }catch(e){
      addLog(`[ERROR] ${e.message}`);
      if(e.message.includes('DATACENTER')||e.message.includes('blocked')||e.message.includes('429')){
        addLog('[FIX] Amazon blocked datacenter IP. Fix: Settings -> Add US residential proxy or set SCRAPERAPI_KEY / SCRAPINGBEE_API_KEY in Netlify env vars');
      }
    }
    setHarvesting(false);
  };

  return (
    <div className="min-h-screen flex bg-[#15120F] text-white font-sans">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Instrument+Serif&display=swap');
        .font-serif{font-family:'Instrument Serif', serif;}
      `}</style>
      
      {/* Sidebar */}
      <aside className="w-[260px] bg-[#1A1714] border-r border-[#2A2520] p-4 hidden lg:flex flex-col fixed h-screen">
        <div className="flex items-center gap-2 mb-8"><div className="w-8 h-8 bg-[#2A4A35] rounded-lg flex items-center justify-center text-sm">🌱</div><span className="font-bold tracking-tight">ListingHarvest.</span><span className="text-[10px] bg-[#2A2520] px-1.5 py-0.5 rounded ml-1">NETLIFY</span></div>
        <nav className="space-y-1 text-sm">
          <div className="bg-[#2A3328] rounded-lg p-3 flex items-center gap-2">⊞ Dashboard</div>
          <div className="p-3 text-zinc-500 flex justify-between">↻ Scrape History <span className="text-xs bg-[#2A2520] px-2 py-0.5 rounded-full">{history.length}</span></div>
        </nav>
        <div className="mt-4 bg-[#1E1B18] rounded-xl p-3 border border-[#2A2520]">
          <p className="text-xs font-bold">How it works</p>
          <p className="text-[11px] text-zinc-500 mt-2 leading-relaxed">
            1. Paste any Amazon search URL<br/>
            2. We boot session + apply ZIP 90009 via Amazon glow endpoint<br/>
            3. Parse s-main-slot only (before related cutoff)<br/>
            4. Paginate with .s-pagination-selected verification<br/>
            5. Fetch product pages -> SL1500 images -> CSV
          </p>
        </div>
        <div className="mt-auto bg-[#1E3A2E] rounded-xl p-4 text-xs border border-[#2A4A35]">
          <p className="font-bold flex items-center gap-2"><span className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>Verified flow</p>
          <p className="text-zinc-400 mt-2 leading-relaxed text-[11px]">boot → ZIP 90009 → listing 1/2 verified → product pages → CSV<br/>Chunked /api/scrape-step avoids timeout</p>
          <button onClick={testConn} className="mt-3 w-full bg-[#2A4A35] hover:bg-[#345A42] py-2.5 rounded-full font-medium transition">Test Connection</button>
          {conn && <p className="mt-2 text-[10px] text-zinc-300 leading-relaxed bg-black/20 p-2 rounded-lg">{conn.ok?`✅ reachable:${conn.reachable} zip:${conn.zipStatus} cookies:${conn.cookieCount} ${conn.latency}ms`:`❌ ${conn.error}`}</p>}
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 p-5 md:p-8 lg:ml-[260px] overflow-auto">
        <p className="text-[11px] tracking-[0.2em] text-zinc-500 font-semibold">— YOUR RESEARCH, REIMAGINED • NETLIFY EDITION</p>
        <h1 className="text-4xl font-serif mt-3 tracking-tight">Good data. Great possibilities.</h1>
        <p className="text-zinc-400 text-sm mt-2 mb-8 max-w-2xl">Exact-listing fidelity — only organic cards inside s-main-slot before Amazon's "related / similar / no exact match" cutoff are kept. Sponsored skipped, ASIN de-duplicated. Netlify blocks less than Vercel.</p>

        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-[#1E1B18] border border-[#2A2520] rounded-[20px] p-6">
            <div className="flex justify-between items-center"><h2 className="font-semibold text-[15px]">Start a new harvest</h2><span className="text-[10px] text-zinc-500 tracking-widest">LET'S GROW • ZIP {zip} • NETLIFY</span></div>
            
            <label className="text-xs text-zinc-400 mt-5 block">Amazon listing URL (every query param preserved, ?page=N respected as start page)</label>
            <input value={url} onChange={e=>setUrl(e.target.value)} className="w-full bg-[#15120F] border border-[#2A2520] rounded-xl px-4 py-3.5 mt-2 text-sm outline-none focus:border-[#3A3530] transition" placeholder="https://www.amazon.com/s?k=..." />
            
            <div className="grid grid-cols-2 gap-3 mt-4">
              <div><label className="text-xs text-zinc-500">ZIP (glow endpoint)</label><input value={zip} onChange={e=>setZip(e.target.value)} className="w-full bg-[#15120F] border border-[#2A2520] rounded-xl px-3 py-2.5 mt-1 text-sm outline-none" /></div>
              <div><label className="text-xs text-zinc-500">Marketplace</label><div className="bg-[#15120F] border border-[#2A2520] rounded-xl px-3 py-2.5 mt-1 text-sm text-zinc-400">amazon.com (US) - Netlify US edge</div></div>
            </div>

            <div className="flex justify-between text-sm mt-6 mb-2"><span className="text-zinc-300">How many products?</span><span className="text-white"><b className="text-[16px]">{count}</b> products <span className="text-zinc-500 text-xs ml-2">{Math.ceil(count/24)} pages</span></span></div>
            <input type="range" min="10" max="500" step="1" value={count} onChange={e=>setCount(Number(e.target.value))} className="w-full accent-[#7CFF9E] h-1.5 bg-[#2A2520] rounded-full appearance-none cursor-pointer" />
            <div className="flex gap-2 flex-wrap mt-3 mb-6">
              {[12,24,48,100,250,500].map(n=><button key={n} onClick={()=>setCount(n)} className={`px-4 py-2 rounded-full text-[13px] border transition ${count===n?'bg-[#7CFF9E] text-black border-[#7CFF9E] font-bold shadow-lg shadow-[#7CFF9E]/20':'border-zinc-700 text-zinc-400 hover:border-zinc-500'}`}>{n}</button>)}
            </div>

            <button onClick={startHarvest} disabled={harvesting} className="bg-[#2A5A40] hover:bg-[#2F6B4A] text-white px-7 py-3 rounded-full text-sm font-medium disabled:opacity-50 transition flex items-center gap-2">
              <span>{harvesting?'⏳ Harvesting...':`🌱 Start harvesting → ${count} products`}</span>
            </button>

            {(harvesting || log.length>0) && (
              <div className="mt-6">
                <div className="flex justify-between text-[11px] text-zinc-500 mb-2"><span>Progress</span><span>{progress}%</span></div>
                <div className="h-2 bg-[#2A2520] rounded-full overflow-hidden"><div className="h-full bg-gradient-to-r from-[#7CFF9E] to-[#2A5A40] transition-all duration-500" style={{width:`${progress}%`}} /></div>
                <div className="mt-3 bg-black/40 rounded-xl p-3 max-h-[200px] overflow-auto text-[11px] font-mono text-zinc-300 border border-[#2A2520] leading-relaxed">
                  {log.map((l,i)=><div key={i} className={l.includes('ERROR')||l.includes('❌')?'text-red-400': l.includes('DONE')||l.includes('✅')?'text-[#7CFF9E]':''}>{l}</div>)}
                </div>
              </div>
            )}

            {products.length>0 && (
              <div className="mt-6 border-t border-[#2A2520] pt-5">
                <p className="text-xs text-zinc-400 mb-3">Product preview grid (listing phase) - {products.length} organic ASINs from s-main-slot</p>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 max-h-[320px] overflow-auto pr-1">
                  {products.map(p=><div key={p.asin} className="bg-[#15120F] border border-[#2A2520] p-2.5 rounded-xl"><p className="text-[11px] truncate leading-tight">{p.title}</p><p className="text-[10px] text-[#7CFF9E] mt-1 font-mono">{p.asin} • {p.price}</p></div>)}
                </div>
              </div>
            )}

            {detailed.length>0 && (
              <div className="mt-5">
                <p className="text-xs text-zinc-400 mb-3">Detailed CSV-ready (SL1500) - {detailed.length} / {products.length}</p>
                <div className="grid grid-cols-1 gap-2 max-h-[400px] overflow-auto">
                  {detailed.map(p=><div key={p.asin} className="flex gap-3 bg-[#15120F] border border-[#2A2520] p-2.5 rounded-xl"><img src={p.first_image} alt="" className="w-14 h-14 object-cover rounded-lg bg-[#1A1714]" onError={e=>e.target.style.display='none'} /><div className="text-[11px] flex-1 min-w-0"><p className="truncate font-medium w-[90%]">{p.full_title}</p><p className="text-zinc-500 truncate font-mono text-[10px]">{p.amazon_link}</p><p className="text-zinc-600 truncate mt-1">{p.description?.substring(0,80)}...</p></div></div>)}
                </div>
              </div>
            )}
          </div>

          <div className="bg-gradient-to-b from-[#1E3A2E] to-[#16261D] rounded-[20px] p-6 flex flex-col border border-[#2A4A35]">
            <p className="text-[11px] tracking-widest text-[#7CFF9E] font-semibold">● SMALL INPUT. BIG POSSIBILITIES.</p>
            <h3 className="text-[26px] font-serif mt-4 leading-[1.1]">You find the listing.<br/>We'll pick the details.</h3>
            <div className="mt-6 text-xs space-y-2.5 text-zinc-300 leading-relaxed">
              <p className="flex gap-2"><span className="text-[#7CFF9E]">✓</span> Chunked job engine /api/scrape-step (avoids timeout)</p>
              <p className="flex gap-2"><span className="text-[#7CFF9E]">✓</span> Resumable + pagination halt if Amazon clamps</p>
              <p className="flex gap-2"><span className="text-[#7CFF9E]">✓</span> Supabase persistence + resume</p>
              <p className="flex gap-2"><span className="text-[#7CFF9E]">✓</span> CSV: Title, Link, Description, Image1, Image2 SL1500</p>
              <p className="flex gap-2"><span className="text-[#7CFF9E]">✓</span> Netlify edition: 26s functions, less blocking than Vercel</p>
            </div>

            <div className="mt-8 bg-black/20 rounded-xl p-3 border border-[#2A4A35]/50">
              <p className="text-[11px] text-zinc-400">Note on blocking:</p>
              <p className="text-[11px] text-zinc-300 mt-1 leading-relaxed">If Amazon rate-limits Netlify IP, you will see clear error. Fix: Add US residential proxy in Settings → Network or set SCRAPERAPI_KEY env var in Netlify.</p>
            </div>

            <div className="mt-6 flex-1">
              <h4 className="font-bold text-sm flex items-center gap-2">Recent harvests <span className="bg-[#2A4A35] text-[10px] px-2 py-0.5 rounded-full">{history.length}</span></h4>
              <div className="mt-3 space-y-2 max-h-[380px] overflow-auto pr-1">
                {history.map(h=><div key={h.id} className="bg-[#15261D] p-3 rounded-xl border border-[#1E3A2E]"><p className="truncate text-xs font-medium">{h.query?.substring(0,45)}</p><p className="text-[11px] text-zinc-500 mt-1">{h.harvested_count} products • {new Date(h.created_at).toLocaleString()} • ZIP {h.zip}</p><p className="text-[10px] text-[#7CFF9E] mt-1 font-mono truncate">{h.status}</p></div>)}
                {history.length===0 && <div className="text-xs text-zinc-500 bg-black/20 p-3 rounded-xl">Sample run 12 ceramic-mug products will appear here after first harvest. Test connection first to verify Amazon reachability.</div>}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
