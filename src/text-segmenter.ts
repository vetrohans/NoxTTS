import { isMarkdownTable } from "./text-processor";

const MAX_SEGMENT_LENGTH = 3000;
const TARGET_SEGMENT_LENGTH = 2000;

/**
 * Smart text segmentation that respects natural boundaries.
 *
 * Rules:
 * 1. Prefer splitting at paragraph boundaries (double newlines)
 * 2. Hard cap: no segment exceeds 3000 chars
 * 3. Soft target: 1500-2500 chars per segment
 * 4. Preserve table integrity (entire table as one segment)
 * 5. Preserve list structure (list item + children together)
 */
export function segmentText(text: string): string[] {
  if (text.length <= MAX_SEGMENT_LENGTH) {
    return text.trim() ? [text.trim()] : [];
  }

  const paragraphs = text.split(/\n\n+/);
  const segments: string[] = [];
  let currentSegment = "";

  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim();
    if (!trimmed) continue;

    // Rule 1: Table forced as its own segment (even if small)
    if (isMarkdownTable(trimmed)) {
      if (currentSegment.trim()) {
        segments.push(currentSegment.trim());
        currentSegment = "";
      }
      // A table might itself exceed the max - keep it whole anyway
      segments.push(trimmed);
      continue;
    }

    // Rule 2: If adding this paragraph would exceed the hard cap
    if (
      currentSegment.length + trimmed.length + 2 > MAX_SEGMENT_LENGTH &&
      currentSegment.trim()
    ) {
      // If current segment is already reasonable, push it
      if (currentSegment.trim().length >= TARGET_SEGMENT_LENGTH * 0.5) {
        segments.push(currentSegment.trim());
        currentSegment = trimmed;
      } else {
        // Current segment is small, try to fit this paragraph
        // by splitting the paragraph further
        const combined = currentSegment + "\n\n" + trimmed;
        if (combined.length <= MAX_SEGMENT_LENGTH) {
          currentSegment = combined;
        } else {
          segments.push(currentSegment.trim());
          // If the paragraph itself is too long, split at sentence boundaries
          if (trimmed.length > MAX_SEGMENT_LENGTH) {
            const subSegments = splitLongParagraph(trimmed);
            segments.push(...subSegments);
            currentSegment = "";
          } else {
            currentSegment = trimmed;
          }
        }
      }
    } else {
      // Safe to add
      if (currentSegment) {
        currentSegment += "\n\n" + trimmed;
      } else {
        currentSegment = trimmed;
      }
    }
  }

  if (currentSegment.trim()) {
    segments.push(currentSegment.trim());
  }

  return segments;
}

/**
 * Split a paragraph that's too long into sentence-level chunks
 * while respecting the max length.
 */
function splitLongParagraph(text: string): string[] {
  const results: string[] = [];
  // Split on sentence-ending punctuation followed by space or newline
  const sentences = text.split(/(?<=[。！？.!?])\s*/);
  let current = "";

  for (const sentence of sentences) {
    if (!sentence.trim()) continue;

    if (
      current.length + sentence.length > MAX_SEGMENT_LENGTH &&
      current.trim()
    ) {
      results.push(current.trim());
      current = sentence;
    } else {
      current += sentence;
    }
  }

  if (current.trim()) {
    results.push(current.trim());
  }

  return results.length > 0 ? results : [text];
}
