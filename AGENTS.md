# EarthLens — contexto e instrucciones del proyecto

Este archivo aplica a todo el repositorio. Describe el contexto y las reglas de
trabajo; el estado de las tareas y sus dependencias se mantiene en
[BACKEND_TASKS.md](BACKEND_TASKS.md). Revisar el código antes de dar una tarea por
completada. Los componentes propuestos en estos documentos no implican que existan.

## Contexto, objetivos y responsabilidades

- Proyecto: **EarthLens**.
- Equipo: **Patagonia Prime**.
- Evento: **NASA Space Apps Challenge 2026**.
- Desafío: **Earth System Trend Detective**.
- Objetivo: explorar datos ambientales históricos reales, identificar tendencias
  con respaldo estadístico y presentar resultados comprensibles y trazables.
- Alcance geográfico exclusivo: **República Argentina**. No incluir ciudades
  internacionales. El catálogo inicial contiene 25 ciudades argentinas y puede
  ampliarse; las investigaciones futuras deben admitir cualquier ubicación dentro
  de Argentina, sin limitarse a ese catálogo.
- El usuario es responsable del backend y del consumo de APIs.
- El motor estadístico corresponde a otro integrante del equipo. Acordar su contrato
  de entrada y salida antes de integrarlo; no inventar su interfaz ni reemplazarlo
  con cálculos o resultados ficticios.

## Funcionalidades del producto

Las siguientes son funcionalidades objetivo. Actualmente existen el proveedor y
normalizador NASA POWER, el catálogo argentino, la caché local y la obtención masiva;
también existen la API HTTP, el frontend Flask y la integración del motor del equipo
para análisis exploratorios. Ver `docs/integration.md` para el contrato inspeccionado
y sus limitaciones; la revisión metodológica conjunta sigue pendiente.

| Funcionalidad | Alcance previsto | Estado de la funcionalidad completa |
| --- | --- | --- |
| Explorador ambiental | Consultar variables ambientales por ubicación argentina y período, conservando unidades y procedencia. | Interfaz conectada a catálogo, caché y análisis exploratorio por ciudad. |
| Tendencias y significancia estadística | Integrar los análisis y evidencias del motor del equipo. | Motor existente integrado; revisión metodológica para ampliar usos pendiente. |
| Earth Radar | Descubrir automáticamente tendencias ambientales en el catálogo inicial de 25 ciudades argentinas. | Backend provisional y estudio de 150 pruebas disponibles; validación científica y ajuste pendientes; sin descubrimientos confirmados. |
| Earth Fingerprint | Generar un perfil de tendencias históricas de temperatura, precipitación, humedad y viento por ciudad. | Perfil provisional de seis indicadores y endpoint disponibles; sin puntajes; validación científica pendiente. |
| Comparador de regiones | Comparar resultados con períodos, unidades, cobertura y criterios compatibles. | Comparación descriptiva de dos ciudades implementada; comparación de regiones arbitrarias pendiente. |
| Investigaciones guiadas | Orientar preguntas y recorridos basados en datos y análisis disponibles. | Interfaz y recomendador del equipo conectados; validación científica de recorridos pendiente. |

## Tecnologías y arquitectura actuales

El código actual usa **Python, Flask, Requests, SciPy y JSON**, con módulos de proveedores
de datos. `app.py` expone `create_app(config=None)` y registra un Blueprint en
`/api`, además del Blueprint web y los estáticos en el mismo origen. Las dependencias directas verificadas localmente figuran en `requirements.txt`;
la instalación limpia y las pruebas se verificaron en Docker con Python 3.12.16
Linux/amd64. El despliegue productivo sigue pendiente.

Archivos existentes relevantes:

```text
app.py
requirements.txt
Dockerfile
compose.yaml
.dockerignore
api/
  __init__.py
  routes.py
  responses.py
  errors.py
services/
  __init__.py
  api_service.py
  cities.py
  geography.py
  cache.py
  bulk.py
  normalizer.py
  providers/
    __init__.py
    power.py
tests/
  test_api.py
  test_cities.py
  test_geography.py
  test_cache.py
  test_bulk.py
  test_city_catalog_builder.py
  test_power_provider.py
  test_power_provider_live.py
test_nasa.py
docs/nasa-power.md
docs/bulk-power.md
docs/api.md
docs/docker.md
data/cities.json
data/cache/.gitignore
scripts/build_city_catalog.py
scripts/fetch_power.py
```

