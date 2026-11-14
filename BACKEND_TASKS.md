# EarthLens — estado y tareas del backend

Actualización: **14 de noviembre de 2026**. Equipo: **Patagonia Prime**.
Desafío: **Earth System Trend Detective**, NASA Space Apps Challenge 2026.

**Alcance exclusivo: República Argentina.** No incluir ciudades internacionales.
El catálogo inicial de 25 ciudades puede ampliarse; las investigaciones futuras
admitirán cualquier ubicación argentina con validación territorial verificable.
Una caja rectangular no es una validación definitiva de pertenencia al país.

Este documento refleja el código local y las verificaciones realizadas. Las tareas
pendientes no autorizan avanzar automáticamente. Ver [AGENTS.md](AGENTS.md).

## Estado actual comprobado

El backend consulta datos mensuales de NASA POWER y dispone de catálogo argentino,
caché JSON, obtención masiva y API REST con Flask. El frontend y el motor real del
equipo están integrados para análisis exploratorio y comparación de ciudades.
Earth Radar y Earth Fingerprint tienen backend provisional, contrato común, API,
estudio persistido e interfaces completas `/radar` y `/fingerprint` (fase 1).
La confirmación científica y el ajuste múltiple permanecen pendientes de B06.
El entorno de desarrollo Docker está construido, iniciado y verificado, y el lote
de 25 ciudades 2000–2024 se ejecutó reutilizando íntegramente la caché existente.

| Componente/tarea | Estado | Evidencia |
| --- | --- | --- |
| Proveedor POWER mensual y consulta individual | Implementado y conservado | `services/providers/power.py`, `get_data()`. |
| Seis variables y consulta multivariable | Implementado y reutilizado | `get_data_multi()`: `T2M`, `T2M_MAX`, `T2M_MIN`, `PRECTOTCORR`, `RH2M`, `WS2M`. |
| Normalización, unidades, fuentes y metadatos | Implementado y conservado | Normalizador y resultados del proveedor; relleno a `None`, exclusión de `YYYY13`, sin conversiones implícitas. |
| **B01 — catálogo argentino** | Completada para las 25 ciudades solicitadas | `data/cities.json`, `services/cities.py`; listado, búsqueda por ID y filtros por provincia/región. |
| Procedencia geográfica y reconstrucción | Implementada con GeoRef real | `coordinate_source` conserva centroide, registro, consulta, ID y fecha; `scripts/build_city_catalog.py`. |
| **B03 — caché local** | Completada para POWER | `services/cache.py`, `data/cache/.gitignore`; clave canónica, fechas UTC y reemplazo atómico. |
| **B04 — obtención masiva** | Implementada; lote completo de 25 ciudades verificado en Docker | 25 aciertos de caché, 150 series y 45.000 registros con valor para 2000–2024; cero descargas nuevas y cero fallos. |
| Protección de caché ante respuestas incompletas o degradadas | Implementada y probada | Seis series, meses completos, contexto, fuentes y unidades; no reemplaza valores disponibles por nulos. |
| Arquitectura para coordenadas libres argentinas | Preparada; falta el adaptador territorial real | `services/geography.py`, `TerritoryEvidence`, `collect_location()`. |
| **B05 — API REST básica** | Completada y probada con el cliente Flask | `app.py`, Blueprint `api/routes.py`, servicio `services/api_service.py`; seis endpoints documentados. |
| **B02 — instalación y dependencias** | Instalación limpia verificada en Docker Linux/amd64 | Python 3.12.16, Flask 3.1.3 y Requests 2.34.2 instalados desde `requirements.txt`; `pip check` y suite satisfactorios. Sin lock transitivo. |
| **B19 — Docker para desarrollo** | Completada para el alcance autorizado | `Dockerfile`, `compose.yaml`, `.dockerignore`, `docs/docker.md`; backend saludable, recarga y caché persistente verificadas. |
| Pruebas sin red | 137 aprobadas: las 134 anteriores más tres contratos de interfaces | `tests/`; 138 descubiertas, sólo NASA de red optativa omitida en Docker. |
| Script manual y documentación previa | Conservados | `test_nasa.py`, `docs/nasa-power.md`. |
| Documentación | Actualizada | `AGENTS.md`, este archivo y contrato para frontend en `docs/api.md`; documentación previa conservada. |

