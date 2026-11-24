import type {
  Answer,
  MultiCorrectMode,
  Question,
  QuestionReportStat,
  Session,
  SessionReportSummary,
  StudentReportStat,
} from '../src/types.ts';

export function normalizeShortAnswer(
  raw: string,
  opts?: { caseSensitive?: boolean; ignoreSpacesAndDashes?: boolean }
): string {
  let s = raw.normalize('NFC').trim();
  // Normalize whitespace
  s = s.replace(/\s+/g, ' ');
  // Normalize ё -> е and Ё -> Е for Cyrillic consistency
  s = s.replace(/ё/g, 'е').replace(/Ё/g, 'Е');
  if (!opts?.caseSensitive) {
    s = s.toLocaleLowerCase('kk');
  }
  if (opts?.ignoreSpacesAndDashes) {
    s = s.replace(/[\s\-–—_]+/g, '');
  }
  return s;
}

export function evaluateAnswer(
  question: Question,
  submittedValues: string[],
  sessionMultiMode?: MultiCorrectMode
): { isCorrect: boolean | null; points: number } {
  const maxPoints = typeof question.points === 'number' && question.points >= 0 ? question.points : 1;
  const cleaned = submittedValues.map((v) => String(v ?? '').trim()).filter(Boolean);

  if (question.type === 'true_false' || question.type === 'multiple_choice') {
    const correctSet = new Set(question.correct.map((c) => c.trim()));
    if (correctSet.size === 0) {
      return { isCorrect: null, points: 0 };
    }
    const chosenSet = new Set(cleaned);
    if (chosenSet.size === 0) {
      return { isCorrect: false, points: 0 };
    }

    const exactMatch =
      chosenSet.size === correctSet.size &&
      [...chosenSet].every((c) => correctSet.has(c));

    if (exactMatch) {
      return { isCorrect: true, points: maxPoints };
    }

    const mode: MultiCorrectMode =
      question.multiCorrectMode || sessionMultiMode || 'all_or_nothing';

    if (correctSet.size > 1 && mode === 'partial') {
      let right = 0;
      let wrong = 0;
      for (const c of chosenSet) {
        if (correctSet.has(c)) right++;
        else wrong++;
      }
      const fraction = Math.max(0, (right - wrong) / correctSet.size);
      const earned = Math.round(fraction * maxPoints * 100) / 100;
      return {
        isCorrect: earned >= maxPoints,
        points: earned,
      };
    }

    return { isCorrect: false, points: 0 };
  }

  // short_answer
  const userText = cleaned[0] || '';
  if (!userText) {
    return { isCorrect: false, points: 0 };
  }
  if (!question.correct || question.correct.length === 0) {
    // Open-ended short answer -> requires manual grading
    return { isCorrect: null, points: 0 };
  }

  const normUser = normalizeShortAnswer(userText, {
    caseSensitive: question.caseSensitive,
    ignoreSpacesAndDashes: question.ignoreSpacesAndDashes,
  });

  const matched = question.correct.some(
    (acc) =>
      normalizeShortAnswer(acc, {
        caseSensitive: question.caseSensitive,
        ignoreSpacesAndDashes: question.ignoreSpacesAndDashes,
      }) === normUser
  );

  if (matched) {
    return { isCorrect: true, points: maxPoints };
  }

  // Non-matching short answer goes to manual grading queue so teacher can verify synonyms/typos
  return { isCorrect: null, points: 0 };
}

export function getEffectiveAnswerScore(answer: Answer): {
  points: number;
  isCorrect: boolean | null;
} {
  if (answer.manualGrade) {
    return {
      points: answer.manualGrade.points,
      isCorrect: answer.manualGrade.isCorrect,
    };
  }
  return {
    points: answer.points,
    isCorrect: answer.isCorrect,
  };
}

export function regradeSessionAnswers(session: Session): void {
  const qMap = new Map(session.quizSnapshot.questions.map((q) => [q.id, q]));
  for (const ans of session.answers) {
    if (ans.manualGrade) {
      // Teacher manual grade always takes precedence and is never overwritten
      ans.points = ans.manualGrade.points;
      ans.isCorrect = ans.manualGrade.isCorrect;
      continue;
    }
    const q = qMap.get(ans.questionId);
    if (!q) continue;
    const res = evaluateAnswer(q, ans.value, session.settings.multiCorrectMode);
    ans.isCorrect = res.isCorrect;
    ans.points = res.points;
  }
  recalculateTeamScores(session);
}

export function recalculateTeamScores(session: Session): void {
  if (!session.teams || session.teams.length === 0) return;
  const studentTeamMap = new Map<string, string>();
  const teamMemberCount = new Map<string, number>();

  for (const st of session.students) {
    if (st.teamId && !st.kicked) {
      studentTeamMap.set(st.id, st.teamId);
      teamMemberCount.set(st.teamId, (teamMemberCount.get(st.teamId) || 0) + 1);
    }
  }

  const totalQuestions = Math.max(1, session.quizSnapshot.questions.length);
  const teamRawCorrect = new Map<string, number>();

  for (const ans of session.answers) {
    const teamId = studentTeamMap.get(ans.studentId);
    if (!teamId) continue;
    const eff = getEffectiveAnswerScore(ans);
    if (eff.isCorrect === true) {
      teamRawCorrect.set(teamId, (teamRawCorrect.get(teamId) || 0) + Math.max(1, eff.points));
    } else if (eff.points > 0) {
      teamRawCorrect.set(teamId, (teamRawCorrect.get(teamId) || 0) + eff.points);
    }
  }

  const maxPointsPerStudent = Math.max(
    1,
    session.quizSnapshot.questions.reduce((acc, q) => acc + Math.max(1, q.points || 1), 0)
  );

  for (const team of session.teams) {
    const score = Math.round((teamRawCorrect.get(team.id) || 0) * 100) / 100;
    const members = Math.max(1, teamMemberCount.get(team.id) || 1);
    const target = members * maxPointsPerStudent;
    team.score = score;
    team.progress = Math.min(100, Math.round((score / Math.max(target, totalQuestions)) * 100));
  }
}