Flujo actual: un consumidor Python o `scripts/fetch_power.py` selecciona ciudades
argentinas y llama a `PowerBulkService`; el servicio reutiliza cachés válidas o
consulta el proveedor multivariable, que normaliza la respuesta NASA. Los consumidores
existentes también pueden seguir usando directamente `get_data()` y `get_data_multi()`.
La API delega en `services/api_service.py`, que reutiliza esos servicios, valida las
solicitudes y proyecta al cliente sólo las variables seleccionadas. La lógica de
obtención y caché no se duplica en las rutas.

### Contrato del proveedor NASA POWER

- Archivo: `services/providers/power.py`.
- Endpoint remoto configurado: `https://power.larc.nasa.gov/api/temporal/monthly/point`.
- Comunidad: `AG`; frecuencia: mensual; timeout actual: 60 segundos.
- `get_data(latitude, longitude, variable, start_year, end_year)` conserva la
  interfaz existente para una variable.
- `get_data_multi(latitude, longitude, variables, start_year, end_year)` consulta
  varias variables en una petición y devuelve un diccionario por código. Requiere
  una colección no vacía y elimina duplicados conservando el orden solicitado.
- Variables admitidas: `T2M`, `T2M_MAX`, `T2M_MIN`, `PRECTOTCORR`, `RH2M` y `WS2M`.
- Cada resultado contiene `provider`, `dataset`, `variable`, `name`, `unit`,
  `latitude`, `longitude`, `start_year`, `end_year`, `frequency`, `series` y `metadata`.
- `series` contiene registros `{"date": "YYYY-MM", "value": número_o_None}`.
- `metadata.header` conserva las fuentes originales y los metadatos de cabecera;
  `metadata.parameter` contiene los metadatos de esa variable. También se conservan
  geometría, mensajes y otros metadatos de primer nivel recibidos.
- `dataset="MERRA-2"` es un campo histórico del contrato. Conservarlo y consultar
  también las fuentes originales en los metadatos; no interpretarlo como prueba de
  que exista un proveedor directo de MERRA-2.
- Las unidades recibidas de NASA tienen prioridad sobre los valores de respaldo
  del catálogo local. No modificar unidades sin una conversión explícita y trazable.
- Se rechazan variables inválidas antes de acceder a la red y se informa con
  `ValueError` si falta una variable solicitada o la estructura esperada es inválida.
  Los errores HTTP, de conexión y de JSON se propagan; no se fabrican resultados.

### Normalización actual

`services/normalizer.py` ordena los registros, conserva los meses `01` a `12`, excluye
el registro anual `YYYY13` y convierte el valor de relleno informado por NASA en
`None`. Conserva los ceros y nulos existentes; no interpola ni crea meses ausentes.

La precipitación `PRECTOTCORR` se conserva en `mm/day`, sin convertirla en un
acumulado mensual. Los extremos de temperatura conservan la definición del producto
mensual de NASA. Los datos del producto corresponden a una grilla; no presentarlos
como mediciones de una estación local.

## Catálogo argentino, caché y obtención masiva

- `data/cities.json` contiene las 25 ciudades acordadas, con ID estable, nombre,
  provincia/jurisdicción, región, país, coordenadas y procedencia GeoRef. Conserva
  el registro oficial, ID de entidad, consulta y fecha de obtención del centroide.
- `services/cities.py` ofrece `list_cities(province=None, region=None)` y
  `get_city(city_id)`; este último devuelve `None` para un ID inexistente. La cantidad
  de localidades no está fijada en el cargador. Los filtros admiten tildes/caso
  indistintos, ID provincial y alias documentados como `CABA` y `centro-pampeana`.
- Las regiones son la agrupación definida por el proyecto: Patagonia, Centro y
  región pampeana, Cuyo, NOA y NEA; no atribuir esta clasificación a GeoRef.
- `scripts/build_city_catalog.py` permite reconstruir el catálogo con una consulta
  por lotes a GeoRef. No ejecutar la reconstrucción automáticamente al importar módulos.
- `services/bulk.py` ofrece `PowerBulkService.collect_city()`, `collect_cities()` y
  `plan_cities()`. Permite seleccionar un ID, un subconjunto, provincia, región o
  catálogo completo. El período por defecto es **2000–2024**, configurable.
- Cada ubicación remota usa una petición con las seis variables del proveedor
  existente. Las consultas son secuenciales, con intervalo mínimo configurable de
  un segundo por defecto; los fallos se informan por ubicación y no detienen el lote.
- `services/cache.py` almacena JSON en `data/cache/power/`, ignorado por Git mediante
  `data/cache/.gitignore`. La clave distingue proveedor, dataset, endpoint, comunidad,
  frecuencia, coordenadas, variables y período. Conserva series, unidades, metadatos,
  ubicación y fechas de obtención en UTC.
