/**
 * EarthLens — Controlador de Earth Time Machine (static/js/time_machine.js)
 * NASA Space Apps Challenge 2026 · Be An Earth System Trend Detective!
 *
 * Características:
 *  - Reproducción fluida 2000–2024 en memoria (cero peticiones al mover el slider).
 *  - Mapa Leaflet con dos modos:
 *      1) Slide-Zoom Zonal: Grilla satelital MERRA-2 3×3 (0.5° × 0.625°) coloreada por año.
 *      2) Red Nacional Argentina: 25 ciudades en 5 regiones sincronizadas por año.
 *  - Comparador dinámico de Épocas (Época A vs Época B) con prueba t de Welch en tiempo real.
 *  - Cinta de Climate Stripes interactiva, gráficos sincronizados y detector de anomalías (|z| >= 1.5).
 */

document.addEventListener('DOMContentLoaded', () => {
  let currentData = null;
  let activeYear = 2000;
  let isPlaying = false;
  let playTimer = null;
  let playSpeedMs = 800;
  let mapMode = 'zone'; // 'zone' | 'national'

  let activeAbortController = null;
  let requestSeq = 0;

  let mapInstance = null;
  let zoneLayerGroup = null;
  let nationalLayerGroup = null;
  let zoneCellRects = [];
  let nationalMarkers = [];
  let trendChartInstance = null;

  let state = {
    city_id: 'comodoro-rivadavia',
    latitude: -45.8806,
    longitude: -67.5195,
    locationName: 'Comodoro Rivadavia, Chubut',
    variable: 'T2M',
    start_year: 2000,
    end_year: 2024,
    split_year: 2012
  };

  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  /**
   * 1. Inicializa parámetros desde query string o sessionStorage
   */
  function initFromURL() {
    const params = new URLSearchParams(window.location.search);
    if (params.has('city_id')) {
      state.city_id = params.get('city_id');
    }
    if (params.has('latitude') || params.has('lat')) {
      const lat = parseFloat(params.get('latitude') || params.get('lat'));
      const lon = parseFloat(params.get('longitude') || params.get('lon'));
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        state.latitude = lat;
        state.longitude = lon;
      }
    }
    if (params.has('location') || params.has('label')) {
      state.locationName = params.get('location') || params.get('label');
    }
    if (params.has('variable')) {
      state.variable = String(params.get('variable')).toUpperCase();
    }
    if (params.has('start_year')) {
      const s = parseInt(params.get('start_year'), 10);
      if (Number.isInteger(s)) state.start_year = Math.max(1981, Math.min(2021, s));
    }
    if (params.has('end_year')) {
      const e = parseInt(params.get('end_year'), 10);
      if (Number.isInteger(e)) state.end_year = Math.max(state.start_year + 3, Math.min(2024, e));
    }
    if (params.has('year')) {
      const y = parseInt(params.get('year'), 10);
      if (Number.isInteger(y)) activeYear = y;
    }

    syncCitySelectWithCoords(state.latitude, state.longitude, state.locationName);
    const varSelect = document.getElementById('tmVariableSelect');
    const startInput = document.getElementById('tmStartYear');
    const endInput = document.getElementById('tmEndYear');
    if (varSelect && EarthLensCharts.VARIABLES_META[state.variable]) {
      varSelect.value = state.variable;
    }
    if (startInput) startInput.value = state.start_year;
    if (endInput) endInput.value = state.end_year;
  }

  function syncCitySelectWithCoords(lat, lon, locName) {
    const citySelect = document.getElementById('tmCitySelect');
    if (!citySelect) return;

    const options = Array.from(citySelect.querySelectorAll('option'));
    for (const opt of options) {
      if (opt.value === 'custom') continue;
      const oLat = parseFloat(opt.dataset.lat);
      const oLon = parseFloat(opt.dataset.lon);
      if (Math.abs(oLat - lat) < 0.25 && Math.abs(oLon - lon) < 0.25) {
        citySelect.value = opt.value;
        state.city_id = opt.value;
        state.locationName = opt.textContent;
        return;
      }
    }

    let customOpt = citySelect.querySelector('option[value="custom"]');
    if (!customOpt) {
      customOpt = document.createElement('option');
      customOpt.value = 'custom';
      citySelect.prepend(customOpt);
    }
    customOpt.dataset.lat = String(lat);
    customOpt.dataset.lon = String(lon);
    customOpt.textContent = `${locName || 'Zona personalizada'} (${Number(lat).toFixed(2)}°, ${Number(lon).toFixed(2)}°)`;
    citySelect.value = 'custom';
    state.city_id = null;
  }

  /**
   * 2. Inicializa el mapa Leaflet
   */
  function initLeafletMap() {
    const mapContainer = document.getElementById('timeMachineMap');
    if (!mapContainer || typeof L === 'undefined') return;

    mapInstance = L.map('timeMachineMap', {
      center: [state.latitude, state.longitude],
      zoom: 7,
      zoomControl: true
    });

    const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; OpenStreetMap contributors · NASA POWER MERRA-2'
    });

    const topoLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 17,
      attribution: 'Tiles &copy; Esri · NASA Earthdata'
    });

    osmLayer.addTo(mapInstance);
    L.control.layers({ 'Mapa Base (OSM)': osmLayer, 'Vista Satelital': topoLayer }).addTo(mapInstance);

    zoneLayerGroup = L.layerGroup().addTo(mapInstance);
    nationalLayerGroup = L.layerGroup();

    mapInstance.on('click', (ev) => {
      const clickedLat = Number(ev.latlng.lat.toFixed(4));
      const clickedLon = Number(ev.latlng.lng.toFixed(4));
      state.latitude = clickedLat;
      state.longitude = clickedLon;
      state.locationName = `Zona (${clickedLat.toFixed(2)}°, ${clickedLon.toFixed(2)}°)`;
      syncCitySelectWithCoords(clickedLat, clickedLon, state.locationName);
      loadTimeMachineData();
    });
  }

  /**
   * 3. Consulta POST /api/time-machine (una sola descarga para todo el período)
   */
  async function loadTimeMachineData() {
    if (activeAbortController) {
      activeAbortController.abort();
    }
    activeAbortController = new AbortController();
    const mySeq = ++requestSeq;

    const spinner = document.getElementById('tmLoadingSpinner');
    if (spinner) spinner.classList.remove('d-none');

    const payload = {
      city_id: state.city_id,
      latitude: state.latitude,
      longitude: state.longitude,
      location_name: state.locationName,
      variable: state.variable,
      start_year: state.start_year,
      end_year: state.end_year,
      split_year: state.split_year,
      include_regional: true
    };

    try {
      const res = await fetch('/api/time-machine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: activeAbortController.signal
      });
      if (res.ok) {
        const data = await res.json();
        if (mySeq !== requestSeq) return;
        if (spinner) spinner.classList.add('d-none');
        applyTimeMachinePayload(data);
        return;
      }
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      console.info('Usando generador local de respaldo para Earth Time Machine.');
    }

    if (mySeq !== requestSeq) return;
    if (spinner) spinner.classList.add('d-none');
    const fallbackData = buildClientFallbackPayload(payload);
    applyTimeMachinePayload(fallbackData);
  }

  /**
   * Respaldo local en caso de abrir el HTML sin servidor Python activo
   */
  function buildClientFallbackPayload(req) {
    const mockBase = EarthLensCharts.buildMockAnalysis({
      latitude: req.latitude,
      longitude: req.longitude,
      locationName: req.location_name,
      variable: req.variable,
      start_year: req.start_year,
      end_year: req.end_year
    });
    const varMeta = EarthLensCharts.VARIABLES_META[req.variable] || EarthLensCharts.VARIABLES_META.T2M;
    const anomBundle = EarthLensCharts.computeAnomalySeries(
      mockBase.series,
      req.variable,
      mockBase.statistics
    );
    const maxRec = [...anomBundle.timeline].sort((a, b) => b.value - a.value)[0];
    const minRec = [...anomBundle.timeline].sort((a, b) => a.value - b.value)[0];
    const midYr = Math.floor((req.start_year + req.end_year) / 2);

    return {
      is_mock: true,
      variable: req.variable,
      variable_name: varMeta.name,
      unit: mockBase.unit,
      display_unit: varMeta.unit,
      source: mockBase.source,
      location: {
        id: 'custom',
        name: req.location_name || 'Comodoro Rivadavia, Chubut',
        province: 'Patagonia',
        region: 'Patagonia',
        latitude: req.latitude,
        longitude: req.longitude
      },
      period: {
        start_year: req.start_year,
        end_year: req.end_year,
        split_year: midYr,
        n_years: anomBundle.timeline.length
      },
      statistics: {
        ...mockBase.statistics,
        mean: anomBundle.mean,
        std_dev: anomBundle.stdDev
      },
      timeline: anomBundle.timeline,
      anomalies: {
        threshold_z: 1.5,
        count: anomBundle.events.length,
        max_record: maxRec,
        min_record: minRec,
        events: anomBundle.events.map((ev) => ({
          ...ev,
          badge: ev.z_score > 0 ? '🔥 Anomalía Positiva' : '❄️ Anomalía Negativa',
          description: `Año ${ev.year}: valor ${ev.value.toFixed(2)} ${varMeta.unit} (z = ${ev.z_score >= 0 ? '+' : ''}${ev.z_score.toFixed(2)}).`
        }))
      },
      period_comparison: computeClientPeriodComparison(anomBundle.timeline, midYr, varMeta.unit),
      spatial_zone: buildClientSpatialZone(req.latitude, req.longitude, req.variable, anomBundle.timeline),
      regional_cities: [],
      conclusion: mockBase.conclusion
    };
  }

  function buildClientSpatialZone(cLat, cLon, variable, timeline) {
    const latStep = 0.5;
    const lonStep = 0.625;
    const cells = [];
    for (let r = -1; r <= 1; r++) {
      for (let c = -1; c <= 1; c++) {
        const lat = Number((cLat + r * latStep).toFixed(4));
        const lon = Number((cLon + c * lonStep).toFixed(4));
        const by_year = {};
        timeline.forEach((pt) => {
          const z = Number((pt.z_score + r * 0.15 - c * 0.1).toFixed(2));
          by_year[String(pt.year)] = {
            value: Number((pt.value + r * 0.2).toFixed(2)),
            anomaly: Number((pt.anomaly + r * 0.15).toFixed(2)),
            z_score: z,
            color: EarthLensCharts.getVariableColor(variable, z)
          };
        });
        cells.push({
          cell_id: `r${r}_c${c}`,
          is_center: r === 0 && c === 0,
          label: r === 0 && c === 0 ? 'Celda Central MERRA-2' : `Sub-celda (${r}, ${c})`,
          latitude: lat,
          longitude: lon,
          bounds: [
            [lat - latStep / 2, lon - lonStep / 2],
            [lat + latStep / 2, lon + lonStep / 2]
          ],
          by_year
        });
      }
    }
    return {
      cell_resolution_deg: { lat: latStep, lon: lonStep },
      zone_bounds: [
        [cLat - 1.5 * latStep, cLon - 1.5 * lonStep],
        [cLat + 1.5 * latStep, cLon + 1.5 * lonStep]
      ],
      cells
    };
  }

  /**
   * 4. Aplica la respuesta completa y sincroniza toda la interfaz
   */
  function applyTimeMachinePayload(data) {
    if (!data || !Array.isArray(data.timeline) || data.timeline.length === 0) return;
    currentData = data;

    const minYr = data.timeline[0].year;
    const maxYr = data.timeline[data.timeline.length - 1].year;
    if (activeYear < minYr || activeYear > maxYr) {
      activeYear = maxYr;
    }

    const slider = document.getElementById('tmYearSlider');
    if (slider) {
      slider.min = minYr;
      slider.max = maxYr;
      slider.value = activeYear;
    }
    setText('tmSliderMinLabel', String(minYr));
    setText('tmSliderMaxLabel', String(maxYr));

    const splitSlider = document.getElementById('tmSplitYearSlider');
    const splitYr = data.period?.split_year || Math.floor((minYr + maxYr) / 2);
    state.split_year = splitYr;
    if (splitSlider) {
      splitSlider.min = minYr + 2;
      splitSlider.max = maxYr - 1;
      splitSlider.value = splitYr;
    }

    const unitDisp = data.display_unit || (data.unit === 'deg C' ? '°C' : data.unit);
    setText('tmTitleLocation', data.location?.name || state.locationName);
    setText('tmVariableBadge', `${data.variable_name} (${data.variable})`);
    setText('tmRegionBadge', `Región: ${data.location?.region || 'Argentina'}`);
    setText('tmPeriodBadge', `${minYr} – ${maxYr} (${data.timeline.length} años)`);
    setText(
      'tmCoordsText',
      `Lat: ${Number(data.location.latitude).toFixed(2)}° · Lon: ${Number(data.location.longitude).toFixed(2)}°`
    );

    updateColorScaleClass(data.variable);
    updateNavigationLinks(data);
    renderSliderTicksAndStripes(data.timeline);
    renderEpochComparisonUI(data.period_comparison, unitDisp);
    renderExtremeRecords(data.anomalies, unitDisp);
    renderAnomalyCards(data.anomalies, unitDisp);
    renderTimelineTable(data.timeline, unitDisp);

    rebuildMapLayers(data);
    setActiveYear(activeYear, { panMap: false });
  }

  function updateColorScaleClass(variable) {
    const bar = document.getElementById('tmColorScaleBar');
    if (!bar) return;
    bar.className = 'tm-color-scale-bar ';
    if (variable === 'PRECTOTCORR') bar.classList.add('tm-scale-precip');
    else if (variable === 'RH2M') bar.classList.add('tm-scale-humidity');
    else if (variable === 'WS2M') bar.classList.add('tm-scale-wind');
    else bar.classList.add('tm-scale-thermal');
  }

  function updateNavigationLinks(data) {
    const qRes = new URLSearchParams({
      latitude: data.location.latitude,
      longitude: data.location.longitude,
      location: data.location.name,
      variable: data.variable,
      start_year: data.period.start_year,
      end_year: data.period.end_year
    });
    const resLink = document.getElementById('tmLinkToResults');
    if (resLink) resLink.href = `/results?${qRes.toString()}`;

    const qCmp = new URLSearchParams({
      latA: data.location.latitude,
      lonA: data.location.longitude,
      nameA: data.location.name,
      variable: data.variable,
      start_year: data.period.start_year,
      end_year: data.period.end_year
    });
    const cmpLink = document.getElementById('tmLinkToCompare');
    if (cmpLink) cmpLink.href = `/compare?${qCmp.toString()}`;
  }

  /**
   * 5. Construye las capas del mapa Leaflet (Grilla Zonal 3×3 y Red de 25 Ciudades)
   */
  function rebuildMapLayers(data) {
    if (!mapInstance || !zoneLayerGroup || !nationalLayerGroup) return;

    zoneLayerGroup.clearLayers();
    nationalLayerGroup.clearLayers();
    zoneCellRects = [];
    nationalMarkers = [];

    const cells = data.spatial_zone?.cells || [];
    cells.forEach((cell) => {
      const rect = L.rectangle(cell.bounds, {
        color: cell.is_center ? '#ffffff' : 'rgba(255, 255, 255, 0.55)',
        weight: cell.is_center ? 2.5 : 1,
        fillColor: '#3b82f6',
        fillOpacity: cell.is_center ? 0.68 : 0.46
      });
      rect.bindTooltip('', { sticky: true });
      rect.addTo(zoneLayerGroup);
      zoneCellRects.push({ cell, rect });
    });

    // Marcador central de la ciudad/ubicación
    const centerMarker = L.circleMarker([data.location.latitude, data.location.longitude], {
      radius: 7,
      color: '#ffffff',
      weight: 2,
      fillColor: '#0b132b',
      fillOpacity: 1
    }).bindTooltip(`📍 ${data.location.name}`, { permanent: false, direction: 'top' });
    centerMarker.addTo(zoneLayerGroup);

    // Marcadores de las 25 ciudades argentinas (modo nacional)
    const cities = data.regional_cities || [];
    cities.forEach((city) => {
      const isSelectedCity =
        Math.abs(city.latitude - data.location.latitude) < 0.2 &&
        Math.abs(city.longitude - data.location.longitude) < 0.2;

      const marker = L.circleMarker([city.latitude, city.longitude], {
        radius: isSelectedCity ? 11 : 8,
        color: isSelectedCity ? '#ffffff' : '#0f172a',
        weight: isSelectedCity ? 2.5 : 1.5,
        fillColor: '#38bdf8',
        fillOpacity: 0.88
      });

      marker.on('click', () => {
        state.city_id = city.id;
        state.latitude = city.latitude;
        state.longitude = city.longitude;
        state.locationName = `${city.name}, ${city.province}`;
        syncCitySelectWithCoords(city.latitude, city.longitude, state.locationName);
        loadTimeMachineData();
      });

      marker.addTo(nationalLayerGroup);
      nationalMarkers.push({ city, marker, isSelectedCity });
    });

    applyMapModeView(true);
  }

  function applyMapModeView(shouldZoom = true) {
    if (!mapInstance || !currentData) return;

    if (mapMode === 'national') {
      if (mapInstance.hasLayer(zoneLayerGroup)) mapInstance.removeLayer(zoneLayerGroup);
      if (!mapInstance.hasLayer(nationalLayerGroup)) nationalLayerGroup.addTo(mapInstance);
      setText('tmMapTitle', 'Red Nacional Argentina · 25 Ciudades (GeoRef + NASA POWER)');
      setText('tmMapSubtitle', 'Cada ciudad cambia de color según su valor y anomalía en el año activo. Haz clic en una ciudad para enfocarte en ella.');
      setText('tmCellHudInfo', `Red Nacional: ${(currentData.regional_cities || []).length} ciudades activas`);
      if (shouldZoom) {
        mapInstance.flyTo([-38.5, -64.0], 4, { duration: 0.6 });
      }
    } else {
      if (mapInstance.hasLayer(nationalLayerGroup)) mapInstance.removeLayer(nationalLayerGroup);
      if (!mapInstance.hasLayer(zoneLayerGroup)) zoneLayerGroup.addTo(mapInstance);
      setText('tmMapTitle', `Mapa Zonal Slide-Zoom · Grilla MERRA-2 (${currentData.location.name})`);
      setText('tmMapSubtitle', 'Visualización de la celda central (0.5° × 0.625°) y su entorno 3×3 coloreado por anomalía anual.');
      setText('tmCellHudInfo', 'Grilla Zonal MERRA-2: 3×3 celdas (1.5° × 1.875°)');
      if (shouldZoom && currentData.spatial_zone?.zone_bounds) {
        mapInstance.flyToBounds(currentData.spatial_zone.zone_bounds, { padding: [24, 24], duration: 0.6 });
      }
    }
    updateMapColorsForYear(activeYear);
  }

  /**
   * 6. Actualiza en < 5 ms el mapa, los visores y los gráficos al cambiar de año
   */
  function setActiveYear(year, options = {}) {
    if (!currentData || !Array.isArray(currentData.timeline)) return;
    const yrNum = Number(year);
    const point = currentData.timeline.find((p) => p.year === yrNum) || currentData.timeline[0];
    if (!point) return;

    activeYear = point.year;
    const unitDisp = currentData.display_unit || '°C';

    const slider = document.getElementById('tmYearSlider');
    if (slider && Number(slider.value) !== activeYear) {
      slider.value = activeYear;
    }

    setText('tmActiveYearDisplay', String(activeYear));
    setText('tmActiveValue', `${point.value.toFixed(2)} ${unitDisp}`);

    const anomSign = point.anomaly >= 0 ? '+' : '';
    const anomEl = document.getElementById('tmActiveAnomaly');
    if (anomEl) {
      anomEl.textContent = `Δ ${anomSign}${point.anomaly.toFixed(2)} ${unitDisp} (z = ${point.z_score >= 0 ? '+' : ''}${point.z_score.toFixed(2)})`;
      anomEl.style.backgroundColor = point.color;
      anomEl.style.color = Math.abs(point.z_score) >= 1.2 ? '#ffffff' : '#0f172a';
    }

    const levelBadge = document.getElementById('tmActiveLevelBadge');
    if (levelBadge) {
      const levelLabels = {
        extreme_high: '🔥 Anomalía Extrema (+)',
        moderate_high: '⚠️ Anomalía Moderada (+)',
        mild_high: '↗ Ligeramente Superior',
        normal: '✓ Rango Normal',
        mild_low: '↘ Ligeramente Inferior',
        moderate_low: '⚠️ Anomalía Moderada (−)',
        extreme_low: '❄️ Anomalía Extrema (−)'
      };
      levelBadge.textContent = levelLabels[point.anomaly_level] || 'Normal';
      levelBadge.className = `badge rounded-pill ${
        point.is_anomaly ? 'bg-warning text-dark fw-bold' : 'bg-secondary text-white'
      }`;
    }

    setText(
      'tmActiveSubtext',
      `Recta OLS en ${activeYear}: ${point.trend_value.toFixed(2)} ${unitDisp} · Percentil: P${point.percentile}`
    );

    // Resaltar tick y stripe activos
    document.querySelectorAll('.tm-tick').forEach((el) => {
      el.classList.toggle('is-active', Number(el.dataset.year) === activeYear);
    });
    document.querySelectorAll('.tm-stripe-item').forEach((el) => {
      el.classList.toggle('is-active', Number(el.dataset.year) === activeYear);
    });
    document.querySelectorAll('.tm-anomaly-card').forEach((el) => {
      el.classList.toggle('is-selected', Number(el.dataset.year) === activeYear);
    });
    document.querySelectorAll('#tmTimelineTableBody tr').forEach((row) => {
      row.classList.toggle('table-primary', Number(row.dataset.year) === activeYear);
    });

    updateMapColorsForYear(activeYear);
    renderSynchronizedCharts(currentData, activeYear);
  }

  function updateMapColorsForYear(year) {
    if (!currentData) return;
    const yrKey = String(year);
    const unitDisp = currentData.display_unit || '°C';

    zoneCellRects.forEach(({ cell, rect }) => {
      const yrData = cell.by_year?.[yrKey];
      if (!yrData) return;
      rect.setStyle({
        fillColor: yrData.color,
        fillOpacity: cell.is_center ? 0.72 : 0.48
      });
      const sign = yrData.anomaly >= 0 ? '+' : '';
      rect.setTooltipContent(
        `<strong>${cell.label}</strong> (${year})<br>` +
          `Valor: <strong>${yrData.value.toFixed(2)} ${unitDisp}</strong><br>` +
          `Anomalía: ${sign}${yrData.anomaly.toFixed(2)} ${unitDisp} (z = ${yrData.z_score >= 0 ? '+' : ''}${yrData.z_score})`
      );
    });

    nationalMarkers.forEach(({ city, marker, isSelectedCity }) => {
      const yrData = city.by_year?.[yrKey];
      if (!yrData) return;
      marker.setStyle({
        fillColor: yrData.color,
        radius: isSelectedCity ? 12 : yrData.is_anomaly ? 10 : 7.5
      });
      const sign = yrData.anomaly >= 0 ? '+' : '';
      marker.bindTooltip(
        `<strong>${city.name}</strong> (${city.region}) · <strong>${year}</strong><br>` +
          `Valor: <strong>${yrData.value.toFixed(2)} ${unitDisp}</strong> | Δ: ${sign}${yrData.anomaly.toFixed(2)} ${unitDisp} (z = ${yrData.z_score >= 0 ? '+' : ''}${yrData.z_score})<br>` +
          `Tendencia 2000–2024: ${city.change_per_decade >= 0 ? '+' : ''}${city.change_per_decade.toFixed(3)} ${unitDisp}/década`,
        { direction: 'top' }
      );
    });
  }

  /**
   * 7. Renderiza las marcas del slider y la cinta interactiva de Climate Stripes
   */
  function renderSliderTicksAndStripes(timeline) {
    const ticksEl = document.getElementById('tmAnomalyTicks');
    const stripesEl = document.getElementById('tmClimateStripes');
    const unitDisp = currentData?.display_unit || '°C';

    if (ticksEl) {
      ticksEl.innerHTML = timeline
        .map(
          (pt) =>
            `<div class="tm-tick ${pt.year === activeYear ? 'is-active' : ''}" data-year="${pt.year}" style="background-color: ${pt.color};" title="${pt.year}: ${pt.value.toFixed(2)} ${unitDisp} (z = ${pt.z_score >= 0 ? '+' : ''}${pt.z_score})"></div>`
        )
        .join('');
      ticksEl.querySelectorAll('.tm-tick').forEach((el) => {
        el.addEventListener('click', () => {
          stopPlayback();
          setActiveYear(Number(el.dataset.year));
        });
      });
    }

    if (stripesEl) {
      stripesEl.innerHTML = timeline
        .map(
          (pt) =>
            `<div class="tm-stripe-item ${pt.year === activeYear ? 'is-active' : ''}" data-year="${pt.year}" style="background-color: ${pt.color};" title="Año ${pt.year}: ${pt.value.toFixed(2)} ${unitDisp} | Anomalía: ${pt.anomaly >= 0 ? '+' : ''}${pt.anomaly.toFixed(2)} ${unitDisp}"></div>`
        )
        .join('');
      stripesEl.querySelectorAll('.tm-stripe-item').forEach((el) => {
        el.addEventListener('click', () => {
          stopPlayback();
          setActiveYear(Number(el.dataset.year));
        });
      });
    }

    const anomCount = timeline.filter((p) => p.is_anomaly).length;
    setText('tmAnomaliesCountBadge', `${anomCount} anomalías detectadas (|z| ≥ 1.5)`);
  }

  /**
   * 8. Renderiza los dos gráficos Chart.js sincronizados con el año activo
   */
  function renderSynchronizedCharts(data, highlightedYear) {
    const timeline = data.timeline || [];
    const unitDisp = data.display_unit || '°C';
    const slope = Number(data.statistics?.slope ?? 0);
    const meanVal = Number(data.statistics?.mean ?? 0);

    setText('tmSlopeBadge', `Pendiente: ${slope >= 0 ? '+' : ''}${(slope * 10).toFixed(3)} ${unitDisp}/década`);
    setText('tmMeanBadge', `Media histórica: ${meanVal.toFixed(2)} ${unitDisp}`);

    // Gráfico 1: Serie + Regresión OLS + Punto resaltado en el año activo
    const canvas1 = document.getElementById('tmTrendChart');
    if (canvas1 && typeof Chart !== 'undefined') {
      if (trendChartInstance) {
        trendChartInstance.destroy();
      }
      const years = timeline.map((p) => p.year);
      const values = timeline.map((p) => p.value);
      const trends = timeline.map((p) => p.trend_value);
      const pointRadii = timeline.map((p) => (p.year === highlightedYear ? 8 : 3.5));
      const pointColors = timeline.map((p) => (p.year === highlightedYear ? '#fc3d21' : '#0b3d91'));

      trendChartInstance = new Chart(canvas1.getContext('2d'), {
        type: 'line',
        data: {
          labels: years,
          datasets: [
            {
              label: `Valor observado (${unitDisp})`,
              data: values,
              borderColor: '#0b3d91',
              backgroundColor: 'rgba(11, 61, 145, 0.10)',
              pointBackgroundColor: pointColors,
              pointBorderColor: '#ffffff',
              pointBorderWidth: 1.5,
              pointRadius: pointRadii,
              borderWidth: 2.3,
              tension: 0.2
            },
            {
              label: `Tendencia lineal OLS`,
              data: trends,
              borderColor: '#fc3d21',
              borderDash: [6, 4],
              borderWidth: 2,
              pointRadius: 0,
              tension: 0
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          onClick: (_, elements) => {
            if (elements && elements.length > 0) {
              const idx = elements[0].index;
              if (years[idx] !== undefined) {
                stopPlayback();
                setActiveYear(years[idx]);
              }
            }
          },
          plugins: {
            legend: { position: 'top' }
          },
          scales: {
            x: { grid: { color: 'rgba(226, 232, 240, 0.6)' } },
            y: {
              title: { display: true, text: `${data.variable_name} (${unitDisp})` },
              grid: { color: 'rgba(226, 232, 240, 0.6)' }
            }
          }
        }
      });
    }

    // Gráfico 2: Barras de anomalías coloreadas por z-score
    EarthLensCharts.renderAnomalyBarChart(
      'tmAnomalyBarChart',
      timeline,
      data.variable,
      unitDisp,
      highlightedYear,
      (clickedYr) => {
        stopPlayback();
        setActiveYear(clickedYr);
      }
    );
  }

  /**
   * 9. Comparador de Épocas (Período A vs Período B) y recálculo instantáneo al mover #tmSplitYearSlider
   */
  function computeClientPeriodComparison(timeline, splitYear, unitDisp) {
    const clean = timeline.slice().sort((a, b) => a.year - b.year);
    const groupA = clean.filter((d) => d.year < splitYear);
    const groupB = clean.filter((d) => d.year >= splitYear);
    if (groupA.length < 2 || groupB.length < 2) return null;

    const mean = (arr) => arr.reduce((s, d) => s + d.value, 0) / arr.length;
    const variance = (arr, m) =>
      arr.length > 1 ? arr.reduce((s, d) => s + Math.pow(d.value - m, 2), 0) / (arr.length - 1) : 0;

    const meanA = mean(groupA);
    const meanB = mean(groupB);
    const varA = variance(groupA, meanA);
    const varB = variance(groupB, meanB);
    const stdA = Math.sqrt(varA);
    const stdB = Math.sqrt(varB);

    const deltaMean = meanB - meanA;
    const deltaPct = Math.abs(meanA) > 1e-9 ? (deltaMean / Math.abs(meanA)) * 100 : 0;
    const seSq = varA / groupA.length + varB / groupB.length;
    const tStat = seSq > 1e-12 ? deltaMean / Math.sqrt(seSq) : 0;
    const df = Math.max(2, groupA.length + groupB.length - 2);
    const zEq = Math.sqrt(df * Math.log(1 + (tStat * tStat) / df)) * (1 - 1 / (4 * df));
    const pVal = Math.max(0.0001, Math.min(1, Math.exp(-0.5 * zEq * zEq)));

    const regA = EarthLensCharts.computeRegressionLine(groupA);
    const regB = EarthLensCharts.computeRegressionLine(groupB);

    const labelA = `${groupA[0].year}–${groupA[groupA.length - 1].year}`;
    const labelB = `${groupB[0].year}–${groupB[groupB.length - 1].year}`;
    const sig = pVal < 0.05;
    const sign = deltaMean >= 0 ? '+' : '';

    return {
      split_year: splitYear,
      period_a: {
        label: labelA,
        mean: Number(meanA.toFixed(3)),
        std_dev: Number(stdA.toFixed(3)),
        change_per_decade: Number((regA.slope * 10).toFixed(3))
      },
      period_b: {
        label: labelB,
        mean: Number(meanB.toFixed(3)),
        std_dev: Number(stdB.toFixed(3)),
        change_per_decade: Number((regB.slope * 10).toFixed(3))
      },
      delta_mean: Number(deltaMean.toFixed(3)),
      delta_percent: Number(deltaPct.toFixed(2)),
      p_value: Number(pVal.toFixed(4)),
      significant_shift: sig,
      summary: sig
        ? `Al contrastar la época reciente (${labelB}) frente a la época base (${labelA}), se registra un cambio estadísticamente significativo de ${sign}${deltaMean.toFixed(2)} ${unitDisp} (${sign}${deltaPct.toFixed(1)}%, p = ${pVal.toFixed(4)} < 0.05).`
        : `Entre la época base (${labelA}) y la época reciente (${labelB}), la variación media es de ${sign}${deltaMean.toFixed(2)} ${unitDisp} (${sign}${deltaPct.toFixed(1)}%, p = ${pVal.toFixed(4)} ≥ 0.05).`
    };
  }

  function renderEpochComparisonUI(cmp, unitDisp) {
    if (!cmp) return;
    const pA = cmp.period_a;
    const pB = cmp.period_b;

    setText('tmSplitYearLabel', `Corte en ${cmp.split_year} (${pA.label} vs ${pB.label})`);
    setText('tmEpochPeriodA', `${pA.label}`);
    setText('tmEpochMeanA', `${pA.mean.toFixed(2)} ${unitDisp}`);
    setText('tmEpochStatsA', `σ: ${pA.std_dev.toFixed(2)} · Tend: ${pA.change_per_decade >= 0 ? '+' : ''}${pA.change_per_decade.toFixed(2)}/déc`);

    setText('tmEpochPeriodB', `${pB.label}`);
    setText('tmEpochMeanB', `${pB.mean.toFixed(2)} ${unitDisp}`);
    setText('tmEpochStatsB', `σ: ${pB.std_dev.toFixed(2)} · Tend: ${pB.change_per_decade >= 0 ? '+' : ''}${pB.change_per_decade.toFixed(2)}/déc`);

    const dSign = cmp.delta_mean >= 0 ? '+' : '';
    setText('tmEpochDeltaMean', `${dSign}${cmp.delta_mean.toFixed(2)} ${unitDisp}`);
    setText('tmEpochDeltaPct', `(${dSign}${cmp.delta_percent.toFixed(1)}%)`);
    setText('tmEpochPValue', `p = ${cmp.p_value < 0.0001 ? '< 0.0001' : cmp.p_value.toFixed(4)}`);
    setText('tmEpochSummaryText', cmp.summary);

    const badge = document.getElementById('tmEpochShiftBadge');
    if (badge) {
      badge.className = `badge rounded-pill ${cmp.significant_shift ? 'badge-sig-yes' : 'badge-sig-no'}`;
      badge.textContent = cmp.significant_shift ? 'Cambio de época significativo (p < 0.05)' : 'Variación dentro del ruido (p ≥ 0.05)';
    }
  }

  function renderExtremeRecords(anomalies, unitDisp) {
    const maxRec = anomalies?.max_record;
    const minRec = anomalies?.min_record;
    if (maxRec) {
      setText('tmMaxRecordVal', `${maxRec.value.toFixed(2)} ${unitDisp}`);
      setText('tmMaxRecordYr', `Año ${maxRec.year} (z = +${maxRec.z_score.toFixed(2)})`);
      const btnMax = document.getElementById('btnJumpMaxRecord');
      if (btnMax) {
        btnMax.onclick = () => {
          stopPlayback();
          setActiveYear(maxRec.year);
        };
      }
    }
    if (minRec) {
      setText('tmMinRecordVal', `${minRec.value.toFixed(2)} ${unitDisp}`);
      setText('tmMinRecordYr', `Año ${minRec.year} (z = ${minRec.z_score.toFixed(2)})`);
      const btnMin = document.getElementById('btnJumpMinRecord');
      if (btnMin) {
        btnMin.onclick = () => {
          stopPlayback();
          setActiveYear(minRec.year);
        };
      }
    }
  }

  function renderAnomalyCards(anomalies, unitDisp) {
    const container = document.getElementById('tmAnomaliesContainer');
    const events = anomalies?.events || [];
    setText('tmAnomalyListCount', `${events.length} eventos`);
    if (!container) return;

    if (events.length === 0) {
      container.innerHTML = `
        <div class="text-muted small p-3 bg-light rounded border">
          No se registraron anomalías con |z| ≥ 1.5 en este período. Usa las tarjetas de récord máximo y mínimo para explorar los extremos.
        </div>`;
      return;
    }

    container.innerHTML = events
      .map(
        (ev) => `
        <div class="tm-anomaly-card ${ev.year === activeYear ? 'is-selected' : ''}" data-year="${ev.year}">
          <div class="d-flex justify-content-between align-items-center mb-1">
            <span class="fw-bold text-dark">Año ${ev.year} · <span style="color:${ev.color}">${ev.badge || 'Anomalía'}</span></span>
            <button type="button" class="btn btn-sm btn-outline-primary py-0 px-2 js-jump-year" data-year="${ev.year}">
              Viajar a ${ev.year}
            </button>
          </div>
          <p class="small text-secondary mb-0">${ev.description || `Valor: ${ev.value.toFixed(2)} ${unitDisp} (z = ${ev.z_score})`}</p>
        </div>`
      )
      .join('');

    container.querySelectorAll('.js-jump-year').forEach((btn) => {
      btn.addEventListener('click', () => {
        stopPlayback();
        setActiveYear(Number(btn.dataset.year));
      });
    });
  }

  function renderTimelineTable(timeline, unitDisp) {
    const tbody = document.getElementById('tmTimelineTableBody');
    if (!tbody) return;

    tbody.innerHTML = timeline
      .map((pt) => {
        const sign = pt.anomaly >= 0 ? '+' : '';
        return `
          <tr data-year="${pt.year}" style="cursor: pointer;" class="${pt.year === activeYear ? 'table-primary' : ''}">
            <td class="fw-bold">${pt.year}</td>
            <td>${pt.value.toFixed(2)} ${unitDisp}</td>
            <td>${pt.trend_value.toFixed(2)} ${unitDisp}</td>
            <td class="fw-semibold" style="color: ${pt.color};">${sign}${pt.anomaly.toFixed(2)} ${unitDisp}</td>
            <td class="font-monospace">${pt.z_score >= 0 ? '+' : ''}${pt.z_score.toFixed(2)}</td>
            <td>${pt.is_anomaly ? '<span class="badge bg-warning text-dark">Anomalía</span>' : '<span class="text-muted small">Normal</span>'}</td>
          </tr>`;
      })
      .join('');

    tbody.querySelectorAll('tr').forEach((row) => {
      row.addEventListener('click', () => {
        stopPlayback();
        setActiveYear(Number(row.dataset.year));
      });
    });
  }

  /**
   * 10. Reproducción automática (Play / Pause)
   */
  function togglePlayback() {
    if (isPlaying) {
      stopPlayback();
    } else {
      startPlayback();
    }
  }

  function startPlayback() {
    if (!currentData || !currentData.timeline?.length) return;
    isPlaying = true;
    const btn = document.getElementById('btnPlayPause');
    if (btn) btn.textContent = '⏸';

    const years = currentData.timeline.map((p) => p.year);
    if (activeYear >= years[years.length - 1]) {
      setActiveYear(years[0]);
    }

    playTimer = setInterval(() => {
      const idx = years.indexOf(activeYear);
      if (idx < years.length - 1) {
        setActiveYear(years[idx + 1]);
      } else {
        setActiveYear(years[0]);
      }
    }, playSpeedMs);
  }

  function stopPlayback() {
    isPlaying = false;
    if (playTimer) {
      clearInterval(playTimer);
      playTimer = null;
    }
    const btn = document.getElementById('btnPlayPause');
    if (btn) btn.textContent = '▶';
  }

  function exportTimeMachineCSV() {
    if (!currentData || !currentData.timeline) return;
    const loc = currentData.location || {};
    const stats = currentData.statistics || {};
    const cmp = currentData.period_comparison || {};

    const metadata = [
      `Proyecto: EarthLens - Earth Time Machine (NASA Space Apps 2026)`,
      `Ubicacion: ${loc.name} (${loc.latitude}, ${loc.longitude}) | Region: ${loc.region}`,
      `Variable: ${currentData.variable} (${currentData.display_unit}) | Fuente: ${currentData.source}`,
      `Tendencia 2000-2024: ${stats.change_per_decade} ${currentData.display_unit}/decada (p=${stats.p_value})`,
      `Comparacion Epocas (${cmp.period_a?.label} vs ${cmp.period_b?.label}): Delta=${cmp.delta_mean} (p=${cmp.p_value})`
    ];

    const headers = [
      'anio',
      'valor_observado',
      'tendencia_ols',
      'anomalia_vs_media',
      'z_score',
      'percentil',
      'es_anomalia',
      'unidad'
    ];
    const rows = currentData.timeline.map((pt) => [
      pt.year,
      pt.value,
      pt.trend_value,
      pt.anomaly,
      pt.z_score,
      pt.percentile,
      pt.is_anomaly,
      currentData.display_unit
    ]);

    EarthLensCharts.downloadCSV(
      `earthlens_timemachine_${currentData.variable.toLowerCase()}_${currentData.period.start_year}_${currentData.period.end_year}.csv`,
      headers,
      rows,
      metadata
    );
  }

  /**
   * 11. Enlace de eventos DOM
   */
  function bindEvents() {
    const citySelect = document.getElementById('tmCitySelect');
    const varSelect = document.getElementById('tmVariableSelect');
    const startInput = document.getElementById('tmStartYear');
    const endInput = document.getElementById('tmEndYear');
    const btnLoad = document.getElementById('btnLoadTimeMachine');
    const slider = document.getElementById('tmYearSlider');
    const splitSlider = document.getElementById('tmSplitYearSlider');
    const btnPlay = document.getElementById('btnPlayPause');
    const btnPrev = document.getElementById('btnPrevYear');
    const btnNext = document.getElementById('btnNextYear');
    const mapModeSelect = document.getElementById('tmMapModeSelect');
    const btnZoomZone = document.getElementById('btnSlideZoomZone');
    const btnZoomArg = document.getElementById('btnSlideZoomArg');
    const btnExport = document.getElementById('btnExportTimeMachineCSV');

    if (citySelect) {
      citySelect.addEventListener('change', () => {
        const opt = citySelect.selectedOptions[0];
        if (!opt) return;
        state.city_id = opt.value !== 'custom' ? opt.value : null;
        state.latitude = parseFloat(opt.dataset.lat);
        state.longitude = parseFloat(opt.dataset.lon);
        state.locationName = opt.textContent;
        loadTimeMachineData();
      });
    }

    if (varSelect) {
      varSelect.addEventListener('change', () => {
        state.variable = varSelect.value;
        loadTimeMachineData();
      });
    }

    if (btnLoad) {
      btnLoad.addEventListener('click', () => {
        if (startInput && endInput) {
          let s = parseInt(startInput.value, 10) || 2000;
          let e = parseInt(endInput.value, 10) || 2024;
          e = Math.max(1984, Math.min(2024, e));
          s = Math.max(1981, Math.min(e - 3, s));
          state.start_year = s;
          state.end_year = e;
          startInput.value = s;
          endInput.value = e;
        }
        loadTimeMachineData();
      });
    }

    if (slider) {
      slider.addEventListener('input', () => {
        stopPlayback();
        setActiveYear(Number(slider.value));
      });
    }

    if (splitSlider) {
      splitSlider.addEventListener('input', () => {
        if (!currentData) return;
        const newSplit = Number(splitSlider.value);
        state.split_year = newSplit;
        const unitDisp = currentData.display_unit || '°C';
        const cmp = computeClientPeriodComparison(currentData.timeline, newSplit, unitDisp);
        if (cmp) {
          currentData.period_comparison = cmp;
          renderEpochComparisonUI(cmp, unitDisp);
        }
      });
    }

    if (btnPlay) btnPlay.addEventListener('click', togglePlayback);

    if (btnPrev) {
      btnPrev.addEventListener('click', () => {
        stopPlayback();
        if (!currentData?.timeline) return;
        const years = currentData.timeline.map((p) => p.year);
        const idx = years.indexOf(activeYear);
        if (idx > 0) setActiveYear(years[idx - 1]);
      });
    }

    if (btnNext) {
      btnNext.addEventListener('click', () => {
        stopPlayback();
        if (!currentData?.timeline) return;
        const years = currentData.timeline.map((p) => p.year);
        const idx = years.indexOf(activeYear);
        if (idx < years.length - 1) setActiveYear(years[idx + 1]);
      });
    }

    document.querySelectorAll('.tm-speed-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tm-speed-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        playSpeedMs = Number(btn.dataset.speed) || 800;
        if (isPlaying) {
          stopPlayback();
          startPlayback();
        }
      });
    });

    if (mapModeSelect) {
      mapModeSelect.addEventListener('change', () => {
        mapMode = mapModeSelect.value;
        applyMapModeView(true);
      });
    }

    if (btnZoomZone) {
      btnZoomZone.addEventListener('click', () => {
        mapMode = 'zone';
        if (mapModeSelect) mapModeSelect.value = 'zone';
        applyMapModeView(true);
      });
    }

    if (btnZoomArg) {
      btnZoomArg.addEventListener('click', () => {
        mapMode = 'national';
        if (mapModeSelect) mapModeSelect.value = 'national';
        applyMapModeView(true);
      });
    }

    if (btnExport) {
      btnExport.addEventListener('click', exportTimeMachineCSV);
    }
  }

  initFromURL();
  initLeafletMap();
  bindEvents();
  loadTimeMachineData();
});
