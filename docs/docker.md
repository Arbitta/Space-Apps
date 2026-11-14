# EarthLens — ejecución local con Docker

Una única aplicación Flask sirve el frontend del equipo y la API REST en el mismo
origen. El motor estadístico corre en ese proceso con SciPy. No se necesitan Node,
npm, otro contenedor, base de datos ni un segundo Compose.

## Arranque

Iniciar Docker Desktop con contenedores Linux y ejecutar desde la raíz, en PowerShell:

```powershell
docker compose up -d --build --wait --wait-timeout 60
```

Abrir **http://127.0.0.1:5000/**. También están disponibles `/explorer`, `/results`,
`/compare`, `/missions`, `/about` y la API en `/api`. El healthcheck es
`http://127.0.0.1:5000/api/health`; no consulta NASA.

Para consultar el estado y los logs:

```powershell
docker compose ps
docker compose logs --tail 50 backend
```

Si 5000 está ocupado, elegir otro puerto antes de arrancar:

```powershell
$env:EARTHLENS_PORT = '5001'
docker compose up -d --build --wait --wait-timeout 60
# Abrir http://127.0.0.1:5001/
```

Sólo se publica la interfaz local de Windows. La imagen usa Python 3.12 y las
versiones directas verificadas de Flask, Requests y SciPy en `requirements.txt`.
NumPy se instala como dependencia de SciPy. La imagen final incluye templates,
estáticos, módulos web, motor y catálogos; no depende de una copia oculta de otra rama.

## Caché y desarrollo

`./data/cache` sigue montado en `/app/data/cache` con lectura/escritura. No se
sustituye por un volumen vacío ni se incluye en la imagen. Las 25 cachés de ciudades
2000–2024 mantienen sus hashes y fechas de obtención. Reiniciar o reconstruir el
servicio no borra esos archivos.

Los módulos Python, `templates/` y `static/` se montan con sólo lectura desde el
host; el editor puede modificarlos normalmente. Flask usa recarga sin depurador
interactivo y ejecuta como UID 10001. Al cambiar dependencias, catálogos de misiones
o Dockerfile, volver a ejecutar el comando de arranque con `--build`.

El navegador usa los CDN del frontend para Bootstrap, Leaflet, Chart.js y fuentes,
y servicios externos para mapas. Necesita Internet para esos recursos; las
consultas científicas 2000–2024 usan la caché local. Otros períodos pueden consultar
NASA. No se fuerza ninguna descarga al arrancar o importar módulos.

Para detener y volver a iniciar, conservando el entorno:

```powershell
docker compose stop
docker compose start
```

No borrar `data/cache` ni ejecutar limpiezas de volúmenes. No cambiar el montaje
persistente. Esta configuración usa el servidor de desarrollo Flask, un proceso y
bloqueo de obtención dentro de ese proceso; producción y múltiples workers quedan
pendientes.

## Pruebas y auditoría real

```powershell
docker compose exec -T -e EARTHLENS_POWER_LIVE=0 backend python -m unittest discover -s tests -v
docker compose exec -T backend python -m pip check
docker compose exec -T backend python -m flask --app app:create_app routes

# Lee las 25 cachés reales; bloquea NASA y comprueba hashes y fechas.
docker compose exec -T backend python -m scripts.check_cached_integration
```

Resultado verificado el **14 de noviembre de 2026**: **103 pruebas aprobadas**
(incluidas las **71 originales**, 7 del motor, 15 del catálogo/misiones y 10 de integración), una prueba NASA
optativa omitida y ninguna dependencia rota. La auditoría real procesó 25 ciudades,
150 series, 45.000 valores mensuales y 150 análisis anuales con cero consultas NASA
ni cambios en las cachés. No implica una nueva verificación del proveedor remoto.

Verificación optativa desde el host, con Chrome instalado y Playwright:

```powershell
.\venv\Scripts\python.exe -m pip install playwright
.\venv\Scripts\python.exe scripts/check_web.py
# Con otro puerto:
.\venv\Scripts\python.exe scripts/check_web.py --url http://127.0.0.1:5001
```

El script abre Chrome en modo headless, verifica Inicio → Explorador → Resultados,
CSV, gráficos, Comparador, errores y recuperación, misiones, metodología y vista
móvil. Guarda capturas e informe en `data/cache/reports/web`, ignorados por Git.
La respuesta 503 interceptada es una prueba de software, no un dato científico.
No se necesita Playwright para ejecutar la aplicación.

## Obtención de datos por solicitud explícita

```powershell
# Sólo planifica; no consulta NASA ni escribe caché.
docker compose exec -T backend python -m scripts.fetch_power --all --start-year 2000 --end-year 2024 --dry-run

# Reutiliza caché y consulta únicamente lo que falte, si se solicita un lote.
docker compose exec -T backend python -m scripts.fetch_power --all --start-year 2000 --end-year 2024
```

No usar `--force` para comprobar el arranque. Contratos: [api.md](api.md).
Diagnóstico por ramas, inventario Docker y metodología: [integration.md](integration.md).
