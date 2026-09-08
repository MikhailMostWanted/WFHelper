// Checks the base64 alphabet and encoded-length bound; callers validate decoded bytes.
export function isBoundedBase64(value: unknown, maxBytes: number): value is string {
  return (
    typeof value === "string" &&
    value.length <= Math.ceil(maxBytes / 3) * 4 &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(value)
  );
}
