export type AppStatus = 400 | 401 | 404 | 429 | 500 | 502;

export class AppError extends Error {
  status: AppStatus;
  code: string;

  constructor(message: string, code: string, status: AppStatus) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, "validation_error", 400);
  }
}

export class ConfigError extends AppError {
  constructor(message: string) {
    super(message, "config_error", 500);
  }
}

export class AuthError extends AppError {
  constructor(message: string) {
    super(message, "auth_error", 401);
  }
}

export class ExternalServiceError extends AppError {
  constructor(message: string) {
    super(message, "external_service_error", 502);
  }
}

export class RateLimitError extends AppError {
  constructor(message: string) {
    super(message, "rate_limit_error", 429);
  }
}
