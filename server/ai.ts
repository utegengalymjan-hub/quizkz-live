import { GoogleGenAI, Type } from '@google/genai';
import type { Locale, Question, SessionReportSummary } from '../src/types.ts';
import { generateId } from './store.ts';

const GEMINI_MODEL = 'gemini-4-hydrogen';

export function isAiAvailable(): boolean {
  return Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim().length > 0);
}

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY орнатылмаған. AI функциялары өшірулі.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function langName(locale: Locale): string {
  if (locale === 'ru') return 'Russian (орыс тілі)';
  if (locale === 'en') return 'English';
  return 'Kazakh (қазақ тілі)';
}

const QUESTIONS_SCHEMA = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      type: {
        type: Type.STRING,
        description: 'One of: multiple_choice, true_false, short_answer',
      },
      text: {
        type: Type.STRING,
        description: 'Question prompt. Use KaTeX $...$ for math formulas.',
      },
      options: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.STRING },
            text: { type: Type.STRING },
          },
          required: ['id', 'text'],
        },
        description: '2-6 options for multiple_choice (ids a,b,c,d,e,f), or true/false for true_false.',
      },
      correct: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: 'List of correct option ids (a..f or true/false) or accepted short_answer strings.',
      },
      points: { type: Type.NUMBER },
      explanation: { type: Type.STRING },
    },
    required: ['type', 'text', 'correct'],
  },
};

function sanitizeAiQuestions(raw: unknown): Question[] {
  if (!Array.isArray(raw)) return [];
  const validLetters = ['a', 'b', 'c', 'd', 'e', 'f'];
  const result: Question[] = [];

  for (const item of raw.slice(0, 100)) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const text = String(obj.text ?? '').trim();
    if (!text) continue;

    const rawType = String(obj.type ?? 'multiple_choice');
    const type: Question['type'] =
      rawType === 'true_false' || rawType === 'short_answer' ? rawType : 'multiple_choice';

    let options: Question['options'];
    let correct: string[] = Array.isArray(obj.correct)
      ? obj.correct.map((c) => String(c).trim()).filter(Boolean)
      : [];

    if (type === 'true_false') {
      options = [
        { id: 'true', text: 'Дұрыс' },
        { id: 'false', text: 'Қате' },
      ];
      correct = correct.map((c) =>
        ['true', '1', 'дұрыс', 'иә', 'верно'].includes(c.toLowerCase()) ? 'true' : 'false'
      );
      if (correct.length === 0) correct = ['true'];
    } else if (type === 'multiple_choice') {
      const rawOpts = Array.isArray(obj.options) ? obj.options : [];
      options = rawOpts
        .slice(0, 6)
        .map((o, idx) => {
          const rec = (o && typeof o === 'object' ? o : {}) as Record<string, unknown>;
          return {
            id: validLetters[idx],
            text: String(rec.text ?? '').trim() || `Нұсқа ${validLetters[idx].toUpperCase()}`,
          };
        });
      if (options.length < 2) {
        options = [
          { id: 'a', text: 'Нұсқа A' },
          { id: 'b', text: 'Нұсқа B' },
        ];
      }
      const validIds = new Set(options.map((o) => o.id));
      correct = correct
        .map((c) => c.toLowerCase())
        .filter((c) => validIds.has(c));
    } else {
      options = undefined;
    }

    result.push({
      id: generateId('q'),
      type,
      text,
      options,
      correct,
      points: Math.max(0.5, Math.min(100, Number(obj.points) || 1)),
      explanation: obj.explanation ? String(obj.explanation).trim() : undefined,
      caseSensitive: false,
      ignoreSpacesAndDashes: true,
      order: result.length,
    });
  }
  return result;
}

export async function parseQuestionsWithAi(rawText: string, language: Locale): Promise<Question[]> {
  const ai = getAiClient();
  const clipped = rawText.slice(0, 40_000);
  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: `Extract all quiz questions from the following educational document. Preserve original language (preferred ${langName(language)}). Convert math expressions to KaTeX ($...$). For multiple_choice, use option ids a, b, c, d, e, f. For true_false, use correct ["true"] or ["false"]. If an answer key is missing for a question, leave correct as an empty array [].\n\nDOCUMENT:\n${clipped}`,
    config: {
      systemInstruction:
        'You are an accurate school quiz parser. Output only valid JSON matching the schema.',
      responseMimeType: 'application/json',
      responseSchema: QUESTIONS_SCHEMA,
    },
  });

  const parsed = JSON.parse((response.text ?? '[]').trim());
  return sanitizeAiQuestions(parsed);
}

