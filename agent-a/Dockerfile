# agent-a Dockerfile
# Python 3.12-slim base, installs requirements, runs main.py

FROM python:3.12-slim

# Set timezone at build time (overridable at runtime via TZ env var)
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Data directory created at runtime via Docker volume mount
RUN mkdir -p /data/strategies

CMD ["python", "main.py"]
