/* Modo detective — Persona 5 (feature/datasets-missions).
 *
 * - En /missions: lista los casos, muestra el detalle, pide la hipótesis y
 *   redirige al explorador/comparador con los parámetros precargados.
 * - En results/compare: expone window.EarthLensMissions para mostrar el
 *   veredicto de la misión activa (ver renderVerdict más abajo).
 */
(function () {
  "use strict";

  const STORAGE_KEY = "earthlens.activeMission";

  // ---------------------------------------------------------------- utils
  async function getJSON(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} respondió ${res.status}`);
    return res.json();
  }

  function el(tag, attrs = {}, text) {
    const node = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function fillList(container, items, tag = "li") {
    container.replaceChildren(...(items || []).map((t) => el(tag, {}, t)));
  }

  function saveActiveMission(data) {
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (_) { /* sin storage */ }
  }

  function loadActiveMission() {
    let stored = null;
    try { stored = JSON.parse(sessionStorage.getItem(STORAGE_KEY)); } catch (_) { /* nada */ }
    if (!stored || !stored.id || !stored.hypothesis) return null;
    return stored;
  }

  function clearActiveMission() {
    try { sessionStorage.removeItem(STORAGE_KEY); } catch (_) { /* nada */ }
  }

  /* ¿El análisis que se está mostrando corresponde a la misión activa?
   * Evita mostrar un veredicto viejo cuando el usuario sigue explorando libremente. */
  function matchesMission(active, request) {
    if (!request) return false;
    const variable = String(request.variable || "").toUpperCase();
    if (variable !== active.variable) return false;
    const lat = Number(request.latitude);
    const lon = Number(request.longitude);
    return (active.locations || []).some((loc) =>
      Math.abs(loc.latitude - lat) < 0.05 && Math.abs(loc.longitude - lon) < 0.05);
  }

  // ------------------------------------------------- veredicto (compartido)
  /* Igual que services/datasets.py::evaluate_hypothesis.
   * statistics sigue el contrato de /api/analyze. */
  function evaluateHypothesis(hypothesis, statistics) {
    const direction = statistics && statistics.direction;
    // Una pendiente "significativa" pero prácticamente nula no es una tendencia.
    const significant = Boolean(statistics && statistics.significant) &&
      (direction === "increasing" || direction === "decreasing");
    const p = statistics && statistics.p_value;
    const pTxt = typeof p === "number" ? ` (p = ${p.toFixed(3)})` : "";

    if (!significant) {
      if (hypothesis === "no_clear_trend") {
        return { verdict: "supported", message:
          `Los datos no muestran una tendencia significativa${pTxt}, como suponías. ` +
          "Ojo: eso no demuestra que no haya cambio, solo que la evidencia no alcanza para afirmarlo." };
      }
      return { verdict: "inconclusive", message:
        `La tendencia no es estadísticamente significativa${pTxt}. No hay evidencia suficiente ` +
        "para confirmar ni descartar tu hipótesis. Probá con un período más largo." };
    }
    if (hypothesis === direction) {
      return { verdict: "supported", message:
        `La evidencia apoya tu hipótesis: hay una tendencia significativa${pTxt}.` };
    }
    if (hypothesis === "no_clear_trend") {
      return { verdict: "contradicted", message:
        `Los datos sí muestran una tendencia significativa${pTxt}, aunque suponías que no habría un cambio claro.` };
    }
    return { verdict: "contradicted", message:
      `La evidencia contradice tu hipótesis: la tendencia significativa${pTxt} va en la dirección opuesta.` };
  }

  const VERDICT_STYLE = {
    supported: { cls: "alert-success", label: "Hipótesis apoyada" },
    contradicted: { cls: "alert-danger", label: "Hipótesis contradicha" },
    inconclusive: { cls: "alert-warning", label: "Evidencia insuficiente" },
  };

  /* Para results.js / compare.js:
   *   EarthLensMissions.renderVerdict(container, statistics, { variable, latitude, longitude }, label);
   * Solo muestra algo si hay una misión activa y el análisis coincide con su
   * variable y ubicación. `label` (opcional) indica a qué ubicación se refiere. */
  function renderVerdict(container, statistics, request, label) {
    const active = loadActiveMission();
    if (!container || !active || !statistics || !matchesMission(active, request)) return null;
    const result = evaluateHypothesis(active.hypothesis, statistics);
    const style = VERDICT_STYLE[result.verdict];
    const box = el("div", { class: `alert ${style.cls} mb-0`, role: "status" });
    box.append(el("strong", {}, `🔎 Misión ${active.number} · ${active.title}: ${style.label}`));
    box.append(el("div", { class: "small" }, active.question));
    const hyp = (active.hypotheses || []).find((h) => h.id === active.hypothesis);
    if (hyp) box.append(el("div", { class: "small" }, `Tu hipótesis: ${hyp.label}${label ? ` (${label})` : ""}.`));
    box.append(el("p", { class: "mb-0 mt-2" }, result.message));
    const back = el("a", { href: "/missions", class: "small" }, "Volver al Modo detective");
    box.append(back);
    container.replaceChildren(box);
    container.classList.remove("d-none");
    return result;
  }

  // ------------------------------------------------------- página /missions
  let current = null;

  function renderCards(missions) {
    const list = document.getElementById("mission-list");
    list.replaceChildren(...missions.map((m) => {
      const col = el("div", { class: "col-md-4" });
      const card = el("button", {
        type: "button",
        class: "card h-100 w-100 text-start mission-card",
        "data-id": m.id,
      });
      const body = el("div", { class: "card-body" });
      body.append(
        el("p", { class: "small text-uppercase text-muted mb-1" }, `Caso ${m.number} · ${m.difficulty}`),
        el("h2", { class: "h5 card-title" }, m.title),
        el("p", { class: "card-text" }, m.question),
        el("span", { class: "badge text-bg-secondary" }, m.mode === "compare" ? `${m.variable} · comparación` : m.variable),
      );
      card.append(body);
      card.addEventListener("click", () => openMission(m.id));
      col.append(card);
      return col;
    }));
  }

  async function openMission(id) {
    const detail = document.getElementById("mission-detail");
    current = await getJSON(`/api/missions/${encodeURIComponent(id)}`);
    const f = (name) => detail.querySelector(`[data-field="${name}"]`);

    ["number", "difficulty", "title", "question", "context"].forEach((k) => { f(k).textContent = current[k]; });

    const v = current.variable_info;
    const facts = [
      `Lugar: ${current.locations.map((l) => `${l.name} (${l.latitude}, ${l.longitude})`).join(" vs. ")}`,
      `Variable: ${v.short_name} (${v.code}, ${v.annual_unit} por año)`,
      `Período: ${current.start_year}–${current.end_year}`,
      `Fuente: ${v.source}`,
    ];
    if (current.supporting_variables_info.length) {
      facts.push(`Para profundizar: ${current.supporting_variables_info.map((s) => s.code).join(", ")}`);
    }
    fillList(f("facts"), facts);
    fillList(f("steps"), current.steps);
    fillList(f("hints"), current.hints);
    fillList(f("caveats"), current.caveats);

    f("hypotheses").replaceChildren(...current.hypotheses.map((h) => {
      const wrap = el("div", { class: "form-check" });
      const input = el("input", { class: "form-check-input", type: "radio", name: "hypothesis", id: `h-${h.id}`, value: h.id });
      wrap.append(input, el("label", { class: "form-check-label", for: `h-${h.id}` }, h.label));
      return wrap;
    }));

    document.getElementById("hypothesis-error").classList.add("d-none");
    detail.classList.remove("d-none");
    detail.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function onInvestigate(event) {
    event.preventDefault();
    const choice = new FormData(event.target).get("hypothesis");
    if (!choice) {
      document.getElementById("hypothesis-error").classList.remove("d-none");
      return;
    }
    saveActiveMission({
      id: current.id,
      number: current.number,
      title: current.title,
      question: current.question,
      hypothesis: choice,
      hypotheses: current.hypotheses,
      variable: current.variable,
      locations: current.locations,
    });
    location.href = `${current.explorer_url}&hypothesis=${encodeURIComponent(choice)}`;
  }

  function setupRecommender(catalog) {
    const select = document.getElementById("phenomenon-select");
    const out = document.getElementById("recommendations");
    catalog.phenomena.forEach((p) => select.append(el("option", { value: p.id }, p.label)));
    select.addEventListener("change", async () => {
      out.replaceChildren();
      if (!select.value) return;
      const data = await getJSON(`/api/variables/recommend?phenomenon=${encodeURIComponent(select.value)}`);
      out.replaceChildren(...data.variables.map((v, i) => {
        const item = el("li", { class: "list-group-item" });
        item.append(
          el("strong", {}, `${i === 0 ? "★ " : ""}${v.short_name} (${v.code})`),
          el("div", { class: "small" }, v.description),
          el("div", { class: "small text-muted" }, v.notes),
        );
        return item;
      }));
    });
  }

  async function initMissionsPage() {
    const list = document.getElementById("mission-list");
    try {
      const [missions, catalog] = await Promise.all([getJSON("/api/missions"), getJSON("/api/phenomena")]);
      renderCards(missions.missions);
      setupRecommender(catalog);
    } catch (err) {
      console.error(err);
      list.replaceChildren(el("p", { class: "text-danger" }, "No se pudieron cargar las misiones. Intentá de nuevo más tarde."));
      return;
    }
    document.getElementById("hypothesis-form").addEventListener("submit", onInvestigate);
    document.getElementById("mission-back").addEventListener("click", () => {
      document.getElementById("mission-detail").classList.add("d-none");
      list.scrollIntoView({ behavior: "smooth" });
    });

    // Permite enlazar directo a un caso: /missions?open=patagonia-cambiante
    const open = new URLSearchParams(location.search).get("open");
    if (open) openMission(open).catch(console.error);
  }

  window.EarthLensMissions = { evaluateHypothesis, renderVerdict, loadActiveMission, clearActiveMission };

  document.addEventListener("DOMContentLoaded", () => {
    if (document.getElementById("missions-page")) initMissionsPage();
  });
})();