### Catálogo inicial

| Región del proyecto | Ciudades |
| --- | --- |
| Patagonia | Comodoro Rivadavia, Puerto Madryn, Trelew, Río Gallegos, Ushuaia, Bariloche y Neuquén. |
| Centro y región pampeana | Buenos Aires, La Plata, Mar del Plata, Bahía Blanca, Rosario, Córdoba y Santa Fe. |
| Cuyo | Mendoza, San Juan y San Luis. |
| NOA | Salta, San Salvador de Jujuy, San Miguel de Tucumán y Santiago del Estero. |
| NEA | Posadas, Corrientes, Resistencia y Formosa. |

Las coordenadas y provincias proceden de la API oficial GeoRef. Las regiones son
la agrupación solicitada por el proyecto. Se conservan las denominaciones oficiales
en el registro fuente y los nombres de presentación en el catálogo. Los centroides
son ubicaciones de consulta de la grilla, no estaciones ni promedios urbanos.
El cargador no fija un límite de 25 localidades.

### Verificaciones realizadas

```powershell
.\venv\Scripts\python.exe -m unittest discover -s tests -v
```

Resultado de la etapa Flask: **72 pruebas descubiertas; 71 aprobadas y 1 omitida**.
Las 48 pruebas anteriores siguen funcionando. La omitida es la
integración previa `test_power_provider_live.py`, optativa mediante
`EARTHLENS_POWER_LIVE=1`. Los datos sintéticos de las pruebas son exclusivamente
para verificar software; no representan observaciones científicas.

- En la etapa anterior, GeoRef resolvió las 25 localidades y se conservaron sus registros.
- En la etapa anterior se hicieron tres consultas NASA reales: Comodoro Rivadavia, Mendoza y Posadas,
  período **2000–2024**, una petición con seis variables por ciudad.
- Las tres ciudades devolvieron 300 registros mensuales disponibles por variable,
  sin faltantes en esas respuestas concretas.
- Repetición de la CLI con acceso de red bloqueado en la comprobación: tres aciertos
  de caché, cero peticiones y archivos/fechas de obtención sin cambios.
- Pruebas simuladas: recorrido de las 25 ciudades, errores individuales, respuestas
  incompletas, nuevos nulos, series totalmente nulas, valores no finitos, fuentes
  ausentes, vencimiento, corrupción y fallos de reemplazo atómico.

Durante la inspección previa a Flask se encontraron **25 entradas de caché ya
existentes**, todas de 2000–2024. Se comprobó su estructura con el validador actual;
no se atribuye su descarga a esta etapa ni se infiere cobertura de todo el país.
Las verificaciones reales anteriores del proveedor quedan documentadas en
`docs/nasa-power.md` y en la conversación.

Verificaciones específicas de la API:

- `tests/test_api.py`: 23 pruebas con cliente Flask, NASA simulada y cachés temporales.
- Catálogos, filtros, detalle por ID, regiones, tipos, años, variables, JSON inválido,
  tamaño de cuerpo, métodos HTTP, CORS desactivado y rechazo de coordenadas libres.
- Selección de variables reutilizando la misma caché de seis; faltantes a `null`,
  actualización forzada, conservación ante fallo y advertencias públicas seguras.
- Errores externos con estados 502/503/504 y fallos internos 500, sin textos privados,
  credenciales ni rutas locales en las respuestas.
- Cliente Flask sobre las cachés reales de Comodoro Rivadavia, Mendoza y Posadas:
  HTTP 200 y origen `cache`, 300 meses de T2M por ciudad. La red estuvo bloqueada en
  esa comprobación; los 25 archivos preexistentes conservaron su contenido.
