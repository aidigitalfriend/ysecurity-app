# Cloudflare Configuration for ysecurity-app.com
# This file contains the DNS records and configuration for Cloudflare setup

# DNS Records for ysecurity-app.com
# Replace YOUR_SERVER_IP with your actual EC2 instance public IP

# A Record for root domain
# Type: A
# Name: @
# Content: YOUR_SERVER_IP
# TTL: Auto
# Proxy status: Proxied

# CNAME Record for www
# Type: CNAME
# Name: www
# Content: @
# TTL: Auto
# Proxy status: Proxied

# A Record for API subdomain
# Type: A
# Name: api
# Content: YOUR_SERVER_IP
# TTL: Auto
# Proxy status: Proxied

# A Record for admin subdomain
# Type: A
# Name: admin
# Content: YOUR_SERVER_IP
# TTL: Auto
# Proxy status: Proxied

# SSL/TLS Configuration
# - SSL/TLS encryption mode: Full (strict)
# - Always Use HTTPS: On
# - Automatic HTTPS Rewrites: On
# - Minimum TLS Version: 1.2

# Page Rules (Legacy - consider using Rules instead)
# 1. URL: https://ysecurity-app.com/*
#    Setting: Always Use HTTPS
#    Setting: Security Level: Medium
#    Setting: Cache Level: Standard

# 2. URL: https://api.ysecurity-app.com/*
#    Setting: Always Use HTTPS
#    Setting: Security Level: High
#    Setting: Cache Level: Bypass

# 3. URL: https://admin.ysecurity-app.com/*
#    Setting: Always Use HTTPS
#    Setting: Security Level: High
#    Setting: Cache Level: Bypass

# Firewall Rules
# Allow legitimate traffic, block suspicious requests

# Rate Limiting
# Apply rate limiting to API endpoints to prevent abuse

# Cloudflare Rules (Modern replacement for Page Rules)
# Rule 1: Redirect HTTP to HTTPS
# Expression: (http.request.uri.path ~ ".*")
# Action: Redirect
# URL: https://ysecurity-app.com${uri}

# Rule 2: API Security
# Expression: (http.request.uri.path contains "/api/")
# Action: Set Security Level
# Security Level: High

# Rule 3: Admin Security
# Expression: (http.request.uri.path contains "/admin/")
# Action: Set Security Level
# Security Level: High

# WAF (Web Application Firewall)
# Enable OWASP Core Rule Set
# Enable Cloudflare Managed Rules

# SSL Certificate
# Use Cloudflare's free SSL certificate (Universal SSL)
# Enable HSTS (HTTP Strict Transport Security)

# DNSSEC
# Enable DNSSEC for additional security

# Argo Smart Routing
# Consider enabling for improved performance

# Cloudflare Workers (if needed for advanced routing)
# Can be used for API routing, authentication, etc.

# Monitoring and Analytics
# Enable Cloudflare Analytics
# Set up alerts for security events