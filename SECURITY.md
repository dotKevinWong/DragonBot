# Security Policy

## Supported Versions

| Version | Supported |
|---|---|
| v3 (current) | ✅ |
| v2 (dragonbot-dev) | ❌ |

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Please report security vulnerabilities through one of these channels:

1. **Discord** — Submit a report in the [DragonBot Discord Server](https://discord.gg/invite/KCkj4CeMtD) under the `#security-reports` channel. Your message will be automatically hidden.
2. **GitHub** — Use [GitHub Security Advisories](https://github.com/drexelDiscord/dragonbot/security/advisories/new) to privately report the vulnerability.

### What to include

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if you have one)

### What to expect

- We will acknowledge your report within 48 hours
- We will provide an update on the fix within 7 days
- We will credit you in the fix (unless you prefer to remain anonymous)

## Scope

The following are in scope for security reports:

- **Bot** — Command injection, privilege escalation, data exposure
- **Web Dashboard** — Authentication bypass, XSS, CSRF, unauthorized access
- **API Routes** — Broken access control, data leaks, injection
- **Database** — SQL injection, unauthorized data access

The following are out of scope:

- Social engineering attacks
- Denial of service
- Issues in third-party dependencies (report upstream)
- Vulnerabilities in Discord's platform itself
