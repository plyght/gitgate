import type { DeviceContext } from "../types";
import { fetchWithTimeout } from "../utils/http";
import {
  getHeader,
  parseForwardedFor,
  validateDeviceHeader,
  validateDeviceId,
  validateIpAddress,
  validateTokenHeader,
  validateUserHeader,
} from "../utils/validation";

export async function authenticateTailscale(
  headers: Record<string, string>,
  config?: Record<string, unknown>,
): Promise<DeviceContext | null> {
  const tsUser = validateUserHeader(getHeader(headers, "x-tailscale-user"));
  const tsDevice = validateDeviceHeader(
    getHeader(headers, "x-tailscale-device"),
  );
  const tsIP = validateIpAddress(getHeader(headers, "x-tailscale-ip"));

  if (!tsUser || !tsDevice) {
    return null;
  }

  const apiKey = validateTokenHeader(
    typeof config?.api_key === "string" ? config.api_key : undefined,
  );

  if (!apiKey) {
    throw new Error("Tailscale API key not configured");
  }

  try {
    const response = await fetchWithTimeout(
      "https://api.tailscale.com/api/v2/devices",
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
        },
      },
      30000,
    );

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as Record<string, unknown>;
    const devices = data.devices as Array<Record<string, unknown>> | undefined;

    if (!devices) {
      return null;
    }

    const device = devices.find((d) => (d.id as string) === tsDevice);

    if (!device) {
      return null;
    }

    const deviceId = validateDeviceId(tsDevice);
    if (!deviceId) {
      return null;
    }

    return {
      device_id: deviceId,
      device_name: device.name as string | undefined,
      user_id: tsUser,
      auth_method: "tailscale",
      ip_address:
        tsIP || parseForwardedFor(getHeader(headers, "x-forwarded-for")),
      timestamp: Date.now(),
    };
  } catch {
    console.warn("Tailscale authentication failed");
    return null;
  }
}
