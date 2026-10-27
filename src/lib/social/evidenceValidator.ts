/**
 * Evidence Verbatim Validator
 * Guarantees zero-fabrication: every evidence snippet stored must exist as an
 * exact substring within the original source content.
 */

/**
 * Validates candidate snippets against source text.
 * Returns only the snippets that actually appear verbatim (case-insensitively) in the source text,
 * returning the exact casing from the original source text.
 */
export function validateVerbatimSnippets(
  sourceText: string,
  candidateSnippets: string[]
): string[] {
  if (!sourceText || !candidateSnippets || candidateSnippets.length === 0) {
    return [];
  }

  const validSnippets: string[] = [];
  const lowerSource = sourceText.toLowerCase();

  for (const candidate of candidateSnippets) {
    if (!candidate || typeof candidate !== 'string') continue;
    const trimmed = candidate.trim();
    if (trimmed.length < 3) continue;

    const lowerCandidate = trimmed.toLowerCase();
    const index = lowerSource.indexOf(lowerCandidate);

    if (index !== -1) {
      // Extract exact slice from original source text to preserve original casing
      const verbatimSlice = sourceText.substring(index, index + lowerCandidate.length);
      if (!validSnippets.includes(verbatimSlice)) {
        validSnippets.push(verbatimSlice);
      }
    }
  }

  return validSnippets;
}

/**
 * Extracts a verbatim context window around a matched pattern in the source text.
 * Never fabricates words; extracts only genuine source substrings.
 */
export function extractVerbatimContext(
  sourceText: string,
  matchRegex: RegExp,
  paddingChars = 30
): string | null {
  if (!sourceText) return null;
  const match = matchRegex.exec(sourceText);
  if (!match) return null;

  const start = Math.max(0, match.index - paddingChars);
  const end = Math.min(sourceText.length, match.index + match[0].length + paddingChars);

  let snippet = sourceText.substring(start, end).trim();
  if (start > 0) snippet = '...' + snippet;
  if (end < sourceText.length) snippet = snippet + '...';

  // Ensure returned snippet actually exists in source text
  const rawExcerpt = sourceText.substring(start, end).trim();
  return rawExcerpt.length >= 3 ? rawExcerpt : null;
}

