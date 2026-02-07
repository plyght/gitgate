# GitGate

Authenticated GitHub Releases proxy with intelligent caching, device verification, and cryptographic signing for secure software distribution in managed environments.

## Overview

GitGate acts as a gatekeeper between your managed devices and GitHub Releases, providing enterprise-grade authentication, caching, and audit logging. It reduces GitHub API consumption through intelligent caching while ensuring only verified devices can access software artifacts. Designed for organizations using MDM solutions or zero-trust networks who need controlled access to GitHub-hosted binaries.

## Features

- **Multi-Method Authentication**: Jamf Pro, Tailscale, mTLS, or open access modes
- **Intelligent Caching**: Configurable TTL-based caching for releases and assets with SHA256 checksums
- **Cryptographic Signing**: Optional RSA signature generation for downloaded assets
- **Rate Limiting**: Per-device request throttling to prevent abuse
- **Comprehensive Auditing**: Structured JSON logging of all access attempts and downloads
- **GitHub API Efficiency**: Reduces upstream API calls through aggressive caching
- **High Performance**: Built on Bun runtime with Hono framework for minimal latency

## Installation

```bash
# From source
git clone https://github.com/yourusername/gitgate.git
cd gitgate
bun install
bun run build

# Run directly
bun run dev

# Production deployment
bun run start
```

Requires Bun 1.0.0 or later.

## Usage

```bash
# List all releases for a repository
curl https://your-gitgate-instance/releases/owner/repo

# Download a specific asset
curl https://your-gitgate-instance/release/owner/repo/v1.0.0/binary.tar.gz \
  -H "X-Device-ID: your-device-id" \
  -o binary.tar.gz

# Verify signature (when signing is enabled)
openssl dgst -sha256 -verify public.pem -signature asset.sig binary.tar.gz
```

Assets include SHA256 checksums in `X-Checksum-SHA256` headers. When signing is enabled, RSA signatures are provided in `X-Signature-RSA-SHA256` headers.

## Configuration

GitGate supports two configuration methods:
1. **Environment variables** (recommended for containerized deployments like Dokploy)
2. **JSON configuration file** (`config.json`)

Environment variables take precedence over the config file.

### Environment Variables

Set these environment variables for configuration:

```bash
GITHUB_TOKEN=ghp_your_fine_grained_pat_here
AUTH_METHOD=tailscale

GITGATE_PORT=3000
GITGATE_HOST=0.0.0.0

GITHUB_CACHE_DIR=./cache
GITHUB_CACHE_TTL_SECONDS=3600

TAILSCALE_API_KEY=tskey_your_tailscale_api_key

JAMF_API_URL=https://your-instance.jamfcloud.com
JAMF_API_KEY=your_api_key
JAMF_API_SECRET=your_api_secret

MTLS_CA_CERT_PATH=/path/to/ca.crt
MTLS_REQUIRE_CLIENT_CERT=true

SIGNING_ENABLED=false
SIGNING_PRIVATE_KEY_PATH=/path/to/private.key

AUDIT_ENABLED=true
AUDIT_LOG_FILE=./logs/audit.log
```

**Required variables:**
- `GITHUB_TOKEN`: GitHub personal access token
- `AUTH_METHOD`: One of `jamf`, `tailscale`, `mtls`, or `none`

**Auth-method-specific variables:**
- For `jamf`: `JAMF_API_URL`, `JAMF_API_KEY`, `JAMF_API_SECRET`
- For `tailscale`: `TAILSCALE_API_KEY`
- For `mtls`: `MTLS_CA_CERT_PATH`, `MTLS_REQUIRE_CLIENT_CERT`

### JSON Configuration File

Alternatively, create `config.json` based on `config.example.json`:

```json
{
  "port": 3000,
  "host": "0.0.0.0",
  "github": {
    "token": "ghp_your_fine_grained_pat_here",
    "cache_dir": "./cache",
    "cache_ttl_seconds": 3600
  },
  "auth": {
    "method": "jamf",
    "jamf": {
      "api_url": "https://your-instance.jamfcloud.com",
      "api_key": "your_api_key",
      "api_secret": "your_api_secret"
    }
  },
  "signing": {
    "enabled": false,
    "private_key_path": "/path/to/private.key"
  },
  "audit": {
    "enabled": true,
    "log_file": "./logs/audit.log"
  }
}
```

### Authentication Methods

- **jamf**: Validates devices against Jamf Pro inventory via API
- **tailscale**: Authenticates using Tailscale network identity
- **mtls**: Mutual TLS with client certificate verification
- **none**: Open access for development or internal networks

### GitHub Token Requirements

Generate a fine-grained personal access token with:
- Read access to repository contents
- Read access to releases

Public repositories require no special permissions.

## Architecture

- `config.ts`: Configuration loading and validation
- `server.ts`: Hono application setup and route handlers
- `auth/`: Authentication adapters for each method
  - `jamf.ts`: Jamf Pro API integration
  - `tailscale.ts`: Tailscale identity verification
  - `mtls.ts`: Client certificate validation
- `github/`: GitHub API interaction layer
  - `client.ts`: Octokit wrapper for releases and assets
  - `cache.ts`: File-based caching with checksums
  - `signing.ts`: RSA signature generation
- `audit/logger.ts`: Structured audit log writer
- `middleware/ratelimit.ts`: Per-device rate limiter

Request flow: Authentication → Rate Limit → Cache Check → GitHub Fetch → Cache Store → Sign → Audit → Response

## Development

```bash
bun install
bun run dev
bun run lint
bun run type-check
```

The dev server watches for changes and automatically restarts. All code is TypeScript with strict type checking.

Key dependencies: Hono (web framework), Octokit (GitHub API client), native Bun APIs for crypto and filesystem operations.

## Security Considerations

- Store GitHub tokens securely with minimal required permissions
- Use authentication methods appropriate for your threat model
- Enable signing for cryptographic verification of downloaded assets
- Review audit logs regularly for anomalous access patterns
- Run behind TLS termination in production
- Rotate API keys and certificates periodically

## License

MIT License
