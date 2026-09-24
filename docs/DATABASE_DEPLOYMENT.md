# INNOSOM Social OS — Database Architecture, Local Setup & Production Deployment Guide

This document specifies the database architecture, configuration guidelines, migration strategy, and deployment operations for **INNOSOM Social OS**.

---

## 1. Database Architecture & Dual Environment Support

INNOSOM Social OS is engineered with a dual database strategy:
- **Local Development**: SQLite for zero-friction local setup without needing PostgreSQL service dependencies (`prisma/schema.sqlite.prisma`).
- **Production Environment**: PostgreSQL for high-performance concurrent processing, relational integrity, row locking, and index optimizations (`prisma/schema.prisma`).

---

## 2. Local Development Configuration

### Option A: SQLite (Default Local Workflow)

1. Ensure `.env` specifies the SQLite connection string:
   ```env
   DATABASE_URL="file:./dev.db"
   JWT_SECRET="innosom-super-secret-jwt-encryption-key-32-bytes!!"
   ENCRYPTION_KEY="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
   ```

2. Initialize schema & seed local database:
   ```bash
   npm run db:push
   npm run db:seed
   ```

### Option B: Local PostgreSQL

If you prefer testing directly against a local PostgreSQL instance:
1. Update `DATABASE_URL` in `.env`:
   ```env
   DATABASE_URL="postgresql://postgres:password@localhost:5432/innosom?schema=public"
   ```

2. Apply migrations & seed:
   ```bash
   npm run db:migrate:dev
   npm run db:seed
   ```

---

## 3. Production PostgreSQL Configuration

### Required Environment Variables

```env
DATABASE_URL="postgresql://<USER>:<PASSWORD>@<PG_HOST>:<PG_PORT>/<PG_DATABASE>?schema=public&sslmode=require&connection_limit=20"
REDIS_URL="redis://:<REDIS_PASSWORD>@<REDIS_HOST>:<REDIS_PORT>"
JWT_SECRET="<64-character-random-hex-string>"
ENCRYPTION_KEY="<64-character-random-hex-string>"
NODE_ENV="production"
ENABLE_LIVE_SOCIAL_APIS="true"
```

### Connection Pooling & SSL Guidelines
- **Connection Limit**: Set `connection_limit` parameter in `DATABASE_URL` based on instance sizing (typically 10-20 per server instance).
- **PgBouncer / Transaction Pooling**: When using managed PostgreSQL services (e.g., AWS RDS, Supabase, Neon), append `?pgbouncer=true` if using transaction pooling mode.
- **SSL**: Set `sslmode=require` or `sslmode=verify-full` in production environments.

---

## 4. Migration Strategy & Production Deployment

### Important Rule
> ⚠️ **Never run `prisma db push` in production.** Production deployments **must** use Prisma Migrations (`prisma migrate deploy`) to ensure schema version control and safe, reproducible database changes.

### Automated CI/CD Deployment Pipeline

In your build/release pipeline (e.g., GitHub Actions, Docker release entrypoint, Vercel Build Step):

```bash
# 1. Install dependencies
npm ci

# 2. Run automated PostgreSQL migrations
npm run db:migrate:deploy

# 3. Seed production defaults (idempotent / initial setup only)
npm run db:seed

# 4. Build application
npm run build

# 5. Execute automated test suite
npm test
```

### Developing New Schema Modifications

When adding or modifying database models in development:

1. Update `prisma/schema.prisma` (PostgreSQL) and `prisma/schema.sqlite.prisma` (SQLite).
2. Generate a new versioned migration:
   ```bash
   npm run db:migrate:dev --name descriptive_change_name
   ```
3. Commit the new migration directory under `prisma/migrations/`.

---

## 5. Indexing & Scheduler Performance Optimizations

To guarantee high scheduler throughput, low query latency, and audit log scalability, the schema includes the following indexes:

| Table | Index | Justification & Query Optimization |
|---|---|---|
| `Publication` | `@@index([status, scheduledAt])` | Optimizes worker polling queries (`WHERE status = 'SCHEDULED' AND scheduledAt <= NOW()`). |
| `Publication` | `@@index([socialConnectionId])` | Fast relational joins and status reconciliation per social account. |
| `Publication` | `@@index([contentVariantId])` | Fast cascading lookups from content variants. |
| `Content` | `@@index([workspaceId, status])` | Speeds up workspace dashboard content filtering (e.g. pending approvals, draft queues). |
| `Content` | `@@index([workspaceId, createdAt])` | Fast chronological pagination for client workspace feeds. |
| `AuditLog` | `@@index([organizationId, createdAt])` | Fast organization-level operational audit trail queries. |
| `AuditLog` | `@@index([workspaceId, createdAt])` | Client workspace audit log filtering at scale. |
| `AuditLog` | `@@index([userId])` | Audit log queries filtered by team member. |
| `AuditLog` | `@@index([entityType, entityId])` | Entity lifecycle history lookups (e.g. tracking post edits). |
| `Membership` | `@@index([organizationId])` | Fast authorization checks for organization membership. |
| `SocialConnection` | `@@index([workspaceId, status])` | Rapid token health monitoring and account status checks. |
| `MediaAsset` | `@@index([workspaceId, createdAt])` | Ordered media asset library views per workspace. |
| `ContentVariantMedia` | `@@index([mediaAssetId])` | Foreign key lookup optimization when checking media usage across posts. |

---

## 6. Verification & Health Check

You can verify full database setup and operations against PostgreSQL at any time by running:

```bash
npm test
```

The test runner initializes a fresh PostgreSQL database, applies migrations (`prisma migrate deploy`), seeds data, and executes tests across authentication, workspace switching, content creation, scheduling, publishing execution, approvals, analytics, media, and audit logging.
