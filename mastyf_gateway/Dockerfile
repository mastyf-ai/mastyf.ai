# Stage 1: Build environment
FROM ubuntu:24.04 AS builder

ENV DEBIAN_FRONTEND=noninteractive \
    PATH="/opt/venv/bin:$PATH"

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/venv
WORKDIR /build

COPY pyproject.toml README.md ./
COPY mastyf_gateway/ ./mastyf_gateway/
RUN --mount=type=cache,target=/root/.cache/pip pip install .

# Remove build tools from virtualenv to eliminate packaging attack surface
RUN pip uninstall -y pip setuptools wheel jaraco.context || true && \
    rm -rf /opt/venv/lib/python3.*/site-packages/pip* \
           /opt/venv/lib/python3.*/site-packages/setuptools* \
           /opt/venv/lib/python3.*/site-packages/wheel* \
           /opt/venv/bin/pip* \
           /opt/venv/bin/wheel*

# Stage 2: Minimal hardened runtime
FROM ubuntu:24.04 AS runtime
ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PATH="/opt/venv/bin:$PATH" \
    MASTYF_POLICY_DIR=/app/policies \
    MASTYF_AUDIT_LOG=/app/logs/audit.jsonl

RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends \
    python3 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /opt/venv /opt/venv
WORKDIR /app
COPY mastyf_gateway/ ./mastyf_gateway/
COPY tests/fixtures/policies/ /app/policies/

# Enforce least-privilege non-root execution per Trivy DS-0002
RUN useradd -u 10001 -m -s /bin/bash mastyf && \
    mkdir -p /app/logs && \
    chown -R mastyf:mastyf /app

USER mastyf
EXPOSE 8000 9090

# Native python healthcheck: eliminates curl package and its CVEs
HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
    CMD python3 -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/healthz')" || exit 1

CMD ["uvicorn", "mastyf_gateway.adapters.rest:create_rest_app", "--factory", "--host", "0.0.0.0", "--port", "8000"]
