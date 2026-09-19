# INNOSOM Social OS — Architecture & Engineering Specification

## 1. System Overview

**INNOSOM Social OS** is an internal agency social media operations platform built as a modular monolith. It provides INNOSOM team members with a unified command center to manage multiple client workspaces (e.g., Haji Abdi College, Garowe General Hospital, East Africa University, Nasiim Perfumes, Alpha Industries) and their connected social media channels without logging out or risking cross-client data leakages.

### Architecture Highlights
- **Framework**: Next.js (App Router, React, TypeScript, Tailwind CSS)
- **Database & ORM**: SQLite (Local Dev) / PostgreSQL (Production) with Prisma ORM
- **Async Processing & Queue**: BullMQ + Redis for background publishing jobs, token health checks, and analytics synchronization
- **Security & Authorization**: Server-side derived session context, RBAC (ADMIN, MANAGER, EDITOR, VIEWER), encrypted social API credentials at rest, strictly enforced workspace scoping.

---

## 2. Database Architecture & Indexing Strategy

### Dual-Database Model
- **Local Development**: SQLite (`prisma/schema.sqlite.prisma`, `dev.db`) for lightweight zero-dependency setup.
- **Production**: PostgreSQL (`prisma/schema.prisma`, `prisma/migrations/`) using strict versioned migrations (`prisma migrate deploy`).

### Performance & Scalability Indexing
The schema is optimized for high-volume publishing queues and client workspace isolation:
- **Queue & Scheduler Performance**:
  - `Publication`: `@@index([status, scheduledAt])` enables sub-millisecond lookups for due posts (`status = 'SCHEDULED' AND scheduledAt <= NOW()`).
- **Workspace Data Isolation**:
  - `Content`: `@@index([workspaceId, status])` and `@@index([workspaceId, createdAt])` optimize workspace feed filtering.
  - `MediaAsset`: `@@index([workspaceId, createdAt])` accelerates gallery sorting.
- **Audit Logging at Scale**:
  - `AuditLog`: `@@index([organizationId, createdAt])`, `@@index([workspaceId, createdAt])`, `@@index([userId])`, and `@@index([entityType, entityId])` support performant auditing across hundreds of thousands of entries.
- **Foreign Key Indexing**:
  - Explicit indexes added for relational columns across all models (`authorId`, `contentVariantId`, `socialConnectionId`, `mediaAssetId`, etc.) ensuring efficient join queries and foreign key constraints in PostgreSQL.

---

## 3. Deployment & Migration Workflow

### Production PostgreSQL Initialization
1. Set `DATABASE_URL` environment variable to point to PostgreSQL.
2. Run `npm run db:migrate:deploy` to apply SQL migrations in `prisma/migrations/`.
3. Run `npm run db:seed` to populate initial agency organization and workspace data.
