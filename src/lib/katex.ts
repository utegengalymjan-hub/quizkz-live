import katex from 'katex';

export interface TextToken {
  kind: 'text' | 'bold' | 'italic' | 'math_inline' | 'math_block';
  content: string;
}

export function tokenizeRichLine(input: string): TextToken[] {
  const tokens: TextToken[] = [];
  // Matches $$...$$, $...$, **...**, *...*
  const regex = /(\$\$[\s\S]+?\$\$|\$(?:\\.|[^$\n])+?\$|\*\*[^*\n]+?\*\*|\*[^*\n]+?\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(input)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ kind: 'text', content: input.slice(lastIndex, match.index) });
    }
    const raw = match[0];
    if (raw.startsWith('$$') && raw.endsWith('$$')) {
      tokens.push({ kind: 'math_block', content: raw.slice(2, -2).trim() });
    } else if (raw.startsWith('$') && raw.endsWith('$')) {
      tokens.push({ kind: 'math_inline', content: raw.slice(1, -1).trim() });
    } else if (raw.startsWith('**') && raw.endsWith('**')) {
      tokens.push({ kind: 'bold', content: raw.slice(2, -2) });
    } else if (raw.startsWith('*') && raw.endsWith('*')) {
      tokens.push({ kind: 'italic', content: raw.slice(1, -1) });
    }
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < input.length) {
    tokens.push({ kind: 'text', content: input.slice(lastIndex) });
  }
  return tokens;
}

export function renderLatexToHtml(expr: string, displayMode: boolean): string {
  try {
    return katex.renderToString(expr, {
      displayMode,
      throwOnError: false,
      strict: false,
      trust: false, // Prevents any unsafe HTML/href commands in KaTeX
      maxExpand: 200,
    });
  } catch {
    return expr;
  }
}
