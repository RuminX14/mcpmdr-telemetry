(()=>{
  'use strict';

  // ======= Constants & State =======
  const PASSWORD = 'MCPMDR';
  const RX = { lat: 54.546, lon: 18.5501 }; // Gdynia Oksywie
  const ACTIVE_TIMEOUT_SEC = 900; // 15 min
  const VISIBILITY_WINDOW_SEC = 3600; // 1 h after finished
  const HISTORY_LIMIT = 600; // ~50 min @ 5s

  const state = {
    source: 'radiosondy',
    filterId: '',
    fetchTimer: null,
    map: null,
    layers: {},
    rxMarker: null,
    sondes: new Map(), // id -> sonde object
    activeId: null,
    charts: {},
    lang: localStorage.getItem('lang') || 'pl'
  };

  // ======= i18n =======
  const translations = {
    pl: {
      login_title: 'SYSTEM TELEMETRII RADIOSOND METEOROLOGICZNYCH',
      brand_sub: 'Dostęp chroniony hasłem',
      login_password_label: 'Hasło',
      login_button: 'Zaloguj',
      source_ttgo: 'TTGO',
      source_radiosondy: 'radiosondy.info',
      ttgo_url_label: 'URL TTGO',
      sonde_id_label: 'ID sondy',
      btn_search: 'Szukaj',
      btn_show_all: 'Wszystkie',
      charts_title: 'Dane graficzne',
      status_active: 'Aktywna',
      status_ended: 'Radiosondaż zakończył się'
    },
    en: {
      login_title: 'METEOROLOGICAL RADIOSONDE TELEMETRY SYSTEM',
      brand_sub: 'Password protected access',
      login_password_label: 'Password',
      login_button: 'Log in',
      source_ttgo: 'TTGO',
      source_radiosondy: 'radiosondy.info',
      ttgo_url_label: 'TTGO URL',
      sonde_id_label: 'Sonde ID',
      btn_search: 'Search',
      btn_show_all: 'All',
      charts_title: 'Charts',
      status_active: 'Active',
      status_ended: 'Sounding finished'
    }
  };
  function applyTranslations(){
    const t = translations[state.lang] || translations.pl;
    document.querySelectorAll('[data-i18n]').forEach(el=>{
      const k = el.getAttribute('data-i18n');
      if(t[k]) el.textContent = t[k];
    });
  }

  // ======= Helpers =======
  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));
  const fmt = (v, digits=0) => Number.isFinite(v) ? v.toFixed(digits) : '—';
  const nowSec = () => Math.floor(Date.now()/1000);
  const toSec = d => Math.floor(d/1000);
  const clamp = (x,a,b)=>Math.max(a,Math.min(b,x));

  // Haversine distance in meters
  function haversine(lat1,lon1,lat2,lon2){
    const R=6371000, toRad = x=>x*Math.PI/180;
    const dLat=toRad(lat2-lat1), dLon=toRad(lon2-lon1);
    const a=Math.sin(dLat/2)**2+Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
    return 2*R*Math.asin(Math.sqrt(a));
  }
  // Bearing degrees 0..360
  function bearing(lat1,lon1,lat2,lon2){
    const toRad=x=>x*Math.PI/180, toDeg=x=>x*180/Math.PI;
    const y=Math.sin(toRad(lon2-lon1))*Math.cos(toRad(lat2));
    const x=Math.cos(toRad(lat1))*Math.sin(toRad(lat2))-Math.sin(toRad(lat1))*Math.cos(toRad(lat2))*Math.cos(toRad(lon2-lon1));
    let brng = toDeg(Math.atan2(y,x));
    return (brng+360)%360;
  }

  function dewPoint(T, RH){ // Magnus
    if(!Number.isFinite(T) || !Number.isFinite(RH)) return null;
    const a=17.27,b=237.7;
    const alpha=(a*T)/(b+T)+Math.log(clamp(RH,0,100)/100);
    return (b*alpha)/(a-alpha);
  }
  function thetaK(Tc, p){
    if(!Number.isFinite(Tc) || !Number.isFinite(p) || p<=0) return null;
    const Tk = Tc+273.15; return Tk*Math.pow(1000/p,0.2854);
  }
  function lclHeight(Tc, Td){
    if(!Number.isFinite(Tc) || !Number.isFinite(Td)) return null;
    if(Tc<Td) return null; return 125*(Tc-Td);
  }
  function zeroIsoHeight(history){
    const arr = [...history].sort((a,b)=>a.alt-b.alt);
    for(let i=1;i<arr.length;i++){
      const t1=arr[i-1].temp, t2=arr[i].temp;
      if(!Number.isFinite(t1)||!Number.isFinite(t2)) continue;
      if((t1<=0 && t2>=0)||(t1>=0 && t2<=0)){
        const z1=arr[i-1].alt, z2=arr[i].alt;
        const k=(0-t1)/(t2-t1); // linear interp
        return z1 + k*(z2-z1);
      }
    }
    return null;
  }

  // ======= Login =======
  function initLogin(){
    const overlay = $('#login-overlay');
    if(sessionStorage.getItem('mcpmdr_logged_in')==='true'){
      overlay.classList.remove('show');
      $('#app').classList.remove('hidden');
      return;
    }
    overlay.classList.add('show');
    $('#password').addEventListener('keydown',e=>{ if(e.key==='Enter') $('#login-btn').click(); });
    $('#login-btn').addEventListener('click',()=>{
      const pass = $('#password').value || '';
      if(pass === PASSWORD){
        sessionStorage.setItem('mcpmdr_logged_in','true');
        overlay.classList.remove('show');
        setTimeout(()=>overlay.remove(),250);
        $('#app').classList.remove('hidden');
      } else {
        $('#login-error').textContent = 'Błędne hasło';
      }
    });
  }

  // ======= Map =======
  function initMap(){
    const map = L.map('map',{ zoomControl:true });
    state.map = map;

    const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{ attribution:'© OSM' });
    const topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',{ attribution:'© OpenTopoMap' });
    const esri = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{ attribution:'© Esri' });

    state.layers = { osm, topo, esri };
    osm.addTo(map);
    L.control.layers({ 'OpenStreetMap':osm, 'OpenTopoMap':topo, 'Esri World Imagery':esri },{} ,{ position:'topleft' }).addTo(map);

    map.setView([RX.lat,RX.lon], 10);
    state.rxMarker = L.marker([RX.lat,RX.lon],{
      title:'RX',
      icon: L.divIcon({ className:'rx-icon', html:'<div style="width:16px;height:16px;border-radius:50%;background:linear-gradient(180deg,#7bffb0,#3dd4ff);border:2px solid #0b1020"></div>' })
    }).addTo(map);
    state.rxMarker.bindTooltip('RX Gdynia Oksywie', { permanent:true, direction:'right', offset:[10,0] });
  }

  // ======= UI Switching =======
  function initUI(){
    applyTranslations();
    $$('.lang .btn').forEach(b=>b.addEventListener('click',()=>{
      state.lang = b.dataset.lang; localStorage.setItem('lang', state.lang); applyTranslations();
    }));

    // Views
    $$('.tab').forEach(tab=>tab.addEventListener('click',()=>{
      $$('.tab').forEach(t=>t.classList.remove('active'));
      tab.classList.add('active');
      const v = tab.dataset.view;
      if(v==='telemetry'){
        $('#view-telemetry').classList.add('show');
        $('#view-charts').classList.remove('show');
        setTimeout(()=>state.map && state.map.invalidateSize(), 180);
      } else {
        $('#view-telemetry').classList.remove('show');
        $('#view-charts').classList.add('show');
        setTimeout(resizeCharts, 180);
      }
    }));

    // Source toggle
    const ttgoWrap = $('#ttgo-url-wrap');
    const rSearch = $('#radiosondy-search');
    $$('#src-ttgo, #src-radiosondy').forEach(r=>r.addEventListener('change',()=>{
      state.source = $('#src-ttgo').checked ? 'ttgo':'radiosondy';
      ttgoWrap.classList.toggle('hidden', state.source!=='ttgo');
      rSearch.classList.toggle('hidden', state.source!=='radiosondy');
      restartFetching();
    }));

    // Search
    $('#btn-search').addEventListener('click',()=>{
      state.filterId = ($('#sonde-id').value||'').trim();
      restartFetching();
    });
    $('#btn-show-all').addEventListener('click',()=>{
      state.filterId = '';
      $('#sonde-id').value='';
      restartFetching();
    });

    // Charts fullscreen toggles
    $$('.fullscreen-toggle').forEach(btn=>{
      btn.addEventListener('click',()=>{
        const card = btn.closest('.card');
        card.classList.toggle('fullscreen');
        setTimeout(resizeCharts, 80);
      });
    });
  }

  // ======= Fetch scheduling =======
  function restartFetching(){
    if(state.fetchTimer){ clearInterval(state.fetchTimer); state.fetchTimer=null; }
    fetchOnce();
    state.fetchTimer = setInterval(fetchOnce, 5000);
  }

  async function fetchOnce(){
    if(state.source==='radiosondy'){
      await fetchRadiosondy();
    } else {
      await fetchTTGO();
    }
    render();
  }

  // ======= TTGO =======
  async function fetchTTGO(){
    const url = ($('#ttgo-url').value||'').trim() || 'http://192.168.0.50/sondes.json';
    if(location.protocol==='https:' && url.startsWith('http:')){
      $('#status-line').textContent = 'HTTPS strony + HTTP TTGO = mixed content (uruchom lokalnie po HTTP / użyj tunelu HTTPS).';
      return;
    }
    try{
      const ctrl = new AbortController();
      const t = setTimeout(()=>ctrl.abort(), 30000);
      const res = await fetch(url,{ signal: ctrl.signal });
      clearTimeout(t);
      if(!res.ok) throw new Error('HTTP '+res.status);
      const data = await res.json();
      // TODO: map TTGO JSON into sonde model when exact spec is known
      $('#status-line').textContent = 'TTGO: odebrano dane ('+(Array.isArray(data)?data.length:1)+')';
    } catch(e){
      $('#status-line').textContent = 'TTGO: błąd pobierania: '+e.message;
    }
  }

  // ======= radiosondy.info via proxy =======
  async function fetchRadiosondy(){
    const q = state.filterId ? `/api/radiosondy?mode=single&id=${encodeURIComponent(state.filterId)}` : '/api/radiosondy?mode=all';
    let lastErr = null;
    for(let attempt=1; attempt<=3; attempt++){
      try{
        const ctrl = new AbortController();
        const t = setTimeout(()=>ctrl.abort(), 30000);
        const res = await fetch(q,{ signal: ctrl.signal, cache:'no-store' });
        clearTimeout(t);
        if(!res.ok) throw new Error('HTTP '+res.status);
        const csv = await res.text();
        parseAndMergeCSV(csv);
        $('#status-line').textContent = `radiosondy.info: OK (attempt ${attempt})`;
        return;
      }catch(err){
        lastErr = err;
        await new Promise(r=>setTimeout(r, 1200*attempt));
      }
    }
    $('#status-line').textContent = `Błąd pobierania danych. ${String(lastErr&&lastErr.name==='AbortError' ? '(Przekroczony czas odpowiedzi radiosondy.info)' : lastErr)}`;
  }

  // ======= CSV Parsing & Normalization =======
  function parseAndMergeCSV(csv){
    if(!csv) return;
    const lines = csv.split(/\r?\n/).filter(l=>l.trim().length);
    if(lines.length<2) return;
    const sep = lines[0].includes(';')?';':','; // header check

    const headers = lines[0].split(sep).map(h=>h.trim().toLowerCase());

    function colIdx(names){
      for(const name of names){
        const i = headers.findIndex(h=>h===name.toLowerCase());
        if(i!==-1) return i;
      }
      // contains fallback
      for(const name of names){
        const i = headers.findIndex(h=>h.includes(name.toLowerCase()));
        if(i!==-1) return i;
      }
      return -1;
    }

    const idx = {
      id: colIdx(['sonde','id','serial']),
      type: colIdx(['type','model']),
      lat: colIdx(['latitude','lat']),
      lon: colIdx(['longitude','lon','lng']),
      alt: colIdx(['altitude','alt']),
      temp: colIdx(['temp','temperature']),
      pressure: colIdx(['pres','pressure','p']),
      humidity: colIdx(['humi','rh']),
      windSpeed: colIdx(['speed','ws']),
      windDir: colIdx(['course','wd']),
      rssi: colIdx(['rssi']),
      time: colIdx(['datetime','time','timestamp'])
    };

    const cutoff = Date.now() - VISIBILITY_WINDOW_SEC*1000; // keep only last hour globally

    for(let li=1; li<lines.length; li++){
      const row = lines[li].split(sep);
      const rec = (i)=>{ const v=row[i]; return v==null? '': String(v).trim(); };

      const tRaw = rec(idx.time);
      let tms = null;
      if(/^[0-9]+$/.test(tRaw)) tms = parseInt(tRaw,10)* (tRaw.length<11?1000:1);
      else tms = Date.parse(tRaw);
      if(!Number.isFinite(tms) || tms<cutoff) continue;

      const lat = parseFloat(rec(idx.lat));
      const lon = parseFloat(rec(idx.lon));
      if(!Number.isFinite(lat)||!Number.isFinite(lon)) continue;

      const id = rec(idx.id) || 'UNKNOWN';
      if(state.filterId && !id.toLowerCase().includes(state.filterId.toLowerCase())) continue;

      const s = getOrCreateSonde(id);
      const point = {
        time: new Date(tms),
        lat, lon,
        alt: toNum(rec(idx.alt)),
        temp: toNum(rec(idx.temp)),
        pressure: toNum(rec(idx.pressure)),
        humidity: toNum(rec(idx.humidity))
      };

      mergePoint(s, point, {
        type: rec(idx.type),
        windSpeed: toNum(rec(idx.windSpeed)),
        windDir: toNum(rec(idx.windDir)),
        rssi: toNum(rec(idx.rssi))
      });
    }

    // cleanup expired (1h after finished)
    const now = Date.now();
    for(const [id,s] of state.sondes){
      const ageSec = (now - s.time)/1000;
      if(s.status==='finished' && ageSec>VISIBILITY_WINDOW_SEC){
        removeSonde(id);
      }
    }
  }

  function toNum(v){
    const n = parseFloat(v); return Number.isFinite(n)? n : null;
  }

  function getOrCreateSonde(id){
    if(!state.sondes.has(id)){
      state.sondes.set(id, {
        id,
        type:null, lat:null, lon:null, alt:null,
        temp:null, pressure:null, humidity:null,
        windSpeed:null, windDir:null, rssi:null,
        time:null,
        dewPoint:null, horizontalSpeed:null, horizontalCourse:null,
        verticalSpeed:null, speed3d:null, distanceToRx:null,
        theta:null, lclHeight:null, zeroIsoHeight:null,
        ageSec: null, status:'active',
        history:[], marker:null, polyline: null
      });
    }
    return state.sondes.get(id);
  }

  function mergePoint(s, p, extra){
    s.type = extra.type || s.type;
    // push to history if newer
    if(!s.time || p.time > s.time){
      s.history.push({ time:p.time, lat:p.lat, lon:p.lon, alt:p.alt, temp:p.temp, pressure:p.pressure, humidity:p.humidity });
      if(s.history.length>HISTORY_LIMIT) s.history.splice(0, s.history.length-HISTORY_LIMIT);
    }
    Object.assign(s, p, { windSpeed: extra.windSpeed, windDir: extra.windDir, rssi: extra.rssi });

    // status
    const age = (Date.now()-s.time)/1000; s.ageSec = age;
    if(age>ACTIVE_TIMEOUT_SEC){ s.status = 'finished'; } else { s.status='active'; }

    // derived
    s.dewPoint = dewPoint(s.temp, s.humidity);
    s.theta = thetaK(s.temp, s.pressure);
    s.lclHeight = lclHeight(s.temp, s.dewPoint);
    s.zeroIsoHeight = zeroIsoHeight(s.history);
    s.distanceToRx = Number.isFinite(s.lat)&&Number.isFinite(s.lon) ? haversine(RX.lat,RX.lon,s.lat,s.lon) : null;

    const n = s.history.length;
    if(n>=2){
      const a = s.history[n-2], b = s.history[n-1];
      const dt = Math.max(0.5, Math.min(600, (b.time - a.time)/1000));
      const dH = haversine(a.lat,a.lon,b.lat,b.lon);
      s.horizontalSpeed = dH/dt;
      s.verticalSpeed = (Number.isFinite(a.alt)&&Number.isFinite(b.alt))? (b.alt-a.alt)/dt : null;
      s.speed3d = (Number.isFinite(s.verticalSpeed)&&Number.isFinite(s.horizontalSpeed)) ? Math.sqrt(dH*dH + (b.alt-a.alt)**2)/dt : null;
      s.horizontalCourse = bearing(a.lat,a.lon,b.lat,b.lon);
    }

    // map visuals
    ensureMapObjects(s);
  }

  function ensureMapObjects(s){
    if(!state.map) return;
    if(!s.marker){
      s.marker = L.circleMarker([s.lat,s.lon],{ radius:6, color:'#3dd4ff', fillColor:'#3dd4ff', fillOpacity:0.9 });
      s.marker.on('click',()=>{ setActiveSonde(s.id, true); });
      s.marker.addTo(state.map);
    } else {
      s.marker.setLatLng([s.lat,s.lon]);
    }
    if(!s.polyline){
      s.polyline = L.polyline(s.history.map(h=>[h.lat,h.lon]),{ color:'rgba(61,212,255,0.45)', weight:2 });
      s.polyline.addTo(state.map);
    } else {
      s.polyline.setLatLngs(s.history.map(h=>[h.lat,h.lon]));
    }
  }

  function removeSonde(id){
    const s = state.sondes.get(id);
    if(!s) return;
    if(s.marker){ s.marker.remove(); }
    if(s.polyline){ s.polyline.remove(); }
    state.sondes.delete(id);
    if(state.activeId===id) state.activeId=null;
  }

  // ======= Rendering =======
  function render(){
    renderTabs();
    renderPanel();
    renderCharts();
  }

  function renderTabs(){
    const wrap = $('#sonde-tabs');
    wrap.innerHTML = '';
    const list = [...state.sondes.values()].filter(s=>s.status!=='expired');
    list.sort((a,b)=> (b.time||0)-(a.time||0));
    for(const s of list){
      const btn = document.createElement('button');
      btn.className = 'sonde-tab'+(s.id===state.activeId?' active':'');
      btn.textContent = s.id;
      btn.addEventListener('click',()=> setActiveSonde(s.id, true));
      wrap.appendChild(btn);
    }

    // auto-select first if none
    if(!state.activeId && list.length) setActiveSonde(list[0].id, false);
  }

  function setActiveSonde(id, center){
    state.activeId = id;
    renderTabs();
    renderPanel();
    if(center){
      const s = state.sondes.get(id);
      if(s && Number.isFinite(s.lat) && Number.isFinite(s.lon)){
        state.map.setView([s.lat,s.lon], Math.max(10, state.map.getZoom()));
      }
    }
  }

  function renderPanel(){
    const s = state.sondes.get(state.activeId);
    const panel = $('#sonde-panel');
    if(!s){ panel.innerHTML=''; return; }
    const t = translations[state.lang] || translations.pl;
    const timeStr = s.time ? new Date(s.time).toLocaleString() : '—';
    const statusStr = s.status==='active' ? t.status_active : t.status_ended;

    const items = [
      {label:'Wysokość [m]', value:fmt(s.alt,0)},
      {label:'Temperatura [°C]', value:fmt(s.temp,1)},
      {label:'Punkt rosy [°C]', value:fmt(s.dewPoint,1)},
      {label:'Ciśnienie [hPa]', value:fmt(s.pressure,1)},
      {label:'Wilgotność [%]', value:fmt(s.humidity,0)},
      {label:'Prędkość pionowa [m/s]', value:fmt(s.verticalSpeed,1)},
      {label:'Prędkość pozioma [m/s]', value:fmt(s.horizontalSpeed,1)},
      {label:'Kurs [°]', value:fmt(s.horizontalCourse,0)},
      {label:'Odległość od RX [m]', value:fmt(s.distanceToRx,0)},
      {label:'0 °C izoterma [m]', value:fmt(s.zeroIsoHeight,0)},
      {label:'LCL [m]', value:fmt(s.lclHeight,0)},
      {label:'θ [K]', value:fmt(s.theta,1)}
    ];

    panel.innerHTML = `
      <div class="card" style="grid-column:1/-1">
        <div class="label">${s.type||''}</div>
        <div class="value" style="font-weight:700;font-size:20px">${s.id}</div>
        <div class="sub">${timeStr} — ${statusStr}</div>
      </div>
      ${items.map(i=>`<div class="card"><div class="label">${i.label}</div><div class="value">${i.value}</div></div>`).join('')}
    `;

    // highlight active tab
    $$('.sonde-tab').forEach(el=>{
      el.classList.toggle('active', el.textContent===s.id);
    });
  }

  // ======= Charts =======
  function ensureChart(id){
    if(state.charts[id]) return state.charts[id];
    const ctx = document.getElementById(id);
    const chart = new Chart(ctx,{
      type:'scatter',
      data:{ datasets:[{ data:[], pointBackgroundColor:'rgba(61,212,255,.95)', pointBorderColor:'rgba(61,212,255,1)', pointRadius:2 }]},
      options:{
        responsive:true, maintainAspectRatio:false,
        scales:{
          x: { grid: { color:'rgba(134,144,176,.35)' }, ticks:{ color:'#e6ebff' } },
          y: { grid: { color:'rgba(134,144,176,.35)' }, ticks:{ color:'#e6ebff' } }
        },
        plugins:{ legend:{ display:false } }
      }
    });
    state.charts[id]=chart; return chart;
  }
  function resizeCharts(){ Object.values(state.charts).forEach(c=>c.resize()); }

  function renderCharts(){
    const s = state.sondes.get(state.activeId);
    const hist = s ? s.history.filter(h=>Number.isFinite(h.alt)) : [];
    function buildXY(getX){
      return hist.filter(h=>Number.isFinite(getX(h))).map(h=>({ x:getX(h), y:h.alt }));
    }
    const Td = h=> dewPoint(h.temp, h.humidity);
    const dist = h=> Number.isFinite(h.lat)&&Number.isFinite(h.lon) ? haversine(RX.lat,RX.lon,h.lat,h.lon) : null;

    const conf = [
      ['chart-temp', h=>h.temp],
      ['chart-pres', h=>h.pressure],
      ['chart-rh', h=>h.humidity],
      ['chart-td', h=>Td(h)],
      ['chart-ws', h=>s&&Number.isFinite(s.windSpeed)? s.windSpeed : null],
      ['chart-dr', h=>dist(h)]
    ];

    for(const [id,getX] of conf){
      const chart = ensureChart(id);
      chart.data.datasets[0].data = buildXY(getX);
      chart.update('none');
    }
  }

  // ======= Boot =======
  window.addEventListener('DOMContentLoaded', () => {
    initLogin();
    initMap();
    initUI();
    restartFetching();
  });
})();
