/**
 * EarthLens — Rol 03: Lógica del Dashboard de Resultados (results.js)
 * Incluye correcciones de auditoría:
 *  - H-01: Validación de particiones de equivalencia y valores límite (1981–2024, span >= 2).
 *  - H-06: Sincronización bidireccional de #quickLocationSelect con URL/sessionStorage y disparo reactivo.
 *  - Control de concurrencia asíncrona con AbortController y secuencia de peticiones.
 */

document.addEventListener('DOMContentLoaded', () => {
  let currentPayload = null;
  let activeAbortController = null;
  let requestSeq = 0;

  let currentRequestParams = EarthLensCharts.sanitizeRequestParams({
    latitude: -45.86,
    longitude: -67.50,
    locationName: 'Comodoro Rivadavia, Chubut',
    variable: 'T2M',
    start_year: 2000,
    end_year: 2024
  });

  const LOCATION_PRESETS = Object.freeze({
    comodoro: { name: 'Comodoro Rivadavia, Chubut', latitude: -45.86, longitude: -67.50 },
    bariloche: { name: 'San Carlos de Bariloche, Río Negro', latitude: -41.13, longitude: -71.31 },
    ushuaia: { name: 'Ushuaia, Tierra del Fuego', latitude: -54.80, longitude: -68.30 },
    riogallegos: { name: 'Río Gallegos, Santa Cruz', latitude: -51.62, longitude: -69.22 },
    madryn: { name: 'Puerto Madryn, Chubut', latitude: -42.77, longitude: -65.03 }
  });

  /**
   * Busca si las coordenadas coinciden con algún preset o sincroniza una opción 'custom' en el <select>
   * (Corrección del hallazgo H-06).
   */
  function syncLocationSelectUI(lat, lon, locName) {
    const locSelect = document.getElementById('quickLocationSelect');
    if (!locSelect) return;

    let matchedKey = null;
    for (const [key, preset] of Object.entries(LOCATION_PRESETS)) {
      if (Math.abs(preset.latitude - lat) < 0.15 && Math.abs(preset.longitude - lon) < 0.15) {
        matchedKey = key;
        break;
      }
    }

    if (matchedKey) {
      locSelect.value = matchedKey;
      return;
    }

    let customOpt = locSelect.querySelector('option[value="custom"]');
    if (!customOpt) {
      customOpt = document.createElement('option');
      customOpt.value = 'custom';
      locSelect.prepend(customOpt);
    }
    customOpt.textContent = `${locName} (${Number(lat).toFixed(2)}, ${Number(lon).toFixed(2)})`;
    customOpt.dataset.lat = String(lat);
    customOpt.dataset.lon = String(lon);
    customOpt.dataset.name = locName;
    locSelect.value = 'custom';
  }

  /**
   * 1. Lee parámetros desde la URL o sessionStorage y los normaliza con sanitizeRequestParams (H-01).
   */
  function loadInitialParams() {
    const params = new URLSearchParams(window.location.search);

    if (params.has('lat') || params.has('latitude') || params.has('variable')) {
      currentRequestParams = EarthLensCharts.sanitizeRequestParams({
        latitude: params.get('latitude') || params.get('lat'),
        longitude: params.get('longitude') || params.get('lon'),
        variable: params.get('variable'),
        start_year: params.get('start_year') || params.get('start'),
        end_year: params.get('end_year') || params.get('end'),
        locationName: params.get('location') || params.get('label')
      });
      return;
    }

    try {
      const bundleRaw =
        sessionStorage.getItem('earthlens_analysis_bundle') ||
        localStorage.getItem('earthlens_analysis_bundle');
      if (bundleRaw) {
        const bundle = JSON.parse(bundleRaw);
        if (bundle && bundle.request) {
          currentRequestParams = EarthLensCharts.sanitizeRequestParams({
            ...bundle.request,
            locationName: bundle.location_label || bundle.request.locationName
          });
          return;
        }
      }

      const savedReq =
        sessionStorage.getItem('earthlens_last_request') ||
        sessionStorage.getItem('earthlens_query_params');
      if (savedReq) {
        const parsed = JSON.parse(savedReq);
        currentRequestParams = EarthLensCharts.sanitizeRequestParams({
          ...currentRequestParams,
          ...parsed
        });
      }
    } catch (err) {
      console.warn('No se pudo leer sessionStorage:', err);
    }
  }

  /**
   * 2. Consulta POST /api/analyze con control de concurrencia (AbortController) y límites saneados.
   */
  async function fetchAnalysisData(rawReqParams, forceMock = false) {
    const cleanParams = EarthLensCharts.sanitizeRequestParams(rawReqParams);
    currentRequestParams = cleanParams;

    if (activeAbortController) {
      activeAbortController.abort();
    }
    activeAbortController = new AbortController();
    const mySeq = ++requestSeq;

    setLoadingState(true);

    const requestBody = {
      latitude: cleanParams.latitude,
      longitude: cleanParams.longitude,
      variable: cleanParams.variable,
      start_year: cleanParams.start_year,
      end_year: cleanParams.end_year,
      location_name: cleanParams.locationName
    };

    if (!forceMock) {
      try {
        const response = await fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
          signal: activeAbortController.signal
        });

        if (response.ok) {
          const liveData = await response.json();
          if (mySeq !== requestSeq) return null; // Petición superada por otra más reciente
          liveData.is_mock = Boolean(liveData.is_mock);
          liveData.location = liveData.location || {
            name: cleanParams.locationName,
            latitude: cleanParams.latitude,
            longitude: cleanParams.longitude
          };
          liveData.period = {
            start_year: cleanParams.start_year,
            end_year: cleanParams.end_year
          };
          setLoadingState(false);
          return liveData;
        }
      } catch (err) {
        if (err && err.name === 'AbortError') {
          return null;
        }
        console.info('Endpoint /api/analyze no disponible; cargando datos de prueba del contrato JSON.');
      }
    }

    if (mySeq !== requestSeq) return null;
    const mockData = EarthLensCharts.buildMockAnalysis(cleanParams);
    setLoadingState(false);
    return mockData;
  }

  /**
   * 3. Renderiza todos los indicadores del dashboard, la conclusión, la tabla y el gráfico Chart.js
   */
  function renderDashboard(data) {
    if (!data) return;
    currentPayload = data;
    const stats = data.statistics || {};
    const series = data.series || [];
    const varMeta = EarthLensCharts.VARIABLES_META[data.variable] || {
      name: data.variable,
      unit: data.unit || '',
      decimals: 2
    };
    const unitDisplay = data.unit === 'deg C' ? '°C' : data.unit || varMeta.unit;

    const banner = document.getElementById('dataModeBanner');
    const bannerText = document.getElementById('dataModeText');
    if (banner && bannerText) {
      if (data.is_mock) {
        banner.classList.remove('is-live');
        bannerText.innerHTML =
          '<strong>MODO DATOS DE PRUEBA (Contrato JSON):</strong> Mostrando serie simulada de referencia (Comodoro Rivadavia / Patagonia 2000–2024) mientras el endpoint <code>POST /api/analyze</code> del backend no esté activo.';
      } else {
        banner.classList.add('is-live');
        bannerText.innerHTML =
          '<strong>CONECTADO AL BACKEND NASA POWER:</strong> Datos científicos y análisis estadístico (SciPy) obtenidos desde <code>POST /api/analyze</code>.';
      }
    }

    const locName = data.location?.name || currentRequestParams.locationName;
    const lat = data.location?.latitude ?? currentRequestParams.latitude;
    const lon = data.location?.longitude ?? currentRequestParams.longitude;
    const startYr = series[0]?.year ?? currentRequestParams.start_year;
    const endYr = series[series.length - 1]?.year ?? currentRequestParams.end_year;

    // Sincronizar los controles del formulario superior con el estado activo (H-01 y H-06)
    syncLocationSelectUI(lat, lon, locName);
    const varSelect = document.getElementById('quickVariableSelect');
    const startInput = document.getElementById('quickStartYear');
    const endInput = document.getElementById('quickEndYear');
    if (varSelect) varSelect.value = data.variable;
    if (startInput) startInput.value = startYr;
    if (endInput) endInput.value = endYr;

    setText('resLocationTitle', locName);
    setText('resCoordinates', `Lat: ${Number(lat).toFixed(2)}° · Lon: ${Number(lon).toFixed(2)}°`);
    setText('resVariableBadge', `${varMeta.name} (${data.variable})`);
    setText('resPeriodBadge', `Período: ${startYr} – ${endYr} (${series.length} años)`);
    setText('resSourceText', data.source || 'NASA POWER / MERRA-2');

    const slope = Number(stats.slope ?? 0);
    const slopeSign = slope >= 0 ? '+' : '';
    setText('metricSlope', `${slopeSign}${slope.toFixed(4)} ${unitDisplay}/año`);

    const decadal = Number(stats.change_per_decade ?? slope * 10);
    const decadalSign = decadal >= 0 ? '+' : '';
    setText('metricDecade', `Cambio por década: ${decadalSign}${decadal.toFixed(3)} ${unitDisplay}/década`);

    const totalChange = Number(stats.total_change ?? slope * (endYr - startYr));
    const totalSign = totalChange >= 0 ? '+' : '';
    setText('metricTotalChange', `${totalSign}${totalChange.toFixed(2)} ${unitDisplay}`);
    setText('metricTotalSub', `Cambio estimado entre ${startYr} y ${endYr}`);

    const pVal = Number(stats.p_value ?? 1);
    const isSig = Boolean(stats.significant ?? pVal < 0.05);
    setText('metricPValue', pVal < 0.0001 ? '< 0.0001' : pVal.toFixed(4));

    const sigBadge = document.getElementById('metricSigBadge');
    if (sigBadge) {
      sigBadge.className = `badge rounded-pill ${isSig ? 'badge-sig-yes' : 'badge-sig-no'}`;
      sigBadge.textContent = isSig
        ? 'Evidencia significativa (p < 0.05)'
        : 'No significativo (p ≥ 0.05)';
    }

    const dirMap = {
      increasing: { label: 'Tendencia Ascendente ↑', icon: '📈' },
      decreasing: { label: 'Tendencia Descendente ↓', icon: '📉' },
      stable: { label: 'Sin tendencia clara →', icon: '➖' },
      no_clear_trend: { label: 'Sin tendencia clara →', icon: '➖' }
    };
    const dirInfo = dirMap[stats.direction] || dirMap.stable;
    setText('metricDirection', `${dirInfo.icon} ${dirInfo.label}`);

    if (Array.isArray(stats.confidence_interval_95) && stats.confidence_interval_95.length === 2) {
      setText(
        'metricConfidence',
        `IC 95% pendiente: [${stats.confidence_interval_95[0]}, ${stats.confidence_interval_95[1]}] ${unitDisplay}/año`
      );
    } else {
      const values = series.map((s) => s.value);
      const meanVal = values.length
        ? (values.reduce((a, b) => a + b, 0) / values.length).toFixed(2)
        : '--';
      setText('metricConfidence', `Promedio del período: ${meanVal} ${unitDisplay}`);
    }

    setText('resConclusionText', data.conclusion || 'Análisis completado.');
    const conclusionBox = document.getElementById('resConclusionBox');
    if (conclusionBox) {
      conclusionBox.className = 'conclusion-box mb-4';
      if (isSig && stats.direction === 'increasing') {
        conclusionBox.classList.add('significant-increasing');
      } else if (isSig && stats.direction === 'decreasing') {
        conclusionBox.classList.add('significant-decreasing');
      }
    }

    const showCICheckbox = document.getElementById('toggleConfidenceBand');
    const showConfidence = showCICheckbox ? showCICheckbox.checked : true;
    EarthLensCharts.renderTrendChart('resultsTrendChart', data, { showConfidence });

    renderSeriesTable(series, stats, unitDisplay);

    const compareLink = document.getElementById('btnGoToCompare');
    if (compareLink) {
      const q = new URLSearchParams({
        latA: lat,
        lonA: lon,
        nameA: locName,
        variable: data.variable,
        start_year: startYr,
        end_year: endYr
      });
      compareLink.href = window.location.protocol === 'file:'
        ? `compare.html?${q.toString()}`
        : `/compare?${q.toString()}`;
    }
  }

  function renderSeriesTable(series, stats, unitDisplay) {
    const tbody = document.getElementById('seriesTableBody');
    if (!tbody) return;

    const { trendPoints } = EarthLensCharts.computeRegressionLine(series, stats);
    const meanVal =
      series.length > 0 ? series.reduce((acc, d) => acc + d.value, 0) / series.length : 0;

    tbody.innerHTML = series
      .map((item, idx) => {
        const fit = trendPoints[idx] ?? item.value;
        const anomaly = item.value - meanVal;
        const anomSign = anomaly >= 0 ? '+' : '';
        return `
          <tr>
            <td class="fw-semibold">${item.year}</td>
            <td>${item.value.toFixed(2)} ${unitDisplay}</td>
            <td>${fit.toFixed(2)} ${unitDisplay}</td>
            <td class="${anomaly >= 0 ? 'text-danger' : 'text-primary'}">${anomSign}${anomaly.toFixed(2)} ${unitDisplay}</td>
          </tr>
        `;
      })
      .join('');
  }

  function handleExportCSV() {
    if (!currentPayload) return;

    const series = currentPayload.series || [];
    const stats = currentPayload.statistics || {};
    const { trendPoints } = EarthLensCharts.computeRegressionLine(series, stats);
    const locName = currentPayload.location?.name || currentRequestParams.locationName;

    const metadata = [
      `Proyecto: EarthLens - NASA Space Apps Challenge 2026`,
      `Ubicacion: ${locName} (${currentRequestParams.latitude}, ${currentRequestParams.longitude})`,
      `Variable: ${currentPayload.variable} (${currentPayload.unit})`,
      `Fuente: ${currentPayload.source}`,
      `Pendiente anual: ${stats.slope} | Cambio por decada: ${stats.change_per_decade} | Cambio total: ${stats.total_change}`,
      `p-valor: ${stats.p_value} | Significativo (p<0.05): ${stats.significant} | Direccion: ${stats.direction}`,
      `Conclusion: ${currentPayload.conclusion}`
    ];

    const headers = ['anio', 'valor_observado', 'valor_regresion_lineal', 'unidad', 'variable'];
    const rows = series.map((item, idx) => [
      item.year,
      item.value,
      trendPoints[idx] ?? '',
      currentPayload.unit,
      currentPayload.variable
    ]);

    const safeVar = (currentPayload.variable || 'serie').toLowerCase();
    const startYr = series[0]?.year || 2000;
    const endYr = series[series.length - 1]?.year || 2024;
    EarthLensCharts.downloadCSV(
      `earthlens_${safeVar}_${startYr}_${endYr}.csv`,
      headers,
      rows,
      metadata
    );
  }

  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function setLoadingState(isLoading) {
    const spinner = document.getElementById('resultsLoadingSpinner');
    if (spinner) {
      spinner.classList.toggle('d-none', !isLoading);
    }
  }

  async function triggerAnalysisFromControls() {
    const varSelect = document.getElementById('quickVariableSelect');
    const locSelect = document.getElementById('quickLocationSelect');
    const startInput = document.getElementById('quickStartYear');
    const endInput = document.getElementById('quickEndYear');

    if (locSelect) {
      const selectedVal = locSelect.value;
      if (LOCATION_PRESETS[selectedVal]) {
        const preset = LOCATION_PRESETS[selectedVal];
        currentRequestParams.latitude = preset.latitude;
        currentRequestParams.longitude = preset.longitude;
        currentRequestParams.locationName = preset.name;
      } else if (selectedVal === 'custom') {
        const customOpt = locSelect.querySelector('option[value="custom"]');
        if (customOpt && customOpt.dataset.lat && customOpt.dataset.lon) {
          currentRequestParams.latitude = parseFloat(customOpt.dataset.lat);
          currentRequestParams.longitude = parseFloat(customOpt.dataset.lon);
          currentRequestParams.locationName = customOpt.dataset.name || currentRequestParams.locationName;
        }
      }
    }

    if (varSelect) {
      currentRequestParams.variable = varSelect.value;
    }

    if (startInput && endInput) {
      currentRequestParams.start_year = parseInt(startInput.value, 10);
      currentRequestParams.end_year = parseInt(endInput.value, 10);
    }

    currentRequestParams = EarthLensCharts.sanitizeRequestParams(currentRequestParams);
    if (startInput) startInput.value = currentRequestParams.start_year;
    if (endInput) endInput.value = currentRequestParams.end_year;

    const data = await fetchAnalysisData(currentRequestParams);
    if (data) {
      renderDashboard(data);
    }
  }

  function bindControls() {
    const varSelect = document.getElementById('quickVariableSelect');
    const locSelect = document.getElementById('quickLocationSelect');
    const startInput = document.getElementById('quickStartYear');
    const endInput = document.getElementById('quickEndYear');
    const btnApply = document.getElementById('btnUpdateResults');
    const btnExportCSV = document.getElementById('btnExportCSV');
    const toggleCI = document.getElementById('toggleConfidenceBand');

    if (varSelect) {
      varSelect.value = currentRequestParams.variable;
      varSelect.addEventListener('change', triggerAnalysisFromControls);
    }

    if (locSelect) {
      syncLocationSelectUI(
        currentRequestParams.latitude,
        currentRequestParams.longitude,
        currentRequestParams.locationName
      );
      locSelect.addEventListener('change', triggerAnalysisFromControls);
    }

    if (startInput) startInput.value = currentRequestParams.start_year;
    if (endInput) endInput.value = currentRequestParams.end_year;

    if (btnApply) {
      btnApply.addEventListener('click', triggerAnalysisFromControls);
    }

    if (toggleCI) {
      toggleCI.addEventListener('change', () => {
        if (currentPayload) {
          EarthLensCharts.renderTrendChart('resultsTrendChart', currentPayload, {
            showConfidence: toggleCI.checked
          });
        }
      });
    }

    if (btnExportCSV) {
      btnExportCSV.addEventListener('click', handleExportCSV);
    }
  }

  (async function init() {
    loadInitialParams();
    bindControls();
    const initialData = await fetchAnalysisData(currentRequestParams);
    if (initialData) {
      renderDashboard(initialData);
    }
  })();
});
