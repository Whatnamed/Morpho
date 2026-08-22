# Agent Runtime Architecture and Next Development Phase

## Current Runtime Architecture

Morpho currently uses the A+ Agent Runtime architecture as the single production runtime path. The migration from the previous Runtime B design is complete, and future work should extend the existing A+ model rather than introduce another runtime abstraction.

The current architecture separates responsibilities between browser-local product state and server-authoritative execution state.

### Client-local responsibilities

The browser remains the owner of product continuity data:

- Workspace content
- Canvas objects and layout state
- Local assets and files
- Project memory
- Stage records
- Conversation history and revisions
- Local agent turn outcomes

This preserves Morpho's local-first product direction: the project itself is not treated as a server-managed SaaS document.

### Server-authoritative responsibilities

The server handles only the parts that require trusted execution boundaries:

- Authentication
- Turn identity binding
- Provider execution
- Search and image credentials
- Quota enforcement
- Idempotency protection
- External execution status journals

The server turn journal is an execution record, not a replacement for local workspace persistence.

## Agent Turn Flow

A typical Agent turn follows this model:

1. Client creates a local turn context.
2. Server creates or resumes the Server Turn Journal.
3. External AI operations execute through controlled server boundaries.
4. Provider execution state is recorded by the server.
5. Client applies approved local effects and persists workspace changes.

The important boundary is that AI suggestions do not directly become authoritative project changes. Human confirmation remains the final authority for design decisions and persistent semantic changes.

## Context and Memory Model

Morpho uses a layered context model:

- Raw conversation data remains local.
- Project memory stores durable design knowledge.
- Summary revisions compress long-running conversations.
- Context frames provide bounded information to Agent execution.

Future context work should continue improving retrieval quality and relevance instead of simply increasing prompt size.

## Current Development Phase

The Agent Runtime migration phase is complete. Current development is focused on product capability expansion on top of the A+ foundation.

Priority areas:

1. Validate complete industrial design workflows with realistic projects.
2. Improve AI capability routing and intent understanding.
3. Strengthen project recovery, backup, and continuity experiences.
4. Continue improving designer-facing interactions rather than only internal infrastructure.

## Next Phase Principles

Future implementation should follow these principles:

- Extend existing A+ boundaries instead of adding parallel execution paths.
- Keep project ownership local-first unless a deliberate product decision changes this.
- Preserve human decision ownership for design records and semantic changes.
- Add capabilities through clear domain contracts.
- Validate new AI features through real design workflows.

The next phase is not a runtime migration. It is the transition from architectural stabilization to proving Morpho's value as an AI-assisted industrial design workspace.