- La caché se reutiliza hasta `force=True`/`--force` o el vencimiento opcional
  `max_age_days`/`--max-age-days`. Un acierto no cambia la fecha de obtención original.
- Validar las seis series y todos los meses del período antes de guardar. Los nulos
  científicos se conservan y cuentan; una serie totalmente nula, una variable o mes
  ausente, valores no finitos o metadatos esenciales ausentes producen un error.
  Una actualización que sustituye valores disponibles por nulos se rechaza.
- Las escrituras usan reemplazo atómico. Una respuesta fallida/incompleta no
  sobrescribe una caché válida. Un refresco fallido se informa como error con
  `cache_preserved`, sin presentar los datos anteriores como una descarga nueva.
- `scripts/fetch_power.py` exige una selección explícita. `--dry-run` sólo muestra
  el plan; no consulta NASA ni escribe cachés. Ver [docs/bulk-power.md](docs/bulk-power.md).

## Validación territorial: estado y límite actual

Las ciudades del catálogo se respaldan en localidades argentinas de GeoRef. Para
coordenadas libres, `services/geography.py` define `TerritoryEvidence` y el contrato
de un validador inyectable de límites oficiales. `collect_location()` admite una
ubicación fuera del catálogo sólo con evidencia de pertenencia a Argentina.

**Todavía no hay un adaptador real de límites/polígonos configurado.** Sin ese
adaptador, las coordenadas libres se rechazan antes de consultar NASA, incluso si
parecen argentinas. Una caja rectangular o el mero rango mundial de latitud/longitud
no validan territorio. Las pruebas de este contrato usan un validador simulado,
que nunca debe usarse para habilitar coordenadas en producción.

El proveedor POWER de bajo nivel mantiene su interfaz existente; la restricción
territorial corresponde a los servicios de aplicación y a las futuras rutas HTTP.
No habilitar una ruta de coordenadas libres que eluda esta validación.

## API REST básica disponible

Contrato y ejemplos para frontend: [docs/api.md](docs/api.md).

- `GET /api/health`: disponibilidad del proceso HTTP, sin sondear NASA.
- `GET /api/variables`: códigos, nombres, unidades de catálogo y fuentes.
- `GET /api/cities`: catálogo argentino con filtros `province` y `region`.
- `GET /api/cities/{city_id}`: detalle de una ciudad verificada.
- `GET /api/regions`: regiones presentes y conteos derivados del catálogo.
- `POST /api/data`: una ciudad, una lista opcional de variables, años y `force`.

La consulta HTTP reutiliza la caché de las seis variables; devuelve sólo las
seleccionadas, con unidades recibidas, metadatos, cobertura, origen y fecha UTC.
La obtención se serializa dentro de cada proceso para evitar descargas duplicadas.
No hay bloqueo entre varios procesos ni despliegue multiproceso verificado.

Las respuestas usan `status`, `data` y `meta`; los errores usan `status`, `error`
y `meta`, con estados HTTP y códigos públicos documentados. No devolver mensajes
crudos de excepciones, rutas locales o advertencias internas. No habilitar
coordenadas libres ni aceptar parámetros de configuración desde el cuerpo HTTP.

Frontend y API comparten origen; CORS permanece desactivado. Si el equipo define
orígenes distintos, acordar una lista explícita antes de habilitarlo. No aplicar
un comodín. `static/js/api.js` consume el contrato documentado en `docs/api.md`.

## Docker para desarrollo local

`Dockerfile` usa `python:3.12-slim`; `compose.yaml` define un único servicio
`backend`, sin base de datos. Sirve el frontend HTML/Jinja y el motor en el mismo
proceso; no requiere Node ni otro contenedor. Usa `app:create_app`, se publica en
`127.0.0.1:5000` y tiene healthcheck sobre `/api/health`. Flask admite recarga de
código sin habilitar el depurador interactivo. Ejecuta como UID 10001.

El código y el catálogo se montan desde el host con sólo lectura en el contenedor;
`./data/cache` se monta con lectura/escritura en `/app/data/cache` y mantiene la
caché original de POWER. No copiar cachés científicas ni credenciales a la imagen.
No sustituir ese montaje por un volumen vacío que oculte datos ya obtenidos.

