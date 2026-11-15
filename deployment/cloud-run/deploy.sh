#!/usr/bin/env bash
# Run in an authenticated Google Cloud Shell after unpacking the release ZIP.
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
command -v gcloud >/dev/null
command -v python3 >/dev/null
python3 verify_release.py --files

PROJECT_NUMBER="$(python3 -c 'import json;print(json.load(open("release.json"))["project_number"])')"
TARGET_URL="$(python3 -c 'import json;print(json.load(open("release.json"))["target_url"])')"
PROJECT_ID="$(gcloud projects describe "$PROJECT_NUMBER" --format='value(projectId)')"
if [[ -z "$PROJECT_ID" ]]; then
  printf '%s\n' 'No se pudo identificar el proyecto autorizado.' >&2
  exit 1
fi
REGION="us-central1"
SERVICE="earthlens"
SUFFIX="local-$(date -u +%m%d%H%M%S)-${RANDOM}"
PREVIEW_TAG="$SUFFIX"
NEW_REVISION="${SERVICE}-${SUFFIX}"

# Store public status only: never export environment variables or credentials.
gcloud run services describe "$SERVICE" --project "$PROJECT_ID" --region "$REGION" \
  --format='json(status.url,status.traffic,status.latestReadyRevisionName)' > before-deploy.json
PUBLIC_URL="$(python3 -c 'import json;print(json.load(open("before-deploy.json"))["status"]["url"])')"
PREVIOUS_SPLIT="$(python3 - <<'PY'
import json
rows=json.load(open('before-deploy.json'))['status'].get('traffic',[])
splits={}
for row in rows:
    if row.get('percent',0)>0:
        revision=row.get('revisionName')
        if not revision: raise SystemExit('No se pudo identificar la revision anterior')
        splits[revision]=splits.get(revision,0)+row['percent']
if sum(splits.values())!=100: raise SystemExit('Distribucion anterior de trafico no valida')
print(','.join(f'{name}={percent}' for name,percent in splits.items()))
PY
)"

printf 'Proyecto: %s. Creando revision de prueba %s.\n' "$PROJECT_ID" "$NEW_REVISION"
gcloud run deploy "$SERVICE" --source ./app --project "$PROJECT_ID" --region "$REGION" \
  --port 8080 --memory 1Gi --cpu 1 --concurrency 8 --max-instances 1 --min-instances 0 \
  --timeout 60 --command="" --args="" --revision-suffix "$SUFFIX" \
  --no-traffic --tag "$PREVIEW_TAG"

PREVIEW_URL="$(gcloud run services describe "$SERVICE" --project "$PROJECT_ID" --region "$REGION" \
  --format='json(status.traffic)' | python3 -c '
import json,sys
rows=json.load(sys.stdin)["status"].get("traffic",[])
urls=[row["url"] for row in rows if row.get("tag")==sys.argv[1] and row.get("revisionName")==sys.argv[2]]
if len(urls)!=1: raise SystemExit("No se pudo identificar la URL de la revision nueva")
print(urls[0])' "$PREVIEW_TAG" "$NEW_REVISION")"
python3 verify_release.py "$PREVIEW_URL"

# Switch to the exact tested revision, never to an unrelated concurrent LATEST.
printf 'Prueba aprobada. Activando %s en la URL publica.\n' "$NEW_REVISION"
if ! gcloud run services update-traffic "$SERVICE" --project "$PROJECT_ID" --region "$REGION" \
  --to-revisions "${NEW_REVISION}=100"; then
  printf '%s\n' 'No se pudo confirmar el cambio. Restaurando el trafico anterior.' >&2
  gcloud run services update-traffic "$SERVICE" --project "$PROJECT_ID" --region "$REGION" \
    --to-revisions "$PREVIOUS_SPLIT"
  exit 1
fi
if ! python3 verify_release.py "$PUBLIC_URL" || ! python3 verify_release.py "$TARGET_URL"; then
  printf '%s\n' 'Fallo la verificacion publica. Restaurando el trafico anterior.' >&2
  gcloud run services update-traffic "$SERVICE" --project "$PROJECT_ID" --region "$REGION" \
    --to-revisions "$PREVIOUS_SPLIT"
  exit 1
fi
printf 'EarthLens actualizado y verificado: %s\n' "$PUBLIC_URL"
printf '%s\n' 'Los volumenes de cache/usuarios y el monitor de Docker local no se migraron con este despliegue.'
