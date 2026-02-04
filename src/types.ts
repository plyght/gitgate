export interface Config {
  port: number;
  host: string;
  github: {
    token: string;
    cache_dir: string;
    cache_ttl_seconds: number;
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
