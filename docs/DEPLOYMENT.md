# INNOSOM Social OS — Production Deployment & Database Guide

This document outlines the database configuration, schema migration strategy, and deployment process for **INNOSOM Social OS**.

---

## 1. Database Architecture Overview

- **Local Development**: SQLite (`file:./dev.db`)
- **Production Environment**: PostgreSQL (`postgresql://user:password@host:5432/dbname?schema=public`)

The application uses **Prisma ORM** with a strict migration workflow for production environments to ensure database changes are trackable, reproducible, and non-destructive.

---

## 2. Environment Configurations

### Local Development (`.env`)
```env
DATABASE_URL="file:./dev.db"
REDIS_URL="redis://localhost:6379"
JWT_SECRET="your-32-byte-secret"
ENCRYPTION_KEY="64-character-hex-encryption-key"
```

### Production (`.env`)
```env
DATABASE_URL="postgresql://innosom_user:secure_password@postgres-host:5432/innosom_db?schema=public"
REDIS_URL="redis://redis-host:6379"
JWT_SECRET="your-production-32-byte-secret"
ENCRYPTION_KEY="64-character-hex-encryption-key"
```

---

## 3. Database Commands

### Local Development (SQLite)
To initialize or synchronize your local SQLite database:
```bash
npm run db:push
npm run db:seed
```

### Production (PostgreSQL)

1. **Deploy Migrations**:
   Run Prisma migration deploy to apply all pending schema migrations on PostgreSQL:
   ```bash
   npm run db:migrate:deploy
   ```

2. **Seed Initial Production Data / Agency Workspaces**:
   ```bash
   npm run db:seed
   ```

3. **Development Migration Creation (When modifying models)**:
   ```bash
   npm run db:migrate:dev -- --name descriptive_migration_name
   ```

---

## 4. Production Deployment Process

When deploying a fresh instance or updating an existing production environment:

1. **Provision Infrastructure**:
   - Provision a PostgreSQL database instance (v14+).
   - Provision a Redis instance for BullMQ background publishing.

2. **Set Environment Variables**:
   Configure `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `ENCRYPTION_KEY`, and `NEXT_PUBLIC_APP_URL`.

3. **Initialize Database Schema**:
   Run:
   ```bash
   npm run db:migrate:deploy
   npm run db:seed
   ```

4. **Build & Start Application Services**:
   - Web application:
     ```bash
     npm run build
     npm start
     ```
   - Worker process:
     ```bash
     npm run worker
     ```

---

## 5. Optimized Indexes & Performance Features

- **Publication Scheduler Polling**: Composite index `(status, scheduledAt)` on `Publication` for sub-millisecond polling queries.
- **Foreign Key Join Performance**: Explicit indexes on foreign key columns (`socialConnectionId`, `contentVariantId`, `authorId`, `userId`, `contentId`, `mediaAssetId`).
- **Workspace & Content Queries**: Compound indexes `(workspaceId, createdAt)` and `(workspaceId, status)` on `Content`.
- **Audit Logs at Scale**: Compound indexes `(organizationId, createdAt)` and `(workspaceId, createdAt)` on `AuditLog`.
