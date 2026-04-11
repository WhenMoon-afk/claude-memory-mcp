export function normalizeText(input: string): string {
  return input.trim().replace(/\s+/g, " ");
}

export function compactLabel(input: string): string {
  const normalized = normalizeText(input);
  return normalized.length <= 20
    ? normalized
    : `${normalized.slice(0, 19).trimEnd()}…`;
}

export function compactPreview(input: string): string {
  const normalized = normalizeText(input);
  return normalized.length <= 80
    ? normalized
    : `${normalized.slice(0, 79).trimEnd()}…`;
}
