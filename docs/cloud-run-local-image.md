# Publicar la interfaz que funciona en localhost

## Diagnóstico comprobado el 15 de noviembre de 2026

| Recurso | Localhost | Servicio actual de Cloud Run |
| --- | --- | --- |
| `/` | 200, interfaz integrada con línea temporal | 200, interfaz anterior |
| `/api/health` | 200 | 404 |
| `/static/js/workspace.js` | 200 | 404 |

Servicio inspeccionado: <https://earthlens-224139449590.us-central1.run.app/>.

Localhost ejecuta `earthlens-backend:local-stable`. El ID local observado fue
`sha256:d1cd8236d6cdae20468c3b60a107384cf0cc574acdebb3ab5dba00ed114e04b3`.
Esa imagen contiene la aplicación integrada; el `app.py`, las plantillas y el
Dockerfile de `main` corresponden a otra versión. Reconstruir desde `main` no
reproduce el contenedor local.

La imagen estable se probó sin montajes ni conexión de red, con Gunicorn en
`0.0.0.0:8080` y `PORT=8080`. Los cuatro recursos `/`, `/time-machine`,
`/api/health` y `/static/js/workspace.js` respondieron 200.

## Publicación de la misma imagen

Estos comandos todavía no se ejecutaron contra Google Cloud. Requieren conocer
el ID del proyecto y un repositorio Docker existente en Artifact Registry, además
de acceso autorizado. Ejecutarlos en **PowerShell de esta computadora**, con
Docker Desktop y Google Cloud CLI disponibles. Cloud Shell no tiene acceso a las
imágenes del Docker local.

Completar los dos valores indicados y ejecutar cada bloque por separado. Si un
comando falla, detenerse y revisar el error antes de continuar.

```powershell
$ProjectId = 'ID_REAL_DEL_PROYECTO'
$Repository = 'REPOSITORIO_DOCKER_EXISTENTE'
$Region = 'us-central1'

gcloud auth login
gcloud run services describe earthlens --region $Region --project $ProjectId --format="yaml(status.url,status.traffic,spec.template.spec.containers[0].image)"
gcloud artifacts repositories list --location $Region --project $ProjectId --format="table(name,format)"
```

Usar el ID de la imagen del contenedor que está sirviendo localhost, para evitar
reconstruir accidentalmente el código de otra rama:

```powershell
$LocalImageId = docker inspect earthlens-runtime-backend-1 --format '{{.Image}}'
if ($LASTEXITCODE -ne 0) { throw 'No se pudo identificar la imagen local.' }
$Version = 'local-' + $LocalImageId.Substring(7, 12)
$RemoteImage = "${Region}-docker.pkg.dev/${ProjectId}/${Repository}/earthlens:${Version}"

gcloud auth configure-docker "${Region}-docker.pkg.dev"
if ($LASTEXITCODE -ne 0) { throw 'No se pudo configurar Artifact Registry.' }
docker tag $LocalImageId $RemoteImage
if ($LASTEXITCODE -ne 0) { throw 'No se pudo etiquetar la imagen local.' }
docker push $RemoteImage
if ($LASTEXITCODE -ne 0) { throw 'No se pudo subir la imagen.' }
```

Crear una revisión de prueba, conservando el tráfico de la URL principal en la
revisión actual. El servicio debe admitir la configuración de esta imagen; revisar
antes si tiene comandos de arranque o montajes personalizados:

```powershell
gcloud run deploy earthlens --image $RemoteImage --region $Region --project $ProjectId --port 8080 --memory 1Gi --no-traffic --tag local-preview
```

Cloud Run entregará una URL para la revisión etiquetada `local-preview`. Verificar
allí el mapa, la línea temporal, `/api/health` y `/static/js/workspace.js` antes
de decidir el cambio de tráfico. El comando para activarla, después de revisar la
persistencia que se describe abajo, es:

```powershell
gcloud run services update-traffic earthlens --region $Region --project $ProjectId --to-tags local-preview=100
```

No es necesario hacer commits ni push a Git para publicar una imagen ya construida.
Si hay un despliegue automático desde GitHub, debe apuntar posteriormente al código
integrado; una nueva construcción desde `main` podría volver a publicar la versión
anterior.

## Datos y servicios que no viajan con la imagen

La imagen reproduce el código y la interfaz. Los volúmenes locales
`earthlens_scientific_cache` y `earthlens_runtime_data` no se transfieren a Cloud Run
al subirla. Tampoco se despliega automáticamente el contenedor de monitoreo de
Compose. Las observaciones científicas existentes, las cuentas, los eventos y el
monitoreo necesitan una estrategia de persistencia y ejecución propia en la nube
antes de considerar equivalente el funcionamiento completo.

El sistema de archivos escribible de Cloud Run es temporal. No usar el SQLite
local del contenedor como almacenamiento persistente de usuarios y eventos; no
incluir esa base privada ni tokens en la imagen. No migrar la base ni reemplazar
la configuración de almacenamiento del servicio sin inspeccionarla primero.

Referencias oficiales: [desplegar imágenes](https://docs.cloud.google.com/run/docs/deploying),
[subir imágenes a Artifact Registry](https://docs.cloud.google.com/artifact-registry/docs/docker/pushing-and-pulling),
[revisiones de prueba y tráfico](https://docs.cloud.google.com/run/docs/rollouts-rollbacks-traffic-migration)
y [contrato del contenedor y almacenamiento](https://docs.cloud.google.com/run/docs/container-contract).
