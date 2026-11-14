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
COPY scripts/ ./scripts/
COPY tests/ ./tests/
COPY data/cities.json ./data/cities.json
RUN mkdir -p /app/data/cache/power \
    && chown -R earthlens:earthlens /app

USER earthlens

EXPOSE 5000

HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:5000/api/health', timeout=2).close()"]

CMD ["python", "-m", "flask", "--app", "app:create_app", "run", "--host", "0.0.0.0", "--port", "5000", "--no-debugger"]
