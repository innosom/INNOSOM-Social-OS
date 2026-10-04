# INNOSOM Social OS — Architecture & Engineering Specification

## 1. System Overview

**INNOSOM Social OS** is an internal agency social media operations platform built as a modular monolith. It provides INNOSOM team members with a unified command center to manage multiple client workspaces (e.g., Haji Abdi College, Garowe General Hospital, East Africa University, Nasiim Perfumes, Alpha Industries) and their connected social media channels without logging out or risking cross-client data leakages.

### Architecture Highlights
- **Framework**: Next.js (App Router, React, TypeScript, Tailwind CSS)
- **Database & ORM**: Dual Database Strategy: SQLite for Local Development (`prisma/schema.sqlite.prisma`) / PostgreSQL for Production Operations (`prisma/schema.prisma`) with Prisma ORM
- **Async Processing & Queue**: BullMQ + Redis for background publishing jobs, token health checks, and analytics synchronization
- **Security & Authorization**: Server-side derived session context, RBAC (ADMIN, MANAGER, EDITOR, VIEWER), encrypted social API credentials at rest, strictly enforced workspace scoping.

---

## 2. Database Architecture & Production Migration Strategy

### 2.1 Schema & Compatibility
- Primary production schema (`prisma/schema.prisma`) targets `postgresql`.
- Local development schema (`prisma/schema.sqlite.prisma`) targets `sqlite`.
- All model field types, default values, UUID generation, foreign keys (`onDelete: Cascade` / `SetNull`), and unique constraints are fully synchronized between both environments.

### 2.2 Performance Indexing Strategy
Production database performance is supported by composite indexes:
- `Publication`: `@@index([status, scheduledAt])` for background worker scheduling queries; `@@index([socialConnectionId])` for channel publication lookups.
- `Content`: `@@index([workspaceId, status])` for instant client workspace filtering and approval queue loading.
- `SocialConnection`: `@@index([workspaceId, status])` for connection health and token checks.
- `AuditLog`: `@@index([organizationId, createdAt])`, `@@index([workspaceId, createdAt])`, `@@index([userId, createdAt])` for tenant-scoped immutable audit querying at scale.

### 2.3 Migration Workflow
- **Development**: Developers use `npm run db:push` to apply schema changes to local `dev.db`.
- **Schema Changes**: When schema changes are made, migrations are generated using `npx prisma migrate dev --name <change_name>` against PostgreSQL.
- **Production**: Production deployment applies migrations safely without data destruction using `npm run db:migrate:deploy`.
