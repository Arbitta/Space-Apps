# EarthLens — contrato de API REST, versión 1

API para el equipo de frontend de Patagonia Prime. Alcance exclusivo: **Argentina**.
Sólo se admiten ciudades del catálogo verificado; no hay coordenadas libres, motor
estadístico, Earth Radar ni Earth Fingerprint en esta etapa.

## Instalación y ejecución local

Desde la raíz del repositorio, en PowerShell:

```powershell
.\venv\Scripts\python.exe -m pip install -r requirements.txt
.\venv\Scripts\python.exe -m flask --app app:create_app run --host 127.0.0.1 --port 5000
```

La URL local es `http://127.0.0.1:5000`. El comando usa el servidor de desarrollo y
no activa el depurador. No se descargan datos al importar módulos o crear la app.
`requirements.txt` fija las versiones directas verificadas localmente; no es un
lock de dependencias transitivas. La instalación limpia se verificó posteriormente
en Docker con Python 3.12.16 Linux/amd64; ver [ejecución con Docker](docker.md).

## Convenciones comunes

Todas las respuestas de los endpoints son JSON UTF-8. El sobre de éxito es
`{"status":"ok","data":...,"meta":{"api_version":"1",...}}`. Los campos `data`
y `meta` varían por recurso; `status` y `meta.api_version` son comunes para permitir
reutilizar el contrato en servicios futuros.

Los errores usan este sobre y un estado HTTP no exitoso:

```json
{
  "status": "error",
  "error": {
    "code": "invalid_request",
    "message": "force debe ser un booleano JSON.",
    "details": {"field": "force"}
  },
  "meta": {"api_version": "1"}
}
```

El frontend debe decidir por `error.code` y el estado HTTP; el texto es explicativo.
`details` siempre es un objeto y puede estar vacío. No se devuelven rutas locales,
credenciales, trazas ni mensajes crudos de excepciones. Las advertencias de caché
tienen códigos y textos públicos controlados. Los metadatos científicos originales
sí se conservan en los datos.

No se admiten parámetros de query desconocidos, vacíos o repetidos. En los GET sin
filtros y en POST `/api/data`, la query debe estar vacía. Los GET también admiten
HEAD y las respuestas automáticas OPTIONS de Flask; un método incorrecto devuelve
405 JSON con su encabezado `Allow`.

## GET /api/health

Comprueba que el proceso HTTP responde. No consulta NASA ni verifica la red, el
catálogo o la disponibilidad del proveedor.

Solicitud: `GET /api/health`. Respuesta 200:

```json
{
  "status": "ok",
  "data": {"service": "EarthLens", "status": "up", "country_code": "AR"},
  "meta": {"api_version": "1"}
}
```

## GET /api/variables

Catálogo obtenido de `services/providers/power.py`, sin consultar NASA. `data` es
una lista con las seis variables; cada elemento contiene `code`, `name`, `unit`,
`provider`, `dataset`, `frequency` y `sources` (nombre y URL).

Solicitud: `GET /api/variables`. Extracto de respuesta 200, con sólo el primer
elemento de la lista de seis:

```json
{
  "status": "ok",
  "data": [{
    "code": "T2M",
    "name": "Temperatura media",
    "unit": "°C",
    "provider": "NASA POWER",
    "dataset": "MERRA-2",
    "frequency": "monthly",
    "sources": [{"name": "NASA POWER", "url": "https://power.larc.nasa.gov/api/temporal/monthly/point"}]
  }],
  "meta": {"api_version": "1", "count": 6}
}
```

| Código | Nombre del catálogo | Unidad del catálogo |
| --- | --- | --- |
| T2M | Temperatura media | °C |
| T2M_MAX | Temperatura máxima | °C |
| T2M_MIN | Temperatura mínima | °C |
| PRECTOTCORR | Precipitaciones | mm/day |
| RH2M | Humedad relativa | % |
| WS2M | Velocidad del viento | m/s |

