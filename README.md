# EarthLens — Patagonia Prime

NASA Space Apps Challenge 2026 · Earth System Trend Detective.
Explorador de datos ambientales históricos de Argentina, con API NASA POWER,
caché local y motor estadístico del equipo.

Desde la raíz del repositorio, con Docker Desktop iniciado:

```powershell
docker compose up -d --build --wait --wait-timeout 60
```

Abrir **http://127.0.0.1:5000/**.

- [Ejecución y pruebas en Docker](docs/docker.md)
- [Contrato de la API](docs/api.md)
- [Diagnóstico e integración entre ramas](docs/integration.md)
- [Estado y dependencias del backend](BACKEND_TASKS.md)

La caché existente de `data/cache` se conserva mediante un bind mount. No hace
falta Node ni un segundo Compose. Los recursos visuales externos requieren Internet.
