#!/usr/bin/env sh
# Publish Docker Hub image + PyPI package (credentials via env — never commit tokens).
#
# Usage:
#   export DOCKER_HUB_USERNAME=rudraneel93
#   export DOCKER_HUB_TOKEN=...
#   export PYPI_TOKEN=pypi-...
#   export RELEASE_TAG=4.3.0   # optional, default 4.3.0
#   ./scripts/publish-docker-pypi-local.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TAG="${RELEASE_TAG:-4.3.0}"
IMAGE="rudraneel93/mastyfai"

if [ -z "${DOCKER_HUB_TOKEN:-}" ] || [ -z "${DOCKER_HUB_USERNAME:-}" ]; then
  echo "Set DOCKER_HUB_USERNAME and DOCKER_HUB_TOKEN" >&2
  exit 1
fi
if [ -z "${PYPI_TOKEN:-}" ]; then
  echo "Set PYPI_TOKEN (pypi-... API token)" >&2
  exit 1
fi

echo "[publish] Docker login…"
echo "$DOCKER_HUB_TOKEN" | docker login -u "$DOCKER_HUB_USERNAME" --password-stdin

echo "[publish] Building $IMAGE:$TAG and :latest…"
docker build -f deploy/Dockerfile \
  -t "$IMAGE:$TAG" \
  -t "$IMAGE:latest" \
  .

echo "[publish] Pushing Docker images…"
docker push "$IMAGE:$TAG"
docker push "$IMAGE:latest"

echo "[publish] Building Python SDK…"
PYPI_VENV="${TMPDIR:-/tmp}/mastyf-pypi-venv"
python3 -m venv "$PYPI_VENV"
"$PYPI_VENV/bin/pip" install -q build twine
rm -rf packages/python-sdk/dist
(cd packages/python-sdk && "$PYPI_VENV/bin/python" -m build)

echo "[publish] Uploading to PyPI…"
TWINE_USERNAME=__token__ TWINE_PASSWORD="$PYPI_TOKEN" \
  "$PYPI_VENV/bin/twine" upload packages/python-sdk/dist/* --non-interactive

echo "[publish] Done."
echo "  Docker: docker.io/$IMAGE:$TAG"
echo "  PyPI:   mastyf-ai (see packages/python-sdk/pyproject.toml version)"
