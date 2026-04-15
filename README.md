# GitGate

Authenticated GitHub Releases proxy with intelligent caching, device verification, and cryptographic signing for secure software distribution in managed environments.

## Overview

GitGate acts as a gatekeeper between your managed devices and GitHub Releases, providing enterprise-grade authentication, caching, and audit logging. It reduces GitHub API consumption through intelligent caching while ensuring only verified devices can access software artifacts. Designed for organizations using MDM solutions or zero-trust networks who need controlled access to GitHub-hosted binaries.

## Features

- **Multi-Method Authentication**: Jamf Pro, Tailscale, mTLS, or open access modes
- **In-Memory LRU Cache**: High-performance memory cache powered by `lru-cache` with configurable size/item limits
- **Conditional Requests (ETags)**: Uses `If-None-Match` / `If-Modified-Since` headers — 304s don't count against GitHub's rate limit
- **Stale-While-Revalidate**: Serves stale data instantly while refreshing in the background
- **Stale-If-Error**: Falls back to cached data when GitHub is down or rate-limited
- **Automatic Retry with Backoff**: Retries rate-limited requests with exponential backoff
- **Rate Limit Awareness**: Tracks GitHub's `X-RateLimit-*` headers and exposes them via `/cache/stats`
- **Separate TTLs**: Different cache lifetimes for metadata (5 min default) vs assets (24 hr default)
- **Cryptographic Signing**: Optional RSA signature generation for downloaded assets
- **Per-Device Rate Limiting**: Request throttling to prevent abuse
- **Comprehensive Auditing**: Structured JSON logging of all access attempts and downloads
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

Every response includes an `X-Cache` header: `HIT`, `STALE`, or `MISS`.

```bash
# View cache stats and GitHub rate limit usage
curl https://your-gitgate-instance/cache/stats

# Clear all cached data
curl -X DELETE https://your-gitgate-instance/cache
```

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

# Cache tuning (all optional)
CACHE_METADATA_TTL_SECONDS=300
CACHE_ASSET_TTL_SECONDS=86400
CACHE_MAX_ITEMS=500
CACHE_MAX_MB=256
CACHE_STALE_WHILE_REVALIDATE_SECONDS=60
CACHE_STALE_IF_ERROR_SECONDS=3600
CACHE_ENABLE_ETAGS=true

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
    "cache_ttl_seconds": 3600,
    "cache": {
      "metadata_ttl_seconds": 300,
      "asset_ttl_seconds": 86400,
      "max_items": 500,
      "max_mb": 256,
      "stale_while_revalidate_seconds": 60,
      "stale_if_error_seconds": 3600,
      "enable_etags": true
    }
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

## Cache System

GitGate's cache is designed to minimize GitHub API usage while keeping data fresh.

**How it reduces rate limit consumption:**

| Technique | Impact |
|-----------|--------|
| In-memory LRU cache | Repeat requests never hit GitHub |
| Conditional requests (ETags) | 304 responses don't count against rate limit |
| Stale-while-revalidate | Serves cached data immediately, refreshes in background |
| Stale-if-error | Falls back to cache when GitHub is unreachable or rate-limited |
| Separate TTLs | Assets cached for 24h (they're immutable), metadata for 5 min |
| Retry with backoff | Automatically retries on 429/403 with exponential delay |

**Cache options:**

| Option | Default | Description |
|--------|---------|-------------|
| `metadata_ttl_seconds` | 300 | TTL for release list metadata |
| `asset_ttl_seconds` | 86400 | TTL for binary assets (immutable, so long-lived) |
| `max_items` | 500 | Max entries in the LRU cache |
| `max_mb` | 256 | Max memory for cached data in MB |
| `stale_while_revalidate_seconds` | 60 | Serve stale data while refreshing |
| `stale_if_error_seconds` | 3600 | Serve stale data when upstream fails |
| `enable_etags` | true | Use conditional requests to save rate limit |

**Monitoring:**

`GET /cache/stats` returns real-time cache performance and GitHub rate limit state:

```json
{
  "memory": {
    "items": 42,
    "max_items": 500,
    "size_bytes": 15728640,
    "max_bytes": 268435456,
    "hits": 1847,
    "misses": 23,
    "hit_rate": "98.8%"
  },
  "etag": {
    "conditional_requests": 156,
    "not_modified": 142,
    "savings_rate": "91.0%"
  },
  "github": {
    "requests_remaining": 4823,
    "requests_limit": 5000,
    "reset_at": "2026-04-15T12:00:00.000Z"
  },
  "uptime_seconds": 86400
}
```

## Architecture

- `config.ts`: Configuration loading and validation
- `server.ts`: Hono application setup and route handlers
- `cache/`: In-memory cache system
  - `index.ts`: `GitGateCache` orchestrator
  - `memory.ts`: LRU memory cache (powered by `lru-cache`)
  - `etag-store.ts`: ETag/Last-Modified tracker for conditional requests
- `auth/`: Authentication adapters for each method
  - `jamf.ts`: Jamf Pro API integration
  - `tailscale.ts`: Tailscale identity verification
  - `mtls.ts`: Client certificate validation
- `github/`: GitHub API interaction layer
  - `client.ts`: Octokit wrapper with conditional requests, rate limit tracking, and retry
  - `signing.ts`: RSA signature generation
- `audit/logger.ts`: Structured audit log writer
- `middleware/ratelimit.ts`: Per-device rate limiter

Request flow: Authentication → Rate Limit → Cache Check → (if miss/stale) GitHub Fetch with ETags → Cache Store → Sign → Audit → Response

## Development

```bash
bun install
bun run dev
bun run lint
bun run type-check
```

The dev server watches for changes and automatically restarts. All code is TypeScript with strict type checking.

Key dependencies: Hono (web framework), Octokit (GitHub API client), lru-cache (in-memory LRU), native Bun APIs for crypto operations.

## Security Considerations

- Store GitHub tokens securely with minimal required permissions
- Use authentication methods appropriate for your threat model
- Enable signing for cryptographic verification of downloaded assets
- Review audit logs regularly for anomalous access patterns
- Run behind TLS termination in production
- Rotate API keys and certificates periodically

## License

MIT License