Estas unidades son las del catálogo de respaldo existente. En `/api/data` se
conservan exactamente las recibidas de NASA, por ejemplo `C` para temperatura.
Usar la unidad de la serie al mostrar los datos. No se convierten valores ni se
interpreta `mm/day` como un acumulado mensual. El catálogo identifica al proveedor;
las fuentes concretas recibidas también figuran en `metadata.header.sources`.

## GET /api/cities

Lista las 25 ciudades iniciales. Filtros opcionales: `province` y `region`, combinados
por intersección. Ignoran caso y tildes; provincia admite nombre o ID GeoRef, `CABA`
y `Tierra del Fuego`. Región admite su nombre y el alias `centro-pampeana`.
Un filtro de texto válido sin coincidencias devuelve 200, `data=[]` y `count=0`.

Solicitud: `GET /api/cities?province=Misiones&region=NEA`. Extracto de respuesta 200
con los campos de procedencia abreviados:

```json
{
  "status": "ok",
  "data": [{
    "id": "posadas", "name": "Posadas",
    "province": "Misiones", "province_id": "54", "region": "NEA",
    "country": "Argentina", "country_code": "AR",
    "latitude": -27.3896545260435, "longitude": -55.9193081767805,
    "coordinate_source": {"name": "GeoRef Argentina", "entity_id": "54028030"}
  }],
  "meta": {"api_version": "1", "count": 1, "filters": {"province": "Misiones", "region": "NEA"}}
}
```

Cada ciudad incluye el `coordinate_source` completo del catálogo: URL, consulta,
registro oficial, ID, campo `centroide` y fecha de obtención. No se pierde esa
procedencia en la respuesta real.

## GET /api/cities/{city_id}

Solicitud: `GET /api/cities/posadas`. Devuelve 200 con `data` igual al objeto de
ciudad del listado. Extracto con la procedencia abreviada:

```json
{
  "status": "ok",
  "data": {
    "id": "posadas", "name": "Posadas",
    "province": "Misiones", "province_id": "54", "region": "NEA",
    "country": "Argentina", "country_code": "AR",
    "latitude": -27.3896545260435, "longitude": -55.9193081767805,
    "coordinate_source": {"name": "GeoRef Argentina", "entity_id": "54028030"}
  },
  "meta": {"api_version": "1"}
}
```

Los IDs usan minúsculas ASCII, números y guiones, como `comodoro-rivadavia`.
Un formato incorrecto devuelve 400; un ID bien formado que no existe devuelve 404
con `error.code="city_not_found"`.

## GET /api/regions

Regiones y cantidad de ciudades presentes, derivadas del catálogo. La clasificación
regional es del proyecto; `city_count` es un conteo, no una puntuación ambiental.

Solicitud: `GET /api/regions`. Respuesta 200:

```json
{
  "status": "ok",
  "data": [
    {"name": "Patagonia", "city_count": 7},
    {"name": "Centro y región pampeana", "city_count": 7},
    {"name": "Cuyo", "city_count": 3},
    {"name": "NOA", "city_count": 4},
    {"name": "NEA", "city_count": 4}
  ],
  "meta": {"api_version": "1", "count": 5}
}
```

## POST /api/data

Requiere `Content-Type: application/json` y un objeto JSON de hasta 16 KiB por
defecto. Consulta una ciudad y devuelve únicamente las variables seleccionadas.

| Campo | Tipo | Regla / valor por defecto |
| --- | --- | --- |
| city_id | string | Obligatorio, ID de una ciudad argentina del catálogo. |
| variables | array de strings | Opcional; las seis por defecto. Lista no vacía de códigos exactos; duplicados eliminados conservando el orden. |
| start_year | integer | Opcional, 2000. Desde 1981, sin strings, booleanos ni decimales. |
| end_year | integer | Opcional, 2024. Mayor o igual al inicio; no se admiten años futuros respecto del año UTC del servidor. |
| force | boolean | Opcional, false. Intenta actualizar aunque exista una caché válida. |

