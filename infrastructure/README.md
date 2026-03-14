# AWS Infrastructure Setup for sercret-security

This directory contains the infrastructure-as-code and deployment scripts for setting up sercret-security on AWS.

## Overview

The infrastructure consists of:
- **AWS EC2** instance for hosting the Node.js application
- **AWS RDS PostgreSQL** for the database
- **AWS CloudFormation** for infrastructure provisioning
- **Cloudflare** for DNS, CDN, and SSL termination

## Prerequisites

1. AWS Account with appropriate permissions
2. Domain name (sercret-security.com)
3. Cloudflare account
4. GitHub repository with application code

## Quick Start

### 1. Deploy Infrastructure with CloudFormation

```bash
# Deploy the CloudFormation stack
aws cloudformation create-stack \
  --stack-name sercret-security-stack \
  --template-body file://infrastructure/cloudformation.yaml \
  --parameters ParameterKey=KeyName,ParameterValue=your-key-pair \
  --capabilities CAPABILITY_IAM
```

### 2. Configure Database

After the CloudFormation stack is created, note the RDS endpoint from the outputs.

Update your environment variables with the database connection string.

### 3. Deploy Application

1. SSH into the EC2 instance
2. Clone your repository
3. Run the deployment script:

```bash
sudo ./infrastructure/deploy-ec2.sh
```

### 4. Configure Cloudflare

1. Point your domain's nameservers to Cloudflare
2. Add the DNS records as specified in `cloudflare/dns-config.md`
3. Enable SSL/TLS encryption
4. Configure firewall rules and WAF

## File Structure

```
infrastructure/
├── cloudformation.yaml          # AWS infrastructure template
├── deploy-ec2.sh               # EC2 deployment script
└── cloudflare/
    └── dns-config.md           # Cloudflare DNS configuration
```

## Environment Variables

Create a `.env` file in the backend directory with:

```env
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://username:password@rds-endpoint:5432/sercret_security
JWT_SECRET=your-super-secure-jwt-secret
STRIPE_SECRET_KEY=your-stripe-secret-key
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-email-app-password
CORS_ORIGIN=https://sercret-security.com
API_BASE_URL=https://api.sercret-security.com
LOG_LEVEL=info
```

## Security Considerations

1. **Database Security**: RDS is configured with security groups allowing access only from the EC2 instance
2. **Application Security**: All traffic goes through Cloudflare WAF and rate limiting
3. **SSL/TLS**: End-to-end encryption with Cloudflare's Universal SSL
4. **Access Control**: SSH access restricted to your IP, admin authentication required

## Monitoring

The deployment script sets up:
- PM2 process monitoring
- Basic health checks
- Log rotation
- Nginx access/error logs

## Scaling

For production scaling:
1. Consider using AWS Elastic Load Balancer
2. Implement Redis for session storage
3. Set up CloudWatch monitoring and alerts
4. Consider using AWS Lambda for certain functions

## Backup and Recovery

- RDS automated backups are enabled
- EC2 instance can be backed up using AMIs
- Application logs are rotated and archived

## Troubleshooting

### Common Issues

1. **Database Connection**: Check security groups and connection string
2. **SSL Issues**: Ensure Cloudflare SSL is properly configured
3. **Application Not Starting**: Check PM2 logs with `pm2 logs sercret-security`

### Useful Commands

```bash
# Check application status
pm2 status

# View application logs
pm2 logs sercret-security

# Restart application
pm2 restart sercret-security

# Check nginx status
sudo systemctl status nginx

# Test database connection
psql postgresql://username:password@rds-endpoint:5432/sercret_security
```

## Cost Optimization

- EC2 t3.micro is suitable for development/testing
- Consider reserved instances for production
- Monitor Cloudflare usage for CDN costs
- Set up billing alerts in AWS

## Next Steps

1. Set up CI/CD pipeline with GitHub Actions
2. Implement automated testing
3. Add application monitoring (DataDog, New Relic)
4. Configure backup strategies
5. Set up multi-region deployment for high availability