import { NoxTTSSettings } from "./settings";

/**
 * Removes emoji characters while preserving Chinese punctuation and symbols
 * that are meaningful in Chinese text.
 */
export function removeEmoji(text: string): string {
  // Match emoji: various unicode emoji ranges, but exclude Chinese-sensible symbols
  const emojiRegex =
    /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1F018}-\u{1F270}\u{238C}\u{23CF}\u{23E9}-\u{23F3}\u{23F8}-\u{23FA}\u{1F780}-\u{1F7FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}]/gu;
  return text.replace(emojiRegex, "");
}

/**
 * Strip YAML frontmatter from the beginning of a Markdown note.
 */
export function stripFrontmatter(text: string): string {
  const frontmatterRegex = /^---\n[\s\S]*?\n---\n?/;
  return text.replace(frontmatterRegex, "");
}

/**
 * Remove Markdown image syntax: ![[xxx]] and ![alt](url)
 */
export function removeImageSyntax(text: string): string {
  let result = text;
  // Wiki-style images: ![[image.png]]
  result = result.replace(/!\[\[.*?\]\]/g, "");
  // Standard markdown images: ![alt](url)
  result = result.replace(/!\[.*?\]\(.*?\)/g, "");
  return result;
}

/**
 * Remove bare URLs but keep display text of links.
 */
export function removeBareUrls(text: string): string {
  let result = text;
  // Remove bare URLs (standalone http/https links)
  result = result.replace(/\bhttps?:\/\/[^\s)\]}>"]+/g, "");
  return result;
}

/**
 * Process markdown links: [[link]] -> display text, [[link|alias]] -> alias
 */
export function processWikiLinks(text: string): string {
  let result = text;
  // [[link|alias]] -> alias
  result = result.replace(/\[\[.*?\|(.*?)\]\]/g, "$1");
  // [[link]] -> link (remove brackets)
  result = result.replace(/\[\[(.*?)\]\]/g, "$1");
  return result;
}

/**
 * Process markdown links: [text](url) -> text
 */
export function processMarkdownLinks(text: string): string {
  return text.replace(/\[(.*?)\]\(.*?\)/g, "$1");
}

/**
 * Remove markdown formatting markers: **bold**, *italic*, ==highlight==
 */
export function stripFormattingMarkers(text: string): string {
  let result = text;
  result = result.replace(/==(.*?)==/g, "$1");
  result = result.replace(/\*\*(.*?)\*\*/g, "$1");
  result = result.replace(/__(.*?)__/g, "$1");
  result = result.replace(/\*(.*?)\*/g, "$1");
  result = result.replace(/_(.*?)_/g, "$1");
  result = result.replace(/~~(.*?)~~/g, "$1");
  return result;
}

/**
 * Remove LaTeX formulas: $$ ... $$ and $ ... $
 */
export function removeLatex(text: string): string {
  let result = text;
  // Block LaTeX: $$ ... $$
  result = result.replace(/\$\$[\s\S]*?\$\$/g, "");
  // Inline LaTeX: $ ... $ (but not $$)
  result = result.replace(/(?<!\$)\$(?!\$)(.*?)(?<!\$)\$(?!\$)/g, "");
  return result;
}

/**
 * Remove code blocks (both fenced and indented).
 */
