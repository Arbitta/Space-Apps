# EarthLens — ejecución local con Docker

Guía para Patagonia Prime. Un único servicio `backend` ejecuta la API Flask para
desarrollo. No se agregan bases de datos ni servicios externos. En esta copia del
repositorio no hay frontend, `package.json`, Vite/Next ni una interfaz HTML propia;
no corresponde crear un segundo contenedor hasta integrar el código del frontend.

## Requisitos y arranque

Docker Desktop debe estar iniciado con el motor de contenedores Linux. En Windows
se verificó con WSL 2, Docker Compose y el proyecto en su carpeta actual de OneDrive.
No hace falta instalar Python ni copiar `venv/` para ejecutar el backend con Docker.

Desde la raíz del repositorio, en PowerShell:

```powershell
docker compose config --quiet
docker compose build
docker compose up -d --wait --wait-timeout 60
docker compose ps
```

API: `http://127.0.0.1:5000/api/health`. La raíz `/` no ofrece una interfaz web.
Los seis endpoints y sus contratos están en [api.md](api.md).

La imagen `earthlens-backend:dev` usa `python:3.12-slim`; en esta verificación
resolvió Python **3.12.16** y se instalaron desde cero Flask **3.1.3** y Requests
**2.34.2**, sin modificar `requirements.txt`. El código usa `app:create_app`.
El proceso corre como el usuario `earthlens` (UID 10001), no como root.

El puerto 5000 se publica únicamente en la interfaz local de Windows. Para usar
otro puerto si el predeterminado ya está ocupado:

```powershell
$env:EARTHLENS_PORT = '5001'
docker compose up -d --wait --wait-timeout 60
# Ahora la API es http://127.0.0.1:5001/api/health
```

El puerto interno y el healthcheck siguen usando 5000. Para volver al predeterminado,
quitar esa variable de la sesión y volver a ejecutar `docker compose up -d`.

## Desarrollo, recarga y dependencias

Compose monta `app.py`, `api/`, `services/`, `scripts/`, `tests/` y el catálogo
`data/cities.json` desde el repositorio. Esos montajes son de sólo lectura dentro
del contenedor; el editor del host puede seguir modificando los archivos.

Flask corre con `--reload --no-debugger` y `FLASK_DEBUG=0`: los cambios de código
se detectan automáticamente y no se habilita el depurador interactivo. La recarga
se comprobó mediante un cambio temporal de fecha en `app.py`, sin alterar su
contenido y restaurando luego la fecha original; los logs confirmaron el reinicio.

Cambios en `requirements.txt` o en el Dockerfile requieren reconstruir:

```powershell
docker compose up -d --build --wait --wait-timeout 60
docker compose logs --tail 50 backend
docker compose logs -f backend
```

El código de negocio y el proveedor no se modificaron para contenerizar. La API
conserva el procesamiento de datos serializado dentro del proceso; no ejecutar
varias réplicas o varios lotes contra la misma caché en esta versión.
Esta configuración usa el servidor de desarrollo Flask; el despliegue productivo
con un servidor WSGI sigue fuera de esta etapa.

## Caché científica persistente

`./data/cache` se monta con lectura/escritura en `/app/data/cache`. La API apunta
explícitamente a `/app/data/cache/power`; el comando de obtención usa el mismo
directorio por defecto. Los archivos JSON existentes se usan directamente, sin
copiarlos a un volumen nuevo ni ocultarlos tras una caché vacía.

La caché queda en el host al detener, recrear o reconstruir el contenedor. La imagen
no contiene los JSON científicos: `.dockerignore` excluye `data/cache`, entornos
virtuales, archivos `.env`, credenciales y temporales; el Dockerfile copia sólo el
catálogo y el código necesarios. `data/cache/.gitignore` mantiene los datos y los
informes locales fuera de Git.

Se verificaron lectura, escritura temporal y eliminación de esa prueba con UID
10001. Los SHA-256 de las 25 cachés anteriores coincidieron antes/después de las
pruebas, el acceso HTTP, la recarga y el lote completo. También se conservaron sus
fechas de obtención científicas.

No borrar `data/cache` para reiniciar la API. Para parar y volver a arrancar:

```powershell
docker compose stop
docker compose start

# Para retirar los contenedores y la red de este proyecto:
docker compose down
# El bind mount data/cache permanece en el host.
```

## Pruebas y endpoints

