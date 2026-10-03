# INNOSOM Social OS — Database & Production Deployment Guide

This document outlines the dual-database architecture for **INNOSOM Social OS**: lightweight SQLite for local development and optimized PostgreSQL for production.

---

## 1. Architecture Overview

- **Local Development**: SQLite (`prisma/schema.sqlite.prisma`) allows instant zero-dependency local setup using `npm run db:push`.
- **Production**: PostgreSQL (`prisma/schema.prisma`) uses versioned, reproducible SQL migrations (`prisma/migrations/`) executed via `npm run db:migrate:deploy`.

---

## 2. Environment Variables Configuration

### Local Development Environment (`.env`)
```env
DATABASE_URL="file:./dev.db"
JWT_SECRET="innosom-super-secret-jwt-encryption-key-32-bytes!!"
ENCRYPTION_KEY="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
PORT=3000
NEXT_PUBLIC_APP_URL="http://localhost:3000"
REDIS_URL="redis://localhost:6379"
```

### Production Environment Variable (`.env.production`)
```env
DATABASE_URL="postgresql://<user>:<password>@<pg-host>:5432/<database>?sslmode=require"
JWT_SECRET="<production-secure-32-byte-secret>"
ENCRYPTION_KEY="<production-64-character-hex-encryption-key>"
PORT=3000
NEXT_PUBLIC_APP_URL="https://app.innosom.com"
REDIS_URL="redis://<redis-host>:6379"
```

---

## 3. Database Management & NPM Scripts

| Script | Command | Purpose |
| :--- | :--- | :--- |
| `npm run db:push` | `prisma db push --schema=prisma/schema.sqlite.prisma` | Push schema changes to local SQLite database (Development) |
| `npm run db:seed` | `tsx prisma/seed.ts` | Seed database with initial organization, workspaces, and demo users |
| `npm run db:generate` | `prisma generate --schema=prisma/schema.sqlite.prisma` | Generate Prisma client for local development |
| `npm run db:generate:pg` | `prisma generate --schema=prisma/schema.prisma` | Generate Prisma client for PostgreSQL production |
| `npm run db:migrate:dev` | `prisma migrate dev --schema=prisma/schema.prisma` | Create new PostgreSQL migration file during dev/staging |
| `npm run db:migrate:deploy` | `prisma migrate deploy --schema=prisma/schema.prisma` | Apply pending PostgreSQL migrations in Production |

---

## 4. Production Deployment Process

To deploy a fresh or updated instance to production with PostgreSQL:

1. **Configure Environment Variables**:
   Set `DATABASE_URL` pointing to your PostgreSQL instance (e.g. AWS RDS, DigitalOcean Managed Database, Neon, or Supabase).

2. **Generate Production Client & Run Migrations**:
   ```bash
   npm run db:generate:pg
   npm run db:migrate:deploy
   ```

3. **Seed Initial Data (First-time Deployment)**:
   ```bash
   npm run db:seed
   ```

4. **Build and Start Production Application**:
   ```bash
   npm run build
   npm run start
   ```

---

## 5. Database Performance & Indexing Strategy

The production PostgreSQL schema includes optimized compound indexes tailored for high concurrency and scale:

1. **Scheduler Polling Performance**:
   - `Publication(status, scheduledAt)`: Accelerates background worker lookups for due publications (`WHERE status = 'SCHEDULED' AND scheduledAt <= NOW()`).
   - `Publication(socialConnectionId, status)`: Fast query resolution for account publication queues.

2. **Workspace & Data Isolation**:
   - `SocialConnection(workspaceId, status)`: Instant workspace token health filtering.
   - `Content(workspaceId, status)`: Fast workspace post status queries.
   - `Workspace(organizationId, slug)`: Unique constraint & index for workspace lookup.

3. **Audit Logging & Scaling**:
   - `AuditLog(organizationId, createdAt)`: Efficient pagination and time-series querying across multi-tenant logs.
   - `AuditLog(workspaceId, createdAt)`: Fast workspace-level audit trail lookups.
