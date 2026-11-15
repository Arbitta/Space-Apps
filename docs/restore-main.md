# Restauración de la versión integrada en main — 15/11/2026

El usuario autorizó publicar de nuevo su rama `feature/backend-api` en `main`
después de los pushes cruzados del equipo. Se tomó como fuente `529c7a9` y como
base del commit de restauración `origin/main` `56c5e1e`.

La rama del backend ya era antecesora de main; un merge normal no recuperaba los
archivos reemplazados posteriormente. Se restauró su árbol en una copia aislada
y se preparó un commit nuevo sobre main. No se reescribe el historial ni se usa
force-push; el código previo continúa accesible en sus commits anteriores.

La aplicación recupera `app.py`, los Blueprints, los proveedores, los servicios,
las pruebas, la documentación y `workspace.html`. La entrada `/` vuelve a abrir
el mismo mapa y la timeline que la imagen local. Se conservan los nuevos helpers
de publicación en `deployment/cloud-run` y se incluyen en el Dockerfile para que
sus pruebas funcionen dentro del contenedor. Los artefactos locales, las copias
de integración, las cachés científicas y la base SQLite quedan fuera de Git y
del contexto de construcción.

Las copias locales de cachés/base se respaldaron antes de actualizar el checkout.
Los volúmenes `earthlens_scientific_cache` y `earthlens_runtime_data`, utilizados
por los contenedores activos, no se modifican durante la restauración.

Validación del árbol publicado:

- Imagen `earthlens-main-restore:verification` construida correctamente.
- Suite Docker sin red: **254 pruebas ejecutadas, 253 aprobadas y una NASA live
  opcional omitida**. Las seis pruebas nuevas de despliegue usan Google Cloud
  simulado; no representan consultas científicas ni una publicación real.
- Arranque Gunicorn con `PORT=8080`: `/`, `/index.html`, `/time-machine`,
  `/api/health`, `/api/cities` y `/static/js/workspace.js` responden 200.
- El JavaScript de la interfaz coincide con localhost al normalizar finales de línea.

Publicar main actualiza el código en GitHub. La construcción y activación de una
revisión de Cloud Run requiere su pipeline o una sesión autorizada. No se considera
verificado ese despliegue por haber aprobado las pruebas locales.

Si el servicio no tiene un trigger automático para main, desde un checkout nuevo
de esta rama, en Cloud Shell con el proyecto correcto seleccionado:

```bash
gcloud run deploy earthlens --source . --region us-central1 --port 8080 --memory 1Gi
```

Para probar una revisión sin tráfico antes de activarla, utilizar el procedimiento
en [deployment/cloud-run](../deployment/cloud-run/README.md). La persistencia de
datos, usuarios y monitoreo continúa siendo una dependencia del despliegue.