export function removeCodeBlocks(text: string): string {
  let result = text;
  // Fenced code blocks: ``` ... ```
  result = result.replace(/```[\s\S]*?```/g, "");
  // Inline code: `code`
  result = result.replace(/`([^`]+)`/g, "");
  return result;
}

/**
 * Process checklist items:
 * - [ ] item -> "待办事项：item"
 * - [x] item -> "已完成：item"
 */
export function processChecklists(text: string): string {
  let result = text;
  result = result.replace(/^\s*-\s*\[ \]\s+(.+)$/gm, "待办事项：$1。");
  result = result.replace(/^\s*-\s*\[x\]\s+(.+)$/gm, "已完成：$1。");
  result = result.replace(/^\s*-\s*\[X\]\s+(.+)$/gm, "已完成：$1。");
  return result;
}

/**
 * Process blockquotes: optionally add "引用：" prefix
 */
export function processBlockquotes(text: string, addPrefix: boolean): string {
  if (!addPrefix) {
    // Still strip the > marker but don't add prefix
    return text.replace(/^>\s?/gm, "");
  }
  return text.replace(/^>\s?(.+)$/gm, "引用：$1。");
}

/**
 * Convert a markdown table to spoken format:
 * Header1 | Header2   ->   Header1：cell1，Header2：cell2。
 */
export function processTable(tableText: string): string {
  const lines = tableText.trim().split("\n");

  if (lines.length < 2) return tableText;

  // Parse the header row
  const headerCells = parseTableRow(lines[0]);

  // Skip separator line (|---|---|)
  let dataStartIndex = 1;
  if (lines[1] && lines[1].match(/^[\s|:\-]+$/)) {
    dataStartIndex = 2;
  }

  const resultLines: string[] = [];

  // First, output the headers as a list: "特征，含义。"
  if (headerCells.length > 0) {
    resultLines.push(headerCells.join("，") + "。");
  }

  // Then output each data row
  for (let i = dataStartIndex; i < lines.length; i++) {
    const cells = parseTableRow(lines[i]);
    if (cells.length === 0) continue;

    const parts: string[] = [];
    for (let j = 0; j < cells.length && j < headerCells.length; j++) {
      parts.push(headerCells[j] + "：" + cells[j]);
    }
    // If more cells than headers, just read the remaining cells
    for (let j = headerCells.length; j < cells.length; j++) {
      parts.push(cells[j]);
    }

    resultLines.push(parts.join("，") + "。");
  }

  return resultLines.join("\n");
}

function parseTableRow(line: string): string[] {
  return line
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cell.trim())
    .filter((cell) => cell.length > 0);
}

/**
 * Check if a text block is a markdown table.
 */
export function isMarkdownTable(text: string): boolean {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return false;

  // First line should have pipes
  if (!lines[0].includes("|")) return false;

  // Second line should be a separator (|---|---|)
  const separatorPattern = /^[\s|:\-]+$/;
  return separatorPattern.test(lines[1]);
}

/**
 * PRD 6.3.3 规则 1：无序列表符号处理
 *
 * 检测无序列表标记符（- * +），但不包括已处理的待办事项（- [ ] / - [x]）。
 * 移除符号本身，替换为逗号（TTS 引擎读逗号时自然停顿约 150ms），
 * 然后直接朗读列表项文本。
 */
export function processUnorderedListMarkers(text: string): string {
  // Match lines starting with - * + as unordered list markers
  // Exclude checklist items: - [ ] and - [x] which are handled separately
  // Match: marker + space + content
  return text.replace(
    /^(\s*)[-*+]\s(?!\[[\sxX]\])(.+)$/gm,
    "$1，$2"
  );
}

/**
 * PRD 6.3.3 规则 2：引号闭合后的智能断句
 *
 * 右引号（" 」）之后的停顿规则：
 * - 后紧跟换行符 → 插入句号（约 200ms 停顿）
 * - 后紧跟中文汉字（非虚词、非标点）→ 插入句号
 * - 后紧跟虚词（的、了、吗、呢 等）→ 不额外停顿
 */
export function processQuotePauses(text: string): string {
  const rightQuote = /["」]/g;
  const functionWords = /^[的了着过吗呢吧啊呀嘛哇哦哎嘿哈嗯]/;

  // Pattern: right quote + newline → insert pause
  let result = text.replace(
    /(["」])(\n+)/g,
    "。$2"
  );

  // Pattern: right quote + Chinese char (not function word, not punctuation)
  result = result.replace(
    /(["」])([一-鿿])/g,
    (match, quote: string, nextChar: string) => {
      if (functionWords.test(nextChar)) {
        // Function word — no extra pause, just remove the quote
        return nextChar;
      }
      // Content word — insert pause
      return "。" + nextChar;
    }
  );

  // Remove standalone remaining right quotes
  result = result.replace(/["」]/g, "");

  return result;
}

/**
 * Remove horizontal rules (---, ***, ___) — PRD 2.3.
 * These are page dividers, not to be read aloud.
 */
export function removeHorizontalRules(text: string): string {
  return text.replace(/^[-*_]{3,}\s*$/gm, "");
}

/**
 * PRD 2.3: Heading number pause.
 * Insert a comma after Chinese/arabic number + delimiter so TTS pauses.
 * "二、七大技能框架" → "二，七大技能框架"
 * "## 3. 项目介绍" → "## 3，项目介绍"
 * Works with optional markdown heading markers (#, ##, etc.)
 */
export function processHeadingPauses(text: string): string {
  return text.replace(
    /^(\s*#{0,6}\s*)([一二三四五六七八九十百千万]+|\d+)[、.．]\s*/gm,
    "$1$2，"
  );
}

export interface ProcessedText {
  text: string;
  isEmpty: boolean;
}

/**
 * Full text preprocessing pipeline.
 * Returns the processed text ready for TTS synthesis.
 */
export function preprocessText(
  rawText: string,
  settings: NoxTTSSettings
): ProcessedText {
  let text = rawText;

  // 1. Strip frontmatter
  if (settings.skipFrontmatter) {
    text = stripFrontmatter(text);
  }

  // 2. Remove horizontal rules (--- separators, PRD 2.3)
  text = removeHorizontalRules(text);

  // 3. Remove image syntax
  if (settings.skipImageSyntax) {
    text = removeImageSyntax(text);
  }

  // 3. Remove code blocks
  if (settings.skipCodeBlocks) {
    text = removeCodeBlocks(text);
  }

  // 4. Remove LaTeX
  if (settings.skipLatex) {
    text = removeLatex(text);
  }

  // 5. Process tables (before other formatting to preserve structure)
  if (settings.smartTableReading) {
    text = processTablesInText(text);
  }

  // 6. Process wiki links
  text = processWikiLinks(text);

  // 7. Process markdown links
  text = processMarkdownLinks(text);

  // 8. Remove bare URLs
  if (settings.skipUrl) {
    text = removeBareUrls(text);
  }

  // 9. Strip formatting markers
  text = stripFormattingMarkers(text);

  // 10. Process checklists
  text = processChecklists(text);

  // 11. Process unordered list markers (PRD 6.3.3 规则 1: must run after checklists)
  text = processUnorderedListMarkers(text);

  // 12. Process heading number pauses (PRD 2.3: 二、→ 二，)
  text = processHeadingPauses(text);

  // 13. Process blockquotes
  text = processBlockquotes(text, settings.quotePrefix);

  // 14. Smart pause after closing quotes (PRD 6.3.3 规则 2)
  text = processQuotePauses(text);

  // 15. Filter emoji (do this last)
  if (settings.filterEmoji) {
    text = removeEmoji(text);
  }

  // Clean up and add paragraph pauses (PRD 6.3.3: 200ms between paragraphs)
  // Insert pause marker between paragraphs that don't end with punctuation
  text = text.replace(/([^。！？.!?，,、：:；;])\n\n+/g, "$1。\n\n");
  text = text.replace(/\n{3,}/g, "\n\n");
  text = text.trim();

  return {
    text,
    isEmpty: text.length === 0,
  };
}

/**
 * Find and process all markdown tables in text, replacing them with
 * the spoken format.
 */
function processTablesInText(text: string): string {
  const blocks = splitIntoBlocks(text);
  const result: string[] = [];

  for (const block of blocks) {
    if (isMarkdownTable(block)) {
      result.push(processTable(block));
    } else {
      result.push(block);
    }
  }

  return result.join("\n\n");
}

function splitIntoBlocks(text: string): string[] {
  return text.split(/\n\n+/);
}
