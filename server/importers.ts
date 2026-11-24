import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import { extractText } from 'unpdf';
import type { Question, QuestionOption, QuestionType } from '../src/types.ts';
import { generateId } from './store.ts';

export interface ParsedImportResult {
  questions: Question[];
  rawText: string;
  warnings: string[];
}

export async function extractRawTextFromBuffer(
  buffer: Buffer,
  filename: string
): Promise<{ text: string; isSpreadsheet: boolean }> {
  const ext = filename.toLowerCase().split('.').pop() || '';

  if (ext === 'docx') {
    const res = await mammoth.extractRawText({ buffer });
    return { text: res.value || '', isSpreadsheet: false };
  }

  if (ext === 'xlsx' || ext === 'xls') {
    return { text: '', isSpreadsheet: true };
  }

  if (ext === 'pdf') {
    const result = await extractText(new Uint8Array(buffer), { mergePages: true });
    const text = Array.isArray(result.text) ? result.text.join('\n') : String(result.text || '');
    return { text, isSpreadsheet: false };
  }

  // txt, csv, md
  return { text: buffer.toString('utf-8'), isSpreadsheet: false };
}

function normalizeHeader(h: unknown): string {
  return String(h ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function detectQuestionType(raw: string, hasOptions: boolean): QuestionType {
  const s = raw.trim().toLowerCase();
  if (
    s === 'true_false' ||
    s === 'tf' ||
    s.includes('дұрыс') ||
    s.includes('правда') ||
    s.includes('верно') ||
    s.includes('true')
  ) {
    return 'true_false';
  }
  if (
    s === 'short_answer' ||
    s === 'sa' ||
    s.includes('қысқа') ||
    s.includes('корот') ||
    s.includes('short') ||
    s.includes('жазба')
  ) {
    return 'short_answer';
  }
  if (s === 'multiple_choice' || s === 'mc' || hasOptions) {
    return 'multiple_choice';
  }
  return 'short_answer';
}

export function parseSpreadsheetBuffer(buffer: Buffer): ParsedImportResult {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) {
    return { questions: [], rawText: '', warnings: ['Excel файлында парақ табылмады.'] };
  }

  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
  const warnings: string[] = [];
  const questions: Question[] = [];
  const rawLines: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const entries = Object.entries(row).map(([k, v]) => [normalizeHeader(k), String(v ?? '').trim()] as const);
    const getCol = (...names: string[]) => {
      for (const n of names) {
        const hit = entries.find(([k]) => k === n || k.startsWith(n));
        if (hit && hit[1]) return hit[1];
      }
      return '';
    };

    const text = getCol('сұрақ', 'вопрос', 'question', 'текст', 'мәтін');
    if (!text) continue;

    const rawType = getCol('түрі', 'тип', 'type');
    const optLetters = ['a', 'b', 'c', 'd', 'e', 'f'] as const;
    const options: QuestionOption[] = [];
    for (const letter of optLetters) {
      const upper = letter.toUpperCase();
      const val = getCol(
        letter,
        `нұсқа ${letter}`,
        `вариант ${letter}`,
        `option ${letter}`,
        `${upper} нұсқасы`
      );
      if (val) {
        options.push({ id: letter, text: val });
      }
    }

    const type = detectQuestionType(rawType, options.length >= 2);
    const rawCorrect = getCol('дұрыс жауап', 'дұрыс', 'ответ', 'правильный', 'correct', 'answer');
    const rawPoints = Number(getCol('ұпай', 'балл', 'points', 'score')) || 1;
    const explanation = getCol('түсіндірме', 'пояснение', 'explanation');

    let finalOptions: QuestionOption[] | undefined = options;
    let correct: string[] = [];

    if (type === 'true_false') {
      finalOptions = [
        { id: 'true', text: 'Дұрыс' },
        { id: 'false', text: 'Қате' },
      ];
      const lc = rawCorrect.toLowerCase();
      if (['true', 't', '1', 'иә', 'дұрыс', 'да', 'верно', 'правда', 'a'].includes(lc)) {
        correct = ['true'];
      } else if (['false', 'f', '0', 'жоқ', 'қате', 'нет', 'неверно', 'ложь', 'b'].includes(lc)) {
        correct = ['false'];
      }
    } else if (type === 'multiple_choice') {
      const tokens = rawCorrect
        .split(/[,;|]+/)
        .map((t) => t.trim())
        .filter(Boolean);
      for (const tok of tokens) {
        const lower = tok.toLowerCase();
        // Match letter (A-F) or option text
        const byId = options.find((o) => o.id === lower);
        if (byId) {
          correct.push(byId.id);
        } else {
          const byText = options.find((o) => o.text.toLowerCase() === lower);
          if (byText) correct.push(byText.id);
        }
      }
      if (options.length < 2) {
        warnings.push(`${i + 2}-жолда 2-ден аз нұсқа бар.`);
      }
    } else {
      finalOptions = undefined;
      correct = rawCorrect
        .split(/[;|]+/)
        .map((t) => t.trim())
        .filter(Boolean);
    }

    questions.push({
      id: generateId('q'),
      type,
      text,
      options: finalOptions,
      correct,
      points: Math.max(0.5, Math.min(100, rawPoints)),
      explanation: explanation || undefined,
      caseSensitive: false,
      ignoreSpacesAndDashes: true,
      order: questions.length,
    });

    rawLines.push(
      `${questions.length}. ${text}${options.length ? ' | ' + options.map((o) => `${o.id.toUpperCase()}) ${o.text}`).join(' ') : ''}${rawCorrect ? ` [Жауап: ${rawCorrect}]` : ''}`
    );
  }

  return {
    questions: questions.slice(0, 200),
    rawText: rawLines.join('\n'),
    warnings,
  };
}

