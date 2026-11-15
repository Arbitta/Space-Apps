FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

COPY requirements.txt ./
RUN python -m pip install --no-cache-dir -r requirements.txt

RUN groupadd --gid 10001 earthlens \
    && useradd --uid 10001 --gid 10001 --create-home earthlens

COPY app.py ./
COPY api/ ./api/
COPY services/ ./services/
COPY web/ ./web/
COPY templates/ ./templates/
COPY static/ ./static/
COPY scripts/ ./scripts/
COPY deployment/ ./deployment/
COPY tests/ ./tests/
COPY data/cities.json ./data/cities.json
COPY data/water_features.json ./data/water_features.json
COPY data/missions.json data/variables.json ./data/
COPY data/guided_missions.json data/mission_variables.json ./data/
RUN mkdir -p /app/data/cache/power /app/data/runtime \
    && chown -R earthlens:earthlens /app

USER earthlens

EXPOSE 5000

HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
    CMD ["python", "-c", "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:' + os.environ.get('PORT', '5000') + '/api/health', timeout=2).close()"]

CMD ["sh", "-c", "exec gunicorn --bind 0.0.0.0:${PORT:-5000} --workers 1 --threads 8 --timeout 60 app:app"]