- `flask --app app:create_app routes` mostró los seis endpoints previstos.
- En la etapa Flask, `pip check` no encontró dependencias rotas; todavía no se había
  verificado una instalación desde cero. Esa comprobación se completó posteriormente
  en Docker, como se detalla a continuación. El despliegue productivo sigue pendiente.

Esta etapa no realizó solicitudes a NASA ni a GeoRef.

### Verificación Docker y lote completo

Se construyó `earthlens-backend:dev` desde `python:3.12-slim`, con instalación
limpia de dependencias y ejecución no root (UID 10001). Compose inició un único
servicio `backend` con puerto `127.0.0.1:5000` y estado `healthy`. No se encontró
frontend en el repositorio y no se creó un servicio para él ni una base de datos.

- Suite dentro del contenedor: **72 descubiertas, 71 aprobadas y una integración
  real omitida**, con `EARTHLENS_POWER_LIVE=0`; respuestas externas simuladas.
- Seis endpoints verificados desde Windows: HTTP 200 para salud, variables, listado
  filtrado, detalle de ciudad, regiones y POST de datos. El POST reutilizó caché.
- Recarga automática confirmada por logs al cambiar temporalmente sólo la fecha
  de `app.py`; contenido y fecha original restaurados. Depurador deshabilitado.
- `pip check` sin dependencias rotas en Python 3.12.16 Linux/amd64.
- Lectura y escritura temporal de la caché montada verificadas con UID 10001.
- SHA-256 de las **25 cachés anteriores idénticos** antes y después de verificaciones
  y lote; fechas originales de obtención conservadas. No se incorporó caché a la imagen.

Sólo después de comprobar Docker se ejecutó el comando autorizado:

```powershell
docker compose exec -T backend python -m scripts.fetch_power --all --start-year 2000 --end-year 2024
```

| Resultado comprobado | Cantidad |
| --- | ---: |
| Ciudades correctas | 25 |
| Reutilizadas desde caché | 25 |
| Descargas nuevas / solicitudes NASA | 0 |
| Consultas fallidas | 0 |
| Series | 150 |
| Registros mensuales totales | 45.000 |
| Registros con valor disponible | 45.000 |
| Faltantes | 0 |

Cada ciudad del catálogo tiene seis series de 300 meses, equivalentes a 1.800
registros por ciudad. Los conteos se verificaron leyendo las cachés con el validador
existente y comparando su cobertura con el informe del lote. Son datos previamente
obtenidos y reutilizados; no se presentan como descargas nuevas ni como análisis.

Informe local: `data/cache/reports/power-2000-2024-docker.json`, ignorado por Git.
Incluye estados por ciudad, cobertura, fechas y totales auditados. La lista completa
de ciudades y comandos compartibles está en [docs/docker.md](docs/docker.md).
El contenedor queda iniciado para desarrollo; el despliegue productivo sigue pendiente.

### Contrato operativo y límites

- Período por defecto 2000–2024, configurable; comunidad `AG`, frecuencia mensual y
  las seis variables existentes. Procesamiento secuencial, intervalo mínimo de un
  segundo por defecto y sin reintentos automáticos.
- CLI con selector explícito: `--city`, `--cities`, `--province`, `--region` o `--all`.
  `--dry-run` no consulta NASA ni escribe cachés.
- Caché JSON en `data/cache/power/`, ignorada por Git. Guarda consulta, ubicación,
  procedencia GeoRef, series, unidades, metadatos y `fetched_at` UTC.
- Reutilización hasta `--force` o vencimiento opcional con `--max-age-days`; no se
  supone que NASA nunca revise datos históricos. No se aproxima la ubicación ni
  se comparten entradas entre períodos diferentes.
- Los nulos científicos se conservan y cuentan. Variables/meses ausentes, series
  totalmente nulas, metadatos esenciales ausentes y actualizaciones que pierdan
  valores disponibles impiden sustituir una caché válida. No se mezclan respuestas.
- Un refresco fallido informa error y `cache_preserved`; mantiene la fecha anterior
  y no presenta datos viejos como una descarga nueva.
