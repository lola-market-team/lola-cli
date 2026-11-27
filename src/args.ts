/** Parse the JSON arguments passed to `lola call`. */
export function parseArgs(text: string | undefined): Record<string, unknown> {
  if (!text || !text.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Arguments must be valid JSON, e.g. \'{"q":"drill"}\'.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Arguments must be a JSON object.');
  }
  return parsed as Record<string, unknown>;
}
