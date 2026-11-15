/* EarthLens: un único estado geográfico y temporal para todo el mapa. */
'use strict';
document.addEventListener('DOMContentLoaded', async () => {
  const $=id=>document.getElementById(id);
  const params=new URLSearchParams(location.search), Time=window.EarthLensTimeAxis;
  const state={
    city_id:params.get('city_id')||document.body.dataset.city||'comodoro-rivadavia',
    variable:params.get('variable')||'T2M',provider:params.get('provider')||'power',
    date:params.get('date')||Time.iso(Date.now()),scale:params.get('scale')||'daily',
    start:params.get('start')||'2000-01-01',end:params.get('end')||'2024-12-31',
    mode:params.get('mode')||'date',panel:document.body.dataset.panel||null,selected:[]
  };
  let cities=[],catalog=[],record=null,frame=null,comparisonRecords=[],chart=null,radial=null,versionChart=null;
  let activeHistoryId=null,activeEventId=null,controller=null,seq=0,timer=null,loadTimer=null;
  let calendarDate=new Date(Time.parse(state.date)),user=null,csrf=null,events=[],notificationRows=[];
  let incidents=[],allIncidents=[],drawing=false,vertices=[],polygon=null,view=Time.view(state.date,state.scale);
  const pointLayers=new Map(),pointFrames=new Map(),cache=new Map();
  const map=L.map('map',{zoomControl:true}).setView([-45.88,-67.52],8);
  const markers=L.layerGroup().addTo(map),eventMarkers=L.layerGroup().addTo(map),incidentMarkers=L.layerGroup().addTo(map);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
    maxZoom:18,attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);
  const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const number=v=>v==null?'—':new Intl.NumberFormat('es-AR',{maximumFractionDigits:2}).format(v);
  const variableNames={T2M:'Temperatura',T2M_MAX:'Temperatura máxima',T2M_MIN:'Temperatura mínima',
    PRECTOTCORR:'Precipitación',RH2M:'Humedad relativa',WS2M:'Viento',
    temperature_2m:'Temperatura',relative_humidity_2m:'Humedad relativa',precipitation:'Precipitación',
    precipitation_probability:'Probabilidad de lluvia',wind_speed_10m:'Viento',wind_gusts_10m:'Ráfagas',
    cloud_cover:'Nubosidad',apparent_temperature:'Sensación térmica',visibility:'Visibilidad',wind_direction_10m:'Dirección del viento'};
  const labels={forecast:'PRONÓSTICO',historical_gridded_product:'HISTÓRICO',reanalysis:'HISTÓRICO · REANÁLISIS',
    climatology_reference:'CLIMATOLOGÍA',unavailable:'SIN DATOS'};

  function notice(message,error=false){$('notice').textContent=message;$('notice').title=message;$('notice').classList.toggle('error',error);}
  async function api(path,options={}){
    const response=await fetch(path,{credentials:'same-origin',...options,
      headers:{'Content-Type':'application/json',...(csrf?{'X-CSRF-Token':csrf}:{}),...(options.headers||{})}});
    const body=await response.json();
    if(!response.ok){const error=new Error(body.error?.message||'Solicitud no disponible');error.code=body.error?.code;throw error;}
    return body.data;
  }
  function safe(fn){return async(...args)=>{try{await fn(...args);}catch(error){if(error.name!=='AbortError')notice(error.message,true);}};}
  function queryContext(){
    const query=new URLSearchParams({city_id:state.city_id,variable:state.variable,provider:state.provider,
      date:state.date,scale:state.scale,start:state.start,end:state.end,mode:state.mode});
    history.replaceState(null,'','?'+query);
    document.body.dataset.date=state.date;document.body.dataset.city=state.city_id;
    document.body.dataset.variable=state.variable;
  }
  function panel(name){
    if(!name){$('inspector').hidden=true;state.panel=null;return;}
    state.panel=name;$('inspector').hidden=false;
    const titles={data:'Datos de la selección',profile:'Perfil de ciudad',calendar:'Calendario',
      events:'Mi espacio · eventos privados',notifications:'Notificaciones',impact:'Impactos y evidencia'};
    $('drawer-title').textContent=titles[name]||'Información';
    document.querySelectorAll('.panel').forEach(p=>p.hidden=p.id!=='panel-'+name);
    document.querySelectorAll('button[data-panel]').forEach(b=>b.classList.toggle('active',b.dataset.panel===name));
    if(name==='profile')safe(profile)();
    if(name==='calendar')calendar();
    if(name==='events'||name==='notifications')safe(loadAccount)();
    if(name==='impact')safe(impact)();
    requestAnimationFrame(()=>{chart?.resize();radial?.resize();versionChart?.resize();});
  }
  document.querySelectorAll('button[data-panel]').forEach(b=>b.onclick=()=>panel(b.dataset.panel));
  $('close-inspector').onclick=()=>panel(null);
  function tools(open){$('tools').hidden=!open;$('toggle-tools').setAttribute('aria-expanded',String(open));}
  $('toggle-tools').onclick=()=>tools($('tools').hidden);
  $('close-tools').onclick=()=>tools(false);
  document.addEventListener('keydown',event=>{if(event.key==='Escape'){panel(null);tools(false);}});

  function selectedCities(){
    const city=cities.find(c=>c.id===state.city_id);if(!city)return [];
    const type=$('territory').value;
    if(type==='province')return cities.filter(c=>c.province===city.province);
    if(type==='region')return cities.filter(c=>c.region===city.region);
    if(type==='multi'||type==='polygon')return cities.filter(c=>state.selected.includes(c.id));
    return [city];
  }
  function renderMap(){
    markers.clearLayers();pointLayers.clear();
    const selected=new Set(selectedCities().map(c=>c.id));
    for(const city of cities){
      const row=pointFrames.get(city.id),value=row?.focus?.value;
      const active=city.id===state.city_id;
      let marker;
      if(selected.has(city.id)&&row){
        marker=L.marker([city.latitude,city.longitude],{zIndexOffset:active?1000:10,
          icon:L.divIcon({className:'observation-marker',iconSize:[76,34],iconAnchor:[38,17],
            html:`<span class="point-value ${escape(row.kind)}${active?' selected':''}">${number(value)}${value!=null?' '+escape(row.focus.unit):''}</span>`})});
      }else marker=L.circleMarker([city.latitude,city.longitude],{radius:active?7:4,color:selected.has(city.id)?'#7ef0d5':'#a1aeb5',
        fillColor:selected.has(city.id)?'#256b60':'#718591',fillOpacity:.8,weight:active?2:1});
      marker.bindTooltip(escape(city.name)+(row?' · '+escape(labels[row.kind]||row.kind):' · ubicación GeoRef, sin consulta para esta fecha'));
      marker.on('click',()=>{
        if($('territory').value==='multi'){
          state.selected=state.selected.includes(city.id)?state.selected.filter(id=>id!==city.id):[...state.selected,city.id];
          state.mode='compare';$('mode').value='compare';renderMap();safe(load)();panel('data');
        }else{selectCity(city.id);panel('data');}
      });
      marker.addTo(markers);pointLayers.set(city.id,marker);
    }
    $('selection-label').textContent=selected.size+' ubicación(es) seleccionada(s) · puntos consultados, sin interpolación';
  }
  function selectCity(id,{fetchData=true}={}){
    const city=cities.find(c=>c.id===id);if(!city)return;
    state.city_id=id;$('city').value=id;$('search').value=city.name;
    $('location-name').textContent=city.name+' · '+city.province;
    $('event-city').textContent='Ubicación: '+city.name+' · centroide GeoRef, no sitio exacto.';
    map.flyTo([city.latitude,city.longitude],Math.max(map.getZoom(),7),{duration:.35});
    incidents=allIncidents.filter(i=>i.city_id===id);renderIncidents();renderMap();queryContext();
    if(fetchData)scheduleLoad(0);
    if(state.panel==='profile')safe(profile)();
  }
  function variables(){
    const previous=state.variable;
    let choices=catalog.filter(r=>r.provider===state.provider);
    if(['power','power-daily','forecast','era5'].includes(state.provider)){
      choices=catalog.filter(r=>r.provider==='power');
      choices.push(...['precipitation_probability','wind_gusts_10m','cloud_cover','apparent_temperature','visibility','wind_direction_10m'].map(variable=>({variable,name:variableNames[variable]})));
      if(!choices.some(r=>r.variable===previous)&&variableNames[previous])choices.push({variable:previous,name:variableNames[previous]});
    }
    choices=choices.filter((r,i,a)=>a.findIndex(x=>x.variable===r.variable)===i);
    $('variable').innerHTML=choices.map(r=>`<option value="${escape(r.variable)}">${escape(variableNames[r.variable]||r.name||r.variable)}</option>`).join('');
    state.variable=choices.some(r=>r.variable===previous)?previous:choices[0]?.variable;
    $('variable').value=state.variable||'';
  }

  function updateAxis(){
    const percent=Time.position(state.date,view);$('scrubber').value=Math.round(Math.max(0,Math.min(1,percent))*10000);
    $('date').value=state.date.length===10?state.date+'T12:00':state.date.slice(0,16);
    $('time-current').textContent=new Date(Time.parse(state.date)).toLocaleString('es-AR',{timeZone:'UTC',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
    $('time-start').textContent=new Date(view.start).toISOString().slice(0,10);
    $('time-end').textContent=new Date(view.end).toISOString().slice(0,10);
    const now=(Date.now()-view.start)/(view.end-view.start),split=Math.max(0,Math.min(1,now));
    $('axis-past').style.width=split*100+'%';$('axis-future').style.width=(1-split)*100+'%';
    $('axis-now').hidden=now<0||now>1;$('axis-now').style.left=split*100+'%';
    const formatter=new Intl.DateTimeFormat('es-AR',view.end-view.start>730*864e5?{year:'numeric',timeZone:'UTC'}:
      view.end-view.start>60*864e5?{month:'short',year:'2-digit',timeZone:'UTC'}:{day:'numeric',month:'short',timeZone:'UTC'});
    $('axis-ticks').innerHTML=Array.from({length:7},(_,i)=>'<span>'+escape(formatter.format(view.start+(view.end-view.start)*i/6))+'</span>').join('');
    renderTimelineMarkers();
  }
  function updateTime(value,options={}){
    if(value)state.date=Time.iso(Time.parse(value));
    const position=Time.position(state.date,view);
    if(options.center||position<0||position>1)view=Time.view(state.date,state.scale);
    calendarDate=new Date(Time.parse(state.date));updateAxis();calendar();queryContext();
    if(options.fetch!==false)scheduleLoad(options.delay??0);
  }
  function scheduleLoad(delay=100){
    clearTimeout(loadTimer);controller?.abort();seq++;
    $('map-value').textContent='Consultando '+(variableNames[state.variable]||state.variable)+'…';
    loadTimer=setTimeout(()=>safe(load)(),delay);
  }
  function activeValue(){
    const value=frame?.focus?.value,unit=frame?.focus?.unit||'';
    $('value').textContent=number(value);$('value-unit').textContent=unit;
    $('map-value').textContent=number(value)+(value!=null?' '+unit:' · sin dato para esta fecha');
    const kind=frame?.kind||'unavailable';$('time-kind').className='kind-label '+kind;
    $('time-kind').textContent=labels[kind]||kind;
    $('data-kind').textContent=labels[kind]||kind;$('data-title').textContent=variableNames[state.variable]||state.variable;
    if(kind==='climatology_reference')$('map-value').textContent=number(value)+' '+unit+' · referencia mensual';
  }
  function plot(rows){
    if(chart)chart.destroy();chart=null;
    const available=rows.filter(row=>row.series?.length);if(!available.length)return;
    const datasets=available.map((row,index)=>({
      label:(row.location?.name||state.city_id)+' · '+row.unit,
      data:row.series.map(p=>({x:Time.parse(p.date),y:p.value})),
      borderColor:index?'#e3b879':row.kind==='forecast'?'#c4a3ff':'#63d2b8',
      borderDash:row.kind==='forecast'?[6,4]:[],pointRadius:row.series.length>100?0:2,spanGaps:false,tension:0
    }));
    const positions=datasets.flatMap(d=>d.data.map(p=>p.x)),min=Math.min(...positions),max=Math.max(...positions);
    chart=new Chart($('chart'),{type:'line',data:{datasets},plugins:[{id:'temporalCursor',afterDatasetsDraw(chart){
      const pixel=chart.scales.x.getPixelForValue(Time.parse(state.date));
      if(pixel<chart.chartArea.left||pixel>chart.chartArea.right)return;
      const context=chart.ctx;context.save();context.strokeStyle='#f0ce91';context.setLineDash([3,3]);context.beginPath();
      context.moveTo(pixel,chart.chartArea.top);context.lineTo(pixel,chart.chartArea.bottom);context.stroke();context.restore();
    }}],options:{responsive:true,maintainAspectRatio:false,animation:false,parsing:false,
      scales:{x:{type:'linear',min,max:max===min?max+36e5:max,ticks:{maxTicksLimit:4,callback:v=>new Date(v).toISOString().slice(0,record?.frequency==='hourly'?16:10)}},y:{ticks:{color:'#9bb1bd'}}},
      plugins:{legend:{labels:{color:'#9bb1bd',font:{size:10}}},tooltip:{callbacks:{title:items=>new Date(items[0].parsed.x).toISOString()}}}}});
  }
  async function obtain(id,signal){
    const selection={city_id:id,date:state.date,variable:state.variable,provider:state.provider,scale:state.scale,start:state.start,end:state.end,mode:state.mode};
    return api('/api/workspace/frame?'+new URLSearchParams(selection),{signal});
  }
  async function load(){
    clearTimeout(loadTimer);controller?.abort();controller=new AbortController();const signal=controller.signal,ticket=++seq;
    record=null;frame=null;comparisonRecords=[];pointFrames.clear();
    activeValue();renderMap();$('provenance').innerHTML='';$('comparison').innerHTML='';$('limits').textContent='';
    if(chart){chart.destroy();chart=null;}notice('Consultando ubicación y fecha…');
    try{
      const result=await obtain(state.city_id,signal);if(ticket!==seq)return;
      frame=result;record=result.record;pointFrames.set(state.city_id,result);
      const rows=record?[record]:[],coverage=[];
      if(state.mode==='compare'){
        const selected=selectedCities().filter(c=>c.id!==state.city_id);
        for(const city of selected.slice(0,4)){
          try{
            const other=await obtain(city.id,signal);if(ticket!==seq)return;pointFrames.set(city.id,other);
            if(other.record&&record&&other.record.unit===record.unit&&other.record.product===record.product)rows.push(other.record);
            else coverage.push(city.name+': '+other.message);
          }catch(error){if(error.name==='AbortError')throw error;coverage.push(city.name+': '+error.message);}
        }
        if(selected.length>4)coverage.push('Gráfico limitado a cinco puntos; '+selectedCities().length+' ubicaciones seleccionadas. No se calcula una media regional.');
      }
      if(ticket!==seq)return;
      comparisonRecords=rows;activeValue();renderMap();plot(rows);queryContext();
      $('comparison').textContent=coverage.join(' ');
      const climate=result.climatology;
      const fields=record?[
        ['Fuente / producto',record.provider+' · '+record.product],['Frecuencia nativa',record.frequency],
        ['Resolución',JSON.stringify(record.spatial_resolution)],['Obtención UTC',record.fetched_at],
        ['Emisión',record.issued_at||'No informada por el endpoint; no se sustituye por la obtención'],
        ['Incertidumbre',record.uncertainty?.intervals?'Consultar intervalos del producto':'Sin intervalos provistos por esta fuente'],
        ['Muestra seleccionada',result.focus?.sample_date||'Sin muestra válida'],
        ['Cobertura de la extracción',record.series.length+' registros'],
        ['Acceso/licencia',record.license?.description||'Consultar procedencia del producto']
      ]:climate?[
        ['Fuente','NASA POWER · referencia mensual 2000–2024'],['Referencia',climate.count+' años para el mes '+climate.month],
        ['Unidad nativa',climate.unit],['Uso','Climatología mensual; no predice el tiempo del día seleccionado']
      ]:[];
      $('provenance').innerHTML=fields.map(([name,value])=>`<dt>${escape(name)}</dt><dd>${escape(value)}</dd>`).join('');
      $('limits').textContent=[result.message,...(record?.limitations||[])].join(' ');
      notice(result.message,result.status==='unavailable');
      if(state.mode==='trend'&&record?.product==='POWER_MONTHLY_AG'){
        try{
          const stats=await api('/api/workspace/trends?'+new URLSearchParams({city_id:state.city_id,variable:record.variable,start:state.start,end:state.end}),{signal});
          if(ticket!==seq)return;$('comparison').innerHTML='<p>Cambio por década: '+number(stats.statistics.change_per_decade)+' '+escape(record.unit)+'</p><p>p nominal: '+escape(stats.statistics.p_value)+'</p><p class="hint">Motor existente, provisional; sin ajuste de autocorrelación ni comparaciones múltiples. No demuestra causalidad.</p>';
        }catch(error){if(error.name==='AbortError')throw error;$('comparison').textContent=error.message;}
      }
      if(state.panel==='impact')await impact();
    }catch(error){
      if(ticket!==seq||error.name==='AbortError')return;
      frame={kind:'unavailable',focus:null,message:error.message};activeValue();pointFrames.set(state.city_id,frame);renderMap();
      notice(error.message,true);$('limits').textContent='El proveedor falló. No se presentan datos anteriores como actuales ni se inventa un pronóstico.';
    }
  }
  function range(){
    state.start=$('start').value;state.end=$('end').value;
    if(!state.start||!state.end||state.start>state.end){notice('Seleccioná un intervalo válido.',true);return;}
    state.mode='range';$('mode').value='range';
    const first=Time.parse(state.start),last=Time.parse(state.end)+864e5;
    view={start:first,end:last};state.date=Time.iso(first);$('range-controls').open=false;
    updateTime(state.date);panel('data');
  }
  function step(direction){updateTime(Time.move(state.date,state.scale,direction));}
  function stop(){clearInterval(timer);timer=null;$('play').textContent='▶';$('play').setAttribute('aria-label','Reproducir evolución temporal');}
  $('play').onclick=()=>{if(timer){stop();return;}$('play').textContent='Ⅱ';$('play').setAttribute('aria-label','Pausar evolución temporal');timer=setInterval(()=>step(+$('direction').value),+$('speed').value);};
  $('speed').onchange=()=>{if(timer){stop();$('play').click();}};
  $('step-back').onclick=()=>step(-1);$('step-next').onclick=()=>step(1);
  $('scrubber').oninput=()=>updateTime(Time.at($('scrubber').value,view,state.scale),{delay:140});
  $('scrubber').onchange=()=>scheduleLoad(0);
  $('date').onchange=()=>{stop();updateTime($('date').value,{center:true});};
  $('scale').onchange=()=>{state.scale=$('scale').value;view=Time.view(state.date,state.scale);updateTime();};
  $('zoom-in').onclick=()=>{view=Time.zoom(view,state.date,.5);updateAxis();};
  $('zoom-out').onclick=()=>{view=Time.zoom(view,state.date,2);updateAxis();};
  $('present').onclick=()=>{stop();state.mode='date';$('mode').value='date';state.scale='daily';$('scale').value='daily';updateTime(Time.iso(Date.now()),{center:true});};
  $('apply-range').onclick=range;
  $('city').onchange=()=>selectCity($('city').value);
  $('search').oninput=()=>{
    const query=$('search').value.trim().toLocaleLowerCase('es');
    const city=cities.find(c=>[c.name,c.name+', '+c.province,c.id].some(n=>n.toLocaleLowerCase('es')===query));
    if(city&&city.id!==state.city_id)selectCity(city.id);
  };
  $('source').onchange=()=>{state.provider=$('source').value;variables();scheduleLoad(0);};
  $('variable').onchange=()=>{state.variable=$('variable').value;queryContext();scheduleLoad(0);};
  $('mode').onchange=()=>{state.mode=$('mode').value;if(state.mode==='range')$('range-controls').open=true;safe(load)();panel('data');};
  $('advanced').onclick=event=>{event.preventDefault();state.mode='trend';$('mode').value='trend';state.scale='monthly';$('scale').value='monthly';updateTime(state.start,{center:true});panel('data');};
  $('incident-layer').onchange=()=>{$('incidents').hidden=!$('incident-layer').checked;renderEvents();};
  $('territory').onchange=()=>{
    state.selected=[state.city_id];const type=$('territory').value;
    $('territory-controls').textContent=type==='multi'?'Elegí ciudades en el mapa.':type==='polygon'?'Dibujá vértices y cerrá con doble clic.':'La provincia o región se selecciona a partir de la ciudad actual.';
    if(type==='province'||type==='region'){state.mode='compare';$('mode').value='compare';scheduleLoad(0);panel('data');}
    if(type==='polygon')$('draw').click();renderMap();
  };
  function inside(point,points){let yes=false;for(let i=0,j=points.length-1;i<points.length;j=i++){const a=points[i],b=points[j];if((a.lng>point.longitude)!==(b.lng>point.longitude)&&point.latitude<(b.lat-a.lat)*(point.longitude-a.lng)/(b.lng-a.lng)+a.lat)yes=!yes;}return yes;}
  $('draw').onclick=()=>{drawing=true;vertices=[];$('territory').value='polygon';map.doubleClickZoom.disable();notice('Marcá vértices; doble clic para cerrar. Se seleccionan centroides, no se valida territorio ni se promedian áreas.');};
  map.on('click',event=>{if(!drawing)return;vertices.push(event.latlng);if(polygon)map.removeLayer(polygon);polygon=L.polygon(vertices,{color:'#65d4bd',fillOpacity:.06}).addTo(map);});
  map.on('dblclick',()=>{if(!drawing||vertices.length<3)return;drawing=false;map.doubleClickZoom.enable();state.selected=cities.filter(c=>inside(c,vertices)).map(c=>c.id);state.mode='compare';$('mode').value='compare';renderMap();scheduleLoad(0);panel('data');});
  $('clear-draw').onclick=()=>{if(polygon)map.removeLayer(polygon);polygon=null;drawing=false;state.selected=[];renderMap();};

  function calendar(){
    const type=$('cal-view').value,first=new Date(calendarDate);
    first.setUTCDate(1);let count=type==='month'?new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate():type==='week'?7:1;
    if(type==='week')first.setUTCDate(calendarDate.getUTCDate()-((calendarDate.getUTCDay()+6)%7));
    if(type==='day')first.setUTCDate(calendarDate.getUTCDate());
    $('cal-title').textContent=calendarDate.toLocaleDateString('es-AR',{month:'long',year:'numeric',timeZone:'UTC'});
    $('calendar-jump').value=state.date.slice(0,10);$('calendar').classList.toggle('list',type==='list'||type==='day');
    if(type==='list'){
      $('calendar').innerHTML=events.filter(e=>e.status==='active').map(e=>`<button data-event="${e.id}">${escape(e.name)} · ${escape(e.start)}</button>`).join('')||'<p>Sin eventos guardados.</p>';
    }else{
      let html=type==='month'?['L','M','M','J','V','S','D'].map(d=>'<span class="hint">'+d+'</span>').join('')+'<span></span>'.repeat((first.getUTCDay()+6)%7):'';
      for(let i=0;i<count;i++){
        const day=new Date(first);day.setUTCDate(first.getUTCDate()+i);const iso=day.toISOString().slice(0,10);
        const associated=events.filter(e=>e.status==='active'&&e.start.slice(0,10)===iso);
        html+=`<button data-day="${iso}" class="${iso===state.date.slice(0,10)?'selected ':''}${associated.length?'has-event':''}">${day.getUTCDate()}${associated.map(e=>'<span class="day-caption">'+escape(e.name)+'</span>').join('')}</button>`;
      }
      $('calendar').innerHTML=html;
    }
    $('calendar').querySelectorAll('[data-day]').forEach(button=>button.onclick=()=>{
      updateTime(button.dataset.day,{center:true});
      const associated=events.find(e=>e.status==='active'&&e.start.slice(0,10)===button.dataset.day);
      if(associated)openEvent(associated.id);else prepareEvent();
    });
    $('calendar').querySelectorAll('[data-event]').forEach(button=>button.onclick=()=>openEvent(button.dataset.event));
  }
  $('cal-view').onchange=calendar;
  function moveCalendar(direction){const type=$('cal-view').value;if(type==='month'||type==='list'){calendarDate.setUTCDate(1);calendarDate.setUTCMonth(calendarDate.getUTCMonth()+direction);}else calendarDate.setUTCDate(calendarDate.getUTCDate()+direction*(type==='week'?7:1));calendar();}
  $('cal-prev').onclick=()=>moveCalendar(-1);$('cal-next').onclick=()=>moveCalendar(1);
  $('calendar-jump').onchange=()=>updateTime($('calendar-jump').value,{center:true});
  $('new-event').onclick=()=>{prepareEvent();panel('events');};
  function investigate(incident){
    state.variable=incident.related_variable;state.provider='power';$('source').value='power';state.scale='daily';$('scale').value='daily';
    variables();selectCity(incident.city_id,{fetchData:false});updateTime(incident.start,{center:true});panel('data');
  }
  function renderIncidents(){
    $('incidents').innerHTML=incidents.map(i=>`<article class="card"><strong>${escape(i.name)}</strong><p>${escape(i.start)} / ${escape(i.end)}</p><p>${escape(i.description)}</p><a href="${escape(i.sources[0].url)}" target="_blank" rel="noopener">Fuente documentada</a> <button data-incident="${i.id}">Investigar</button></article>`).join('')||'<p class="hint">Sin acontecimientos documentados en el catálogo actual.</p>';
    $('incidents').querySelectorAll('[data-incident]').forEach(button=>button.onclick=()=>investigate(incidents.find(i=>i.id===button.dataset.incident)));
    renderEvents();
  }
  function renderTimelineMarkers(){
    const rows=[...events.filter(e=>e.status==='active').map(e=>({id:e.id,date:e.start,name:e.name,event:true})),
      ...($('incident-layer').checked?allIncidents:[]).map(i=>({id:i.id,date:i.start,name:i.name,event:false}))];
    $('time-markers').innerHTML=rows.filter(r=>Time.position(r.date,view)>=0&&Time.position(r.date,view)<=1).map(r=>
      `<button style="left:${Time.position(r.date,view)*100}%" class="${r.event?'event-mark':''}" data-${r.event?'event':'incident'}="${r.id}" title="${escape(r.name+' · '+r.date)}" aria-label="${escape(r.name+' · '+r.date)}">⚑</button>`).join('');
    $('time-markers').querySelectorAll('[data-event]').forEach(button=>button.onclick=()=>openEvent(button.dataset.event));
    $('time-markers').querySelectorAll('[data-incident]').forEach(button=>button.onclick=()=>investigate(allIncidents.find(i=>i.id===button.dataset.incident)));
  }
  function renderEvents(){
    eventMarkers.clearLayers();incidentMarkers.clearLayers();
    for(const event of events.filter(e=>e.status==='active')){
      const city=cities.find(c=>c.id===event.city_id);if(!city)continue;
      L.marker([city.latitude,city.longitude]).bindTooltip(escape(event.name)+' · '+escape(event.start)).on('click',()=>openEvent(event.id)).addTo(eventMarkers);
    }
    if($('incident-layer').checked)for(const incident of allIncidents){
      const city=cities.find(c=>c.id===incident.city_id);if(!city)continue;
      L.circleMarker([city.latitude,city.longitude],{radius:13,color:'#ddb06c',fill:false,weight:2,dashArray:'4 4'})
        .bindTooltip(escape(incident.name)+' · centroide, no extensión del impacto').on('click',()=>investigate(incident)).addTo(incidentMarkers);
    }
    renderTimelineMarkers();calendar();
  }
  async function openEvent(id){
    const event=events.find(e=>e.id===id)||await api('/api/events/'+id);activeEventId=id;
    selectCity(event.city_id,{fetchData:false});state.scale='hourly';$('scale').value='hourly';updateTime(Time.iso(Time.parse(event.start)),{center:true});panel('events');
    // Reutiliza el mismo formulario CRUD, no una segunda página o calendario.
    const fields=$('event-form').elements;
    for(const key of ['id','name','description','activity','participants','transport','flexible_days','flexible_hours','location_label'])fields[key].value=event[key]??'';
    for(const key of ['start','end'])fields[key].value=event[key].slice(0,16);
    fields.outdoor.checked=event.outdoor;fields.notifications.checked=event.notifications;
    for(const key of ['min_temperature','max_temperature','max_probability','max_precipitation','max_wind','max_gust'])fields[key].value=event.preferences[key]??'';
    fields.require_official_alerts.checked=event.preferences.require_official_alerts!==false;
    $('event-form-title').textContent='Editar / reprogramar: '+event.name;
    $('event-details').hidden=false;$('event-details').innerHTML='<div class="event-details-head"><h2>'+escape(event.name)+'</h2><p>'+escape(event.city_id+' · '+event.start+' / '+event.end)+'</p><p class="hint">Centroide de ciudad; impacto espacial sin capas suficientes.</p></div>';
    await previewEvent();
  }