- Escrituras atómicas; sin bloqueo entre procesos en esta versión. Ejecutar un único
  lote por directorio de caché. Un fallo de escritura se informa como advertencia
  con `cache_written=false` si los datos remotos obtenidos son válidos.
- Para coordenadas libres se exige evidencia de límites oficiales de Argentina.
  **El adaptador real está pendiente**: por defecto se devuelve
  `TerritoryValidationUnavailable` antes de consultar NASA. La arquitectura admite
  incorporar ubicaciones argentinas arbitrarias mediante B18, sin limitarse al
  catálogo ni aceptar una caja rectangular como prueba territorial.

Comandos y ejemplos de uso: [docs/bulk-power.md](docs/bulk-power.md).

### API disponible para frontend

Application Factory en `app.py`, Blueprint en `api/routes.py`, sobre de respuestas
en `api/responses.py` y mapeo seguro de errores en `api/errors.py`. Las rutas delegan
validación y adaptación a `services/api_service.py`, que usa los módulos existentes
de ciudades, obtención, caché y proveedor, sin modificar su implementación.

| Método | Ruta | Alcance verificado |
| --- | --- | --- |
| GET | `/api/health` | Estado del proceso HTTP, sin sondeo externo. |
| GET | `/api/variables` | Catálogo del proveedor con unidades y fuentes. |
| GET | `/api/cities` | Ciudades argentinas, filtros `province` y `region`. |
| GET | `/api/cities/{city_id}` | Detalle por ID; 404 para una ciudad inexistente. |
| GET | `/api/regions` | Regiones y conteos derivados del catálogo. |
| POST | `/api/data` | Una ciudad, variables seleccionadas y período; caché prioritaria, `force` opcional. |

Frontend y API comparten origen; CORS permanece desactivado. Las coordenadas libres
siguen rechazadas. La obtención se serializa dentro del proceso; el despliegue
multiproceso permanece pendiente. Los nuevos contratos están en `docs/api.md`.

Contrato completo, ejemplos JSON, estados HTTP y comandos: [docs/api.md](docs/api.md).

```powershell
.\venv\Scripts\python.exe -m flask --app app:create_app run --host 127.0.0.1 --port 5000
```

## Pendientes, prioridades y dependencias

**P1:** base necesaria. **P2:** integración y producto. **P3:** complemento.
B01, B02, B03, B04, B05 y B19 están completadas para su alcance de desarrollo actual.
No se afirma un lock de dependencias transitivas ni un despliegue productivo.
B07, B12 y B15 están completadas para análisis exploratorio del catálogo argentino,
según el contrato técnico existente del motor. B06 conserva revisión metodológica
pendiente; no se afirma aprobación del compañero de nuevos métodos. B17 continúa.

| ID | Prioridad | Tarea pendiente | Dependencias y criterio de finalización |
| --- | --- | --- | --- |
| B18 | P1 | Incorporar adaptador real de límites oficiales de Argentina. | Verificar fuente, geometrías y cobertura. Probar interiores, exteriores, costas y fronteras con procedencia/versionado; nunca usar sólo una caja rectangular. |
| B06 | P1 | Revisar criterios científicos con el responsable del motor. | Contrato técnico inspeccionado e integrado (`docs/integration.md`). Falta precisión completa, coherencia p-valor/significancia/slope_tolerance, revisión conjunta de estacionalidad, autocorrelación, cobertura, centinelas, acumulados y comparaciones múltiples. Bloquea confirmación de hallazgos, no el procesamiento provisional explícito autorizado. |
| B13 | P2 | Evaluar Giovanni/Earthdata, GPM, GLDAS y MERRA-2 directo según necesidad. | Caso de uso argentino y documentación oficial. Verificar acceso, variables, unidades y cobertura; integración completa sólo con cliente y prueba real. |
| B14 | P3 | Evaluar SWOT/Hydrocron como complemento. | Caso de uso hídrico argentino y documentación oficial. Registrar viabilidad y límites; implementar sólo si aporta. |
| B16 | P2 | Definir investigaciones guiadas argentinas. | Interfaz original, tres misiones, hipótesis y recomendador incorporados desde `origin/datasets-missions`; falta revisión conjunta de recorridos e interpretación científica. |
| B17 | P2 — continua | Ampliar integración y CI. | B02 y módulos incorporados. Mantener pruebas sin red separadas de comprobaciones reales optativas; contratos HTTP, motor y flujo de navegador incorporados; falta CI del equipo. |

