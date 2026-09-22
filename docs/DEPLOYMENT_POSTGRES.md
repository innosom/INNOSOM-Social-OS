# Production PostgreSQL & Deployment Guide

This guide details the database architecture, configuration, migration strategy, and deployment process for INNOSOM Social OS.

---

## Database Architecture Overview

INNOSOM Social OS supports a dual database strategy:
- **Local Development**: SQLite (via `prisma/schema.sqlite.prisma`) for lightweight, zero-dependency local setup.
- **Production**: PostgreSQL 15+ (via `prisma/schema.prisma`) with full transactional isolation, composite indexes for scheduler performance, and versioned Prisma migrations.

---

## Schema & Performance Optimizations

The production PostgreSQL schema (`prisma/schema.prisma`) includes targeted performance optimizations:

1. **Scheduler Polling Performance**:
   - `Publication([status, scheduledAt])`: High-frequency polling by `pollScheduledPublications()` queries `status = 'SCHEDULED' AND scheduledAt <= NOW()`. This composite index avoids full table scans on `Publication`.
   - `Publication([socialConnectionId])` & `Publication([contentVariantId])`: Speeds up relational joins and cascade operations.

2. **Workspace & Content Queries**:
   - `Content([workspaceId, status])`: Optimizes multi-tenant dashboard and content list queries filtered by workspace and content approval status (`DRAFT`, `IN_REVIEW`, `APPROVED`, `SCHEDULED`).
   - `SocialConnection([workspaceId, status])`: Ensures fast health status and token monitoring checks per workspace.

3. **Audit Log Querying at Scale**:
   - `AuditLog([organizationId, createdAt])`: Efficiently paginates agency-wide audit logs across all workspaces in reverse chronological order.
   - `AuditLog([workspaceId, createdAt])`: Optimizes workspace-scoped audit log streams.

4. **Foreign Key Cascade Behaviors**:
   - `Workspace`, `SocialConnection`, `ContentVariant`, `Publication`, `AnalyticsSnapshot` use `ON DELETE CASCADE` from their parents to ensure clean deletion.
   - `AuditLog.workspace` uses `ON DELETE SET NULL` to preserve security audit history even if a workspace is deleted.
   - `User` relations (`Content.author`, `AuditLog.user`, `Approval.user`) use `ON DELETE RESTRICT` to preserve compliance records.

---

## Environment Variables

### Local Development (SQLite)
```env
DATABASE_URL="file:./dev.db"
ENCRYPTION_KEY="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
JWT_SECRET="innosom-super-secret-jwt-encryption-key-32-bytes!!"
```

### Production (PostgreSQL)
```env
DATABASE_URL="postgresql://<user>:<password>@<host>:5432/<dbname>?schema=public&sslmode=require"
ENCRYPTION_KEY="<64-character-hex-string>"
JWT_SECRET="<secure-random-32-byte-string>"
REDIS_URL="redis://<redis-host>:6379"
ENABLE_LIVE_SOCIAL_APIS="true"
```

---

## Migration & Deployment Strategy

Production **must** use database migrations rather than `prisma db push`.

### 1. Initializing a New Production PostgreSQL Instance

1. Ensure `DATABASE_URL` is configured to point to your target PostgreSQL database.
2. Run database migrations:
   ```bash
   npm run db:migrate:deploy
   ```
3. Seed default admin, organization, and demo workspaces:
   ```bash
   npm run db:seed
   ```

### 2. Developing Schema Changes (For Engineers)

When introducing schema modifications in production schema (`prisma/schema.prisma`):

1. Apply and generate a new migration locally against PostgreSQL:
   ```bash
   npm run db:migrate:dev -- --name your_migration_name
   ```
2. Mirror structural changes to `prisma/schema.sqlite.prisma` for local SQLite developer parity.
3. Commit the generated migration directory in `prisma/migrations/`.

---

## Production Deployment Checklist

1. [ ] Provision PostgreSQL 15+ database instance with connection pooling (e.g. PgBouncer or AWS RDS Proxy).
2. [ ] Provision Redis 7+ instance for BullMQ background publication queue.
3. [ ] Set `DATABASE_URL`, `REDIS_URL`, `ENCRYPTION_KEY` (64 hex chars), and `JWT_SECRET`.
4. [ ] Run `npm run db:migrate:deploy`.
5. [ ] Run `npm run db:seed` (if initializing fresh environment).
6. [ ] Build application artifact: `npm run build`.
7. [ ] Start web server: `npm run start`.
8. [ ] Start background queue worker process: `npm run worker`.

---

## Verification & Testing Commands

Run full automated test suite (includes encryption, publishing, providers, and PostgreSQL integration tests):
```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/innosom_dev?schema=public" npm test
```