No se admiten otros campos. `latitude`, `longitude`, `lat`, `lon` o `coordinates`
devuelven 400 `coordinates_not_supported`. No hay selección de varias ciudades
en este endpoint. El período utiliza años completos; no se admiten fechas diarias.
Que un año sea válido no garantiza cobertura completa de NASA para ese año.

Solicitud de ejemplo:

```json
{"city_id":"mendoza","variables":["T2M"],"start_year":2000,"end_year":2024,"force":false}
```

Extracto de respuesta 200 con datos reales de la caché previamente verificada de
Mendoza. Se muestran sólo dos de los 300 meses y parte de los campos de ciudad y
metadatos; la respuesta real conserva todos esos campos y la serie completa:

```json
{
  "status": "ok",
  "data": {
    "city": {"id":"mendoza","name":"Mendoza","country_code":"AR"},
    "provider":"NASA POWER", "dataset":"MERRA-2", "frequency":"monthly",
    "start_year":2000, "end_year":2024,
    "variables": {
      "T2M": {
        "provider":"NASA POWER", "dataset":"MERRA-2", "variable":"T2M",
        "name":"Temperatura media", "unit":"C",
        "latitude":-32.8985811304419, "longitude":-68.8464060446987,
        "start_year":2000, "end_year":2024, "frequency":"monthly",
        "series":[{"date":"2000-01","value":24.74},{"date":"2000-02","value":23.5}],
        "metadata":{
          "header":{"sources":["MERRA2","POWER"],"fill_value":-999.0,"time_standard":"LST"},
          "parameter":{"units":"C","longname":"Temperature at 2 Meters"}
        }
      }
    }
  },
  "meta": {
    "api_version":"1", "origin":"cache",
    "fetched_at":"2026-11-14T17:44:54.775518+00:00",
    "requested_variables":["T2M"],
    "quality":{"T2M":{"expected_count":300,"valid_count":300,"missing_count":0}},
    "cache_available":true, "warnings":[]
  }
}
```

Los registros de `series` tienen `date=YYYY-MM` y `value` numérico o `null` para
faltantes. No se interpola ni se transforma un faltante en cero. `quality` conserva
conteos por variable; no expresa significancia estadística ni salud ambiental.

### Caché, proveedor y fallos

Se reutiliza `PowerBulkService` y su caché existente de seis variables. Pedir sólo
`T2M` también puede llenar esa caché completa mediante una única petición NASA;
la respuesta HTTP sólo incluye lo solicitado. Otra selección de variables para la
misma ubicación/período reutiliza la misma entrada, sin nuevas consultas.

`meta.origin` es `cache` o `nasa_power`. `fetched_at` es la fecha UTC de obtención;
una lectura de caché no la cambia. `cache_available` indica que los datos están en
caché o que la escritura terminó correctamente. No se revela la ruta del archivo.

Si falla una actualización, no se sobrescribe una caché válida ni se devuelve éxito
con datos viejos. El error puede añadir `meta.cache_preserved=true` y
`meta.previous_fetched_at`. Una consulta posterior sin `force` puede reutilizarla.
Una descarga válida con error de escritura devuelve 200, `cache_available=false`
y advertencia `cache_write_failed`. Una caché inválida recuperada mediante una
descarga válida informa `cache_recovered`. No hay reintentos automáticos.

El proveedor conserva su timeout de 60 segundos. Las obtenciones se serializan
dentro de cada proceso para reutilizar la caché entre solicitudes concurrentes;
las rutas de catálogo y salud no esperan ese bloqueo. Las esperas pueden aumentar
si hay solicitudes de datos en cola. No hay coordinación entre múltiples procesos:
la ejecución local documentada usa un proceso; el despliegue multiproceso queda pendiente.

