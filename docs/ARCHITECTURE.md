# INNOSOM Social OS — Architecture & Engineering Specification

## 1. System Overview

**INNOSOM Social OS** is an internal agency social media operations platform built as a modular monolith. It provides INNOSOM team members with a unified command center to manage multiple client workspaces (e.g., Haji Abdi College, Garowe General Hospital, East Africa University, Nasiim Perfumes, Alpha Industries) and their connected social media channels without logging out or risking cross-client data leakages.

### Architecture Highlights
- **Framework**: Next.js (App Router, React, TypeScript, Tailwind CSS)
- **Database & ORM**: PostgreSQL (Production) / SQLite (Local Dev) with Prisma ORM and Versioned Migrations
- **Async Processing & Queue**: BullMQ + Redis for background publishing jobs, token health checks, and analytics synchronization
- **Security & Authorization**: Server-side derived session context, RBAC (ADMIN, MANAGER, EDITOR, VIEWER), encrypted social API credentials at rest, strictly enforced workspace scoping.

---

## 2. Database Architecture & Production PostgreSQL Strategy

### 2.1 Multi-Database Support
- **Production Engine**: PostgreSQL 16+ using versioned Prisma Migrations (`prisma/migrations/`).
- **Local Development Engine**: SQLite (`DATABASE_URL="file:./dev.db"`) via `prisma/schema.sqlite.prisma` (`npm run db:push`).

### 2.2 Schema & Indexing Optimizations

The Prisma schema incorporates optimized indexing for high-concurrency production operation:

1. **Publication Queue & Scheduler**:
   - `Publication(status, scheduledAt)`: Composite B-Tree index enabling $O(\log N)$ polling for due publications in background workers.
   - `Publication(socialConnectionId, status)`: Fast lookup of scheduled/failed posts per connection.
   - `Publication(contentVariantId)`: Instant relational mapping between content variants and publications.

2. **Content & Workspace Isolation**:
   - `Content(workspaceId, status)`: High-efficiency workspace filtering by approval/publishing status.
   - `Content(workspaceId, createdAt)`: Fast paginated content feed loading.
   - `Content(authorId)`: Relational join optimization for author user lookups.

3. **Audit Log Trail at Scale**:
   - `AuditLog(organizationId, createdAt)` & `AuditLog(workspaceId, createdAt)`: Fast time-range querying per tenant/workspace.
   - `AuditLog(userId, createdAt)`: Audit search by user.
   - `AuditLog(entityType, entityId)`: Entity history lookup.

4. **Foreign Key Performance**:
   - Explicit FK indexes across all junction tables (`Membership(organizationId)`, `Membership(userId)`, `ContentVariantMedia(mediaAssetId)`, `Approval(contentId)`, `Approval(userId)`).

### 2.3 Migration & Deployment Workflow
- **Production Migrations**: Run `npm run db:migrate:deploy` in deployment pipelines prior to app server launch.
- **Production Initialization**: Zero manual database editing required; fresh PostgreSQL instances are fully provisioned via `prisma migrate deploy` and `npm run db:seed`.