```powershell
docker compose exec -T -e EARTHLENS_POWER_LIVE=0 backend python -m unittest discover -s tests -v
docker compose exec -T backend python -m pip check
docker compose exec -T backend python -m flask --app app:create_app routes

Invoke-RestMethod http://127.0.0.1:5000/api/health
Invoke-RestMethod http://127.0.0.1:5000/api/variables
Invoke-RestMethod 'http://127.0.0.1:5000/api/cities?province=Chubut'
Invoke-RestMethod http://127.0.0.1:5000/api/cities/mendoza
Invoke-RestMethod http://127.0.0.1:5000/api/regions
$earthlensBody = @{ city_id='mendoza'; variables=@('T2M','RH2M'); start_year=2000; end_year=2024 } | ConvertTo-Json
Invoke-RestMethod http://127.0.0.1:5000/api/data -Method Post -ContentType 'application/json' -Body $earthlensBody
```

Resultado verificado el **14 de noviembre de 2026**: 72 pruebas descubiertas,
**71 aprobadas y una integración real omitida**, sin consultas externas desde la
suite; `pip check` sin dependencias rotas. Los seis endpoints respondieron **HTTP
200 desde Windows**; `/api/data` usó la caché y devolvió 300 meses por variable.

El healthcheck heredado de la imagen consulta `/api/health` cada 15 segundos, con
timeout de 3 segundos y tres intentos. Comprueba el proceso HTTP, no la disponibilidad
de NASA ni la calidad científica. `docker compose ps` debe mostrar `healthy`.

## Obtención masiva 2000–2024

```powershell
# Ver selección sin consultas NASA ni escrituras de caché.
docker compose exec -T backend python -m scripts.fetch_power --all --start-year 2000 --end-year 2024 --dry-run

# Reutilizar cachés válidas y obtener únicamente lo que falte.
docker compose exec -T backend python -m scripts.fetch_power --all --start-year 2000 --end-year 2024

# Subconjunto o región, si se necesita después.
docker compose exec -T backend python -m scripts.fetch_power --cities comodoro-rivadavia mendoza posadas
docker compose exec -T backend python -m scripts.fetch_power --region Cuyo
```

No se usa `--force` para el lote inicial. El servicio mantiene una consulta
multivariable por ciudad que necesite datos remotos, seis variables y un intervalo
mínimo de un segundo entre inicios de consultas. Los errores se registran por
ubicación y el lote continúa. No hay reintentos automáticos ni sustitución de una
caché válida por respuestas incompletas o degradadas. Los faltantes científicos
permanecen como `null` y se cuentan. La CLI termina con 0 si todo fue correcto y 1
si hubo ubicaciones fallidas.

El lote ejecutado dentro de Docker terminó así:

| Resultado | Cantidad |
| --- | ---: |
| Ciudades procesadas correctamente | 25 |
| Ciudades reutilizadas desde caché | 25 |
| Descargas nuevas / consultas NASA | 0 |
| Consultas fallidas | 0 |
| Series normalizadas disponibles | 150 |
| Registros mensuales totales | 45.000 |
| Registros con valor disponible | 45.000 |
| Registros faltantes | 0 |

Cada ciudad tiene seis series de 300 meses: **1.800 registros por ciudad**. Estos
conteos describen datos ya obtenidos anteriormente y reutilizados, no nuevas
observaciones ni resultados de tendencias. No permiten inferir cobertura para
otras ubicaciones o períodos.

| Región | Ciudades verificadas desde caché |
| --- | --- |
| Patagonia | Comodoro Rivadavia, Puerto Madryn, Trelew, Río Gallegos, Ushuaia, Bariloche, Neuquén. |
| Centro y región pampeana | Buenos Aires, La Plata, Mar del Plata, Bahía Blanca, Rosario, Córdoba, Santa Fe. |
| Cuyo | Mendoza, San Juan, San Luis. |
| NOA | Salta, San Salvador de Jujuy, San Miguel de Tucumán, Santiago del Estero. |
| NEA | Posadas, Corrientes, Resistencia, Formosa. |

Informe local completo: `data/cache/reports/power-2000-2024-docker.json`. Contiene
estados, origen, períodos, fechas de obtención, cobertura por variable y un bloque
`audit` con los totales comprobados. Está ignorado por Git. Los datos completos
siguen en los 25 archivos originales de `data/cache/power/`.

## Frontend y alcance

No se agregó un contenedor de frontend porque su implementación no está en este
repositorio. CORS sigue desactivado; cuando el frontend esté disponible, podrá
utilizar un proxy de desarrollo para `/api` o se acordarán orígenes explícitos.
Las coordenadas libres siguen bloqueadas hasta integrar límites oficiales de
Argentina. Esta etapa no incorpora estadísticas, Earth Radar ni Earth Fingerprint.

Referencias: [bind mounts de Docker](https://docs.docker.com/engine/storage/bind-mounts/),
[servicios Compose](https://docs.docker.com/reference/compose-file/services/) y
[CLI de Flask](https://flask.palletsprojects.com/en/stable/cli/).