## Estados HTTP y códigos de error

| HTTP | error.code | Significado |
| --- | --- | --- |
| 400 | invalid_request | JSON, campos, filtros, variables, tipos, IDs o años inválidos. |
| 400 | coordinates_not_supported | Coordenadas libres no habilitadas. |
| 404 | city_not_found | ID válido fuera del catálogo argentino. |
| 404 | not_found | Ruta inexistente, incluidas funcionalidades futuras aún no implementadas. |
| 405 | method_not_allowed | Método incorrecto; se conserva `Allow`. |
| 413 | request_too_large | Cuerpo superior al límite configurado. |
| 415 | unsupported_media_type | Content-Type no JSON. |
| 500 | internal_error | Fallo interno, sin detalles privados. |
| 502 | provider_error | Error HTTP u otro fallo de respuesta externa. |
| 502 | provider_invalid_response | JSON externo inválido, datos incompletos o actualización que degradaría la caché. |
| 503 | provider_unavailable | No se pudo establecer comunicación con NASA POWER. |
| 504 | provider_timeout | NASA POWER excedió su tiempo de espera. |

## Integración desde frontend y CORS

No hay frontend ni orígenes externos configurados en este repositorio, por lo que
**CORS está desactivado** y no se emite `Access-Control-Allow-Origin`. Usar el mismo
origen, por ejemplo con un proxy del servidor de desarrollo del frontend para `/api`
hacia `http://127.0.0.1:5000`. Si el equipo adopta orígenes distintos, acordarlos
antes de habilitar una lista explícita; no se configuró un comodín ni credenciales.

```javascript
const response = await fetch('/api/data', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({city_id: 'mendoza', variables: ['T2M', 'RH2M'], start_year: 2000, end_year: 2024})
});
const payload = await response.json();
if (!response.ok) throw new Error(`${payload.error.code}: ${payload.error.message}`);
const temperature = payload.data.variables.T2M;
// Usar temperature.unit, temperature.series y temperature.metadata.
```

Ejemplos para compartir desde PowerShell:

```powershell
Invoke-RestMethod http://127.0.0.1:5000/api/health
Invoke-RestMethod 'http://127.0.0.1:5000/api/cities?province=Chubut&region=Patagonia'
$earthlensBody = @{ city_id='mendoza'; variables=@('T2M','RH2M'); start_year=2000; end_year=2024 } | ConvertTo-Json
Invoke-RestMethod http://127.0.0.1:5000/api/data -Method Post -ContentType 'application/json' -Body $earthlensBody
```

Configuración opcional del servidor mediante `create_app(config)` o variables de
entorno con prefijo `EARTHLENS_`: `CACHE_DIR`, `CATALOG_PATH`, `POWER_REQUEST_DELAY`,
`POWER_CACHE_MAX_AGE_DAYS` y `MAX_CONTENT_LENGTH`. Los valores numéricos usan sintaxis
JSON en el entorno. La configuración no se acepta desde las solicitudes HTTP.

## Verificación

```powershell
.\venv\Scripts\python.exe -m unittest discover -s tests -v
.\venv\Scripts\python.exe -m flask --app app:create_app routes
.\venv\Scripts\python.exe -m pip check
```

El cliente de pruebas usa NASA simulada y cachés temporales. Se verificaron además
lecturas HTTP de las cachés reales preexistentes de Comodoro Rivadavia, Mendoza y
Posadas, con el acceso a NASA bloqueado: ninguna petición externa ni cambio en los
25 archivos de caché existentes. La integración de red previa sigue siendo optativa.

La arquitectura sigue las recomendaciones oficiales de Flask para
[Application Factories](https://flask.palletsprojects.com/en/stable/patterns/appfactories/),
[Blueprints](https://flask.palletsprojects.com/en/stable/blueprints/) y
[cliente de pruebas](https://flask.palletsprojects.com/en/stable/testing/).
