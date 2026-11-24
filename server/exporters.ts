import * as XLSX from 'xlsx';
import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import type { Quiz, Session } from '../src/types.ts';
import { buildSessionReport, getEffectiveAnswerScore } from './scoring.ts';

function formatOptionLabel(question: Quiz['questions'][number], values: string[]): string {
  if (!values || values.length === 0) return '—';
  if (question.type === 'short_answer') return values.join(', ');
  if (question.type === 'true_false') {
    return values.map((v) => (v === 'true' ? 'Дұрыс' : v === 'false' ? 'Қате' : v)).join(', ');
  }
  return values
    .map((id) => {
      const opt = question.options?.find((o) => o.id === id);
      return opt ? `${id.toUpperCase()}) ${opt.text}` : id.toUpperCase();
    })
    .join('; ');
}

export function exportSessionToExcelBuffer(session: Session): Buffer {
  const report = buildSessionReport(session);
  const questions = [...session.quizSnapshot.questions].sort((a, b) => a.order - b.order);
  const wb = XLSX.utils.book_new();

  // Sheet 1: Жиынтық (Summary)
  const summaryRows = [
    { 'Көрсеткіш': 'Сессия атауы', 'Мәні': report.title },
    { 'Көрсеткіш': 'Түрі', 'Мәні': report.kind },
    { 'Көрсеткіш': 'Бөлме', 'Мәні': report.roomName },
    { 'Көрсеткіш': 'Басталған уақыты', 'Мәні': new Date(report.startedAt).toLocaleString('kk-KZ') },
    {
      'Көрсеткіш': 'Аяқталған уақыты',
      'Мәні': report.endedAt ? new Date(report.endedAt).toLocaleString('kk-KZ') : 'Белсенді',
    },
    { 'Көрсеткіш': 'Қатысқан оқушылар', 'Мәні': report.studentCount },
    { 'Көрсеткіш': 'Аяқтаған оқушылар', 'Мәні': report.finishedCount },
    { 'Көрсеткіш': 'Ең жоғары балл', 'Мәні': report.totalPointsPossible },
    { 'Көрсеткіш': 'Орташа балл', 'Мәні': report.averageScore },
    { 'Көрсеткіш': 'Орташа пайыз (%)', 'Мәні': report.averagePercent },
    { 'Көрсеткіш': 'Медиана (%)', 'Мәні': report.medianPercent },
    { 'Көрсеткіш': 'Орташа уақыт (сек)', 'Мәні': Math.round(report.averageTimeMs / 1000) },
    { 'Көрсеткіш': 'Қолмен тексеруді күтуде', 'Мәні': report.pendingManualCount },
  ];
  const wsSummary = XLSX.utils.json_to_sheet(summaryRows);
  wsSummary['!cols'] = [{ wch: 28 }, { wch: 42 }];
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Жиынтық');

  // Sheet 2: Оқушылар (Students)
  const studentRows = report.studentStats.map((st, idx) => ({
    '№': idx + 1,
    'Аты-жөні': st.displayName,
    'Оқушы ID': st.studentCode || '',
    'Жауап бергені': `${st.answeredCount}/${questions.length}`,
    'Дұрыс': st.correctCount,
    'Тексеруде': st.pendingCount,
    'Балл': st.earnedPoints,
    'Макс. балл': st.totalPointsPossible,
    'Пайыз (%)': st.percent,
    'Уақыты (сек)': Math.round(st.totalTimeMs / 1000),
    'Ескертулер (прокторинг)': st.violationCount,
    'Прокторинг жапты': st.autoClosedByProctoring ? 'Иә' : 'Жоқ',
  }));
  const wsStudents = XLSX.utils.json_to_sheet(
    studentRows.length ? studentRows : [{ 'Хабарлама': 'Оқушылар жоқ' }]
  );
  wsStudents['!cols'] = [
    { wch: 5 },
    { wch: 24 },
    { wch: 14 },
    { wch: 14 },
    { wch: 8 },
    { wch: 10 },
    { wch: 8 },
    { wch: 10 },
    { wch: 12 },
    { wch: 13 },
    { wch: 22 },
    { wch: 16 },
  ];
  XLSX.utils.book_append_sheet(wb, wsStudents, 'Оқушылар');

  // Sheet 3: Сұрақтар (Questions)
  const questionRows = report.questionStats.map((q, idx) => ({
    '№': idx + 1,
    'Сұрақ': q.text,
    'Түрі': q.type,
    'Ұпай': q.points,
    'Жауап саны': q.answeredCount,
    'Дұрыс': q.correctCount,
    'Қате': q.incorrectCount,
    'Қолмен тексеру': q.pendingCount,
    'Дәлдік (%)': q.accuracyPercent,
    'Орташа уақыт (сек)': Math.round(q.averageTimeMs / 1000),
  }));
  const wsQuestions = XLSX.utils.json_to_sheet(
    questionRows.length ? questionRows : [{ 'Хабарлама': 'Сұрақтар жоқ' }]
  );
  wsQuestions['!cols'] = [
    { wch: 5 },
    { wch: 48 },
    { wch: 16 },
    { wch: 8 },
    { wch: 12 },
    { wch: 8 },
    { wch: 8 },
    { wch: 15 },
    { wch: 12 },
    { wch: 18 },
  ];
  XLSX.utils.book_append_sheet(wb, wsQuestions, 'Сұрақтар');

  // Sheet 4: Толық жауаптар (Detailed Answers Matrix)
  const detailRows: Record<string, unknown>[] = [];
  for (const st of report.studentStats) {
    for (let qi = 0; qi < questions.length; qi++) {
      const q = questions[qi];
      const ans = st.answersByQuestion[q.id];
      const eff = ans ? getEffectiveAnswerScore(ans) : null;
      detailRows.push({
        'Оқушы': st.displayName,
        'Оқушы ID': st.studentCode || '',
        'Сұрақ №': qi + 1,
        'Сұрақ мәтіні': q.text,
        'Оқушы жауабы': ans ? formatOptionLabel(q, ans.value) : '—',
        'Дұрыс жауап': formatOptionLabel(q, q.correct),
        'Күйі': !ans
          ? 'Жауап жоқ'
          : eff?.isCorrect === true
          ? 'Дұрыс'
          : eff?.isCorrect === false
          ? 'Қате'
          : 'Қолмен тексеру',
        'Балл': eff ? eff.points : 0,
        'Уақыты (сек)': ans ? Math.round((ans.timeSpentMs || 0) / 1000) : 0,
      });
    }
  }
  const wsDetail = XLSX.utils.json_to_sheet(
    detailRows.length ? detailRows : [{ 'Хабарлама': 'Жауаптар жоқ' }]
  );
  wsDetail['!cols'] = [
    { wch: 22 },
    { wch: 12 },
    { wch: 9 },
    { wch: 42 },
    { wch: 26 },
    { wch: 26 },
    { wch: 16 },
    { wch: 8 },
    { wch: 14 },
  ];
  XLSX.utils.book_append_sheet(wb, wsDetail, 'Толық жауаптар');

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

function csvEscape(v: unknown): string {
  const s = String(v ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function exportSessionToCsv(session: Session): string {
  const report = buildSessionReport(session);
  const questions = [...session.quizSnapshot.questions].sort((a, b) => a.order - b.order);

  const headers = [
    'Аты-жөні',
    'Оқушы ID',
    'Балл',
    'Макс. балл',
    'Пайыз (%)',
    'Ескертулер',
    ...questions.map((_, i) => `Сұрақ ${i + 1}`),
  ];

  const lines = [headers.map(csvEscape).join(',')];
  for (const st of report.studentStats) {
    const row = [
      st.displayName,
      st.studentCode || '',
      st.earnedPoints,
      st.totalPointsPossible,
      st.percent,
      st.violationCount,
      ...questions.map((q) => {
        const ans = st.answersByQuestion[q.id];
        return ans ? formatOptionLabel(q, ans.value) : '';
      }),
    ];
    lines.push(row.map(csvEscape).join(','));
  }
  return '\uFEFF' + lines.join('\r\n');
}

export async function exportQuizToDocxBuffer(quiz: Quiz, includeKey: boolean): Promise<Buffer> {
  const questions = [...quiz.questions].sort((a, b) => a.order - b.order);
  const children: Paragraph[] = [
    new Paragraph({
      text: quiz.title,
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 120 },
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: includeKey
            ? `QuizKZ Live · Мұғалім нұсқасы (жауап кілтімен) · Сұрақ саны: ${questions.length}`
            : `QuizKZ Live · Оқушы нұсқасы · Аты-жөні: ___________________________   Күні: ______________`,
          italics: true,
          color: '475569',
          size: 20,
        }),
      ],
      spacing: { after: 260 },
    }),
  ];

  questions.forEach((q, idx) => {
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `${idx + 1}. ${q.text} `,
            bold: true,
            size: 23,
          }),
          new TextRun({
            text: `(${q.points} ұпай)`,
            color: '64748B',
            size: 20,
          }),
        ],
        spacing: { before: 180, after: 80 },
      })
    );

    if (q.type === 'multiple_choice' && q.options) {
      for (const opt of q.options) {
        const isCorrect = includeKey && q.correct.includes(opt.id);
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: `   ${opt.id.toUpperCase()}) ${opt.text}${isCorrect ? '  ✓' : ''}`,
                bold: isCorrect,
                color: isCorrect ? '059669' : '0F172A',
                size: 21,
              }),
            ],
            spacing: { after: 50 },
          })
        );
      }
    } else if (q.type === 'true_false') {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: includeKey
                ? `   Нұсқалар: Дұрыс / Қате  —  Дұрыс жауап: ${q.correct.includes('true') ? 'Дұрыс ✓' : 'Қате ✓'}`
                : '   [  ] Дұрыс     [  ] Қате',
              color: includeKey ? '059669' : '0F172A',
              bold: includeKey,
              size: 21,
            }),
          ],
          spacing: { after: 60 },
        })
      );
    } else {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: includeKey
                ? `   Қабылданатын жауап: ${q.correct.length ? q.correct.join(' / ') : '(қолмен бағаланады)'}`
                : '   Жауап: __________________________________________________________',
              color: includeKey ? '059669' : '475569',
              bold: includeKey,
              size: 21,
            }),
          ],
          spacing: { after: 60 },
        })
      );
    }

    if (includeKey && q.explanation) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `   Түсіндірме: ${q.explanation}`,
              italics: true,
              color: '475569',
              size: 20,
            }),
          ],
          spacing: { after: 90 },
        })
      );
    }
  });

  const doc = new Document({
    sections: [{ properties: {}, children }],
  });
  return Packer.toBuffer(doc);
}

