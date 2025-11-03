# Security Policy

## Supported Versions

We actively support the following versions of Memory MCP with security updates:

| Version | Supported          |
| ------- | ------------------ |
| 2.0.x   | :white_check_mark: |
| 1.x.x   | :x:                |

## Reporting a Vulnerability

We take the security of Memory MCP seriously. If you discover a security vulnerability, please follow these steps:

### 1. **Do Not** Open a Public Issue

Please do not open a public GitHub issue for security vulnerabilities. This helps prevent exploitation before a fix is available.

### 2. Report via GitHub Security Advisories

The preferred method is to use GitHub's private vulnerability reporting:

1. Go to https://github.com/WhenMoon-afk/claude-memory-mcp/security/advisories
2. Click "Report a vulnerability"
3. Fill in the details using the template below

### 3. Alternative: Email

If you cannot use GitHub Security Advisories, you can email the maintainers:

- Create a new GitHub issue with title "SECURITY: [Brief Description]"
- In the body, request private contact information
- We will respond within 48 hours with secure communication details

### Report Template

When reporting a vulnerability, please include:

```markdown
## Vulnerability Summary
[Brief description of the vulnerability]

## Affected Versions
[Which versions are affected]

## Vulnerability Type
[e.g., SQL Injection, Path Traversal, XSS, etc.]

## Steps to Reproduce
1. [First step]
2. [Second step]
3. [etc.]

## Impact
[What can an attacker do with this vulnerability?]

## Suggested Fix
[Optional: Your thoughts on how to fix it]

## Additional Context
[Any other relevant information]
```

## Security Considerations for Memory MCP

### Data Storage

Memory MCP stores data locally in SQLite databases. Users should be aware that:

- **Database Location**: By default, memories are stored in `~/.memory-mcp/memory.db` or the path configured in `MEMORY_DB_PATH`
- **Encryption**: Database files are **not encrypted at rest** by default
- **Sensitive Data**: Avoid storing passwords, API keys, or other sensitive credentials in memories
- **Access Control**: Database files inherit filesystem permissions of the user running Memory MCP

### Input Validation

Memory MCP includes input validation to prevent:

- SQL injection (via parameterized queries with better-sqlite3)
- Path traversal attacks
- Malicious content in memory fields

### Sandboxing

Memory MCP runs as an MCP server and:

- **Does not make network requests** (fully local operation)
- **File system access** is limited to the configured database path
- **No code execution** from user inputs

### Best Practices for Users

1. **Database Backups**: Regularly backup your memory database
2. **Filesystem Permissions**: Ensure database directory has appropriate permissions (e.g., `chmod 700 ~/.memory-mcp`)
3. **Sensitive Data**: Do not store plaintext credentials or secrets in memories
4. **Updates**: Keep Memory MCP updated to the latest version
5. **MCPB Bundles**: Only install MCPB bundles from official releases on this repository

### Known Limitations

- **No encryption at rest**: Database files are stored in plaintext SQLite format
- **No authentication**: Memory MCP assumes it runs in a trusted local environment
- **No rate limiting**: Local operation means no built-in rate limiting

## Security Update Process

When a security vulnerability is confirmed:

1. **Acknowledgment**: We will acknowledge receipt within 48 hours
2. **Investigation**: We will investigate and validate the issue within 5 business days
3. **Fix Development**: We will develop and test a fix
4. **Disclosure**: We will:
   - Release a patch version with the fix
   - Publish a security advisory on GitHub
   - Credit the reporter (unless they prefer to remain anonymous)
   - Update this SECURITY.md if needed

### Timeline

- **Critical vulnerabilities**: Patch within 7 days
- **High severity**: Patch within 14 days
- **Medium/Low severity**: Patch in next scheduled release

## Security Best Practices for Contributors

If you're contributing to Memory MCP:

1. **Input Validation**: Always validate and sanitize user inputs
2. **SQL Safety**: Use parameterized queries (already enforced by better-sqlite3)
3. **Path Safety**: Validate file paths to prevent traversal
4. **Dependencies**: Keep dependencies updated and review security advisories
5. **Code Review**: Security-sensitive changes require maintainer review
6. **Testing**: Include security test cases for new features

## Security Checklist for Releases

Before each release, we verify:

- [ ] All dependencies are up-to-date
- [ ] No known security vulnerabilities in dependencies (via `npm audit`)
- [ ] Input validation is in place for all user-facing APIs
- [ ] SQL queries use parameterized statements
- [ ] File system operations are safely scoped
- [ ] No sensitive data in logs or error messages
- [ ] MCPB bundle excludes development files and secrets

## Contact

For security-related questions that are not vulnerabilities:

- Open a regular GitHub issue with the `security` label
- Tag maintainers in discussions

For urgent security matters, follow the vulnerability reporting process above.

## Recognition

We appreciate security researchers who help keep Memory MCP safe. Reporters of valid security vulnerabilities will be:

- Credited in the security advisory (unless they prefer anonymity)
- Listed in the release notes for the patch version
- Mentioned in our README's acknowledgments section

Thank you for helping keep Memory MCP secure!
