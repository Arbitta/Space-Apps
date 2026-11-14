/**
 * EarthLens — Rol 03: Lógica del Comparador de Dos Ubicaciones (compare.js)
 * Compara dos ubicaciones con la misma variable, misma unidad y mismo período.
 * Soporta parámetros desde explorer.js (?lat1, ?lon1) y desde results.js (?latA, ?lonA).
 */

document.addEventListener('DOMContentLoaded', () => {
  const PRESET_COORDS = {
    comodoro: { name: 'Comodoro Rivadavia, Chubut', latitude: -45.86, longitude: -67.50 },
    ushuaia: { name: 'Ushuaia, Tierra del Fuego', latitude: -54.80, longitude: -68.30 },
    bariloche: { name: 'San Carlos de Bariloche, Río Negro', latitude: -41.13, longitude: -71.31 },
    riogallegos: { name: 'Río Gallegos, Santa Cruz', latitude: -51.62, longitude: -69.22 },
    madryn: { name: 'Puerto Madryn, Chubut', latitude: -42.77, longitude: -65.03 },
    neuquen: { name: 'Neuquén Capital, Neuquén', latitude: -38.95, longitude: -68.06 }
  };

  let state = {
    variable: 'T2M',
    start_year: 2000,
    end_year: 2024,
    locA: { ...PRESET_COORDS.comodoro },
    locB: { ...PRESET_COORDS.ushuaia },
    dataA: null,
    dataB: null
  };

  function initFromURL() {
    const params = new URLSearchParams(window.location.search);

    if (params.get('variable')) {
      state.variable = params.get('variable').toUpperCase();
    }
    if (params.get('start_year')) {
      state.start_year = parseInt(params.get('start_year'), 10) || 2000;
    }
    if (params.get('end_year')) {
      state.end_year = parseInt(params.get('end_year'), 10) || 2024;
    }

    const latA = params.get('latA') || params.get('lat1');
    const lonA = params.get('lonA') || params.get('lon1');
    if (latA && lonA) {
      state.locA = {
        name: params.get('nameA') || params.get('label1') || `Ubicación A (${latA}, ${lonA})`,
        latitude: parseFloat(latA),
        longitude: parseFloat(lonA)
      };
    }

    const latB = params.get('latB') || params.get('lat2');
    const lonB = params.get('lonB') || params.get('lon2');
    if (latB && lonB) {
      state.locB = {
        name: params.get('nameB') || params.get('label2') || `Ubicación B (${latB}, ${lonB})`,
        latitude: parseFloat(latB),
        longitude: parseFloat(lonB)
      };
    }
  }

  async function fetchSingleLocation(loc) {
    const payload = {
      latitude: Number(loc.latitude),
      longitude: Number(loc.longitude),
      variable: state.variable,
      start_year: Number(state.start_year),
      end_year: Number(state.end_year),
      location_name: loc.name
    };

    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        const json = await res.json();
        json.is_mock = Boolean(json.is_mock);
        json.location = { name: loc.name, latitude: loc.latitude, longitude: loc.longitude };
        return json;
      }
    } catch (_) {}

    return EarthLensCharts.buildMockAnalysis({
      latitude: loc.latitude,
      longitude: loc.longitude,
      locationName: loc.name,
      variable: state.variable,
      start_year: state.start_year,
      end_year: state.end_year
    });
  }

  async function runComparison() {
    const [resA, resB] = await Promise.all([
      fetchSingleLocation(state.locA),
      fetchSingleLocation(state.locB)
    ]);

    state.dataA = resA;
    state.dataB = resB;

    renderComparisonUI(resA, resB);
  }

  function renderComparisonUI(dataA, dataB) {
    const varMeta = EarthLensCharts.VARIABLES_META[state.variable] || {
      name: state.variable,
      unit: dataA.unit || ''
    };
    const unitDisplay = dataA.unit === 'deg C' ? '°C' : dataA.unit || varMeta.unit;

    const banner = document.getElementById('compareModeBanner');
    const bannerText = document.getElementById('compareModeText');
    if (banner && bannerText) {
      const isMock = dataA.is_mock || dataB.is_mock;
      banner.classList.toggle('is-live', !isMock);
      bannerText.innerHTML = isMock
        ? '<strong>MODO DATOS DE PRUEBA (Contrato JSON):</strong> Comparando series simuladas reproducibles con la misma variable y período mientras el backend Flask no esté activo.'
        : '<strong>CONECTADO AL BACKEND NASA POWER:</strong> Comparación calculada con datos de NASA POWER / MERRA-2 y motor estadístico SciPy.';
    }

    setText('cmpSharedVariable', `${varMeta.name} (${state.variable}) · Unidad: ${unitDisplay}`);
    setText('cmpSharedPeriod', `Período común: ${state.start_year} – ${state.end_year}`);

    populateLocationColumn('A', state.locA, dataA, unitDisplay);
    populateLocationColumn('B', state.locB, dataB, unitDisplay);

    // Veredicto del Modo detective (Persona 5): la hipótesis se evalúa sobre la Ubicación A.
    if (window.EarthLensMissions && !dataA.is_mock) {
      EarthLensMissions.renderVerdict(
        document.getElementById('mission-verdict'),
        dataA.statistics,
        { variable: state.variable, latitude: state.locA.latitude, longitude: state.locA.longitude },
        state.locA.name
      );
    }

    renderComparativeSynthesis(state.locA.name, state.locB.name, dataA, dataB, varMeta, unitDisplay);

    const showTrends = document.getElementById('cmpToggleTrendlines')?.checked ?? true;
    EarthLensCharts.renderComparisonChart(
      'comparisonChart',
      dataA,
      dataB,
      state.locA.name,
      state.locB.name,
      showTrends
    );

    renderComparisonTable(dataA, dataB, unitDisplay);
  }

  function populateLocationColumn(suffix, loc, data, unitDisplay) {
    const stats = data.statistics || {};
    const series = data.series || [];
    const meanVal =
      series.length > 0
        ? (series.reduce((acc, d) => acc + d.value, 0) / series.length).toFixed(2)
        : '--';

    const slope = Number(stats.slope ?? 0);
    const decadal = Number(stats.change_per_decade ?? slope * 10);
    const total = Number(stats.total_change ?? 0);
    const pVal = Number(stats.p_value ?? 1);
    const isSig = Boolean(stats.significant ?? pVal < 0.05);

    setText(`cmpName${suffix}`, loc.name);
    setText(
      `cmpCoords${suffix}`,
      `Lat: ${Number(loc.latitude).toFixed(2)}° · Lon: ${Number(loc.longitude).toFixed(2)}°`
    );
    setText(`cmpMean${suffix}`, `${meanVal} ${unitDisplay}`);
    setText(`cmpSlope${suffix}`, `${slope >= 0 ? '+' : ''}${slope.toFixed(4)} ${unitDisplay}/año`);
    setText(`cmpDecade${suffix}`, `${decadal >= 0 ? '+' : ''}${decadal.toFixed(3)} ${unitDisplay}/década`);
    setText(`cmpTotal${suffix}`, `${total >= 0 ? '+' : ''}${total.toFixed(2)} ${unitDisplay}`);
    setText(`cmpPVal${suffix}`, pVal < 0.0001 ? '< 0.0001' : pVal.toFixed(4));
    setText(`cmpConclusion${suffix}`, data.conclusion || '');

    const badge = document.getElementById(`cmpSigBadge${suffix}`);
    if (badge) {
      badge.className = `badge rounded-pill ${isSig ? 'badge-sig-yes' : 'badge-sig-no'}`;
      badge.textContent = isSig ? 'Significativo (p < 0.05)' : 'No significativo (p ≥ 0.05)';
    }
  }

  function renderComparativeSynthesis(nameA, nameB, dataA, dataB, varMeta, unitDisplay) {
    const sA = dataA.statistics || {};
    const sB = dataB.statistics || {};

    const decA = Number(sA.change_per_decade ?? 0);
    const decB = Number(sB.change_per_decade ?? 0);
    const totA = Number(sA.total_change ?? 0);
    const totB = Number(sB.total_change ?? 0);

    const meanA =
      dataA.series.reduce((a, b) => a + b.value, 0) / Math.max(1, dataA.series.length);
    const meanB =
      dataB.series.reduce((a, b) => a + b.value, 0) / Math.max(1, dataB.series.length);
    const diffMean = (meanA - meanB).toFixed(2);
    const diffDecade = (decA - decB).toFixed(3);
    const diffTotal = (totA - totB).toFixed(2);

    const fasterLoc = Math.abs(decA) >= Math.abs(decB) ? nameA : nameB;
    const fasterRate = Math.abs(decA) >= Math.abs(decB) ? decA : decB;

    setText(
      'cmpDeltaMean',
      `${diffMean >= 0 ? '+' : ''}${diffMean} ${unitDisplay} (A − B)`
    );
    setText(
      'cmpDeltaDecade',
      `${diffDecade >= 0 ? '+' : ''}${diffDecade} ${unitDisplay}/década`
    );
    setText(
      'cmpDeltaTotal',
      `${diffTotal >= 0 ? '+' : ''}${diffTotal} ${unitDisplay} en el período`
    );

    const summaryEl = document.getElementById('cmpSynthesisText');
    if (summaryEl) {
      summaryEl.innerHTML = `En el período <strong>${state.start_year}–${state.end_year}</strong> para <strong>${varMeta.name.toLowerCase()}</strong>, <strong>${fasterLoc}</strong> presenta la mayor velocidad de cambio (${fasterRate >= 0 ? '+' : ''}${fasterRate.toFixed(3)} ${unitDisplay}/década). La diferencia neta de cambio acumulado entre ambas ubicaciones es de <strong>${diffTotal >= 0 ? '+' : ''}${diffTotal} ${unitDisplay}</strong>.`;
    }
  }

  function renderComparisonTable(dataA, dataB, unitDisplay) {
    const tbody = document.getElementById('cmpTableBody');
    if (!tbody) return;

    const mapA = new Map((dataA.series || []).map((d) => [d.year, d.value]));
    const mapB = new Map((dataB.series || []).map((d) => [d.year, d.value]));
    const years = Array.from(new Set([...mapA.keys(), ...mapB.keys()])).sort((a, b) => a - b);

    tbody.innerHTML = years
      .map((yr) => {
        const vA = mapA.get(yr);
        const vB = mapB.get(yr);
        const diff =
          typeof vA === 'number' && typeof vB === 'number' ? (vA - vB).toFixed(2) : '--';
        const diffSign = Number(diff) > 0 ? '+' : '';
        return `
          <tr>
            <td class="fw-semibold">${yr}</td>
            <td>${typeof vA === 'number' ? `${vA.toFixed(2)} ${unitDisplay}` : '--'}</td>
            <td>${typeof vB === 'number' ? `${vB.toFixed(2)} ${unitDisplay}` : '--'}</td>
            <td class="fw-medium">${diff !== '--' ? `${diffSign}${diff} ${unitDisplay}` : '--'}</td>
          </tr>
        `;
      })
      .join('');
  }

  function exportComparisonCSV() {
    if (!state.dataA || !state.dataB) return;

    const mapA = new Map((state.dataA.series || []).map((d) => [d.year, d.value]));
    const mapB = new Map((state.dataB.series || []).map((d) => [d.year, d.value]));
    const years = Array.from(new Set([...mapA.keys(), ...mapB.keys()])).sort((a, b) => a - b);

    const metadata = [
      `Proyecto: EarthLens - Comparador de dos ubicaciones`,
      `Variable: ${state.variable} (${state.dataA.unit}) | Periodo: ${state.start_year}-${state.end_year}`,
      `Ubicacion A: ${state.locA.name} (${state.locA.latitude}, ${state.locA.longitude}) | Pendiente: ${state.dataA.statistics?.slope}`,
      `Ubicacion B: ${state.locB.name} (${state.locB.latitude}, ${state.locB.longitude}) | Pendiente: ${state.dataB.statistics?.slope}`
    ];

    const headers = [
      'anio',
      `valor_A_${state.locA.name.split(',')[0].replace(/\s+/g, '_')}`,
      `valor_B_${state.locB.name.split(',')[0].replace(/\s+/g, '_')}`,
      'diferencia_A_menos_B',
      'unidad'
    ];

    const rows = years.map((yr) => {
      const vA = mapA.get(yr) ?? '';
      const vB = mapB.get(yr) ?? '';
      const diff =
        typeof vA === 'number' && typeof vB === 'number' ? Number((vA - vB).toFixed(3)) : '';
      return [yr, vA, vB, diff, state.dataA.unit];
    });

    EarthLensCharts.downloadCSV(
      `earthlens_comparacion_${state.variable.toLowerCase()}_${state.start_year}_${state.end_year}.csv`,
      headers,
      rows,
      metadata
    );
  }

  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function bindEvents() {
    const presetA = document.getElementById('selectPresetA');
    const presetB = document.getElementById('selectPresetB');
    const latAInput = document.getElementById('inputLatA');
    const lonAInput = document.getElementById('inputLonA');
    const latBInput = document.getElementById('inputLatB');
    const lonBInput = document.getElementById('inputLonB');
    const varSelect = document.getElementById('cmpVariableSelect');
    const startInput = document.getElementById('cmpStartYear');
    const endInput = document.getElementById('cmpEndYear');
    const btnCompare = document.getElementById('btnRunComparison');
    const btnExport = document.getElementById('btnExportCompareCSV');
    const toggleTrend = document.getElementById('cmpToggleTrendlines');

    if (varSelect) varSelect.value = state.variable;
    if (startInput) startInput.value = state.start_year;
    if (endInput) endInput.value = state.end_year;
    if (latAInput) latAInput.value = state.locA.latitude;
    if (lonAInput) lonAInput.value = state.locA.longitude;
    if (latBInput) latBInput.value = state.locB.latitude;
    if (lonBInput) lonBInput.value = state.locB.longitude;

    if (presetA) {
      presetA.addEventListener('change', () => {
        const p = PRESET_COORDS[presetA.value];
        if (p) {
          state.locA = { ...p };
          if (latAInput) latAInput.value = p.latitude;
          if (lonAInput) lonAInput.value = p.longitude;
        }
      });
    }

    if (presetB) {
      presetB.addEventListener('change', () => {
        const p = PRESET_COORDS[presetB.value];
        if (p) {
          state.locB = { ...p };
          if (latBInput) latBInput.value = p.latitude;
          if (lonBInput) lonBInput.value = p.longitude;
        }
      });
    }

    if (btnCompare) {
      btnCompare.addEventListener('click', () => {
        if (varSelect) state.variable = varSelect.value;
        if (startInput && endInput) {
          const s = parseInt(startInput.value, 10) || 2000;
          const e = parseInt(endInput.value, 10) || 2024;
          state.start_year = Math.min(s, e - 2);
          state.end_year = Math.max(s + 2, e);
          startInput.value = state.start_year;
          endInput.value = state.end_year;
        }
        if (latAInput && lonAInput) {
          const la = parseFloat(latAInput.value);
          const lo = parseFloat(lonAInput.value);
          if (!Number.isNaN(la) && !Number.isNaN(lo)) {
            state.locA.latitude = la;
            state.locA.longitude = lo;
          }
        }
        if (latBInput && lonBInput) {
          const lb = parseFloat(latBInput.value);
          const lob = parseFloat(lonBInput.value);
          if (!Number.isNaN(lb) && !Number.isNaN(lob)) {
            state.locB.latitude = lb;
            state.locB.longitude = lob;
          }
        }
        runComparison();
      });
    }

    if (toggleTrend) {
      toggleTrend.addEventListener('change', () => {
        if (state.dataA && state.dataB) {
          EarthLensCharts.renderComparisonChart(
            'comparisonChart',
            state.dataA,
            state.dataB,
            state.locA.name,
            state.locB.name,
            toggleTrend.checked
          );
        }
      });
    }

    if (btnExport) {
      btnExport.addEventListener('click', exportComparisonCSV);
    }
  }

  initFromURL();
  bindEvents();
  runComparison();
});
