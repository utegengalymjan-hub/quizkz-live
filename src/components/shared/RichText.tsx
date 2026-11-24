import React from 'react';
import { renderLatexToHtml, tokenizeRichLine } from '../../lib/katex.ts';

interface RichTextProps {
  text: string;
  className?: string;
}

export const RichText: React.FC<RichTextProps> = ({ text, className = '' }) => {
  if (!text) return null;
  const lines = text.split('\n');

  const renderInline = (line: string, lineIdx: number) => {
    const tokens = tokenizeRichLine(line);
    return tokens.map((tok, i) => {
      const key = `${lineIdx}-${i}`;
      if (tok.kind === 'math_block') {
        return (
          <span
            key={key}
            className="block my-2 overflow-x-auto"
            dangerouslySetInnerHTML={{ __html: renderLatexToHtml(tok.content, true) }}
          />
        );
      }
      if (tok.kind === 'math_inline') {
        return (
          <span
            key={key}
            className="inline-block align-middle mx-0.5"
            dangerouslySetInnerHTML={{ __html: renderLatexToHtml(tok.content, false) }}
          />
        );
      }
      if (tok.kind === 'bold') {
        return (
          <strong key={key} className="font-semibold">
            {tok.content}
          </strong>
        );
      }
      if (tok.kind === 'italic') {
        return (
          <em key={key} className="italic">
            {tok.content}
          </em>
        );
      }
      return <React.Fragment key={key}>{tok.content}</React.Fragment>;
    });
  };

  // Group bullet lines (- or •) into lists
  const elements: React.ReactNode[] = [];
  let listBuffer: { idx: number; content: string }[] = [];

  const flushList = () => {
    if (listBuffer.length === 0) return;
    elements.push(
      <ul key={`ul-${listBuffer[0].idx}`} className="list-disc pl-5 my-1 space-y-0.5">
        {listBuffer.map((item) => (
          <li key={item.idx}>{renderInline(item.content, item.idx)}</li>
        ))}
      </ul>
    );
    listBuffer = [];
  };

  lines.forEach((line, idx) => {
    const bulletMatch = line.match(/^\s*[-•]\s+(.+)$/);
    if (bulletMatch) {
      listBuffer.push({ idx, content: bulletMatch[1] });
    } else {
      flushList();
      if (line.trim() === '') {
        if (idx > 0 && idx < lines.length - 1) {
          elements.push(<div key={`sp-${idx}`} className="h-2" />);
        }
      } else {
        elements.push(
          <span key={`ln-${idx}`} className={lines.length > 1 ? 'block' : 'inline'}>
            {renderInline(line, idx)}
          </span>
        );
      }
    }
  });
  flushList();

  return <span className={`break-words ${className}`}>{elements}</span>;
};