export async function generateQuestionsWithAi(params: {
  topic: string;
  grade: string;
  count: number;
  difficulty: 'easy' | 'medium' | 'hard';
  language: Locale;
}): Promise<Question[]> {
  const ai = getAiClient();
  const count = Math.min(25, Math.max(1, params.count));
  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: `Generate ${count} school quiz questions in ${langName(params.language)}.
Topic: ${params.topic}
Grade/Level: ${params.grade}
Difficulty: ${params.difficulty}
Include a mix of multiple_choice (4 options a-d), true_false, and short_answer questions. Include clear explanations and use KaTeX ($...$) for any math or science formulas.`,
    config: {
      systemInstruction:
        'You are an experienced school teacher creating accurate, curriculum-aligned quiz questions. Return valid JSON matching the schema.',
      responseMimeType: 'application/json',
      responseSchema: QUESTIONS_SCHEMA,
    },
  });

  const parsed = JSON.parse((response.text ?? '[]').trim());
  return sanitizeAiQuestions(parsed);
}

export async function refineQuestionWithAi(params: {
  question: Question;
  action: 'harder' | 'easier' | 'add_options' | 'write_explanation';
  language: Locale;
}): Promise<Partial<Question>> {
  const ai = getAiClient();
  const actionMap = {
    harder: 'Make this question more challenging while staying clear and fair for students.',
    easier: 'Simplify this question and its language so struggling students can understand it.',
    add_options: 'Improve or add plausible distractor options (total 4 options a-d) keeping the correct answer accurate.',
    write_explanation: 'Write a concise, pedagogical explanation for why the correct answer is right.',
  };

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: `${actionMap[params.action]}
Respond in ${langName(params.language)}.
Current question JSON:
${JSON.stringify({
  type: params.question.type,
  text: params.question.text,
  options: params.question.options,
  correct: params.question.correct,
  explanation: params.question.explanation,
})}`,
    config: {
      systemInstruction: 'You are a helpful school assessment assistant. Return a single refined question object as JSON.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          text: { type: Type.STRING },
          options: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                text: { type: Type.STRING },
              },
              required: ['id', 'text'],
            },
          },
          correct: { type: Type.ARRAY, items: { type: Type.STRING } },
          explanation: { type: Type.STRING },
        },
        required: ['text'],
      },
    },
  });

  const parsed = JSON.parse((response.text ?? '{}').trim()) as Record<string, unknown>;
  const out: Partial<Question> = {};
  if (typeof parsed.text === 'string' && parsed.text.trim()) out.text = parsed.text.trim();
  if (typeof parsed.explanation === 'string') out.explanation = parsed.explanation.trim();
  if (Array.isArray(parsed.options) && params.question.type === 'multiple_choice') {
    const letters = ['a', 'b', 'c', 'd', 'e', 'f'];
    out.options = parsed.options.slice(0, 6).map((o: unknown, i: number) => {
      const rec = (o && typeof o === 'object' ? o : {}) as Record<string, unknown>;
      return { id: letters[i], text: String(rec.text ?? '').trim() };
    });
  }
  if (Array.isArray(parsed.correct) && parsed.correct.length > 0) {
    out.correct = parsed.correct.map((c: unknown) => String(c).trim());
  }
  return out;
}

export async function analyzeSessionReportWithAi(
  report: SessionReportSummary,
  language: Locale
): Promise<string> {
  const ai = getAiClient();
  const compact = {
    title: report.title,
    studentCount: report.studentCount,
    averagePercent: report.averagePercent,
    medianPercent: report.medianPercent,
    questions: report.questionStats.map((q) => ({
      order: q.order + 1,
      text: q.text.slice(0, 180),
      accuracyPercent: q.accuracyPercent,
      answeredCount: q.answeredCount,
    })),
  };

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: `Analyze this classroom quiz session report and write a short, practical summary for the teacher in ${langName(language)} (max 200 words). Highlight: 1) overall mastery, 2) weakest topics/questions that need review, 3) concrete next-lesson recommendations.\n\nREPORT DATA:\n${JSON.stringify(compact)}`,
    config: {
      systemInstruction:
        'You are an instructional coach helping a school teacher interpret class quiz results concisely without fluff.',
    },
  });

  return (response.text ?? '').trim();
}
