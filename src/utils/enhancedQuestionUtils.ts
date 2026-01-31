interface MarkdownCell {
  cellIndex: number;
  text: string;
}

export function enhanceQuestion(
  text: string,
  nearestMarkdown: MarkdownCell | null
): string {
  if (!nearestMarkdown?.text) {
    return text;
  }

  const questionMatch = nearestMarkdown.text.match(
    /(?:Question|Q)\s*(\d+\.\d+\.\d+)/i
  );

  if (questionMatch) {
    const questionId = questionMatch[0];
    return `[Working on ${questionId}] ${text}`;
  }

  const contextPreview = nearestMarkdown.text
    .substring(0, 150)
    .replace(/\n/g, ' ');
  return `[Context: ${contextPreview}...] ${text}`;
}
