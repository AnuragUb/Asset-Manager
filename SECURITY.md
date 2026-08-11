# Security Policy

## Supported surfaces

Security reports are accepted for the **active web application**:

- `web-app/asset-manager-backend`
- `web-app/asset-manager-frontend`

Legacy PowerShell / Electron clients are deprecated; reports against them are lower priority unless they expose shared secrets or production data paths.

---

## Reporting a vulnerability

**Do not** open a public GitHub issue for:

- Credential leaks, tokens, or `.env` contents  
- Authentication / authorization bypasses  
- SQL injection, XSS, path traversal, or RCE  
- Privilege escalation or data exfiltration paths  

Instead, report privately to the repository maintainers / CINEOM engineering owners responsible for AssetEngine (use your internal security or lead engineer channel).

Include:

1. Affected environment (dev / staging / production) if known  
2. Steps to reproduce (minimal)  
3. Impact assessment  
4. Whether exploitation was observed in production  

We will acknowledge receipt and coordinate fix + disclosure timing.

---

## Secret handling

- Never commit `.env`, Zoho OAuth tokens, DB passwords, or JWT secrets.  
- Rotate credentials immediately if they appear in git history or chat logs.  
- Prefer environment variables and host-level secrets over files in the repo.  
- Uploaded content under `input/` and exports under `export/` are operational data — keep them out of git (see `.gitignore`).

---

## Known security posture (honest summary)

This product is mid-hardening:

- JWT login and RBAC tables exist.  
- **Many legacy API routes are still unauthenticated** — treat the network perimeter and VPN/firewall as part of the control plane until route coverage improves.  
- Redis / cache and Postgres access must stay private to trusted hosts.  
- Encryption helpers exist; not all sensitive fields are guaranteed encrypted at rest.

See also: [`docs/07_SECURITY.md`](./docs/07_SECURITY.md).

---

## Preferred hardening direction

Contributors should prefer changes that:

1. Close auth gaps on write/mutate routes first  
2. Avoid logging secrets or PII in cleartext  
3. Validate and constrain file upload paths  
4. Use parameterized queries (Knex) — never string-concat SQL with user input  
5. Keep CORS and cookie settings intentional per environment  

Large auth refactors require an agreed plan — see [`AGENTS.md`](./AGENTS.md).
