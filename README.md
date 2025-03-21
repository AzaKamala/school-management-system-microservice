# Multi-Tenant School Management System

A scalable microservices-based school management system with multi-tenancy, comprehensive authentication, and audit logging capabilities.

## Table of Contents

- [System Overview](#system-overview)
- [Key Features](#key-features)
- [Architecture](#architecture)
- [Technologies Used](#technologies-used)
- [Services Description](#services-description)
- [Setup Instructions](#setup-instructions)
- [API Endpoints](#api-endpoints)
- [Security Features](#security-features)

## System Overview

This project implements a robust school management system with multi-tenancy capabilities, allowing different schools (tenants) to have isolated data while sharing the same infrastructure. The system follows a microservices architecture and focuses on security, scalability, and auditability.

## Key Features

- **Multi-Tenancy**: Each school (tenant) has isolated data with database-level separation
- **Authentication & Security**:
  - JWT-based authentication with access and refresh tokens
  - OAuth2 support for social login
  - Rate limiting and brute force protection
  - Role-Based Access Control (RBAC)
- **User Management**:
  - Super Admins: Manage all tenants and view cross-tenant reports
  - Tenant Admins: Manage users within their school
  - Students: View their own profiles and data
- **Event-Driven Architecture**:
  - Message-based communication between services
  - Comprehensive audit logging
- **Resilience Patterns**:
  - Circuit breaker pattern
  - Message retry queues
  - Graceful service degradation

## Architecture

The system is built using a microservices architecture with three main services:

1. **Auth Service**: Handles authentication, authorization, and token management
2. **Tenant Service**: Manages tenants, users, roles, and permissions 
3. **Audit Service**: Records and queries audit logs across all tenants

These services communicate through a message broker (RabbitMQ) and are exposed through an API Gateway (Traefik).

## Technologies Used

- **Backend**: Node.js, TypeScript, Express
- **Database**: PostgreSQL with Prisma ORM
- **Authentication**: JWT, OAuth2
- **Message Broker**: RabbitMQ
- **API Gateway**: Traefik
- **Containerization**: Docker, Docker Compose
- **ORM**: Prisma

## Services Description

### Auth Service
- Responsible for authentication and authorization
- Issues and validates JWT tokens
- Supports both password-based and OAuth2 login
- Implements rate limiting and brute force protection
- Publishes login events to the message queue

### Tenant Service
- Manages tenant creation and configuration
- Provides separate database isolation per tenant
- Handles user management within tenants
- Manages roles and permissions
- Provides APIs for tenant-specific operations

### Audit Service
- Consumes login events from the message queue
- Records all authentication activity in a dedicated database
- Provides query APIs for tenant-specific and admin-level auditing
- Supports filtering and pagination of audit logs

## Setup Instructions

### Prerequisites
- Node.js (v18 or higher)
- Docker and Docker Compose
- PostgreSQL (if running locally)

### Environment Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/AzaKamala/school-management-system-microservice.git
   cd school-management-system
   ```

2. Copy environment examples and configure them for each service, including the project root:
   ```bash
   cp .env.example .env
   ```

3. Initialize the databases:
   ```bash
    # Auth Service
    docker-compose run --rm auth-service npm run init:db

    # Tenant Service
    docker-compose run --rm tenant-service npm run init:db

    # Audit Service
    docker-compose run --rm audit-service npm run init:db
   ```

4. Start the services using Docker Compose:
   ```bash
   docker-compose up --build
   ```

5. The system will be accessible at:
   - API: http://localhost
   - RabbitMQ Management: http://localhost:15672 (guest/guest)
   - Traefik Dashboard: http://localhost:8082

### Manual Development Setup

For each service, you can also run them locally:

```bash
# Auth Service
cd auth-service
npm install
npm run init:db
npm run generate
npm run dev

# Tenant Service
cd tenant-service
npm install
npm run init:db
npm run generate
npm run dev

# Audit Service
cd audit-service
npm install
npm run init:db
npm run generate
npm run dev
```

## API Endpoints

### Auth Service
- `POST /auth/login` - Login with email/password
- `POST /auth/refresh-token` - Refresh access token
- `POST /auth/logout` - Logout and invalidate tokens
- `GET /auth/oauth/google` - Initiate Google OAuth login
- `GET /auth/verify-token` - Verify token validity

### Tenant Service
- `GET /tenant` - List all tenants (admin only)
- `POST /tenant` - Create a new tenant (admin only)
- `GET /tenant/:id` - Get tenant details
- `PUT /tenant/:id` - Update tenant (admin only)
- `DELETE /tenant/:id` - Delete tenant (admin only)
- `GET /admin-user` - List all admin users (admin only)
- `POST /admin-user` - Create a new admin user (admin only)
- `GET /tenant/:tenantId/user` - List users in a tenant
- `POST /tenant/:tenantId/user` - Create a user in a tenant

### Audit Service
- `GET /:tenantId/audit` - Get audit logs for a tenant
- `GET /admin` - Get audit logs across all tenants (admin only)

A complete Postman collection is included in the repository for testing all endpoints.

## Security Features

- **JWT-based Authentication**: Secure token-based authentication with refresh token rotation
- **Rate Limiting**: Protection against brute force attacks and API abuse
- **Data Isolation**: Each tenant has its own database for complete data isolation
- **Role-Based Access Control**: Granular permissions system
- **OAuth Integration**: Support for third-party authentication providers
- **Audit Logging**: Comprehensive logging of all authentication and security-related events
- **Circuit Breaker Pattern**: Resilience against service failures

### Postman Collection
A Postman collection is included in the repository for testing the API endpoints. Import `School_Management_System_API.postman_collection.json` into Postman to get started.