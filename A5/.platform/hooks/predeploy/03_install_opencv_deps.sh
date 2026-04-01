#!/bin/bash
# Amazon Linux 2023 + Python EB: install graphics dynamic libraries for A5 (OpenCV support).
# Platform hooks run as root before app source is moved to /var/app/current.
set -euo pipefail

log() { echo "[predeploy opencv-deps] $*"; }

if command -v dnf >/dev/null 2>&1; then
  log "Installing system libraries (libglvnd-glx, libX11, libXext) via dnf..."
  dnf install -y libglvnd-glx libX11 libXext
  log "Dependency installation complete."
else
  log "dnf not found, skipping system library installation."
fi
