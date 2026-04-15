export interface CacheConfig {
  metadata_ttl_seconds: number;
  asset_ttl_seconds: number;
  max_items: number;
  max_mb: number;
  stale_while_revalidate_seconds: number;
  stale_if_error_seconds: number;
  enable_etags: boolean;
}

export interface Config {
  port: number;
  host: string;
  github: {
    token: string;
    cache_dir: string;
    cache_ttl_seconds: number;
    cache?: Partial<CacheConfig>;
  };
  auth: {
    method: "jamf" | "tailscale" | "mtls" | "none";
    jamf?: {
      api_url: string;
      api_key: string;
      api_secret: string;
    };
    tailscale?: {
      api_key: string;
    };
    mtls?: {
      ca_cert_path: string;
      require_client_cert: boolean;
    };
  };
  signing?: {
    enabled: boolean;
    private_key_path?: string;
  };
  audit?: {
    enabled: boolean;
    log_file?: string;
  };
  security?: {
    cors?: {
      allowed_origins?: string[];
      allow_credentials?: boolean;
    };
  };
}

export interface DeviceContext {
  device_id: string;
  device_name?: string;
  user_id?: string;
  auth_method: string;
  ip_address: string;
  timestamp: number;
}

export interface CacheEntry {
  data: string;
  checksum: string;
  timestamp: number;
  ttl: number;
}

export interface CacheMeta {
  key: string;
  checksum: string;
  etag?: string;
  last_modified?: string;
  timestamp: number;
  ttl: number;
  size: number;
  content_type: string;
  stale_while_revalidate: number;
  stale_if_error: number;
}

export interface CacheStats {
  memory: {
    items: number;
    max_items: number;
    size_bytes: number;
    max_bytes: number;
    hits: number;
    misses: number;
    hit_rate: string;
  };
  etag: {
    conditional_requests: number;
    not_modified: number;
    savings_rate: string;
  };
  github: {
    requests_remaining: number | null;
    requests_limit: number | null;
    reset_at: string | null;
  };
  uptime_seconds: number;
}

export interface GitHubRateLimitInfo {
  remaining: number;
  limit: number;
  reset: number;
  used: number;
}

export interface ReleaseAsset {
  id: number;
  name: string;
  url: string;
  browser_download_url: string;
  size: number;
  download_count: number;
  created_at: string;
  updated_at: string;
}

export interface Release {
  id: number;
  tag_name: string;
  name: string;
  draft: boolean;
  prerelease: boolean;
  created_at: string;
  published_at: string;
  assets: ReleaseAsset[];
}

export interface AuditLog {
  timestamp: number;
  device_id: string;
  action: string;
  resource: string;
  status: "success" | "failure";
  details?: Record<string, unknown>;
}

export interface RateLimitState {
  requests: number;
  reset_at: number;
  blocked_until?: number;
  violations?: number;
}