export function parseStructuredText(rawText: string): ParsedImportResult {
  const warnings: string[] = [];
  const normalized = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!normalized) {
    return { questions: [], rawText: '', warnings: ['Мәтін бос.'] };
  }

  // Check if CSV-like (comma or semicolon separated with header)
  const firstLine = normalized.split('\n')[0] || '';
  if (
    (firstLine.includes(',') || firstLine.includes(';')) &&
    /(сұрақ|вопрос|question)/i.test(firstLine)
  ) {
    try {
      const wb = XLSX.read(normalized, { type: 'string' });
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      const res = parseSpreadsheetBuffer(buf);
      if (res.questions.length > 0) return res;
    } catch {
      // Fallback to block parser
    }
  }

  const lines = normalized.split('\n');
  const blocks: string[][] = [];
  let current: string[] = [];

  const isQuestionStart = (line: string) =>
    /^(?:Q?\d+[\.\)]\s+|\d+\s*[-–]\s+|Сұрақ\s*\d*[:.]?\s*|Вопрос\s*\d*[:.]?\s*|Question\s*\d*[:.]?\s*)/i.test(
      line.trim()
    );

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      if (current.length > 0) {
        blocks.push(current);
        current = [];
      }
      continue;
    }
    if (isQuestionStart(line) && current.length > 0) {
      blocks.push(current);
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) blocks.push(current);

  const questions: Question[] = [];
  const optionLetters = ['a', 'b', 'c', 'd', 'e', 'f'];
  const cyrToLat: Record<string, string> = {
    а: 'a',
    в: 'b',
    б: 'b',
    с: 'c',
    д: 'd',
    е: 'e',
    ф: 'f',
  };

  for (const block of blocks) {
    if (questions.length >= 200) break;
    const textLines: string[] = [];
    const options: QuestionOption[] = [];
    const starredOptions: string[] = [];
    let answerLine = '';
    let explanation = '';
    let points = 1;

    for (let li = 0; li < block.length; li++) {
      const line = block[li];

      // Answer line
      const ansMatch = line.match(
        /^(?:Дұрыс\s*жауап|Жауабы|Жауап|Ответ|Правильный\s*ответ|Answer|Correct)\s*[:\-–]\s*(.+)$/i
      );
      if (ansMatch) {
        answerLine = ansMatch[1].trim();
        continue;
      }

      // Explanation line
      const expMatch = line.match(/^(?:Түсіндірме|Пояснение|Explanation)\s*[:\-–]\s*(.+)$/i);
      if (expMatch) {
        explanation = expMatch[1].trim();
        continue;
      }

      // Points line
      const ptsMatch = line.match(/^(?:Ұпай|Балл|Points)\s*[:\-–]\s*([0-9.]+)/i);
      if (ptsMatch) {
        points = Math.max(0.5, Math.min(100, Number(ptsMatch[1]) || 1));
        continue;
      }

      // Option line: e.g. "*A) text", "A. text", "А) text", "- text"
      const optMatch = line.match(/^(\*)?\s*([A-Fa-fА-Еа-е])[\.\)]\s+(.+)$/);
      if (optMatch && options.length < 6) {
        const isStarred = Boolean(optMatch[1]) || optMatch[3].endsWith('*');
        const rawLetter = optMatch[2].toLowerCase();
        const mappedLetter = cyrToLat[rawLetter] || rawLetter;
        const id = optionLetters.includes(mappedLetter)
          ? mappedLetter
          : optionLetters[options.length];
        const cleanOptText = optMatch[3].replace(/\*$/, '').trim();
        options.push({ id, text: cleanOptText });
        if (isStarred) starredOptions.push(id);
        continue;
      }

      // Clean leading question number on first text line
      if (li === 0) {
        const cleaned = line
          .replace(
            /^(?:Q?\d+[\.\)]\s+|\d+\s*[-–]\s+|Сұрақ\s*\d*[:.]?\s*|Вопрос\s*\d*[:.]?\s*|Question\s*\d*[:.]?\s*)/i,
            ''
          )
          .trim();
        if (cleaned) textLines.push(cleaned);
      } else {
        textLines.push(line);
      }
    }

    const qText = textLines.join(' ').trim();
    if (!qText) continue;

    let type: QuestionType = 'short_answer';
    let finalOptions: QuestionOption[] | undefined;
    let correct: string[] = [];

    if (options.length >= 2) {
      // Detect true/false if exactly 2 options like Дұрыс/Қате or True/False
      const o0 = options[0].text.toLowerCase();
      const o1 = options[1].text.toLowerCase();
      const isTF =
        options.length === 2 &&
        ((o0.includes('дұрыс') && o1.includes('қате')) ||
          (o0.includes('true') && o1.includes('false')) ||
          (o0.includes('верно') && o1.includes('неверно')) ||
          (o0.includes('правда') && o1.includes('ложь')));

      if (isTF) {
        type = 'true_false';
        finalOptions = [
          { id: 'true', text: 'Дұрыс' },
          { id: 'false', text: 'Қате' },
        ];
        if (starredOptions.includes(options[0].id)) correct = ['true'];
        else if (starredOptions.includes(options[1].id)) correct = ['false'];
        else if (answerLine) {
          const lc = answerLine.toLowerCase();
          if (['a', 'а', 'true', 'дұрыс', 'иә', 'верно', 'да', '1'].includes(lc)) correct = ['true'];
          else if (['b', 'б', 'в', 'false', 'қате', 'жоқ', 'неверно', 'нет', '0'].includes(lc))
            correct = ['false'];
        }
      } else {
        type = 'multiple_choice';
        finalOptions = options;
        if (starredOptions.length > 0) {
          correct = [...new Set(starredOptions)];
        } else if (answerLine) {
          const toks = answerLine
            .split(/[,;|]+/)
            .map((t) => t.trim())
            .filter(Boolean);
          for (const tok of toks) {
            const lc = tok.toLowerCase().replace(/[\.\)]$/, '');
            const mapped = cyrToLat[lc] || lc;
            const byId = options.find((o) => o.id === mapped);
            if (byId) correct.push(byId.id);
            else {
              const byText = options.find((o) => o.text.toLowerCase() === tok.toLowerCase());
              if (byText) correct.push(byText.id);
            }
          }
        }
      }
    } else {
      const lcAns = answerLine.toLowerCase();
      if (['дұрыс', 'қате', 'true', 'false', 'верно', 'неверно'].includes(lcAns)) {
        type = 'true_false';
        finalOptions = [
          { id: 'true', text: 'Дұрыс' },
          { id: 'false', text: 'Қате' },
        ];
        correct = ['дұрыс', 'true', 'верно'].includes(lcAns) ? ['true'] : ['false'];
      } else {
        type = 'short_answer';
        if (answerLine) {
          correct = answerLine
            .split(/[;|]+/)
            .map((t) => t.trim())
            .filter(Boolean);
        }
      }
    }

    questions.push({
      id: generateId('q'),
      type,
      text: qText,
      options: finalOptions,
      correct,
      points,
      explanation: explanation || undefined,
      caseSensitive: false,
      ignoreSpacesAndDashes: true,
      order: questions.length,
    });
  }

  if (questions.length === 0) {
    warnings.push('Құрылымдық парсер сұрақтарды анықтай алмады. Нөмірлеуді (1., A), B), Жауабы: A) тексеріңіз немесе AI тануды қолданыңыз.');
  }

  return { questions, rawText: normalized, warnings };
}