Las 71 pruebas originales siguen intactas. La suite ampliada y las páginas se
verificaron dentro de Docker y con Chrome real; ver `BACKEND_TASKS.md`.
El lote completo de 25 ciudades para 2000–2024 se ejecutó por indicación explícita
del usuario: 25 aciertos de caché, 150 series, 45.000 valores mensuales disponibles,
sin faltantes ni fallos; no se hicieron descargas nuevas. Se verificó que las 25
cachés anteriores conservaran sus hashes y fechas de obtención.

Guía y comandos: [docs/docker.md](docs/docker.md). Frontend y motor se incorporaron
desde las ramas del equipo sin reemplazar el proveedor ni su caché. Diagnóstico e
inventario Docker: [docs/integration.md](docs/integration.md).

## Arquitectura prevista — todavía pendiente

Mantener los proveedores separados de la lógica de producto. Las siguientes capas
se incorporarán por etapas autorizadas:

1. Adaptador territorial con límites oficiales de Argentina para coordenadas libres.
2. Despliegue productivo de la API y ampliación de rutas cuando existan los servicios
   de análisis y producto. La instalación limpia para desarrollo ya se verificó en Docker.
3. Revisión metodológica conjunta del motor ya integrado antes de ampliar usos científicos.
4. Validación científica y futuras vistas para Radar/Fingerprint; sus servicios y generador provisionales ya existen.
5. CI y ampliación de contratos; el flujo actual del frontend y sus pruebas ya están conectados.

Rutas de producto **implementadas con evidencia provisional**: `/api/radar` y
`/api/fingerprint/{city_id}`. `/api/analyze`, `/api/compare`, `/api/summary`,
`/api/missions`, `/api/catalog` y `/api/variables/recommend` están integradas.
Las tres primeras usan el motor real y el proveedor/caché existentes; los
catálogos de misiones y recomendaciones nunca descargan ni fabrican datos.

## Fuentes científicas

Priorizar NASA POWER, MERRA-2, Giovanni, GPM y GLDAS según la variable y el caso de
uso. Evaluar SWOT como recurso complementario, incluyendo Hydrocron como posible
vía de acceso. Estas prioridades no equivalen a integraciones terminadas.

Actualmente sólo existe el proveedor NASA POWER. MERRA-2 figura en su contrato de
datos; no hay un cliente directo de MERRA-2. Giovanni es una vía de acceso/análisis
a evaluar mediante servicios oficiales NASA Earthdata; no tratarlo como un dataset
único ni suponer que todos los productos comparten variables o resolución.

Antes de agregar una fuente, verificar documentación oficial, acceso y autenticación,
cobertura espacial y temporal, frecuencia, unidades, valores faltantes y metadatos
del producto concreto. No suponer equivalencias entre productos de POWER, GPM,
GLDAS y SWOT ni combinar sus series sin justificar su compatibilidad.

## Restricciones científicas y de colaboración

- Inspeccionar primero los archivos y conservar las funcionalidades que ya funcionan,
  especialmente la compatibilidad de `get_data()`.
- No modificar archivos de compañeros sin autorización. El motor estadístico y el
  frontend son puntos de coordinación, no autorización para editar código ajeno.
- Trabajar por etapas. Completar y probar la etapa autorizada, explicar los cambios
  y esperar indicación antes de implementar la siguiente.
- Mantener el alcance exclusivo argentino. No agregar ciudades internacionales ni
  sustituir una validación territorial por una caja rectangular. El catálogo no
  define un límite permanente para las ubicaciones investigables dentro del país.
- No inventar observaciones, tendencias, pendientes, significancias ni conclusiones.
  Los datos sintéticos sólo se permiten como pruebas de software claramente
  identificadas y separadas de los resultados científicos.
- No introducir puntuaciones ambientales arbitrarias. Earth Fingerprint debe
  describir resultados y evidencias, con su método y contexto.
- Mantener unidades, fuentes, metadatos, período, frecuencia y cobertura. Explicitar
  cualquier agregación, transformación o limitación de resolución.
- No reemplazar faltantes por cero ni imputarlos silenciosamente. Acordar con el
  responsable del motor los criterios de cobertura, estacionalidad, incertidumbre
  y comparaciones múltiples antes de presentar descubrimientos de Earth Radar.
- No confundir correlación con causalidad ni presentar significancia estadística
  como una explicación causal. No presentar resultados del motor si aún no existe
  una integración verificable.
- No hacer commits ni push sin autorización. Conservar los cambios locales y los
  archivos sin seguimiento preexistentes; no limpiar el repositorio por iniciativa propia.
- No incluir credenciales en código, documentación, cachés o resultados versionables.

## Verificación y mantenimiento

Ejecutar desde la raíz, en PowerShell:

```powershell
.\venv\Scripts\python.exe -m unittest discover -s tests -v
```

