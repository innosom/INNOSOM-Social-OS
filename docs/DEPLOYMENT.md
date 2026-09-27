# PostgreSQL Deployment & Migration Guide — INNOSOM Social OS

This document outlines the architecture, database configurations, index optimizations, migration strategy, and deployment workflows for operating **INNOSOM Social OS** reliably in production with PostgreSQL while preserving local SQLite development workflows.

---

## 1. Environment & Database Configurations

INNOSOM Social OS supports dual database configurations:

- **Production / Staging**: Managed **PostgreSQL** instance configured in `prisma/schema.prisma`.
- **Local Development**: SQLite (file-based) configured in `prisma/schema.sqlite.prisma` (or local PostgreSQL via Docker).

### Environment Variables (`.env` / `.env.production`)

```env
# Production PostgreSQL Connection String
DATABASE_URL="postgresql://<user>:<password>@<host>:<port>/<database>?schema=public&sslmode=require"

# Queue & Cache Infrastructure
REDIS_URL="redis://localhost:6379"

# Security & Encryption Credentials
JWT_SECRET="<32-byte-secret-key>"
ENCRYPTION_KEY="<64-character-hex-aes-256-gcm-key>"

# App Settings
PORT=3000
NEXT_PUBLIC_APP_URL="https://social.innosom.com"

# Set to "true" in production to activate live Social API adapters
ENABLE_LIVE_SOCIAL_APIS="true"
```

---

## 2. Schema Architecture & Indexing Strategy

The PostgreSQL Prisma schema (`prisma/schema.prisma`) includes indexes designed for high-concurrency scheduler operations, workspace scoping, multi-tenant isolation, and high-volume audit logging.

### Key Index Optimizations

1. **Scheduler Performance (`Publication`)**:
   - `@@index([status, scheduledAt])`: Enables fast index scans for `QueueService` querying due publications (`WHERE status = 'SCHEDULED' AND scheduledAt <= NOW()`).
   - `@@index([contentVariantId])` & `@@index([socialConnectionId])`: Foreign key indexes preventing lock contention during concurrent status transitions and cascade updates.

2. **Workspace Data Scoping & Content Management (`Content`, `SocialConnection`, `MediaAsset`)**:
   - `@@index([workspaceId, status])` & `@@index([workspaceId, createdAt])`: Accelerates filtered list views for content status tabs and chronological feeds.
   - `@@index([workspaceId, folderPath])` & `@@index([workspaceId, createdAt])`: Optimizes media asset library queries.
   - `@@index([status, expiresAt])`: Fast filtering for background token health monitoring routines.

3. **Multi-Tenant Audit Logging at Scale (`AuditLog`)**:
   - `@@index([organizationId, createdAt])` & `@@index([workspaceId, createdAt])`: Fast time-series querying for agency dashboard audit logs.
   - `@@index([userId, createdAt])` & `@@index([entityType, createdAt])`: High-efficiency filtering by actor and action type.

---

## 3. Database Migration Strategy & Deployment Workflow

Production **MUST** use versioned database migrations rather than `prisma db push`.

### Initializing a Fresh PostgreSQL Production Database

1. **Set Production Connection String**:
   ```bash
   export DATABASE_URL="postgresql://user:password@pg-host:5432/innosom_db?schema=public&sslmode=require"
   ```

2. **Deploy Database Migrations**:
   Run `npm run db:migrate:deploy` (executes `prisma migrate deploy --schema=prisma/schema.prisma`).
   This applies all pending versioned migrations from `prisma/migrations/` sequentially and idempotently.
   ```bash
   npm run db:migrate:deploy
   ```

3. **Seed Initial Workspace & Admin Credentials (Optional / First-time Setup)**:
   ```bash
   npm run db:seed
   ```

4. **Verify Database Setup**:
   Run verification suite:
   ```bash
   npm test
   ```

### Developing New Schema Changes (PostgreSQL)

When making schema changes in development against PostgreSQL:
1. Edit `prisma/schema.prisma` (and duplicate changes into `prisma/schema.sqlite.prisma` for SQLite compatibility).
2. Generate a new migration:
   ```bash
   npm run db:migrate:dev -- --name <migration_name>
   ```
3. Commit the newly generated `prisma/migrations/<timestamp>_<migration_name>/` folder to version control.

---

## 4. Local Development Workflows

### Option A: SQLite Local Development (Default)

For quick, zero-setup local frontend & API development:
```bash
# Push schema to local dev.db SQLite file
npm run db:push

# Seed development workspaces and mock social accounts
npm run db:seed

# Start Next.js development server
npm run dev
```

### Option B: Local PostgreSQL Development (Docker)

To mirror production locally using Docker:
```bash
# 1. Start PostgreSQL container
docker run -d --name innosom-pg -e POSTGRES_USER=innosom -e POSTGRES_PASSWORD=innosom -e POSTGRES_DB=innosom_db -p 5432:5432 postgres:16-alpine

# 2. Set local DATABASE_URL in .env
DATABASE_URL="postgresql://innosom:innosom@localhost:5432/innosom_db?schema=public"

# 3. Apply migrations and seed
npm run db:migrate:deploy
npm run db:seed
```

---

## 5. Production Health Monitoring & Best Practices

- **Connection Pooling**: Use PgBouncer or Supabase / AWS RDS proxy for connection pooling under high HTTP concurrency.
- **Background Worker Process**: Ensure `npm run worker` is running as a dedicated background worker service alongside the Next.js web application.
- **Encrypted Token Storage**: OAuth tokens are automatically encrypted using AES-256-GCM before database insertion. Ensure `ENCRYPTION_KEY` is backed up securely in your password manager or secrets vault.