export function buildExcelTemplateBuffer(): Buffer {
  const rows = [
    {
      'Сұрақ': 'Квадрат теңдеудің түбірлерін табыңыз: $x^2 - 9 = 0$',
      'Түрі': 'multiple_choice',
      A: '$x = \\pm 3$',
      B: '$x = 9$',
      C: '$x = 3$',
      D: '$x = -9$',
      E: '',
      F: '',
      'Дұрыс жауап': 'A',
      'Ұпай': 1,
      'Түсіндірме': '$x^2 = 9 \\Rightarrow x = 3$ немесе $x = -3$.',
    },
    {
      'Сұрақ': 'Су $100^\\circ C$ температурада қайнайды (қалыпты қысымда).',
      'Түрі': 'true_false',
      A: '',
      B: '',
      C: '',
      D: '',
      E: '',
      F: '',
      'Дұрыс жауап': 'Дұрыс',
      'Ұпай': 1,
      'Түсіндірме': 'Қалыпты атмосфералық қысымда таза су 100°C-та қайнайды.',
    },
    {
      'Сұрақ': 'Қазақстанның ең биік нүктесі (шыңы) қалай аталады?',
      'Түрі': 'short_answer',
      A: '',
      B: '',
      C: '',
      D: '',
      E: '',
      F: '',
      'Дұрыс жауап': 'Хан Тәңірі; Хан-Тәңірі',
      'Ұпай': 2,
      'Түсіндірме': 'Хан Тәңірі шыңының биіктігі 6995 м.',
    },
  ];

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [
    { wch: 46 },
    { wch: 16 },
    { wch: 18 },
    { wch: 18 },
    { wch: 18 },
    { wch: 18 },
    { wch: 12 },
    { wch: 12 },
    { wch: 18 },
    { wch: 8 },
    { wch: 36 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, 'Сұрақтар');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
