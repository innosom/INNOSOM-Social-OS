# INNOSOM Social OS — Architecture & Engineering Specification

## 1. System Overview

**INNOSOM Social OS** is an internal agency social media operations platform built as a modular monolith. It provides INNOSOM team members with a unified command center to manage multiple client workspaces (e.g., Haji Abdi College, Garowe General Hospital, East Africa University, Nasiim Perfumes, Alpha Industries) and their connected social media channels without logging out or risking cross-client data leakages.

### Architecture Highlights
- **Framework**: Next.js (App Router, React, TypeScript, Tailwind CSS)
- **Database & ORM**: SQLite (Local Dev) / PostgreSQL (Production) with Prisma ORM
- **Async Processing & Queue**: BullMQ + Redis for background publishing jobs, token health checks, and analytics synchronization
- **Security & Authorization**: Server-side derived session context, RBAC (ADMIN, MANAGER, EDITOR, VIEWER), encrypted social API credentials at rest, strictly enforced workspace scoping.

---

## 2. Database & Data Layer Architecture

### Provider Configurations
- **Local Development**: SQLite supported via `prisma/schema.sqlite.prisma` (`npm run db:push`).
- **Production Environment**: PostgreSQL supported via `prisma/schema.prisma` (`npm run db:migrate:deploy`).

### Database Optimization & Indexing Strategy
To ensure production performance under concurrent workload and scaling:
1. **Scheduler Performance (`Publication`)**:
   - Composite index `@@index([status, scheduledAt])`: Accelerates QueueService due-publication polling queries filtering for `status = 'SCHEDULED'` and `scheduledAt <= NOW()`.
   - Foreign key indexes `@@index([contentVariantId])`, `@@index([socialConnectionId])`.
2. **Multi-Tenant Workspace & Content Isolation (`Content`, `Membership`)**:
   - Composite index `@@index([workspaceId, status])`: Optimizes filtered content views in client workspaces.
   - Indexes `@@index([organizationId])` and `@@index([userId])` on `Membership`: Prevents sequential scans during workspace authorization and workspace switching.
3. **Audit Trail at Scale (`AuditLog`)**:
   - Composite index `@@index([organizationId, createdAt])` and `@@index([workspaceId, createdAt])`: Supports fast paginated audit activity views.
   - Index `@@index([entityType, entityId])` and `@@index([userId])`: Enables targeted lookups by entity or user action.

---

## 3. Production Deployment & Migration Workflow

### Initializing Production PostgreSQL
1. Set `DATABASE_URL` in environment variables:
   ```env
   DATABASE_URL="postgresql://user:password@host:5432/innosom_db?schema=public"
   ```
2. Run database migrations:
   ```bash
   npm run db:migrate:deploy
   ```
3. Seed default organization, administrative users, and client workspaces:
   ```bash
   npm run db:seed
   ```
4. Build and start application server:
   ```bash
   npm run build
   npm start
   ```
