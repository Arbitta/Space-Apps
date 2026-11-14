/**
 * EarthLens — Rol 03: Lógica del Dashboard de Resultados (results.js)
 * Conectado al contrato JSON de POST /api/analyze y con soporte de datos de prueba etiquetados.
 */

document.addEventListener('DOMContentLoaded', () => {
  // Estado actual del análisis mostrado en pantalla
  let currentPayload = null;
  let currentRequestParams = {
    latitude: -45.86,
    longitude: -67.50,
    locationName: 'Comodoro Rivadavia, Chubut',
    variable: 'T2M',
    start_year: 2000,
    end_year: 2024
  };

  // Presets de ubicaciones para probar rápido desde Resultados
  const LOCATION_PRESETS = {
    comodoro: { name: 'Comodoro Rivadavia, Chubut', latitude: -45.86, longitude: -67.50 },
    bariloche: { name: 'San Carlos de Bariloche, Río Negro', latitude: -41.13, longitude: -71.31 },
    ushuaia: { name: 'Ushuaia, Tierra del Fuego', latitude: -54.80, longitude: -68.30 },
    riogallegos: { name: 'Río Gallegos, Santa Cruz', latitude: -51.62, longitude: -69.22 },
    madryn: { name: 'Puerto Madryn, Chubut', latitude: -42.77, longitude: -65.03 }
  };

  /**
   * 1. Lee parámetros desde la URL (?lat=...&lon=...&variable=...&start_year=...&end_year=...)
   *    o desde sessionStorage (si el Explorador guardó el resultado previamente).
   */
  function loadInitialParams() {
    const params = new URLSearchParams(window.location.search);

    if (params.has('lat') || params.has('latitude') || params.has('variable')) {
      currentRequestParams.latitude = parseFloat(params.get('latitude') || params.get('lat') || -45.86);
      currentRequestParams.longitude = parseFloat(params.get('longitude') || params.get('lon') || -67.50);
      currentRequestParams.variable = (params.get('variable') || 'T2M').toUpperCase();
      currentRequestParams.start_year = parseInt(params.get('start_year') || params.get('start') || 2000, 10);
      currentRequestParams.end_year = parseInt(params.get('end_year') || params.get('end') || 2024, 10);
      currentRequestParams.locationName =
        params.get('location') ||
        `Coord (${currentRequestParams.latitude.toFixed(2)}°, ${currentRequestParams.longitude.toFixed(2)}°)`;
      return;
    }

    // Revisar si el explorador (Rol 02) guardó una consulta en sessionStorage
    try {
      const savedReq = sessionStorage.getItem('earthlens_query_params');
      if (savedReq) {
        const parsed = JSON.parse(savedReq);
        currentRequestParams = { ...currentRequestParams, ...parsed };
      }
    } catch (err) {
      console.warn('No se pudo leer sessionStorage:', err);
    }
  }

  /**
   * 2. Consulta al endpoint POST /api/analyze respetando el contrato de la Página 6.
   *    Si el backend aún no está levantado, usa los datos de prueba etiquetados.
   */
  async function fetchAnalysisData(reqParams, forceMock = false) {
    setLoadingState(true);

    const requestBody = {
      latitude: Number(reqParams.latitude),
      longitude: Number(reqParams.longitude),
      variable: reqParams.variable,
      start_year: Number(reqParams.start_year),
      end_year: Number(reqParams.end_year)
    };

    if (!forceMock) {
      try {
        const response = await fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody)
        });

        if (response.ok) {
          const liveData = await response.json();
          liveData.is_mock = false;
          liveData.location = liveData.location || {
            name: reqParams.locationName,
            latitude: requestBody.latitude,
            longitude: requestBody.longitude
          };
          liveData.period = {
            start_year: requestBody.start_year,
            end_year: requestBody.end_year
          };
          setLoadingState(false);
          return liveData;
        }
      } catch (err) {
        // Backend Flask no disponible o archivo abierto directamente: usar Mock Data etiquetado
        console.info('Endpoint /api/analyze no disponible aún; cargando datos de prueba del contrato JSON.');
      }
    }

    const mockData = EarthLensCharts.buildMockAnalysis(reqParams);
    setLoadingState(false);
    return mockData;
  }

  /**
   * 3. Renderiza todos los indicadores del dashboard, la conclusión, la tabla y el gráfico Chart.js
   */
  function renderDashboard(data) {
    currentPayload = data;
    const stats = data.statistics || {};
    const series = data.series || [];
    const varMeta = EarthLensCharts.VARIABLES_META[data.variable] || {
      name: data.variable,
      unit: data.unit || '',
      decimals: 2
    };
    const unitDisplay = data.unit === 'deg C' ? '°C' : data.unit || varMeta.unit;

    // Banner de modo de datos (Prueba vs API Real)
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
          '<strong>CONECTADO AL BACKEND NASA POWER:</strong> Datos científicos reales obtenidos desde <code>POST /api/analyze</code>.';
      }
    }

    // Encabezado de contexto
    const locName = data.location?.name || currentRequestParams.locationName;
    const lat = data.location?.latitude ?? currentRequestParams.latitude;
    const lon = data.location?.longitude ?? currentRequestParams.longitude;
    const startYr = series[0]?.year ?? currentRequestParams.start_year;
    const endYr = series[series.length - 1]?.year ?? currentRequestParams.end_year;

    setText('resLocationTitle', locName);
    setText('resCoordinates', `Lat: ${Number(lat).toFixed(2)}° · Lon: ${Number(lon).toFixed(2)}°`);
    setText('resVariableBadge', `${varMeta.name} (${data.variable})`);
    setText('resPeriodBadge', `Período: ${startYr} – ${endYr} (${series.length} años)`);
    setText('resSourceText', data.source || 'NASA POWER / MERRA-2');

    // Métrica 1: Pendiente lineal (slope)
    const slope = Number(stats.slope ?? 0);
    const slopeSign = slope >= 0 ? '+' : '';
    setText('metricSlope', `${slopeSign}${slope.toFixed(4)} ${unitDisplay}/año`);

    const decadal = Number(stats.change_per_decade ?? slope * 10);
    const decadalSign = decadal >= 0 ? '+' : '';
    setText('metricDecade', `Cambio por década: ${decadalSign}${decadal.toFixed(3)} ${unitDisplay}/década`);

    // Métrica 2: Magnitud del cambio total en el período
    const totalChange = Number(stats.total_change ?? slope * (endYr - startYr));
    const totalSign = totalChange >= 0 ? '+' : '';
    setText('metricTotalChange', `${totalSign}${totalChange.toFixed(2)} ${unitDisplay}`);
    setText('metricTotalSub', `Cambio estimado entre ${startYr} y ${endYr}`);

    // Métrica 3: p-valor y significancia estadística (umbral α = 0.05)
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

    // Métrica 4: Dirección e intervalo de confianza
    const dirMap = {
      increasing: { label: 'Tendencia Ascendente ↑', icon: '📈' },
      decreasing: { label: 'Tendencia Descendente ↓', icon: '📉' },
      stable: { label: 'Sin tendencia clara →', icon: '➖' }
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

    // Conclusión e interpretación basada en evidencia
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

    // Renderizar gráfico con Chart.js
    const showCICheckbox = document.getElementById('toggleConfidenceBand');
    const showConfidence = showCICheckbox ? showCICheckbox.checked : true;
    EarthLensCharts.renderTrendChart('resultsTrendChart', data, { showConfidence });

    // Poblar tabla anual con valores observados y estimados por la regresión
    renderSeriesTable(series, stats, unitDisplay);

    // Actualizar enlace hacia el Comparador pre-cargando la Ubicación A
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
      compareLink.href = `compare.html?${q.toString()}`;
    }
  }

  /**
   * 4. Llena la tabla desplegable de datos anuales + valores ajustados por regresión
   */
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

  /**
   * 5. Exporta la serie actual y sus métricas estadísticas a CSV
   */
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

  /**
   * 6. Sincroniza controles interactivos del panel superior
   */
  function bindControls() {
    const varSelect = document.getElementById('quickVariableSelect');
    const locSelect = document.getElementById('quickLocationSelect');
    const startInput = document.getElementById('quickStartYear');
    const endInput = document.getElementById('quickEndYear');
    const btnApply = document.getElementById('btnUpdateResults');
    const btnExportCSV = document.getElementById('btnExportCSV');
    const toggleCI = document.getElementById('toggleConfidenceBand');

    if (varSelect) varSelect.value = currentRequestParams.variable;
    if (startInput) startInput.value = currentRequestParams.start_year;
    if (endInput) endInput.value = currentRequestParams.end_year;

    if (locSelect) {
      locSelect.addEventListener('change', () => {
        const preset = LOCATION_PRESETS[locSelect.value];
        if (preset) {
          currentRequestParams.latitude = preset.latitude;
          currentRequestParams.longitude = preset.longitude;
          currentRequestParams.locationName = preset.name;
        }
      });
    }

    if (btnApply) {
      btnApply.addEventListener('click', async () => {
        if (varSelect) currentRequestParams.variable = varSelect.value;
        if (startInput && endInput) {
          const s = parseInt(startInput.value, 10) || 2000;
          const e = parseInt(endInput.value, 10) || 2024;
          currentRequestParams.start_year = Math.min(s, e - 2);
          currentRequestParams.end_year = Math.max(s + 2, e);
          startInput.value = currentRequestParams.start_year;
          endInput.value = currentRequestParams.end_year;
        }
        const data = await fetchAnalysisData(currentRequestParams);
        renderDashboard(data);
      });
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

  // Inicialización principal
  (async function init() {
    loadInitialParams();
    bindControls();
    const initialData = await fetchAnalysisData(currentRequestParams);
    renderDashboard(initialData);
  })();
});
