#!/bin/bash

# AWS EC2 Deployment Script for ysecurity-app
# This script sets up the application on an EC2 instance

set -e

echo "Starting ysecurity-app deployment..."

# Update system packages
echo "Updating system packages..."
sudo apt update && sudo apt upgrade -y

# Install Node.js 18.x
echo "Installing Node.js..."
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PostgreSQL client (RDS connection)
echo "Installing PostgreSQL client..."
sudo apt install -y postgresql-client

# Install PM2 for process management
echo "Installing PM2..."
sudo npm install -g pm2

# Install nginx
echo "Installing nginx..."
sudo apt install -y nginx

# Create application directory
echo "Creating application directory..."
sudo mkdir -p /var/www/ysecurity-app
sudo chown -R ubuntu:ubuntu /var/www/ysecurity-app

# Clone or copy application code (replace with your deployment method)
echo "Copying application code..."
# In production, you would clone from git or copy from build artifacts
# git clone https://github.com/your-repo/ysecurity-app.git /var/www/ysecurity-app
# Or copy from S3, etc.

# Install dependencies
echo "Installing dependencies..."
cd /var/www/ysecurity-app/backend
npm install --production

# Create environment file
echo "Setting up environment variables..."
cat > .env << EOF
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://username:password@your-rds-endpoint:5432/sercret_security
JWT_SECRET=your-super-secure-jwt-secret-here
STRIPE_SECRET_KEY=your-stripe-secret-key
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-email-app-password
CORS_ORIGIN=https://ysecurity-app.com
API_BASE_URL=https://api.ysecurity-app.com
LOG_LEVEL=info
EOF

# Run database migration
echo "Running database migration..."
node migrate-to-postgres.js

# Configure nginx
echo "Configuring nginx..."
sudo tee /etc/nginx/sites-available/ysecurity-app > /dev/null <<EOF
server {
    listen 80;
    server_name ysecurity-app.com www.ysecurity-app.com api.ysecurity-app.com admin.ysecurity-app.com;

    # Redirect HTTP to HTTPS
    return 301 https://\$server_name\$request_uri;
}

server {
    listen 443 ssl http2;
    server_name ysecurity-app.com www.ysecurity-app.com;

    # SSL configuration (will be handled by Cloudflare)
    # ssl_certificate /etc/ssl/certs/ssl-cert-snakeoil.pem;
    # ssl_certificate_key /etc/ssl/private/ssl-cert-snakeoil.key;

    # Serve static files
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }
}

server {
    listen 443 ssl http2;
    server_name api.ysecurity-app.com;

    # SSL configuration (will be handled by Cloudflare)

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;

        # API specific settings
        client_max_body_size 10M;
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
}

server {
    listen 443 ssl http2;
    server_name admin.ysecurity-app.com;

    # SSL configuration (will be handled by Cloudflare)

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }
}
EOF

# Enable nginx site
sudo ln -sf /etc/nginx/sites-available/ysecurity-app /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx

# Start application with PM2
echo "Starting application with PM2..."
cd /var/www/ysecurity-app/backend
pm2 start server.js --name "ysecurity-app"
pm2 startup
pm2 save

# Install SSL certificate (Let's Encrypt)
echo "Installing SSL certificate..."
sudo apt install -y certbot python3-certbot-nginx
# Note: SSL will be handled by Cloudflare, but you can still get certificates for direct access
# sudo certbot --nginx -d ysecurity-app.com -d www.ysecurity-app.com -d api.ysecurity-app.com -d admin.ysecurity-app.com

# Set up log rotation
echo "Setting up log rotation..."
sudo tee /etc/logrotate.d/ysecurity-app > /dev/null <<EOF
/var/www/ysecurity-app/backend/logs/*.log {
    daily
    missingok
    rotate 52
    compress
    delaycompress
    notifempty
    create 644 ubuntu ubuntu
    postrotate
        pm2 reloadLogs
    endscript
}
EOF

# Set up monitoring (basic)
echo "Setting up basic monitoring..."
sudo tee /var/www/ysecurity-app/monitor.sh > /dev/null <<EOF
#!/bin/bash
# Basic health check script
if curl -f http://localhost:3000/api/health > /dev/null 2>&1; then
    echo "Application is healthy"
else
    echo "Application is unhealthy"
    # Send alert (integrate with your monitoring system)
fi
EOF
sudo chmod +x /var/www/ysecurity-app/monitor.sh

# Add to crontab for monitoring
(crontab -l ; echo "*/5 * * * * /var/www/ysecurity-app/monitor.sh") | crontab -

# Set up firewall
echo "Configuring firewall..."
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw --force enable

# Final setup
echo "Deployment completed!"
echo "Don't forget to:"
echo "1. Update the .env file with your actual secrets"
echo "2. Configure Cloudflare DNS to point to this server"
echo "3. Set up SSL certificates in Cloudflare"
echo "4. Test the application"
echo ""
echo "Application is running at:"
echo "- Main site: https://ysecurity-app.com"
echo "- API: https://api.ysecurity-app.com"
echo "- Admin: https://admin.ysecurity-app.com"
echo ""
echo "PM2 commands:"
echo "- pm2 status"
echo "- pm2 logs ysecurity-app"
echo "- pm2 restart ysecurity-app"