export async function exportSessionToDocxBuffer(session: Session): Promise<Buffer> {
  const report = buildSessionReport(session);

  const tableRows: TableRow[] = [
    new TableRow({
      children: ['№', 'Оқушы', 'Балл', 'Пайыз', 'Ескерту'].map(
        (h) =>
          new TableCell({
            children: [
              new Paragraph({
                children: [new TextRun({ text: h, bold: true, size: 20 })],
              }),
            ],
          })
      ),
    }),
    ...report.studentStats.map(
      (st, idx) =>
        new TableRow({
          children: [
            String(idx + 1),
            st.displayName,
            `${st.earnedPoints} / ${st.totalPointsPossible}`,
            `${st.percent}%`,
            String(st.violationCount),
          ].map(
            (val) =>
              new TableCell({
                children: [new Paragraph({ children: [new TextRun({ text: val, size: 20 })] })],
              })
          ),
        })
    ),
  ];

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({
            text: `Сессия есебі: ${report.title}`,
            heading: HeadingLevel.HEADING_1,
            spacing: { after: 120 },
          }),
          new Paragraph({
            children: [
              new TextRun({
                text: `Бөлме: ${report.roomName} · Күні: ${new Date(report.startedAt).toLocaleString('kk-KZ')} · Оқушылар: ${report.studentCount} · Орташа: ${report.averagePercent}% · Медиана: ${report.medianPercent}%`,
                size: 21,
                color: '334155',
              }),
            ],
            spacing: { after: 220 },
          }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: tableRows,
          }),
        ],
      },
    ],
  });

  return Packer.toBuffer(doc);
}
