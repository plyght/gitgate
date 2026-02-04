import type { DeviceContext } from "../types";
import { fetchWithTimeout } from "../utils/http";
import {
  getHeader,
  parseForwardedFor,
  validateDeviceId,
  validateHttpsUrl,
  validateTokenHeader,
} from "../utils/validation";

export async function authenticateJamf(
  headers: Record<string, string>,
  config?: Record<string, unknown>,
): Promise<DeviceContext | null> {
  const jamfToken = validateTokenHeader(getHeader(headers, "x-jamf-token"));

  if (!jamfToken) {
    return null;
  }

  const apiUrl = validateHttpsUrl(
    typeof config?.api_url === "string" ? config.api_url : undefined,
  );
  const apiKey = typeof config?.api_key === "string" ? config.api_key : null;
  const apiSecret =
    typeof config?.api_secret === "string" ? config.api_secret : null;

  if (!apiUrl || !apiKey || !apiSecret) {
    throw new Error("Jamf configuration incomplete");
  }

  try {
    const response = await fetchWithTimeout(
      `${apiUrl.toString().replace(/\/$/, "")}/api/v1/auth/tokens`,
      {
      method: "GET",
      headers: {
        Authorization: `Bearer ${jamfToken}`,
        Accept: "application/json",
      },
      },
      30000,
    );

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as Record<string, unknown>;
    const deviceIdRaw =
      typeof data.device_id === "string" ? data.device_id : undefined;
    const deviceId = validateDeviceId(deviceIdRaw);
    const deviceName =
      typeof data.device_name === "string" ? data.device_name : undefined;
    const userId = typeof data.user_id === "string" ? data.user_id : undefined;

    if (!deviceId) {
      return null;
    }

    return {
      device_id: deviceId,
      device_name: deviceName,
      user_id: userId,
      auth_method: "jamf",
      ip_address: parseForwardedFor(getHeader(headers, "x-forwarded-for")),
      timestamp: Date.now(),
    };
  } catch {
    console.warn("Jamf authentication failed");
    return null;
  }
}