export function computeMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 10) / 10;
  }
  return Math.round(sorted[mid] * 10) / 10;
}

export function buildSessionReport(session: Session): SessionReportSummary {
  const questions = [...session.quizSnapshot.questions].sort((a, b) => a.order - b.order);
  const totalPointsPossible = questions.reduce((acc, q) => acc + (q.points ?? 1), 0);

  const answersByStudent = new Map<string, Map<string, Answer>>();
  for (const ans of session.answers) {
    let map = answersByStudent.get(ans.studentId);
    if (!map) {
      map = new Map();
      answersByStudent.set(ans.studentId, map);
    }
    map.set(ans.questionId, ans);
  }

  const studentStats: StudentReportStat[] = session.students
    .filter((s) => !s.kicked)
    .map((st) => {
      const stAnswers = answersByStudent.get(st.id) || new Map<string, Answer>();
      let answeredCount = 0;
      let correctCount = 0;
      let pendingCount = 0;
      let earnedPoints = 0;
      let totalTimeMs = 0;
      const answersObj: Record<string, Answer> = {};

      for (const q of questions) {
        const ans = stAnswers.get(q.id);
        if (!ans) continue;
        answeredCount++;
        answersObj[q.id] = ans;
        totalTimeMs += ans.timeSpentMs || 0;
        const eff = getEffectiveAnswerScore(ans);
        earnedPoints += eff.points;
        if (eff.isCorrect === true) correctCount++;
        else if (eff.isCorrect === null) pendingCount++;
      }

      earnedPoints = Math.round(earnedPoints * 100) / 100;
      const percent =
        totalPointsPossible > 0
          ? Math.round((earnedPoints / totalPointsPossible) * 1000) / 10
          : 0;

      return {
        studentId: st.id,
        displayName: st.displayName,
        studentCode: st.studentCode,
        teamId: st.teamId,
        answeredCount,
        correctCount,
        pendingCount,
        earnedPoints,
        totalPointsPossible,
        percent,
        totalTimeMs,
        violationCount: st.violations.length,
        violations: st.violations,
        finishedAt: st.finishedAt,
        autoClosedByProctoring: st.autoClosedByProctoring,
        answersByQuestion: answersObj,
      };
    });

  const questionStats: QuestionReportStat[] = questions.map((q) => {
    let answeredCount = 0;
    let correctCount = 0;
    let incorrectCount = 0;
    let pendingCount = 0;
    let totalTime = 0;
    const optionDistribution: Record<string, number> = {};

    if (q.options) {
      for (const opt of q.options) {
        optionDistribution[opt.id] = 0;
      }
    }

    for (const st of studentStats) {
      const ans = st.answersByQuestion[q.id];
      if (!ans) continue;
      answeredCount++;
      totalTime += ans.timeSpentMs || 0;
      const eff = getEffectiveAnswerScore(ans);
      if (eff.isCorrect === true) correctCount++;
      else if (eff.isCorrect === false) incorrectCount++;
      else pendingCount++;

      for (const val of ans.value) {
        const key = q.type === 'short_answer' ? val.trim() || '(бос)' : val;
        optionDistribution[key] = (optionDistribution[key] || 0) + 1;
      }
    }

    const graded = correctCount + incorrectCount;
    const accuracyPercent =
      graded > 0 ? Math.round((correctCount / graded) * 1000) / 10 : 0;

    return {
      questionId: q.id,
      order: q.order,
      text: q.text,
      type: q.type,
      points: q.points ?? 1,
      answeredCount,
      correctCount,
      incorrectCount,
      pendingCount,
      accuracyPercent,
      averageTimeMs: answeredCount > 0 ? Math.round(totalTime / answeredCount) : 0,
      optionDistribution,
    };
  });

  const percents = studentStats.map((s) => s.percent);
  const averagePercent =
    percents.length > 0
      ? Math.round((percents.reduce((a, b) => a + b, 0) / percents.length) * 10) / 10
      : 0;
  const averageScore =
    studentStats.length > 0
      ? Math.round(
          (studentStats.reduce((a, b) => a + b.earnedPoints, 0) / studentStats.length) * 100
        ) / 100
      : 0;
  const averageTimeMs =
    studentStats.length > 0
      ? Math.round(studentStats.reduce((a, b) => a + b.totalTimeMs, 0) / studentStats.length)
      : 0;

  const answeredQuestions = questionStats.filter((q) => q.answeredCount > 0);
  const hardestQuestions = [...answeredQuestions]
    .sort((a, b) => a.accuracyPercent - b.accuracyPercent)
    .slice(0, 3);
  const easiestQuestions = [...answeredQuestions]
    .sort((a, b) => b.accuracyPercent - a.accuracyPercent)
    .slice(0, 3);

  const pendingManualCount = studentStats.reduce((acc, s) => acc + s.pendingCount, 0);

  return {
    sessionId: session.id,
    title: session.title,
    kind: session.kind,
    roomName: session.roomName,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    studentCount: studentStats.length,
    finishedCount: studentStats.filter((s) => Boolean(s.finishedAt)).length,
    totalPointsPossible,
    averageScore,
    averagePercent,
    medianPercent: computeMedian(percents),
    averageTimeMs,
    pendingManualCount,
    hardestQuestions,
    easiestQuestions,
    questionStats,
    studentStats,
    teamStats: session.teams ? [...session.teams] : undefined,
    aiAnalysis: session.aiAnalysis,
  };
}
