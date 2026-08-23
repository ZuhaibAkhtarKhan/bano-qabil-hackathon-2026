---
name: Supabase remains authoritative
description: The imported 1Apply product must preserve its original Supabase authentication and database behavior.
---

The original Supabase project is the source of truth for 1Apply authentication, profiles, opportunities, applications, memory, documents, and related workflows. Replit PostgreSQL/Drizzle tables and Clerk authentication are not substitutes for this product.

**Why:** The product's imported server logic, migrations, ownership rules, and user requirement all depend on Supabase; a parallel auth or data model silently breaks the real application flows.

**How to apply:** New frontend session handling should use the Supabase browser client, and server routes should validate Supabase access tokens and query the original schema/RLS. Keep temporary replacement routes out of the active API.