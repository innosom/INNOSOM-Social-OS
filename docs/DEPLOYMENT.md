# Database & Deployment Guide — INNOSOM Social OS

This document outlines the database architecture, configuration, migration strategies, and deployment procedures for **INNOSOM Social OS**.

---

## 1. Database Architecture Overview

INNOSOM Social OS utilizes Prisma ORM with a dual-database environment strategy:

- **Local Development**: SQLite (`file:./dev.db`) for lightweight, zero-dependency local development and testing.
- **Production / Staging**: PostgreSQL for multi-tenant data isolation, high-concurrency background worker safety, and relational integrity.

---

## 2. Local Development Configuration (SQLite)

### Environment Variable (`.env`)
```env
DATABASE_URL="file:./dev.db"
JWT_SECRET="innosom-super-secret-jwt-encryption-key-32-bytes!!"
ENCRYPTION_KEY="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
```

### Commands for Local Development
1. **Push Schema Changes to Local SQLite Database**:
   ```bash
   npm run db:push
   ```
2. **Seed Local Database with Test Workspaces & Accounts**:
   ```bash
   npm run db:seed
   ```
3. **Run Test Suite**:
   ```bash
   npm test
   ```

---

## 3. Production Configuration (PostgreSQL)

### Environment Variable (`.env` or Environment Secret Manager)
```env
DATABASE_URL="postgresql://username:password@postgres-host:5432/innosom_db?sslmode=require"
JWT_SECRET="<your-production-32-byte-secret-key>"
ENCRYPTION_KEY="<your-production-64-char-hex-key>"
NODE_ENV="production"
```

### Production Migration Procedure
Production deployments **must strictly use Prisma Migrations** (`npm run db:migrate:deploy`) rather than `db push` to guarantee deterministic, zero-downtime schema evolution.

1. **Deploy Migrations to Staging / Production PostgreSQL**:
   ```bash
   npm run db:migrate:deploy
   ```
2. **Seed Production Base Data (Optional / Initial Deployment Only)**:
   ```bash
   npm run db:seed
   ```
3. **Generate Prisma Client for Production Schema**:
   ```bash
   npm run db:generate
   ```
4. **Build Production Application**:
   ```bash
   npm run build
   ```

---

## 4. Migration Strategy for Developers

When making database schema modifications:

1. Update `prisma/schema.prisma` (PostgreSQL target schema).
2. Sync changes to `prisma/schema.sqlite.prisma` to maintain local dev compatibility.
3. Run `npm run db:migrate:dev` to generate a new versioned migration in `prisma/migrations/`.
4. Test schema migration and test suite:
   ```bash
   npm test
   ```

---

## 5. Schema Performance & Indexing Optimizations

The production PostgreSQL schema contains targeted indexes for multi-tenant querying and async worker performance:

| Table | Index Columns | Query / Operational Justification |
|-------|---------------|-----------------------------------|
| `Publication` | `(status, scheduledAt)` | Polling scheduled posts in worker scheduler (`QueueService.ts`) |
| `Publication` | `(contentVariantId)` | Joining content variants in publication processing |
| `Publication` | `(socialConnectionId)` | Filtering posts by connected platform account |
| `Content` | `(workspaceId, status)` | Client workspace post listing filtered by workflow state |
| `Content` | `(workspaceId, createdAt)` | Time-series post retrieval for workspace calendars |
| `Content` | `(authorId)` | Filtering posts by authoring user |
| `SocialConnection` | `(workspaceId, status)` | Health check dashboard & connection status monitoring |
| `SocialConnection` | `(status)` | Global health status tracking for expired tokens |
| `MediaAsset` | `(workspaceId, folderPath)` | Media folder navigation within workspace media library |
| `AuditLog` | `(organizationId, createdAt)` | Multi-tenant organization operational audit query |
| `AuditLog` | `(workspaceId, createdAt)` | Workspace-scoped operational audit filtering |
| `AuditLog` | `(userId)` | Tracking sensitive actions by individual agency users |
| `AuditLog` | `(action)` | Audit log filtering by operational action type |

---

## 6. High-Concurrency & Foreign Key Behavior

- **Worker Idempotency Locks**: Background publishing worker (`src/modules/publishing/PublishingWorker.ts`) performs atomic `updateMany` checking `status IN ('SCHEDULED', 'FAILED')` before transitioning status to `PUBLISHING`. This prevents race conditions under multi-worker execution.
- **Cascade Deletes**: Foreign keys (`Workspace`, `Content`, `ContentVariant`, `Publication`, `Membership`, `Approval`) use explicit `ON DELETE CASCADE` rules so cascading workspace or post deletion cleans up attached children cleanly.
- **SetNull Behavior**: `AuditLog.workspaceId` uses `ON DELETE SET NULL` to preserve immutable operational audit logs even if a workspace is deleted.
