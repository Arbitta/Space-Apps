FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8000 \
    HOST=0.0.0.0

WORKDIR /app

# Instalar dependencias científicas y web (Flask, SciPy, NumPy, Pandas, Pytest, Gunicorn)
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

# Copiar el proyecto tanto en /app como en /app_baked (respaldo inmutable ante cambios de branch) y normalizar CRLF
COPY . /app
RUN sed -i 's/\r$//' /app/docker-entrypoint.sh && cp -r /app /app_baked && chmod +x /app/docker-entrypoint.sh /app_baked/docker-entrypoint.sh

# Ejecutar la suite de pruebas (Rol 06) al construir la imagen si tests/ está presente
# (en Cloud Run, .gcloudignore excluye tests/ para mantener la imagen liviana)
RUN if [ -d /app/tests ]; then python3 -m unittest discover -s /app/tests -v; fi

EXPOSE 8000

ENTRYPOINT ["/app_baked/docker-entrypoint.sh"]
CMD ["sh", "-c", "gunicorn --bind 0.0.0.0:${PORT:-8000} --workers 1 --threads 8 --timeout 60 app:app"]
