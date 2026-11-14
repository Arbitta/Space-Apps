/**
 * EarthLens — Inicio: Mapa de tu ubicación arriba + Datos en modo de filas abajo (index.js)
 */

(function (window, document) {
  'use strict';

  const DEFAULT_AR_CITY = {
    lat: -34.6037,
    lon: -58.3816,
    name: 'Buenos Aires, Argentina'
  };

  const HOME_VARIABLES = [
    {
      code: 'T2M',
      title: 'Temperatura Media',
      icon: '🌡️',
      unit: '°C',
      desc: 'Promedio anual a 2 metros'
    },
    {
      code: 'PRECTOTCORR',
      title: 'Precipitaciones',
      icon: '🌧️',
      unit: 'mm/día',
      desc: 'Lluvia media diaria corregida'
    },
    {
      code: 'RH2M',
      title: 'Humedad Relativa',
      icon: '💧',
      unit: '%',
      desc: 'Humedad atmosférica a 2 m'
    },
    {
      code: 'WS2M',
      title: 'Velocidad del Viento',
      icon: '💨',
      unit: 'm/s',
      desc: 'Viento medio a 2 metros'
    },
    {
      code: 'T2M_MAX',
      title: 'Temperatura Máxima',
      icon: '☀️',
      unit: '°C',
      desc: 'Extremos cálidos anuales'
    },
    {
      code: 'T2M_MIN',
      title: 'Temperatura Mínima',
      icon: '❄️',
      unit: '°C',
      desc: 'Extremos fríos anuales'
    }
  ];

  const START_YEAR = 2000;
  const END_YEAR = 2024;

  let map = null;
  let userMarker = null;
  let merraCell = null;

  const currentLoc = {
    lat: DEFAULT_AR_CITY.lat,
    lon: DEFAULT_AR_CITY.lon,
    label: DEFAULT_AR_CITY.name
  };

  function initHomeMap() {
    const container = document.getElementById('home-location-map');
    if (!container || typeof L === 'undefined') return;

    const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    });

    const satLayer = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      {
        maxZoom: 17,
        attribution: 'Tiles &copy; Esri, NASA'
      }
    );

    map = L.map('home-location-map', {
      center: [-38.4161, -63.6167],
      zoom: 4,
      minZoom: 2,
      layers: [osmLayer]
    });

    L.control.layers(
      {
        'Mapa Estándar (OSM)': osmLayer,
        'Vista Satelital': satLayer
      },
      null,
      { position: 'topleft' }
    ).addTo(map);

    L.control.scale({ metric: true, imperial: false, position: 'bottomright' }).addTo(map);

    // Si el usuario hace clic en el mapa, actualiza las filas de abajo para ese punto
    map.on('click', async function (e) {
      const lat = Number(e.latlng.lat.toFixed(4));
      const lon = Number(e.latlng.lng.toFixed(4));
      setLocationOnMap(lat, lon, 'Buscando nombre del lugar...', false);
      const placeName = await reverseGeocode(lat, lon);
      setLocationOnMap(lat, lon, placeName, false);
      loadAllEstimations(lat, lon);
    });
  }

  function setLocationOnMap(lat, lon, label, fly = true) {
    currentLoc.lat = Number(lat.toFixed(4));
    currentLoc.lon = Number(lon.toFixed(4));
    currentLoc.label = label || `${currentLoc.lat}°, ${currentLoc.lon}°`;

    const latLng = [currentLoc.lat, currentLoc.lon];
    const cellBounds = [
      [Math.max(-90, currentLoc.lat - 0.25), Math.max(-180, currentLoc.lon - 0.3125)],
      [Math.min(90, currentLoc.lat + 0.25), Math.min(180, currentLoc.lon + 0.3125)]
    ];

    if (map) {
      if (!userMarker) {
        userMarker = L.marker(latLng).addTo(map);
      } else {
        userMarker.setLatLng(latLng);
      }

      if (!merraCell) {
        merraCell = L.rectangle(cellBounds, {
          color: '#00b4d8',
          weight: 1.5,
          fillColor: '#00b4d8',
          fillOpacity: 0.15,
          dashArray: '4, 4',
          interactive: false
        }).addTo(map);
      } else {
        merraCell.setBounds(cellBounds);
      }

      userMarker.bindPopup(
        `<div class="small">
          <strong>📍 ${escapeHtml(currentLoc.label)}</strong><br>
          <span class="text-primary font-monospace">${currentLoc.lat.toFixed(4)}°, ${currentLoc.lon.toFixed(4)}°</span>
        </div>`
      ).openPopup();

      if (fly) {
        map.flyTo(latLng, 7, { duration: 1.0 });
      }
    }

    setText('user-location-name', currentLoc.label);
    setText('user-location-coords', `(${currentLoc.lat.toFixed(4)}°, ${currentLoc.lon.toFixed(4)}°)`);
    updateExplorerLinks();
  }

  function updateExplorerLinks() {
    const baseQs = new URLSearchParams({
      lat: currentLoc.lat,
      lon: currentLoc.lon,
      start_year: START_YEAR,
      end_year: END_YEAR,
      label: currentLoc.label
    }).toString();

    const baseHref = window.location.protocol === 'file:'
      ? `explorer.html?${baseQs}`
      : `/explorer?${baseQs}`;

    document.querySelectorAll('.js-go-explorer-link').forEach(function (el) {
      el.href = baseHref;
    });
  }

  async function reverseGeocode(lat, lon) {
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=10&accept-language=es`;
      const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
      if (!res.ok) throw new Error('Error Nominatim');
      const data = await res.json();
      const addr = data.address || {};
      const city = addr.city || addr.town || addr.village || addr.municipality || addr.county || addr.state_district || '';
      const state = addr.state || '';
      const country = addr.country || '';
      const parts = [city, state, country].filter(Boolean);
      if (parts.length > 0) return parts.join(', ');
    } catch (_) {}
    return `Ubicación (${lat.toFixed(2)}°, ${lon.toFixed(2)}°)`;
  }

  function detectUserLocation() {
    let resolved = false;
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        async function (pos) {
          resolved = true;
          const lat = Number(pos.coords.latitude.toFixed(4));
          const lon = Number(pos.coords.longitude.toFixed(4));
          const placeName = await reverseGeocode(lat, lon);
          setLocationOnMap(lat, lon, placeName, true);
          loadAllEstimations(lat, lon);
        },
        function () {
          if (!resolved) detectLocationByIpFallback();
        },
        { enableHighAccuracy: false, timeout: 5000, maximumAge: 60000 }
      );
    } else {
      detectLocationByIpFallback();
    }
  }

  async function detectLocationByIpFallback() {
    try {
      const res = await fetch('https://get.geojs.io/v1/ip/geo.json');
      if (res.ok) {
        const data = await res.json();
        const lat = parseFloat(data.latitude);
        const lon = parseFloat(data.longitude);
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          const labelParts = [data.city, data.region, data.country].filter(Boolean);
          const label = labelParts.length > 0 ? labelParts.join(', ') : await reverseGeocode(lat, lon);
          setLocationOnMap(lat, lon, label, true);
          loadAllEstimations(lat, lon);
          return;
        }
      }
    } catch (_) {}

    setLocationOnMap(DEFAULT_AR_CITY.lat, DEFAULT_AR_CITY.lon, DEFAULT_AR_CITY.name, true);
    loadAllEstimations(DEFAULT_AR_CITY.lat, DEFAULT_AR_CITY.lon);
  }

  function computeFallbackEstimation(lat, lon, varMeta) {
    const latFactor = Math.abs(lat) / 90;
    let avg = 15.0;
    let slope = 0.032;

    if (varMeta.code === 'T2M') {
      avg = Number((25.5 - latFactor * 26).toFixed(1));
      slope = 0.035;
    } else if (varMeta.code === 'PRECTOTCORR') {
      avg = Number((2.6 - latFactor * 1.3).toFixed(2));
      slope = -0.016;
    } else if (varMeta.code === 'RH2M') {
      avg = Number((65 - latFactor * 12).toFixed(1));
      slope = -0.07;
    } else if (varMeta.code === 'WS2M') {
      avg = Number((3.8 + latFactor * 4.0).toFixed(2));
      slope = 0.021;
    } else if (varMeta.code === 'T2M_MAX') {
      avg = Number((31.5 - latFactor * 25).toFixed(1));
      slope = 0.041;
    } else if (varMeta.code === 'T2M_MIN') {
      avg = Number((19.5 - latFactor * 27).toFixed(1));
      slope = 0.029;
    }

    const changePerDecade = Number((slope * 10).toFixed(2));
    const totalChange = Number((slope * (END_YEAR - START_YEAR)).toFixed(2));

    return {
      is_mock: true,
      variable: varMeta.code,
      mean_value: avg,
      statistics: {
        slope: slope,
        change_per_decade: changePerDecade,
        total_change: totalChange,
        p_value: 0.018,
        significant: true,
        direction: slope > 0 ? 'increasing' : 'decreasing'
      }
    };
  }

  async function loadAllEstimations(lat, lon) {
    renderLoadingRows();

    if (window.location.protocol !== 'file:') {
      try {
        const qs = new URLSearchParams({
          lat: lat,
          lon: lon,
          start_year: START_YEAR,
          end_year: END_YEAR
        }).toString();

        const res = await fetch(`/api/summary?${qs}`, {
          headers: { 'Accept': 'application/json' }
        });

        if (res.ok) {
          const data = await res.json();
          if (data && data.estimations) {
            renderEstimationRows(data.estimations, Boolean(data.is_mock));
            return;
          }
        }
      } catch (_) {}
    }

    const fallbackMap = {};
    HOME_VARIABLES.forEach(function (v) {
      fallbackMap[v.code] = computeFallbackEstimation(lat, lon, v);
    });
    renderEstimationRows(fallbackMap, true);
  }

  function renderLoadingRows() {
    const container = document.getElementById('estimations-rows');
    if (!container) return;

    const badge = document.getElementById('data-source-status');
    if (badge) {
      badge.className = 'badge bg-info-subtle text-info-emphasis';
      badge.textContent = 'Consultando NASA POWER...';
    }

    container.innerHTML = HOME_VARIABLES.map(function (v) {
      return `
        <div class="data-row-item">
          <div class="data-row-var">
            <span class="data-row-icon">${v.icon}</span>
            <div>
              <div class="fw-bold text-dark">${v.title} <code class="ms-1 small">${v.code}</code></div>
              <div class="text-muted small">${v.desc}</div>
            </div>
          </div>
          <div class="text-muted small">
            <span class="spinner-border spinner-border-sm text-primary me-2"></span>Calculando estimación...
          </div>
        </div>
      `;
    }).join('');
  }

  function renderEstimationRows(estimationsByCode, isMock) {
    const container = document.getElementById('estimations-rows');
    if (!container) return;

    const badge = document.getElementById('data-source-status');
    if (badge) {
      if (isMock) {
        badge.className = 'el-mock-badge';
        badge.textContent = '⚠️ Datos de prueba';
      } else {
        badge.className = 'badge bg-success-subtle text-success-emphasis border border-success-subtle';
        badge.textContent = '✓ Datos reales NASA POWER';
      }
    }

    container.innerHTML = HOME_VARIABLES.map(function (v) {
      const item = estimationsByCode[v.code] || computeFallbackEstimation(currentLoc.lat, currentLoc.lon, v);
      const stats = item.statistics || {};
      const meanVal = item.mean_value ?? '—';
      const decChange = stats.change_per_decade ?? 0;
      const totChange = stats.total_change ?? 0;
      const pVal = stats.p_value ?? 1;
      const sig = Boolean(stats.significant);

      const signDec = decChange > 0 ? '+' : '';
      const signTot = totChange > 0 ? '+' : '';

      let trendBadge = '<span class="badge bg-secondary-subtle text-secondary">↔ Estable</span>';
      if (sig && stats.direction === 'increasing') {
        trendBadge = '<span class="badge bg-danger-subtle text-danger-emphasis">↑ En aumento (p = ' + pVal + ')</span>';
      } else if (sig && stats.direction === 'decreasing') {
        trendBadge = '<span class="badge bg-primary-subtle text-primary-emphasis">↓ En descenso (p = ' + pVal + ')</span>';
      }

      const varExplorerQs = new URLSearchParams({
        lat: currentLoc.lat,
        lon: currentLoc.lon,
        variable: v.code,
        start_year: START_YEAR,
        end_year: END_YEAR,
        label: currentLoc.label
      }).toString();

      const varExplorerHref = window.location.protocol === 'file:'
        ? `explorer.html?${varExplorerQs}`
        : `/explorer?${varExplorerQs}`;

      return `
        <div class="data-row-item">
          <div class="data-row-var">
            <span class="data-row-icon">${v.icon}</span>
            <div>
              <div class="fw-bold text-dark">${v.title} <code class="ms-1 small">${v.code}</code></div>
              <div class="text-muted small">${v.desc}</div>
            </div>
          </div>

          <div class="data-row-metric">
            <span class="data-row-metric-label">Promedio estimado</span>
            <span class="data-row-metric-value">${meanVal} <small class="fw-normal text-secondary">${v.unit}</small></span>
          </div>

          <div class="data-row-metric">
            <span class="data-row-metric-label">Tendencia / década</span>
            <span class="data-row-metric-value ${decChange > 0 ? 'text-danger' : (decChange < 0 ? 'text-primary' : 'text-secondary')}">
              ${signDec}${decChange} <small class="fw-normal">${v.unit}</small>
            </span>
          </div>

          <div class="data-row-metric">
            <span class="data-row-metric-label">Cambio ${START_YEAR}–${END_YEAR}</span>
            <span class="data-row-metric-value">${signTot}${totChange} <small class="fw-normal text-secondary">${v.unit}</small></span>
          </div>

          <div class="data-row-metric">
            <span class="data-row-metric-label">Evidencia</span>
            <div>${trendBadge}</div>
          </div>

          <div class="data-row-action">
            <a href="${varExplorerHref}" class="btn btn-sm btn-outline-primary fw-semibold">
              Ver en Explorador &rarr;
            </a>
          </div>
        </div>
      `;
    }).join('');
  }

  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = String(str ?? '');
    return div.innerHTML;
  }

  function initHome() {
    initHomeMap();
    detectUserLocation();

    const btnMyLoc = document.getElementById('btn-detect-my-location');
    if (btnMyLoc) {
      btnMyLoc.addEventListener('click', function () {
        detectUserLocation();
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initHome);
  } else {
    initHome();
  }
})(window, document);
