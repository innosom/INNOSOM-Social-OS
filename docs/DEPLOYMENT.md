# INNOSOM Social OS — Production Deployment & Migration Guide

This document outlines the database architecture, environment configuration, migration strategy, and operational procedures for deploying **INNOSOM Social OS** to production with PostgreSQL while preserving the lightweight SQLite local development workflow.

---

## 1. Database Architecture Overview

| Environment | Database Engine | Schema Location | Database URL Example | Strategy |
|-------------|-----------------|-----------------|----------------------|----------|
| **Local Dev** | SQLite | `prisma/schema.sqlite.prisma` | `file:./dev.db` | Rapid iteration via `npm run db:push` |
| **Production** | PostgreSQL (v14+) | `prisma/schema.prisma` | `postgresql://user:pass@host:5432/db?schema=public` | Production migrations via `npm run db:migrate:deploy` |

### Key Architectural Standards
- **Zero Raw Query Coupling**: All database operations utilize Prisma ORM, ensuring high compatibility between local SQLite testing and production PostgreSQL.
- **Production Migrations**: Production environments MUST NOT use `db push`. All schema changes in production are strictly version-controlled via SQL migration scripts in `prisma/migrations/`.
- **Database Index Optimization**: PostgreSQL indexes are defined for multi-tenant workspace lookups, scheduler queue polling (`status`, `scheduledAt`), foreign key cascade checks, and audit logging at scale.

---

## 2. Environment Configuration

### Local Development (`.env`)
Copy `.env.example` to `.env`:
```env
DATABASE_URL="file:./dev.db"
REDIS_URL="redis://localhost:6379"
JWT_SECRET="innosom-super-secret-jwt-encryption-key-32-bytes!!"
ENCRYPTION_KEY="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
ENABLE_LIVE_SOCIAL_APIS="false"
```

### Production Deployment (`.env.production`)
Copy `.env.production.example` to `.env.production` or set server environment variables:
```env
DATABASE_URL="postgresql://innosom_user:secure_password@postgres-host:5432/innosom_production?schema=public"
REDIS_URL="redis://:redis_password@redis-host:6379"
JWT_SECRET="<min-32-character-random-secret>"
ENCRYPTION_KEY="<64-character-hex-random-key>"
ENABLE_LIVE_SOCIAL_APIS="true"
NODE_ENV="production"
```

---

## 3. Local Development Setup Workflow

For local development using SQLite:

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Push Schema to SQLite Database**:
   ```bash
   npm run db:push
   ```

3. **Seed Local Database**:
   ```bash
   npm run db:seed
   ```

4. **Start Dev Server**:
   ```bash
   npm run dev
   ```

---

## 4. Production PostgreSQL Deployment & Migration Strategy

### Step 1: Initialize Database & Apply Migrations
In production CI/CD pipelines or deployment scripts, apply all pending Prisma migrations against PostgreSQL:

```bash
npm run db:migrate:deploy
```

This command:
- Checks the `_prisma_migrations` table in PostgreSQL.
- Executes unapplied migration scripts from `prisma/migrations/` in chronological order.
- Guarantees zero schema drift without destroying existing production data.

### Step 2: Seed Initial Data (First Deployment Only)
To populate initial organization structures, default client workspaces, and admin credentials on a fresh database:

```bash
npm run db:seed
```

### Step 3: Schema Evolution / Creating New Migrations (Developer Flow)
When introducing schema changes:
1. Update `prisma/schema.prisma` (PostgreSQL) and keep `prisma/schema.sqlite.prisma` (SQLite) synchronized.
2. Run migration creation command against a development PostgreSQL instance:
   ```bash
   npm run db:migrate:dev -- --name describe_change
   ```
3. Commit the generated `prisma/migrations/<timestamp>_describe_change/migration.sql` file to repository version control.

---

## 5. Performance & Indexing Optimization Summary

The PostgreSQL schema (`prisma/schema.prisma`) includes targeted indexes for high-throughput social agency operations:

1. **Scheduler Performance**:
   - `Publication`: `@@index([status, scheduledAt])` enables sub-millisecond lookups for due publications during background worker polling (`where: { status: 'SCHEDULED', scheduledAt: { lte: now } }`).
2. **Multi-Tenant Data Isolation**:
   - `Workspace`: `@@index([organizationId])`
   - `Content`: `@@index([workspaceId, status])` and `@@index([workspaceId, createdAt])`
   - `SocialConnection`: `@@index([workspaceId])` and `@@index([status])`
3. **Audit Log Querying at Scale**:
   - `AuditLog`: `@@index([organizationId, createdAt])`, `@@index([workspaceId, createdAt])`, `@@index([userId, createdAt])`
4. **Foreign Key Performance**:
   - Foreign key indexes on all join tables (`Membership`, `ContentVariantMedia`, `Approval`, `Publication`).

---

## 6. High Concurrency & Race Condition Prevention

Background publication jobs utilize database-level atomic transitions:
- `processPublicationJob` uses `prisma.publication.updateMany` with explicit status constraints (`status: { in: ['SCHEDULED', 'FAILED', 'APPROVED'] }`) before initiating provider API calls.
- Row-level lock acquisition in PostgreSQL prevents duplicate post publishing when multiple worker processes operate concurrently.

---

## 7. Verification & Testing

Verify system readiness against PostgreSQL:

```bash
DATABASE_URL="postgresql://user:pass@localhost:5432/innosom_test?schema=public" npm test
```

Executes:
- Credential encryption security tests
- Scheduled publication worker execution
- Social provider adapter unit tests
- Full PostgreSQL integration test (schema migration, seed, auth, workspace switching, content creation, scheduling, publishing, approvals, analytics, media, audit logs)