La suite sin red usa valores sintéticos identificados como tales. La prueba real de
NASA POWER es optativa: requiere `EARTHLENS_POWER_LIVE=1`, acceso a Internet y hace
dos consultas. Ver instrucciones en [docs/nasa-power.md](docs/nasa-power.md).
Un resultado `skipped` no equivale a una verificación de red satisfactoria.

Las pruebas de catálogo, caché, selección masiva y geografía son sin red. El lote de
25 ubicaciones se prueba con NASA simulada. La primera verificación real de NASA se
limitó a tres ciudades; en la etapa Docker se ejecutó el lote de 25 con cachés
preexistentes verificadas, sin solicitudes nuevas. No forzar una actualización
completa por iniciativa propia; reutilizar la caché conforme a la tarea autorizada.
Los comandos están en `docs/bulk-power.md` y `docs/docker.md`.
Las pruebas de API usan el cliente Flask, NASA simulada y cachés temporales; no
consultan proveedores reales. Las verificaciones adicionales pueden leer la caché
real existente bloqueando la red y comprobando que no se modifique.

`test_nasa.py` es un script manual que consulta NASA al ejecutarse o importarse;
evitar importarlo como parte de verificaciones sin red. Mantener la separación
entre pruebas automáticas de contrato y comprobaciones reales de los proveedores.

Al completar trabajo autorizado, actualizar el estado y las dependencias en
`BACKEND_TASKS.md`, citar los archivos que lo respaldan e informar qué se verificó
y qué quedó pendiente. No marcar una funcionalidad de producto como completada
por disponer solamente de su proveedor de datos.


## Integración de frontend y motor — contrato vigente

`services/trend_analysis.py` conserva el motor de `origin/results-charts` e33c76d;
`services/analysis_service.py` adapta series mensuales reales a sus entradas y
mantiene unidades, metadatos, cobertura y fechas. El motor requiere SciPy y aplica
medias aritméticas anuales con mínimo 9 meses válidos, 3 años y 70% de cobertura.
La comparación exige idénticas unidades y años válidos. No reemplazar el motor
ni activar proveedores con respaldo sintético.

Las misiones originales de `origin/datasets-missions` fbd7d0a se conservan en
`services/guided_missions.py`, catálogos separados y su interfaz. Su agregador
anual alternativo permanece disponible como código del compañero y pruebas; no
se usa en el flujo estadístico actual. `services/mission_service.py` proyecta el
catálogo al método y las unidades vigentes y usa IDs de ciudades verificadas.

`tests/statistics_fixtures/` y `tests/data/` contienen recursos heredados sólo para
pruebas de software. La aplicación no usa esas muestras ni genera series de
respaldo. Los scripts `check_cached_integration.py` y `check_web.py` verifican
respectivamente las cachés reales con NASA bloqueada y el flujo de navegador.

Consultar `docs/integration.md` antes de ampliar métodos, misiones o resultados.
Earth Radar y Earth Fingerprint tienen backend provisional, según `docs/products.md`.
La falta de corrección de autocorrelación y comparaciones múltiples impide tratar
este análisis exploratorio como un servicio de descubrimientos confirmados.


## Contrato común y productos provisionales

`services/analysis_results.py` define el contrato común v1 y los indicadores de las
seis variables; `AnalysisService.results()` reutiliza el motor y la obtención
existentes. No agregar regresiones alternativas. `statistics` conserva lo recibido;
`statistics_unrounded` queda reservado para la salida completa del compañero,
actualmente ausente. Todos los análisis calculados son científicamente
`provisional`, aunque `data_status` sea `valid`.

`services/fingerprint.py` produce perfiles y verifica compatibilidad descriptiva.
`services/radar.py` define la familia completa del catálogo x seis variables y
persiste sus resultados. `scripts/generate_radar.py` es siempre cache-only; nunca
actualiza observaciones. El artefacto derivado vive en `data/cache/radar/latest.json`
y se escribe atómicamente con integridad SHA-256, fuera de `power/`.

`GET /api/radar` sólo lee el artefacto y filtra filas: no genera estudios, descarga
series ni ajusta p-valores. Los filtros no cambian la familia, resumen ni estado
de ajuste. `GET /api/fingerprint/{city_id}` conserva el período solicitado y las
seis variables. No habilitar coordenadas libres ni configuración HTTP del motor.

No marcar ninguna señal nominal provisional como descubrimiento confirmado. La
aprobación metodológica, precisión completa y correcciones científicas continúan
bajo coordinación de B06. Los perfiles no contienen puntuaciones arbitrarias.
