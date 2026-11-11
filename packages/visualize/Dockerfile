# Stage 1: Build React frontend
FROM node:20-slim AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ .
RUN npm run build

# Stage 2: Python backend + built frontend
FROM python:3.11-slim
WORKDIR /app

# Install system deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential && \
    rm -rf /var/lib/apt/lists/*

# Install Python deps
# BACKEND_MODE=modal: lightweight install (no torch/transformers)
# BACKEND_MODE=local: full install with ML deps
ARG BACKEND_MODE=local
ENV BACKEND_MODE=${BACKEND_MODE}

COPY requirements.txt requirements-modal.txt pyproject.toml ./
RUN if [ "$BACKEND_MODE" = "modal" ]; then \
        pip install --no-cache-dir -r requirements-modal.txt; \
    else \
        pip install --no-cache-dir .; \
    fi

# Copy source
COPY src/ src/
COPY static/ static/

# Copy built frontend
COPY --from=frontend-build /app/frontend/dist/ frontend/dist/

# Create data directory
RUN mkdir -p data

EXPOSE 8765

ENV DEVICE=cpu
ENV MODEL_NAME=Qwen/Qwen3-0.6B
ENV LOCAL_FILES_ONLY=false

CMD ["python", "-m", "src.server"]
