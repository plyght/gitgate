import { X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import type { DeviceContext } from "../types";
import { validateDeviceId } from "../utils/validation";

function parseDistinguishedName(input: string): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  let current = "";
  let escaped = false;
  const segments: string[] = [];

  for (const char of input) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "," || char === "/") {
      if (current.trim()) {
        segments.push(current.trim());
      }
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) {
    segments.push(current.trim());
  }

  for (const segment of segments) {
    const index = segment.indexOf("=");
    if (index === -1) {
      continue;
    }
    const key = segment.slice(0, index).trim();
    const value = segment.slice(index + 1).trim();
    if (!key || !value) {
      continue;
    }
    if (!result[key]) {
      result[key] = [];
    }
    result[key].push(value);
  }
  return result;
}

function parseSubjectAltNames(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const index = entry.indexOf(":");
      if (index === -1) {
        return "";
      }
      return entry.slice(index + 1).trim();
    })
    .filter(Boolean);
}

export async function authenticateMTLS(
  clientCert?: string,
  config?: Record<string, unknown>,
): Promise<DeviceContext | null> {
  if (!clientCert) {
    return null;
  }

  if (!config?.ca_cert_path) {
    throw new Error("mTLS CA certificate path not configured");
  }

  try {
    const caCertPem = readFileSync(config.ca_cert_path as string, "utf-8");
    const caCert = new X509Certificate(caCertPem);
    const clientX509 = new X509Certificate(clientCert);

    const now = Date.now();
    const notBefore = Date.parse(clientX509.validFrom);
    const notAfter = Date.parse(clientX509.validTo);

    if (!Number.isFinite(notBefore) || !Number.isFinite(notAfter)) {
      return null;
    }

    if (now < notBefore || now > notAfter) {
      return null;
    }

    if (!clientX509.verify(caCert.publicKey)) {
      return null;
    }

    if (clientX509.keyUsage && !clientX509.keyUsage.includes("Digital Signature")) {
      return null;
    }
    const subjectMap = parseDistinguishedName(clientX509.subject);
    const altNames = parseSubjectAltNames(clientX509.subjectAltName);
    const commonName = subjectMap.CN?.[0];
    const candidate = altNames[0] || commonName || undefined;
    const deviceId = validateDeviceId(candidate);

    if (!deviceId) {
      return null;
    }

    return {
      device_id: deviceId,
      auth_method: "mtls",
      ip_address: "0.0.0.0",
      timestamp: Date.now(),
    };
  } catch {
    console.warn("mTLS authentication failed");
    return null;
  }
}