No iniciar descargas completas automáticamente. El período 2000–2024 se verificó
con 25 cachés intactas. B18 y la revisión científica de B06 siguen pendientes.
Radar y Fingerprint están implementados como productos provisionales; no se
presentan descubrimientos confirmados ni se aplica un ajuste aún no acordado. El motor y la interfaz se integraron por solicitud
explícita del usuario; no se implementan etapas futuras por iniciativa propia.

## Historial de la etapa Docker inicial y coordinación

Modificados en la etapa Docker: `AGENTS.md`, `BACKEND_TASKS.md` y `docs/api.md`.

Creados en la etapa Docker:

- `Dockerfile`, `compose.yaml` y `.dockerignore`.
- `docs/docker.md`.
- Informe local ignorado: `data/cache/reports/power-2000-2024-docker.json`.

La etapa Docker no editó aplicación, rutas, servicios, proveedor, normalizador,
catálogo, scripts, pruebas ni dependencias anteriores. Las 25 cachés existentes
permanecen intactas. No se realizaron
commits ni push. El motor y el frontend pertenecen a otros integrantes y quedan
fuera de las modificaciones de esta etapa.


## Integración del proyecto completo — 14 de noviembre de 2026

| Tarea | Estado del alcance solicitado | Evidencia |
| --- | --- | --- |
| Diagnóstico y comparación de ramas | Completado | `docs/integration.md`: HEAD 9066cdd, main d56d8ae y motor en results-charts e33c76d; inventario de ambos Docker/Compose. |
| B07 — adaptador al motor existente | Completado para consultas exploratorias | `services/analysis_service.py`; `services/trend_analysis.py` idéntico al del compañero; SciPy 1.18.1. No incluye validación metodológica conjunta pendiente de B06. |
| B12 — análisis y comparación | Completado para ciudades del catálogo | `api/routes.py`, errores públicos, unidades/cobertura compatibles y `tests/test_web_integration.py`. Coordenadas libres/regiones arbitrarias pendientes de sus contratos y B18. |
| B15 — frontend conectado | Completado para el flujo actual | `web/routes.py`, `templates/`, `static/js/api.js`; Chrome real mediante `scripts/check_web.py`: datos, gráficos, CSV, comparación y errores sin fallback simulado. |
| Docker unificado | Completado | `Dockerfile`, `compose.yaml`: un servicio Flask, mismo origen, puerto 5000, caché original persistente, estado healthy. |
| Regresión backend y motor | Completada | 104 descubiertas, 103 aprobadas, una NASA de red optativa omitida dentro de Docker; `pip check` correcto. Las 71 pruebas originales no se editaron. |
| Auditoría científica sin nuevas descargas | Completada | `scripts/check_cached_integration.py`: 25 ciudades, 150 series, 45.000 valores y 150 análisis; red NASA bloqueada, hashes y fechas iguales. |

No se modificó `main`, no se hicieron commits ni push ni se eliminaron volúmenes.
El archivo local sin seguimiento preexistente `e config --services` se conservó.
Los datos sintéticos heredados quedaron identificados y aislados bajo `tests/`.
No se habilitaron fuentes distintas de POWER ni coordenadas libres.

Arranque: `docker compose up -d --build --wait --wait-timeout 60`.
Navegador: **http://127.0.0.1:5000/**. Guía: `docs/docker.md`.
Evidencias locales: `data/cache/reports/web/` e
`data/cache/reports/integrated-cache-audit.json`, ignoradas por Git.


