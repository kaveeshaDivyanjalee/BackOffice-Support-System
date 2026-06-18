#!/bin/bash
# ============================================================
# Deployment script for backofficeagent.sltdigitallab.lk
# Run this on the server at 146.190.105.2
# ============================================================

set -e

echo "========================================="
echo "  BackOffice Support System Deployment"
echo "========================================="

# ── Step 1: Create a temporary Nginx config WITHOUT SSL (for initial cert request)
echo ""
echo "[1/5] Creating temporary Nginx config for SSL certificate request..."

# Back up the production SSL config
cp nginx/default.conf nginx/default.conf.ssl

# Create a temporary HTTP-only config for the cert request
cat > nginx/default.conf << 'NGINX_TEMP'
server {
    listen 80;
    server_name backofficeagent.sltdigitallab.lk;

    # Let's Encrypt ACME challenge
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    # Backend API routes (HTTP only for initial setup)
    location /support-query {
        proxy_pass http://backend:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 120s;
    }

    location /email-chat {
        proxy_pass http://backend:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 120s;
    }

    location / {
        proxy_pass http://frontend:80;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
NGINX_TEMP

# ── Step 2: Build and start containers
echo ""
echo "[2/5] Building and starting Docker containers..."
docker compose down 2>/dev/null || true
docker compose up -d --build

echo ""
echo "Waiting 10 seconds for services to start..."
sleep 10

# ── Step 3: Request SSL certificate from Let's Encrypt
echo ""
echo "[3/5] Requesting SSL certificate from Let's Encrypt..."
docker compose run --rm certbot certonly \
    --webroot \
    --webroot-path=/var/www/certbot \
    --email your-email@sltdigitallab.lk \
    --agree-tos \
    --no-eff-email \
    -d backofficeagent.sltdigitallab.lk

# ── Step 4: Restore the production SSL Nginx config
echo ""
echo "[4/5] Switching to production SSL config..."
cp nginx/default.conf.ssl nginx/default.conf

# ── Step 5: Reload Nginx to apply SSL
echo ""
echo "[5/5] Reloading Nginx with SSL..."
docker compose exec nginx nginx -s reload

echo ""
echo "========================================="
echo "  ✅ Deployment Complete!"
echo "========================================="
echo ""
echo "  Your app is now live at:"
echo "  🌐 https://backofficeagent.sltdigitallab.lk"
echo ""
echo "  ⚠️  Make sure the DNS A record is set:"
echo "     backofficeagent → 146.190.105.2"
echo ""
