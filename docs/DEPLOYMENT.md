# INNOSOM Social OS — Production Deployment & Database Guide

This document outlines the deployment process, database architecture, migration strategy, and environment configuration for INNOSOM Social OS in production.

---

## Database Architecture Overview

INNOSOM Social OS uses a dual-database architecture strategy:

- **Local Development**: SQLite for zero-setup, lightweight development (`prisma/schema.sqlite.prisma`).
- **Production & Staging**: PostgreSQL 14+ for enterprise multi-tenancy, concurrent access, composite indexing, and reliable relational persistence (`prisma/schema.prisma`).

---

## Environment Variables Configuration

In production, ensure the following environment variables are set:

```env
# Database Connection (PostgreSQL)
DATABASE_URL="postgresql://<user>:<password>@<host>:5432/<database>?schema=public&sslmode=require"

# Queue / Cache Service
REDIS_URL="redis://:<password>@<host>:6379"

# Security & Encryption Keys
JWT_SECRET="<generate-64-char-random-jwt-secret>"
ENCRYPTION_KEY="<generate-64-char-hex-key-for-aes-256-gcm>"

# Application URLs
PORT=3000
NEXT_PUBLIC_APP_URL="https://app.innosom.com"

# Provider Controls
ENABLE_LIVE_SOCIAL_APIS="true"
NODE_ENV="production"
```

---

## Production Database Setup & Migration Strategy

### 1. Versioned Prisma Migrations

Production **MUST NOT** use `prisma db push`. All production database schema changes are managed via versioned Prisma migration files located in `prisma/migrations/`.

To apply pending migrations to a fresh or existing production PostgreSQL instance:

```bash
npm run db:migrate:deploy
```

Or directly via npx:

```bash
npx prisma migrate deploy
```

### 2. Database Seeding (First-time deployment)

To seed initial organization data, default admin users, and workspace structures on a new deployment:

```bash
npm run db:seed
```

---

## Connection Pooling & High Concurrency Guidelines

When deploying to hosted PostgreSQL providers (AWS RDS, Supabase, Neon, GCP Cloud SQL) or using PgBouncer:

1. **Transaction Pooling**: Ensure connection limit parameters match server capacity.
2. **PgBouncer Integration**: When using PgBouncer with transaction mode, append `?pgbouncer=true&connection_limit=10` to `DATABASE_URL`.
3. **Queue Workers**: The background worker process (`npm run worker`) opens database connections independently of the Next.js web application. Ensure total worker + web connections do not exceed PostgreSQL `max_connections`.

---

## Local Development Workflow (SQLite)

For local development using SQLite:

1. Update `.env` with SQLite URL:
   ```env
   DATABASE_URL="file:./dev.db"
   ```

2. Initialize and push local schema:
   ```bash
   npm run db:push
   npm run db:seed
   ```

3. Run development server and tests:
   ```bash
   npm run dev
   npm test
   ```

---

## Deployment Step-by-Step Checklist

1. **Provision Infrastructure**: Provision PostgreSQL database instance and Redis cluster.
2. **Set Environment Variables**: Configure `DATABASE_URL`, `ENCRYPTION_KEY`, `JWT_SECRET`, and provider credentials.
3. **Build Application**:
   ```bash
   npm run db:generate
   npm run build
   ```
4. **Deploy Database Migrations**:
   ```bash
   npm run db:migrate:deploy
   ```
5. **Seed Database (Initial Only)**:
   ```bash
   npm run db:seed
   ```
6. **Start Application & Background Worker**:
   - Web application: `npm start`
   - Background Publishing Worker: `npm run worker`