## Resultado común, Fingerprint y Radar provisional — 14 de noviembre de 2026

Etapa autorizada por el usuario a partir de la auditoría de `b4093bc`.

| Componente/tarea | Estado del alcance autorizado | Evidencia |
| --- | --- | --- |
| Resultado común | Implementado, sin un motor duplicado | `services/analysis_results.py`, `AnalysisService.results()`; indicador, unidad, ubicación, período, cobertura mensual/anual, estadísticas, hashes y metodología. |
| Precisión y estados | Preparado; entrega completa pendiente del compañero | Estados `valid` (reservado), `provisional`, `insufficient`, `error`; `data_status=valid` no confirma ciencia. Copia las estadísticas actuales y deja `statistics_unrounded=null`; no reconstruye cifras ni cambia el motor. |
| B09 — Fingerprint | Backend v1 implementado y probado; validación científica pendiente | `services/fingerprint.py`: seis variables, cuatro principales y dos extremos; compatibilidad descriptiva, sin puntajes ni normalizaciones. |
| B08 — Radar | Backend v1 implementado y probado; descubrimientos confirmados pendientes de B06 | `services/radar.py`: familia completa de 150 pruebas, cobertura, errores y exclusiones; ajuste múltiple preparado pero no aplicado. |
| B10 — generador | Implementado y piloto completo ejecutado | `scripts/generate_radar.py`; cache-only, dry-run, IDs de estudio/ejecución, fecha UTC, hash de integridad y escritura atómica. |
| B11 — endpoints de producto | Implementados | `GET /api/fingerprint/{city_id}` y `GET /api/radar`; contratos y ejemplos en `docs/api.md`, `docs/products.md`, `docs/examples/`. |
| Obtención sin red | Implementada como opción interna explícita | `PowerBulkService.collect_cities(cache_only=True)` y `EarthLensService.get_data(cache_only=True)`; un faltante o caché vencida se informa sin consultar NASA. No se habilita como configuración HTTP. |
| Filtros de Radar | Implementados sin recalcular | Provincia, región, variable, dirección y evidencia. El manifiesto, la familia y el ajuste pendiente se conservan íntegros al filtrar. |
| Verificación | 134 aprobadas, una NASA de red omitida | 135 descubiertas en Docker, `pip check` correcto, 31 pruebas nuevas de contrato, caché, errores, compatibilidad, CLI, atomicidad y filtros. Flujos anteriores comprobados en Chrome con cero errores JavaScript. |

Piloto 2000–2024: 25 ciudades, 150 series reales y 45.000 valores mensuales.
25 aciertos de caché, **150 resultados provisionales**, 48 señales nominales
provisionales, 102 sin señal nominal, cero errores, cero exclusiones y **cero
hallazgos confirmados**. Distribución de señales nominales: T2M 13, T2M_MAX 11,
T2M_MIN 7, PRECTOTCORR 8, RH2M 4 y WS2M 5. No son resultados corregidos por
comparaciones múltiples ni evidencia causal.

Se ejecutó la generación bloqueando solicitudes externas y `JsonCache.write`.
Los 150 registros persistidos coincidieron con una segunda ejecución del análisis
(excluyendo la fecha de ejecución); para Comodoro Rivadavia, Mendoza y Posadas se
contrastaron estadísticas con el análisis anterior y compatibilidad de perfiles.
Los 25 JSON originales conservaron sus hashes y fechas. El motor, `static/` y
`templates/` también conservaron sus hashes.

Artefacto derivado local ignorado por Git: `data/cache/radar/latest.json`.
Ejemplos reales versionables: tres perfiles completos y Radar Cuyo/T2M en
`docs/examples/`. Cada resultado incluye coordenadas y enlaces a las páginas
existentes. No se modificaron frontend, motor estadístico, dependencias, Docker,
proveedores nuevos ni bases de datos. No se hicieron commits ni push ni cambios
en `main`.

