// Vercel Node serverless function
// Path: /api/radiosondy.js

let CACHE = { body:null, ts:0 };
const CACHE_TTL_MS = 30_000; // 30s

export default async function handler(req, res){
  // CORS
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if(req.method === 'OPTIONS'){ res.status(204).end(); return; }

  const upstream = 'https://radiosondy.info/export/export_search.php?csv=1&search_limit=200';

  // Serve cached if fresh
  const now = Date.now();
  if(CACHE.body && now - CACHE.ts < CACHE_TTL_MS){
    res.setHeader('Content-Type','text/plain; charset=utf-8');
    res.status(200).send(CACHE.body);
    return;
  }

  const ctrl = new AbortController();
  const timeout = setTimeout(()=>ctrl.abort(), 12_000);
  try{
    const r = await fetch(upstream, { signal: ctrl.signal });
    clearTimeout(timeout);
    if(!r.ok){
      if(CACHE.body){
        res.setHeader('X-Proxy-Warn','stale-cache');
        res.setHeader('Content-Type','text/plain; charset=utf-8');
        res.status(r.status).send(CACHE.body);
      } else {
        res.status(r.status).send('');
      }
      return;
    }
    const text = await r.text();
    CACHE = { body:text, ts: Date.now() };
    res.setHeader('Content-Type','text/plain; charset=utf-8');
    res.status(200).send(text);
  } catch(err){
    clearTimeout(timeout);
    if(err && err.name === 'AbortError'){
      if(CACHE.body){
        res.setHeader('X-Proxy-Warn','stale-cache');
        res.setHeader('Content-Type','text/plain; charset=utf-8');
        res.status(504).send(CACHE.body);
      } else {
        res.status(504).send('');
      }
    } else {
      if(CACHE.body){
        res.setHeader('X-Proxy-Warn','stale-cache');
        res.setHeader('Content-Type','text/plain; charset=utf-8');
        res.status(502).send(CACHE.body);
      } else {
        res.status(502).send('');
      }
    }
  }
}
