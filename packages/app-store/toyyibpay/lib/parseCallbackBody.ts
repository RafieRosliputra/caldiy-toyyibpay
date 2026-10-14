/**
 * ToyyibPay posts its bill callback as `multipart/form-data` (their PHP examples pass an array to cURL), which
 * Next's default body parser does not decode - it left `req.body` empty and every callback was rejected with
 * "Missing order_id/billcode". The webhook therefore disables the body parser and decodes the raw body here,
 * while still accepting urlencoded/JSON in case ToyyibPay changes or a proxy rewrites the request.
 */
export function parseMultipartFormData(rawBody: string, contentType: string): Record<string, string> {
  const boundaryMatch = /boundary="?([^";]+)"?/i.exec(contentType);
  if (!boundaryMatch) return {};

  const fields: Record<string, string> = {};
  for (const part of rawBody.split(`--${boundaryMatch[1]}`)) {
    const separatorIndex = part.indexOf("\r\n\r\n");
    if (separatorIndex === -1) continue;

    const headers = part.slice(0, separatorIndex);
    const nameMatch = /name="([^"]+)"/i.exec(headers);
    if (!nameMatch) continue;

    fields[nameMatch[1]] = part.slice(separatorIndex + 4).replace(/\r\n$/, "");
  }
  return fields;
}

export function parseCallbackBody(rawBody: string, contentType: string): Record<string, string> {
  const type = contentType.toLowerCase();

  if (type.includes("application/json")) {
    try {
      const parsed = JSON.parse(rawBody) as Record<string, unknown>;
      return Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, String(value)]));
    } catch {
      return {};
    }
  }

  if (type.includes("multipart/form-data")) {
    return parseMultipartFormData(rawBody, contentType);
  }

  const fields: Record<string, string> = {};
  new URLSearchParams(rawBody).forEach((value, key) => {
    fields[key] = value;
  });
  return fields;
}
