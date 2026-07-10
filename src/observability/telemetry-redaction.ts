import type { TelemetryAttributes } from "./telemetry-contract.js";

const SECRET_KEY_PATTERNS = [
  /authorization/i,
  /cookie/i,
  /set-cookie/i,
  /token/i,
  /api[-_.]?key/i,
  /secret/i,
  /password/i,
  /passwd/i,
  /private[-_.]?key/i,
  /client[-_.]?secret/i,
];

const SECRET_VALUE_PATTERNS = [
  /bearer\s+[A-Za-z0-9._~+/=-]+/i,
  /sk-[A-Za-z0-9]{20,}/,
  /ghp_[A-Za-z0-9]{20,}/,
  /xox[baprs]-[A-Za-z0-9-]+/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

export const REDACTED = "[REDACTED]" as const;

export function redactTelemetryAttributes(attributes: TelemetryAttributes): TelemetryAttributes {
  const result: TelemetryAttributes = {};

  for (const [key, value] of Object.entries(attributes)) {
    if (isSecretKey(key)) {
      result[key] = REDACTED;
      continue;
    }

    result[key] = redactTelemetryValue(value);
  }

  return result;
}

export function redactTelemetryValue(
  value: TelemetryAttributes[string],
): TelemetryAttributes[string] {
  if (typeof value === "string") {
    return SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value)) ? REDACTED : value;
  }

  if (Array.isArray(value)) {
    return value.map((item) =>
      typeof item === "string" && SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(item))
        ? REDACTED
        : item,
    ) as typeof value;
  }

  return value;
}

function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERNS.some((pattern) => pattern.test(key));
}
