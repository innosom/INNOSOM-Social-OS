# INNOSOM Social OS — Database & Deployment Specification

This guide outlines database configuration, schema migrations, indexing strategy, and production deployment procedures for **INNOSOM Social OS**.

---

## 1. Database Architecture Overview

INNOSOM Social OS uses a dual-database configuration strategy managed through Prisma ORM:

- **Local Development**: SQLite (default) for zero-setup lightweight development, or local PostgreSQL.
- **Production**: PostgreSQL for high-performance concurrent access, database-level locking, transactional reliability, and scalar indexing at scale.

### Schema File Locations
- **Production Schema**: `prisma/schema.prisma` (`provider = "postgresql"`)
- **Local SQLite Schema**: `prisma/schema.sqlite.prisma` (`provider = "sqlite"`)
- **Versioned Migrations**: `prisma/migrations/`

---

## 2. Environment Variables & Database Connection Strings

### Local Development (`.env`)
```env
# Default SQLite local development
DATABASE_URL="file:./dev.db"

# Or local PostgreSQL development
# DATABASE_URL="postgresql://postgres:postgres@localhost:5432/innosom_dev?schema=public"

JWT_SECRET="your-jwt-secret-at-least-32-bytes"
ENCRYPTION_KEY="64-character-hex-string-for-aes-256-gcm"
REDIS_URL="redis://localhost:6379"
```

### Production Environment Variables
```env
# Production PostgreSQL Connection String with Connection Pooling (e.g. PgBouncer/Supabase/RDS)
DATABASE_URL="postgresql://<user>:<password>@<host>:<port>/<dbname>?sslmode=require&pgbouncer=true"

# Direct URL for running Prisma migrations in production (bypassing connection poolers)
DIRECT_URL="postgresql://<user>:<password>@<host>:<port>/<dbname>?sslmode=require"

JWT_SECRET="production-super-secret-jwt-key"
ENCRYPTION_KEY="64-character-hex-key"
REDIS_URL="rediss://:<password>@<host>:<port>"
NODE_ENV="production"
ENABLE_LIVE_SOCIAL_APIS="true"
```

---

## 3. Database Commands Reference

### Local Development Workflow (SQLite)
To apply schema changes directly to local SQLite without generating production migration files:
```bash
# Push schema to local dev.db
npm run db:push

# Seed test database
npm run db:seed
```

### Production Migration Workflow (PostgreSQL)
In production, schema updates **must always use versioned migrations** rather than `db push`.

#### Developing New Migrations (Local PostgreSQL)
```bash
# Generate and test a new PostgreSQL migration
npm run db:migrate:dev -- --name <migration_name>
```

#### Deploying Migrations to Production
During deployment (e.g., CI/CD pipeline or release step):
```bash
# Apply pending versioned migrations against production PostgreSQL
npm run db:migrate:deploy

# Seed initial data (if initializing a fresh production tenant)
npm run db:seed
```

---

## 4. Production Database Optimizations & Indexing Strategy

The production PostgreSQL schema contains composite indexes designed specifically for scheduler performance, multi-tenant isolation, and audit logging at scale:

| Table | Index Columns | Justification / Query Optimization |
|-------|---------------|-----------------------------------|
| `Publication` | `(status, scheduledAt)` | Polling scheduler queries (`where: { status: 'SCHEDULED', scheduledAt: { lte: now } }`) |
| `Publication` | `(status, createdAt)` | Dashboard failure and status queue queries |
| `Publication` | `(socialConnectionId)` | Account connection deletion cascades & channel history |
| `Content` | `(workspaceId, status)` | Client workspace content filters & approval queues |
| `SocialConnection` | `(workspaceId, status)` | Workspace social connection status listings & token health checks |
| `Membership` | `(organizationId)` | User authorization & agency tenant membership lookups |
| `Membership` | `(userId)` | User session membership lookups |
| `AuditLog` | `(organizationId, createdAt)` | High-throughput agency audit trail sorting |
| `AuditLog` | `(workspaceId, createdAt)` | Client workspace audit log filtering |
| `AuditLog` | `(userId)` | User activity logs |

---

## 5. Deployment Checklist & Verification Steps

1. **Provision PostgreSQL Database**: Verify database instance is accessible and SSL is enabled.
2. **Set Environment Variables**: Set `DATABASE_URL`, `DIRECT_URL`, `JWT_SECRET`, and `ENCRYPTION_KEY`.
3. **Run Migrations**:
   ```bash
   npm run db:migrate:deploy
   ```
4. **Seed Database (First-time setup)**:
   ```bash
   npm run db:seed
   ```
5. **Build & Start Application**:
   ```bash
   npm run build
   npm start
   ```
6. **Start Worker Service**:
   ```bash
   npm run worker
   ```