Pendientes de coordinación: B06 antes de confirmar resultados o aplicar ajuste;
B18 para coordenadas libres; nuevas interfaces de Radar/Fingerprint y correcciones
de la interfaz detectadas en la auditoría (respuesta del comparador asociada al
selector cambiante, ampliación automática de años), sólo con autorización del
responsable del frontend. B13/B14 y el despliegue productivo permanecen pendientes.

```powershell
docker compose exec -T backend python -m scripts.generate_radar --dry-run
docker compose exec -T backend python -m scripts.generate_radar
Invoke-RestMethod 'http://127.0.0.1:5000/api/fingerprint/mendoza?start_year=2000&end_year=2024'
Invoke-RestMethod 'http://127.0.0.1:5000/api/radar?region=Cuyo&variable=T2M'
```

## FASE 1 — interfaces Radar y Fingerprint verificadas

Autorización posterior del usuario para implementar ambas interfaces y compartir
la navegación. Se inspeccionaron arquitectura, contratos, documentación y estado
Git antes de editar. Rama: `feature/backend-api`, base `87db1b4`; no se modificó
`main`, no se hicieron commits ni push. La fase no agrega proveedores científicos.

| Alcance | Estado comprobado | Archivos/evidencia |
| --- | --- | --- |
| Earth Radar | Funcional con datos reales | `/radar`, mapa Leaflet con 25 marcadores, cinco filtros, resumen global, tarjetas y orden por ciudad/indicador/p nominal; magnitud sólo con una variable. Enlace a Resultados y leyenda sin puntajes. |
| Earth Fingerprint | Funcional con datos reales | `/fingerprint`, selector argentino, seis tarjetas/gráficos históricos anuales, principales/extremos, fuentes y metodología. Comparación descriptiva con unidades y compatibilidad estricta; sin gráfico radial. |
| Navegación | Integrada en todas las páginas | Parcial Jinja único; conserva marca, estilos y el enlace Inicio → Explorador con la ciudad seleccionada. |
| Selecciones rápidas | Verificadas en Chrome | AbortController y secuencia; respuestas tardías no reemplazan ciudades, filtros, títulos ni gráficos actuales. Probado con y sin cancelación. |
| Carga/error/vacío | Verificados | Estados visibles, reintentos, ocultación de resultados previos; filtro real de confirmados sin resultados. Fixtures de 503, incompatibilidad e indicador dinámico insuficiente sólo en navegador. |
| Responsive y enlaces | Verificados | 1440, 1280, 820 y 390 px sin desborde horizontal; menú móvil, comparación móvil, enlaces al Explorador, Resultados y Comparador. |
| Regresión sin red | 137 aprobadas, una remota optativa omitida | Suite completa: 138 descubiertas en Docker; las 134 anteriores más tres pruebas nuevas. Tras el ajuste final de navegación se repitieron satisfactoriamente los tres contratos de páginas. |
| Navegador | 9 grupos de verificaciones nuevas y 10 anteriores aprobados | `scripts/check_product_pages.py` y `scripts/check_web.py`, Chrome real, cero errores JavaScript. Capturas inspeccionadas en escritorio y móvil. |
| Integración científica sin descargas | 25 perfiles, 150 análisis y 45.000 valores mensuales | Cliente Flask dentro de Docker con `requests.sessions.Session.request` y `JsonCache.write` bloqueados. Cero consultas NASA y cero escrituras; estadísticas, series, cobertura, indicador, unidad, IDs y procedencia coinciden con el estudio persistido. |
| Preservación | Comprobada por SHA-256 | Las 25 cachés, `data/cache/radar/latest.json` y `services/trend_analysis.py` permanecen idénticos. No se regeneró el estudio. |
| Docker | Reconstruido y saludable | Mismo servicio, puerto y bind mounts; sin cambios en Dockerfile, Compose, volúmenes, dependencias ni motor. |

Resultados reales del estudio **existente** mostrado por la interfaz: 25 ciudades,
150 resultados provisionales, 48 señales nominales, 102 sin señal nominal,
cero errores/exclusiones y **cero descubrimientos confirmados**. Son p-valores sin
ajuste; no se ejecutó un nuevo estudio ni se amplió su familia.

