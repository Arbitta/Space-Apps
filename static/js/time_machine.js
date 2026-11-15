/**
 * EarthLens — Controlador de Earth Time Machine (static/js/time_machine.js)
 * Interfaz Satelital Meteorológica de Pantalla Completa + Ventanas Flotantes (Bootstrap 5 + Leaflet + Chart.js)
 * NASA Space Apps Challenge 2026 · Be An Earth System Trend Detective!
 *
 * Características:
 *  - Mapa satelital Esri World Imagery a pantalla completa con barra temporal en la parte inferior.
 *  - Pluma meteorológica satelital (pane con desenfoque Gaussiano tipo imagen de TV del clima)
 *    que cambia de paleta según la variable (Infrarrojo térmico, Radar Doppler de lluvia,
 *    Vapor de agua/humedad y Jet Stream de viento).
 *  - Botones alrededor del mapa que abren ventanitas flotantes en la misma pantalla:
 *      1) Serie anual, tendencia OLS y cursor del año activo.
 *      2) Desviación y anomalías respecto a la media.
 *      3) Detector de anomalías (y comparador de épocas).
 *      4) Matriz histórica anual.
 */

document.addEventListener('DOMContentLoaded', () => {
  let currentData = null;
  let activeYear = 2000;
  let isPlaying = false;
  let playTimer = null;
  let playSpeedMs = 700;
  let mapMode = 'zone'; // 'zone' | 'national'
  let openWindowId = null;

  let activeAbortController = null;
  let requestSeq = 0;

  let mapInstance = null;
  let weatherPlumeGroup = null;
  let zoneLayerGroup = null;
  let nationalLayerGroup = null;
  let zoneCellLayers = [];
  let nationalLayers = [];
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

  /**
   * Paletas meteorológicas estilo TV / Imagen Satelital (NOAA / GOES / Windy)
   * Cada variable tiene su propia rampa continua según el z-score anual.
   */
  const SATELLITE_TV_METADATA = {
    T2M: {
      title: '🌡️ Infrarrojo Térmico Satelital (T2M)',
      minLabel: 'Frío (-2σ)',
      maxLabel: 'Cálido (+2σ)',
      scaleClass: 'tm-scale-thermal'
    },
    T2M_MAX: {
      title: '🔥 Onda de Calor Superficial (T2M_MAX)',
      minLabel: 'Templado (-2σ)',
      maxLabel: 'Extremo (+2σ)',
      scaleClass: 'tm-scale-thermal'
    },
    T2M_MIN: {
      title: '❄️ Frente Polar / Mínimas (T2M_MIN)',
      minLabel: 'Helada (-2σ)',
      maxLabel: 'Templado (+2σ)',
      scaleClass: 'tm-scale-thermal'
    },
    PRECTOTCORR: {
      title: '🌧️ Radar Doppler de Precipitación',
      minLabel: 'Sequía (-2σ)',
      maxLabel: 'Tormenta (+2σ)',
      scaleClass: 'tm-scale-precip'
    },
    RH2M: {
      title: '💧 Vapor de Agua Atmosférico (RH2M)',
      minLabel: 'Aire Seco (-2σ)',
      maxLabel: 'Saturado (+2σ)',
      scaleClass: 'tm-scale-humidity'
    },
    WS2M: {
      title: '💨 Corriente de Viento Superficial (WS2M)',
      minLabel: 'Calma (-2σ)',
      maxLabel: 'Ráfagas (+2σ)',
      scaleClass: 'tm-scale-wind'
    }
  };

  function getSatelliteWeatherColor(variable, zScore) {
    const varCode = (variable || 'T2M').toUpperCase();
    const z = Number(zScore || 0);

    if (varCode === 'PRECTOTCORR') {
      if (z <= -1.8) return '#92400e';
      if (z <= -1.0) return '#d97706';
      if (z <= -0.3) return '#fde047';
      if (z < 0.35) return '#34d399';
      if (z < 1.1) return '#06b6d4';
      if (z < 1.8) return '#2563eb';
      return '#a855f7';
    }

    if (varCode === 'RH2M') {
      if (z <= -1.8) return '#92400e';
      if (z <= -1.0) return '#f59e0b';
      if (z <= -0.3) return '#fde68a';
      if (z < 0.4) return '#5eead4';
      if (z < 1.2) return '#06b6d4';
      if (z < 1.9) return '#0284c7';
      return '#1d4ed8';
    }

    if (varCode === 'WS2M') {
      if (z <= -1.6) return '#1e293b';
      if (z <= -0.8) return '#0284c7';
      if (z <= 0.2) return '#22d3ee';
      if (z < 1.0) return '#818cf8';
      if (z < 1.7) return '#c084fc';
      return '#f43f5e';
    }

    // Infrarrojo térmico (T2M, T2M_MAX, T2M_MIN)
    if (z <= -1.9) return '#3b0764';
    if (z <= -1.1) return '#1d4ed8';
    if (z <= -0.35) return '#06b6d4';
    if (z < 0.35) return '#84cc16';
    if (z < 1.1) return '#facc15';
    if (z < 1.8) return '#f97316';
    return '#dc2626';
  }

  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  /**
   * 1. Inicializa parámetros desde query string
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
    customOpt.textContent = `${locName || 'Zona seleccionada'} (${Number(lat).toFixed(2)}°, ${Number(lon).toFixed(2)}°)`;
    citySelect.value = 'custom';
    state.city_id = null;
  }

  /**
   * 2. Inicializa el mapa Leaflet con vista Satelital por defecto + Pane Meteorológico Difuminado
   */
  function initLeafletMap() {
    const mapContainer = document.getElementById('timeMachineMap');
    if (!mapContainer || typeof L === 'undefined') return;

    mapInstance = L.map('timeMachineMap', {
      center: [state.latitude, state.longitude],
      zoom: 7,
      zoomControl: false
    });

    L.control.zoom({ position: 'bottomright' }).addTo(mapInstance);

    // Vista Satelital Real (Esri World Imagery) por defecto para aspecto de noticiero del clima
    const satelliteLayer = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      {
        maxZoom: 17,
        attribution: 'Satélite &copy; Esri · NASA Earthdata MERRA-2'
      }
    );

    // Etiquetas de fronteras y ciudades sobre la imagen satelital
    const labelsOverlay = L.tileLayer(
      'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
      {
        maxZoom: 17,
        opacity: 0.78
      }
    );

    const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; OpenStreetMap contributors'
    });

    satelliteLayer.addTo(mapInstance);
    labelsOverlay.addTo(mapInstance);

    L.control
      .layers(
        { '🛰️ Imagen Satelital (Clima TV)': satelliteLayer, '🗺️ Mapa Político (OSM)': osmLayer },
        { '🏷️ Nombres y Límites': labelsOverlay },
        { position: 'bottomright' }
      )
      .addTo(mapInstance);

    // Pane especial con filtro CSS blur para simular las manchas meteorológicas de TV
    const plumePane = mapInstance.createPane('satelliteWeatherPane');
    plumePane.style.zIndex = 380;
    plumePane.classList.add('leaflet-satellite-weather-pane');

    weatherPlumeGroup = L.layerGroup().addTo(mapInstance);
    zoneLayerGroup = L.layerGroup().addTo(mapInstance);
    nationalLayerGroup = L.layerGroup();

    mapInstance.on('click', (ev) => {
      const clickedLat = Number(ev.latlng.lat.toFixed(4));
      const clickedLon = Number(ev.latlng.lng.toFixed(4));
      state.latitude = clickedLat;
      state.longitude = clickedLon;
      state.locationName = `Coordenada (${clickedLat.toFixed(2)}°, ${clickedLon.toFixed(2)}°)`;
      syncCitySelectWithCoords(clickedLat, clickedLon, state.locationName);
      loadTimeMachineData();
    });
  }

  /**
   * 3. Consulta POST /api/time-machine
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
          badge: ev.z_score > 0 ? '🔥 Anomalía Alta' : '❄️ Anomalía Baja',
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
            color: getSatelliteWeatherColor(variable, z)
          };
        });
        cells.push({
          cell_id: `r${r}_c${c}`,
          is_center: r === 0 && c === 0,
          label: r === 0 && c === 0 ? 'Foco Central Satelital' : `Sector (${r}, ${c})`,
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
   * 4. Aplica la respuesta completa y sincroniza el mapa satelital y las ventanitas
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
    setText('tmRegionBadge', `${data.location?.region || 'Argentina'}`);
    setText('tmPeriodBadge', `${minYr}–${maxYr}`);
    setText(
      'tmCoordsText',
      `${Number(data.location.latitude).toFixed(2)}°, ${Number(data.location.longitude).toFixed(2)}°`
    );

    updateWeatherLegend(data.variable);
    updateNavigationLinks(data);
    renderSliderStripes(data.timeline, data.variable);
    renderEpochComparisonUI(data.period_comparison, unitDisp);
    renderExtremeRecords(data.anomalies, unitDisp);
    renderAnomalyCards(data.anomalies, unitDisp);
    renderTimelineTable(data.timeline, unitDisp, data.variable);

    rebuildMapLayers(data);
    setActiveYear(activeYear);
  }

  function updateWeatherLegend(variable) {
    const meta = SATELLITE_TV_METADATA[variable] || SATELLITE_TV_METADATA.T2M;
    setText('tmWeatherTvTitle', meta.title);
    setText('tmScaleMinText', meta.minLabel);
    setText('tmScaleMaxText', meta.maxLabel);
    const bar = document.getElementById('tmColorScaleBar');
    if (bar) {
      bar.className = `tm-color-scale-bar flex-grow-1 ${meta.scaleClass}`;
    }
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
   * 5. Construye las capas meteorológicas satelitales (Pluma Gaussiana + Sensores)
   */
  function rebuildMapLayers(data) {
    if (!mapInstance || !zoneLayerGroup || !nationalLayerGroup || !weatherPlumeGroup) return;

    weatherPlumeGroup.clearLayers();
    zoneLayerGroup.clearLayers();
    nationalLayerGroup.clearLayers();
    zoneCellLayers = [];
    nationalLayers = [];

    const cells = data.spatial_zone?.cells || [];
    cells.forEach((cell) => {
      // Pluma meteorológica difusa (se dibuja en el pane con blur CSS para efecto imagen de satélite TV)
      const plumeCircle = L.circle([cell.latitude, cell.longitude], {
        pane: 'satelliteWeatherPane',
        radius: cell.is_center ? 58000 : 48000,
        stroke: false,
        fillColor: '#38bdf8',
        fillOpacity: cell.is_center ? 0.78 : 0.62
      });

      // Marco sutil interactivo para inspección al pasar el mouse
      const rect = L.rectangle(cell.bounds, {
        color: cell.is_center ? 'rgba(255, 255, 255, 0.75)' : 'rgba(255, 255, 255, 0.16)',
        weight: cell.is_center ? 1.8 : 0.7,
        dashArray: cell.is_center ? null : '3, 4',
        fillColor: '#38bdf8',
        fillOpacity: 0.12
      });
      rect.bindTooltip('', { sticky: true, className: 'tm-sat-city-tooltip' });

      rect.addTo(zoneLayerGroup);
      zoneCellLayers.push({ cell, rect, plumeCircle });
    });

    // Marcador del punto central
    const centerMarker = L.circleMarker([data.location.latitude, data.location.longitude], {
      radius: 6,
      color: '#ffffff',
      weight: 2,
      fillColor: '#00b4d8',
      fillOpacity: 1
    }).bindTooltip(`📍 ${data.location.name}`, {
      permanent: false,
      direction: 'top',
      className: 'tm-sat-city-tooltip'
    });
    centerMarker.addTo(zoneLayerGroup);

    // Red de 25 ciudades argentinas con halos meteorológicos
    const cities = data.regional_cities || [];
    cities.forEach((city) => {
      const isSelectedCity =
        Math.abs(city.latitude - data.location.latitude) < 0.2 &&
        Math.abs(city.longitude - data.location.longitude) < 0.2;

      const plume = L.circle([city.latitude, city.longitude], {
        pane: 'satelliteWeatherPane',
        radius: isSelectedCity ? 230000 : 185000,
        stroke: false,
        fillColor: '#38bdf8',
        fillOpacity: 0.68
      });

      const marker = L.circleMarker([city.latitude, city.longitude], {
        radius: isSelectedCity ? 9 : 6.5,
        color: '#ffffff',
        weight: isSelectedCity ? 2.5 : 1.2,
        fillColor: '#38bdf8',
        fillOpacity: 0.95
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
      nationalLayers.push({ city, marker, plume, isSelectedCity });
    });

    applyMapModeView(true);
  }

  function applyMapModeView(shouldZoom = true) {
    if (!mapInstance || !currentData) return;

    weatherPlumeGroup.clearLayers();

    if (mapMode === 'national') {
      if (mapInstance.hasLayer(zoneLayerGroup)) mapInstance.removeLayer(zoneLayerGroup);
      if (!mapInstance.hasLayer(nationalLayerGroup)) nationalLayerGroup.addTo(mapInstance);
      nationalLayers.forEach(({ plume }) => plume.addTo(weatherPlumeGroup));
      setText('tmCellHudInfo', `Cobertura satelital: ${(currentData.regional_cities || []).length} estaciones en Argentina`);
      if (shouldZoom) {
        mapInstance.flyTo([-38.5, -64.0], 4, { duration: 0.65 });
      }
    } else {
      if (mapInstance.hasLayer(nationalLayerGroup)) mapInstance.removeLayer(nationalLayerGroup);
      if (!mapInstance.hasLayer(zoneLayerGroup)) zoneLayerGroup.addTo(mapInstance);
      zoneCellLayers.forEach(({ plumeCircle }) => plumeCircle.addTo(weatherPlumeGroup));
      setText('tmCellHudInfo', `Barrido satelital MERRA-2 (0.5° × 0.625°) · ${currentData.location.name}`);
      if (shouldZoom && currentData.spatial_zone?.zone_bounds) {
        mapInstance.flyToBounds(currentData.spatial_zone.zone_bounds, { padding: [70, 70], duration: 0.65 });
      }
    }
    updateMapColorsForYear(activeYear);
  }

  /**
   * 6. Actualiza en tiempo real el mapa satelital, la barra inferior y las ventanitas
   */
  function setActiveYear(year) {
    if (!currentData || !Array.isArray(currentData.timeline)) return;
    const yrNum = Number(year);
    const point = currentData.timeline.find((p) => p.year === yrNum) || currentData.timeline[0];
    if (!point) return;

    activeYear = point.year;
    const unitDisp = currentData.display_unit || '°C';
    const satColor = getSatelliteWeatherColor(currentData.variable, point.z_score);

    const slider = document.getElementById('tmYearSlider');
    if (slider && Number(slider.value) !== activeYear) {
      slider.value = activeYear;
    }

    setText('tmActiveYearDisplay', String(activeYear));
    setText('tmActiveValue', `${point.value.toFixed(1)} ${unitDisp}`);

    const anomSign = point.anomaly >= 0 ? '+' : '';
    const anomEl = document.getElementById('tmActiveAnomaly');
    if (anomEl) {
      anomEl.textContent = `${anomSign}${point.anomaly.toFixed(2)} ${unitDisp}`;
      anomEl.style.backgroundColor = satColor;
      anomEl.style.color = '#ffffff';
    }

    const levelBadge = document.getElementById('tmActiveLevelBadge');
    if (levelBadge) {
      const levelLabels = {
        extreme_high: '🔥 Anomalía Extrema (+)',
        moderate_high: '⚠️ Superior a lo normal',
        mild_high: '↗ Ligeramente cálido/alto',
        normal: '✓ Condición normal',
        mild_low: '↘ Ligeramente frío/bajo',
        moderate_low: '⚠️ Inferior a lo normal',
        extreme_low: '❄️ Anomalía Extrema (−)'
      };
      levelBadge.textContent = levelLabels[point.anomaly_level] || '✓ Condición normal';
      levelBadge.className = `badge rounded-pill ${
        point.is_anomaly ? 'bg-warning text-dark fw-bold' : 'bg-secondary bg-opacity-50 text-white'
      }`;
    }

    document.querySelectorAll('.tm-stripe-item').forEach((el) => {
      el.classList.toggle('is-active', Number(el.dataset.year) === activeYear);
    });
    document.querySelectorAll('.tm-anomaly-card').forEach((el) => {
      el.classList.toggle('is-selected', Number(el.dataset.year) === activeYear);
    });
    document.querySelectorAll('#tmTimelineTableBody tr').forEach((row) => {
      row.classList.toggle('table-info', Number(row.dataset.year) === activeYear);
      row.classList.toggle('text-dark', Number(row.dataset.year) === activeYear);
    });

    updateMapColorsForYear(activeYear);
    renderSynchronizedCharts(currentData, activeYear);
  }

  function updateMapColorsForYear(year) {
    if (!currentData) return;
    const yrKey = String(year);
    const unitDisp = currentData.display_unit || '°C';
    const varCode = currentData.variable;

    zoneCellLayers.forEach(({ cell, rect, plumeCircle }) => {
      const yrData = cell.by_year?.[yrKey];
      if (!yrData) return;
      const satColor = getSatelliteWeatherColor(varCode, yrData.z_score);

      plumeCircle.setStyle({
        fillColor: satColor,
        fillOpacity: cell.is_center ? 0.82 : 0.64
      });
      rect.setStyle({
        fillColor: satColor,
        fillOpacity: cell.is_center ? 0.22 : 0.1
      });

      const sign = yrData.anomaly >= 0 ? '+' : '';
      rect.setTooltipContent(
        `<strong>${cell.label}</strong> (${year})<br>` +
          `Promedio anual: <strong>${yrData.value.toFixed(2)} ${unitDisp}</strong><br>` +
          `Desviación: ${sign}${yrData.anomaly.toFixed(2)} ${unitDisp}`
      );
    });

    nationalLayers.forEach(({ city, marker, plume, isSelectedCity }) => {
      const yrData = city.by_year?.[yrKey];
      if (!yrData) return;
      const satColor = getSatelliteWeatherColor(varCode, yrData.z_score);

      plume.setStyle({
        fillColor: satColor,
        fillOpacity: isSelectedCity ? 0.82 : 0.64
      });
      marker.setStyle({
        fillColor: satColor,
        radius: isSelectedCity ? 10 : yrData.is_anomaly ? 8.5 : 6.5
      });

      const sign = yrData.anomaly >= 0 ? '+' : '';
      marker.bindTooltip(
        `<strong>${city.name}</strong> (${year})<br>` +
          `Valor: <strong>${yrData.value.toFixed(2)} ${unitDisp}</strong> (${sign}${yrData.anomaly.toFixed(2)} ${unitDisp})`,
        { direction: 'top', className: 'tm-sat-city-tooltip' }
      );
    });
  }

  /**
   * 7. Renderiza la cinta cromática bajo el slider inferior
   */
  function renderSliderStripes(timeline, variable) {
    const stripesEl = document.getElementById('tmClimateStripes');
    const unitDisp = currentData?.display_unit || '°C';

    if (stripesEl) {
      stripesEl.innerHTML = timeline
        .map((pt) => {
          const satColor = getSatelliteWeatherColor(variable, pt.z_score);
          return `<div class="tm-stripe-item ${pt.year === activeYear ? 'is-active' : ''}" data-year="${pt.year}" style="background-color: ${satColor};" title="${pt.year}: ${pt.value.toFixed(2)} ${unitDisp}"></div>`;
        })
        .join('');
      stripesEl.querySelectorAll('.tm-stripe-item').forEach((el) => {
        el.addEventListener('click', () => {
          stopPlayback();
          setActiveYear(Number(el.dataset.year));
        });
      });
    }

    const anomCount = timeline.filter((p) => p.is_anomaly).length;
    setText('tmDockAnomalyCount', String(anomCount));
  }

  /**
   * 8. Renderiza los dos gráficos dentro de sus respectivas ventanitas
   */
  function renderSynchronizedCharts(data, highlightedYear) {
    const timeline = data.timeline || [];
    const unitDisp = data.display_unit || '°C';
    const slope = Number(data.statistics?.slope ?? 0);
    const meanVal = Number(data.statistics?.mean ?? 0);

    setText('tmSlopeBadge', `Tendencia: ${slope >= 0 ? '+' : ''}${(slope * 10).toFixed(2)} ${unitDisp}/década`);
    setText('tmMeanBadge', `Media: ${meanVal.toFixed(2)} ${unitDisp}`);

    const canvas1 = document.getElementById('tmTrendChart');
    if (canvas1 && typeof Chart !== 'undefined') {
      if (trendChartInstance) {
        trendChartInstance.destroy();
      }
      const years = timeline.map((p) => p.year);
      const values = timeline.map((p) => p.value);
      const trends = timeline.map((p) => p.trend_value);
      const pointRadii = timeline.map((p) => (p.year === highlightedYear ? 8 : 3.5));
      const pointColors = timeline.map((p) =>
        p.year === highlightedYear ? '#fc3d21' : getSatelliteWeatherColor(data.variable, p.z_score)
      );

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
              tension: 0.22
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
   * 9. Comparador de Épocas y Detector de Anomalías (Ventanita 3)
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
        ? `Cambio estadísticamente significativo de ${sign}${deltaMean.toFixed(2)} ${unitDisp} entre ${labelA} y ${labelB} (p = ${pVal.toFixed(4)} < 0.05).`
        : `Variación media de ${sign}${deltaMean.toFixed(2)} ${unitDisp} entre ${labelA} y ${labelB}, dentro de la variabilidad natural (p = ${pVal.toFixed(4)} ≥ 0.05).`
    };
  }

  function renderEpochComparisonUI(cmp, unitDisp) {
    if (!cmp) return;
    const pA = cmp.period_a;
    const pB = cmp.period_b;

    setText('tmSplitYearLabel', `Corte ${cmp.split_year} (${pA.label} vs ${pB.label})`);
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
      badge.textContent = cmp.significant_shift ? 'Cambio significativo (p < 0.05)' : 'Variación normal (p ≥ 0.05)';
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
        <div class="text-white-50 small p-3 rounded bg-dark border border-secondary">
          No se registraron anomalías extremas (|z| ≥ 1.5) en este período.
        </div>`;
      return;
    }

    container.innerHTML = events
      .map(
        (ev) => `
        <div class="tm-anomaly-card ${ev.year === activeYear ? 'is-selected' : ''}" data-year="${ev.year}">
          <div class="d-flex justify-content-between align-items-center mb-1">
            <span class="fw-bold text-white small">Año ${ev.year} · <span style="color:${ev.color}">${ev.badge || 'Anomalía'}</span></span>
            <button type="button" class="btn btn-sm btn-outline-info py-0 px-2 js-jump-year" data-year="${ev.year}">
              Ver en mapa
            </button>
          </div>
          <p class="small text-white-50 mb-0" style="font-size: 0.75rem;">${ev.description || `Valor: ${ev.value.toFixed(2)} ${unitDisp} (z = ${ev.z_score})`}</p>
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

  function renderTimelineTable(timeline, unitDisp, variable) {
    const tbody = document.getElementById('tmTimelineTableBody');
    if (!tbody) return;

    tbody.innerHTML = timeline
      .map((pt) => {
        const sign = pt.anomaly >= 0 ? '+' : '';
        const satColor = getSatelliteWeatherColor(variable, pt.z_score);
        const isCurrent = pt.year === activeYear;
        return `
          <tr data-year="${pt.year}" style="cursor: pointer;" class="${isCurrent ? 'table-info text-dark' : ''}">
            <td class="fw-bold">${pt.year}</td>
            <td>${pt.value.toFixed(2)} ${unitDisp}</td>
            <td>${pt.trend_value.toFixed(2)} ${unitDisp}</td>
            <td class="fw-semibold" style="color: ${satColor};">${sign}${pt.anomaly.toFixed(2)} ${unitDisp}</td>
            <td class="font-monospace">${pt.z_score >= 0 ? '+' : ''}${pt.z_score.toFixed(2)}</td>
            <td>${pt.is_anomaly ? '<span class="badge bg-warning text-dark">Anomalía</span>' : '<span class="text-white-50 small">Normal</span>'}</td>
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
   * 10. Gestión de Ventanitas Flotantes (sin recargar ni abrir otra pestaña)
   */
  function togglePopupWindow(windowId) {
    const allWindows = document.querySelectorAll('.tm-popup-window');
    const allButtons = document.querySelectorAll('.tm-dock-btn');

    if (openWindowId === windowId) {
      allWindows.forEach((w) => w.classList.add('d-none'));
      allButtons.forEach((b) => b.classList.remove('is-active'));
      openWindowId = null;
      return;
    }

    allWindows.forEach((w) => {
      w.classList.toggle('d-none', w.id !== windowId);
    });
    allButtons.forEach((b) => {
      b.classList.toggle('is-active', b.dataset.windowTarget === windowId);
    });
    openWindowId = windowId;

    if (currentData && (windowId === 'winTrend' || windowId === 'winAnomaliesBar')) {
      setTimeout(() => renderSynchronizedCharts(currentData, activeYear), 40);
    }
  }

  /**
   * 11. Reproducción automática (Play / Pause)
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
   * 12. Enlace de eventos DOM y teclado
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

    // Botones que abren las 4 ventanitas flotantes
    document.querySelectorAll('.tm-dock-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const targetId = btn.dataset.windowTarget;
        if (targetId) togglePopupWindow(targetId);
      });
    });

    // Botones de cerrar ventanita
    document.querySelectorAll('.tm-window-close').forEach((btn) => {
      btn.addEventListener('click', () => {
        const targetId = btn.dataset.closeWindow;
        if (targetId) togglePopupWindow(targetId);
      });
    });

    // Cerrar ventanita con tecla Escape y avanzar años con flechas
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && openWindowId) {
        togglePopupWindow(openWindowId);
      } else if (ev.target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(ev.target.tagName)) {
        return;
      } else if (ev.key === 'ArrowRight' && currentData?.timeline) {
        stopPlayback();
        const years = currentData.timeline.map((p) => p.year);
        const idx = years.indexOf(activeYear);
        if (idx < years.length - 1) setActiveYear(years[idx + 1]);
      } else if (ev.key === 'ArrowLeft' && currentData?.timeline) {
        stopPlayback();
        const years = currentData.timeline.map((p) => p.year);
        const idx = years.indexOf(activeYear);
        if (idx > 0) setActiveYear(years[idx - 1]);
      } else if (ev.key === ' ') {
        ev.preventDefault();
        togglePlayback();
      }
    });

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
        playSpeedMs = Number(btn.dataset.speed) || 700;
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
