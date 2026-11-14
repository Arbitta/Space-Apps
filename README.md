# 🌍 EarthLens — NASA Space Apps Challenge 2026

**Be An Earth System Trend Detective!**  
Aplicación web científica para investigar tendencias ambientales mediante series temporales de **NASA POWER (MERRA-2)**, regresión lineal, intervalos de confianza y misiones guiadas.

---

## 🚀 Cómo levantar el proyecto (Docker y Local)

### Opción 1: Con Docker (Resistente a cambios de rama / branch)
El contenedor compila una copia íntegra de respaldo (`/app_baked`) y monta el directorio local en modo no destructivo (`/workspace:ro`). **Una vez levantado el contenedor, puedes cambiar de rama en Git (`git checkout main`, `git checkout explorador`, etc.) y la aplicación seguirá funcionando en el puerto 8000 sin caerse ni perder módulos.**

```bash
docker compose up -d --build
```

Para ver logs o detenerlo:
```bash
docker compose logs -f
docker compose down
```

### Opción 2: Con Python directo (sin Docker)
Funciona tanto con `Flask + SciPy` instalados como con la librería estándar de Python 3:
```bash
python3 app.py
```

### Enlaces locales
* **Dashboard de Resultados:** `http://localhost:8000/templates/results.html` (o `http://localhost:8000/results`)
* **Comparador de Ubicaciones:** `http://localhost:8000/templates/compare.html` (o `http://localhost:8000/compare`)
* **Endpoint de Análisis:** `POST http://localhost:8000/api/analyze`
* **Endpoint de Comparación:** `POST http://localhost:8000/api/compare`
* **Catálogo de Variables:** `GET http://localhost:8000/api/variables`
* **Catálogo de Misiones:** `GET http://localhost:8000/api/missions`

---

## 🧪 Ejecutar las pruebas automatizadas (Rol 06)

```bash
python3 -m unittest discover -s tests -v
```
*(O con pytest dentro del contenedor: `docker exec earthlens-app pytest -v`)*

### Casos de prueba incluidos (`tests/test_statistics.py` y `tests/test_api.py`)
1. **Recurso oficial NASA POWER:** `Comodoro Rivadavia, 2000–2024` (`lat: -45.86, lon: -67.50`) en `data/samples/comodoro_rivadavia_2000_2024.json`.
2. **Misión 01 — Patagonia cambiante:** Tendencia ascendente significativa ($p < 0.05$) en `T2M`, `T2M_MAX` y `T2M_MIN`.
3. **Misión 02 — En busca del agua:** Tendencia descendente en `PRECTOTCORR` y `RH2M` (incluyendo validación de que la humedad relativa atmosférica no equivale a la humedad del suelo).
4. **Misión 03 — El misterio del viento:** Análisis de `WS2M` y comparación estadística entre dos ubicaciones patagónicas (`Comodoro Rivadavia` vs `Ushuaia`).
5. **Limpieza y completitud:** Filtrado de valores faltantes (`-999` de NASA POWER), exclusión del resumen anual `YYYY13` en series mensuales y validación de cobertura mínima.

---

## 📊 Metodología Estadística y Supuestos (`services/trend_analysis.py`)

1. **Agregación anual y completitud:**
   * Se filtran códigos centinela (`-999`, `NaN`, `None`).
   * Se exige un mínimo de 9 meses válidos por año en series mensuales y al menos 3 años válidos en el período.
2. **Regresión lineal (OLS con `scipy.stats.linregress`):**
   * **Pendiente ($m$):** cambio anual estimado en la unidad de la variable.
   * **Cambio por década:** $m \times 10$.
   * **Cambio total en el período:** $m \times (\text{año}_{\text{fin}} - \text{año}_{\text{inicio}})$.
3. **Significancia e incertidumbre:**
   * **$p\text{-valor}$ bilateral:** calculado con distribución $t$ de Student ($n - 2$ grados de libertad). Un $p < 0.05$ sugiere evidencia estadística de tendencia lineal; un $p \ge 0.05$ **no demuestra ausencia de cambio**, sino que la variabilidad interanual impide confirmar una tendencia lineal bajo los supuestos del modelo.
   * **Intervalo de confianza al 95%:** $m \pm t_{0.975, n-2} \cdot SE(m)$.
4. **Limitaciones espaciales:**
   * Los datos de **NASA POWER / MERRA-2** representan promedios en celdas geográficas satelitales (~0.5° × 0.625°), no estaciones meteorológicas puntuales. Correlación temporal no implica causalidad directa.
