#!/bin/bash
# ============================================================
# Deployment script for backofficeagent.sltdigitallab.lk
# Run this on the server at 146.190.105.2
# ============================================================

set -e

echo "========================================="
echo "  BackOffice Support System Deployment"
echo "========================================="

# ── Step 1: Stop old containers (including old nginx/certbot if they exist)
echo ""
echo "[1/6] Stopping old containers..."
cd /opt/backoffice
docker compose down 2>/dev/null || true

# ── Step 2: Build and start the backend + frontend containers
echo ""
echo "[2/6] Building and starting Docker containers..."
docker compose up -d --build

echo ""
echo "Waiting 10 seconds for services to start..."
sleep 10

# ── Step 3: Verify containers are running
echo ""
echo "[3/6] Verifying containers..."
docker ps --format "table {{.Names}}\t{{.Ports}}\t{{.Status}}" | grep backoffice

# ── Step 4: Install Host Nginx config
echo ""
echo "[4/6] Installing Host Nginx config for backofficeagent..."
cp /opt/backoffice/nginx/backofficeagent /etc/nginx/sites-available/backofficeagent
ln -sf /etc/nginx/sites-available/backofficeagent /etc/nginx/sites-enabled/backofficeagent

# ── Step 5: Test Nginx config
echo ""
echo "[5/6] Testing Nginx configuration..."
nginx -t

# ── Step 6: Reload Host Nginx
echo ""
echo "[6/6] Reloading Host Nginx..."
systemctl reload nginx

echo ""
echo "========================================="
echo "  ✅ Deployment Complete!"
echo "========================================="
echo ""
echo "  Your app is now live at:"
echo "  🌐 https://backofficeagent.sltdigitallab.lk"
echo ""
echo "  Port Map:"
echo "  Frontend → 127.0.0.1:8084"
echo "  Backend  → 127.0.0.1:8085"
echo ""
echo "  ⚠️  If SSL cert doesn't exist yet, run:"
echo "  certbot --nginx -d backofficeagent.sltdigitallab.lk"
echo ""