Ejemplos comprobados de T2M para 2000–2024 (unidad NASA `C`; cobertura 25/25 años,
300/300 meses en cada ciudad):

| Ciudad | Cambio por década (C/década) | IC95% de pendiente (C/año) | p nominal | Evidencia |
| --- | --- | --- | --- | --- |
| Comodoro Rivadavia | 0,2464 | [0,00186; 0,04741] | 0,03521 | Señal nominal provisional |
| Mendoza | 0,3412 | [0,00405; 0,06419] | 0,02787 | Señal nominal provisional |
| Posadas | 0,267 | [-0,00309; 0,0565] | 0,0766 | Sin señal nominal |

### Archivos de la fase

Creados:

- `templates/_navigation.html`, `templates/_provisional_notice.html`,
  `templates/radar.html`, `templates/fingerprint.html`.
- `static/css/products.css`, `static/js/products.js`, `static/js/radar.js`,
  `static/js/fingerprint.js`.
- `tests/test_product_pages.py`, `scripts/check_product_pages.py`.

Modificados:

- `web/routes.py`: dos páginas nuevas; `static/js/api.js`: señal de cancelación
  opcional, conservando las llamadas anteriores.
- `templates/base.html`, `templates/index.html`, `templates/explorer.html`,
  `templates/results.html`, `templates/compare.html`: inclusión de navegación
  compartida; contenido y lógica de las páginas conservados.
- `static/css/styles.css`: ajuste de la marca en pantallas pequeñas.
- `AGENTS.md`, `BACKEND_TASKS.md`, `README.md`, `docs/api.md`, `docs/docker.md`,
  `docs/products.md`: estado, contratos web, limitaciones y ejecución.

Evidencias locales ignoradas, sin reemplazar informes anteriores:

- `data/cache/reports/interfaces-phase1/20261114T212310541717Z/`: informe de
  nueve grupos de comprobaciones, hashes, origen de los 25 perfiles y capturas
  reales de ambas interfaces, incluida comparación móvil.
- `data/cache/reports/interfaces-phase1/20261114T212313856622Z/legacy/`:
  regresión de los diez recorridos anteriores y sus capturas.

### Ejecución y límites

```powershell
docker compose up -d --build --wait --wait-timeout 60
# Abrir http://127.0.0.1:5000/radar
# Abrir http://127.0.0.1:5000/fingerprint?city_id=comodoro-rivadavia
# Comparar http://127.0.0.1:5000/fingerprint?city_id=mendoza&city_id_b=posadas

docker compose exec -T -e EARTHLENS_POWER_LIVE=0 backend python -B -m unittest discover -s tests -v
.\venv\Scripts\python.exe -B scripts/check_product_pages.py
.\venv\Scripts\python.exe -B scripts/check_web.py
```

La comprobación de navegador requiere Playwright y Chrome en el host. La aplicación
no requiere Node ni Playwright. Sus recursos CDN y teselas requieren Internet.
Si falta el artefacto Radar, la interfaz muestra el error sin generar ni descargar
datos. Fingerprint usa el período cacheado 2000–2024 y no agrega controles para
descargas de períodos nuevos. Las tarjetas y gráficos se generan desde el contrato
recibido para admitir indicadores adicionales en fases futuras.

Pendientes científicos: validación metodológica B06, autocorrelación/supuestos OLS,
cobertura, ajuste múltiple, entrega de precisión completa y agregación anual
acordada, especialmente precipitación. No se modificó ninguno de esos criterios.
La comparación no prueba diferencias significativas entre ciudades. Continúan
pendientes el adaptador territorial B18 y el despliegue productivo.

**Fases 2–7 no iniciadas**: arquitectura multiproveedor, consultas reales GLDAS,
MODIS, GPM y SWOT/Hydrocron e integración general se abordarán en ese orden tras
esta fase. No hay nuevas variables habilitadas ni ampliación automática de Radar.
