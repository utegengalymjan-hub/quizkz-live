import type {
  Folder,
  Locale,
  PublicTeacher,
  Question,
  Quiz,
  Room,
  Session,
  SessionKind,
  SessionReportSummary,
  SessionSettings,
  StudentSessionView,
  ViolationType,
} from '../types.ts';

// Teacher token kept in JS memory (never written to localStorage/sessionStorage)
let teacherToken: string | null = null;

export function setTeacherToken(token: string | null) {
  teacherToken = token;
}

export function getTeacherToken(): string | null {
  return teacherToken;
}

export interface PersistedStudentSession {
  token: string;
  sessionId: string;
  roomName: string;
  displayName: string;
  proctoringAccepted?: boolean;
  pendingAnswers: { questionId: string; value: string[]; timeSpentMs: number }[];
}

const STUDENT_STORAGE_KEY = 'quizkz_student_session_v1';

export function loadStudentStorage(): PersistedStudentSession | null {
  try {
    const raw = localStorage.getItem(STUDENT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedStudentSession;
    if (!parsed.token || !parsed.sessionId) return null;
    if (!Array.isArray(parsed.pendingAnswers)) parsed.pendingAnswers = [];
    return parsed;
  } catch {
    return null;
  }
}

export function saveStudentStorage(data: PersistedStudentSession | null) {
  try {
    if (!data) localStorage.removeItem(STUDENT_STORAGE_KEY);
    else localStorage.setItem(STUDENT_STORAGE_KEY, JSON.stringify(data));
  } catch {}
}

export class ApiError extends Error {
  status: number;
  data?: Record<string, unknown>;
  constructor(message: string, status: number, data?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

async function request<T>(
  url: string,
  options: RequestInit = {},
  authToken?: string | null
): Promise<T> {
  const headers = new Headers(options.headers || {});
  const tokenToUse = authToken !== undefined ? authToken : teacherToken;
  if (tokenToUse) {
    headers.set('Authorization', `Bearer ${tokenToUse}`);
  }
  if (!(options.body instanceof FormData) && options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  let res: Response;
  try {
    res = await fetch(url, { ...options, headers });
  } catch {
    throw new ApiError('Желі байланысы үзілді. Интернетті тексеріңіз.', 0);
  }

  const contentType = res.headers.get('content-type') || '';
  const body = contentType.includes('application/json')
    ? await res.json().catch(() => ({}))
    : await res.text().catch(() => '');

  if (!res.ok) {
    const msg =
      (typeof body === 'object' && body && 'error' in body && String((body as Record<string, unknown>).error)) ||
      `Сервер қатесі (${res.status})`;
    throw new ApiError(msg, res.status, typeof body === 'object' ? (body as Record<string, unknown>) : undefined);
  }
  return body as T;
}

export async function downloadAuthenticatedFile(url: string, fallbackFilename: string) {
  const headers = new Headers();
  if (teacherToken) headers.set('Authorization', `Bearer ${teacherToken}`);
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(data.error || 'Файлды жүктеу сәтсіз болды.', res.status);
  }
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') || '';
  let filename = fallbackFilename;
  const utf8Match = cd.match(/filename\*=UTF-8''([^;]+)/i);
  const simpleMatch = cd.match(/filename="([^"]+)"/i);
  if (utf8Match) filename = decodeURIComponent(utf8Match[1]);
  else if (simpleMatch) filename = simpleMatch[1];

  const objUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(objUrl), 2000);
}

export const api = {
  getConfig: () =>
    request<{ aiEnabled: boolean; appName: string; maxStudentsPerRoom: number; maxQuestions: number }>(
      '/api/config',
      {},
      null
    ),

  // Auth
  register: (payload: { name: string; email: string; password: string; language: Locale }) =>
    request<{ token: string; teacher: PublicTeacher }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    }, null),

  login: (payload: { email: string; password: string }) =>
    request<{ token: string; teacher: PublicTeacher }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    }, null),

  me: () => request<{ teacher: PublicTeacher }>('/api/auth/me'),

  updateProfile: (payload: {
    name?: string;
    email?: string;
    language?: Locale;
    defaultSessionSettings?: SessionSettings;
  }) =>
    request<{ teacher: PublicTeacher }>('/api/auth/profile', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: boolean }>('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),

  resetPasswordWithToken: (token: string, newPassword: string) =>
    request<{ ok: boolean }>('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, newPassword }),
    }, null),

  deleteAccount: (password: string) =>
    request<{ ok: boolean }>('/api/auth/account', {
      method: 'DELETE',
      body: JSON.stringify({ password }),
    }),

  // Folders
  getFolders: () => request<{ folders: Folder[] }>('/api/folders'),
  createFolder: (name: string, parentId: string | null = null) =>
    request<{ folder: Folder }>('/api/folders', {
      method: 'POST',
      body: JSON.stringify({ name, parentId }),
    }),
  updateFolder: (id: string, payload: { name?: string; parentId?: string | null }) =>
    request<{ folder: Folder }>(`/api/folders/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  deleteFolder: (id: string) => request<{ ok: boolean }>(`/api/folders/${id}`, { method: 'DELETE' }),

  // Quizzes
  getQuizzes: (trash = false) =>
    request<{ quizzes: Quiz[] }>(`/api/quizzes${trash ? '?trash=true' : ''}`),
  getQuiz: (id: string) => request<{ quiz: Quiz }>(`/api/quizzes/${id}`),
  createQuiz: (payload: Partial<Quiz>) =>
    request<{ quiz: Quiz }>('/api/quizzes', { method: 'POST', body: JSON.stringify(payload) }),
  updateQuiz: (id: string, payload: Partial<Quiz>) =>
    request<{ quiz: Quiz }>(`/api/quizzes/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteQuiz: (id: string, permanent = false) =>
    request<{ ok: boolean }>(`/api/quizzes/${id}${permanent ? '?permanent=true' : ''}`, {
      method: 'DELETE',
    }),
  restoreQuiz: (id: string) =>
    request<{ quiz: Quiz }>(`/api/quizzes/${id}/restore`, { method: 'POST' }),
  duplicateQuiz: (id: string) =>
    request<{ quiz: Quiz }>(`/api/quizzes/${id}/duplicate`, { method: 'POST' }),
  shareQuiz: (id: string, payload: { isPublic?: boolean; regenerateCode?: boolean }) =>
    request<{ quiz: Quiz }>(`/api/quizzes/${id}/share`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  mergeQuizzes: (quizIds: string[], title: string, folderId: string | null = null) =>
    request<{ quiz: Quiz }>('/api/quizzes/merge', {
      method: 'POST',
      body: JSON.stringify({ quizIds, title, folderId }),
    }),
  importByShareCode: (code: string, folderId: string | null = null) =>
    request<{ quiz: Quiz }>('/api/quizzes/import-share-code', {
      method: 'POST',
      body: JSON.stringify({ code, folderId }),
    }),
  getPublicQuiz: (code: string) =>
    request<{
      quiz: {
        id: string;
        title: string;
        description?: string;
        shareCode: string;
        questionCount: number;
        questions: Question[];
      };
    }>(`/api/public/quiz/${encodeURIComponent(code)}`, {}, null),

  // Import & AI
  importStructured: (formDataOrText: FormData | string) => {
    if (typeof formDataOrText === 'string') {
      return request<{ questions: Question[]; rawText: string; warnings: string[] }>(
        '/api/import/structured',
        { method: 'POST', body: JSON.stringify({ text: formDataOrText }) }
      );
    }
    return request<{ questions: Question[]; rawText: string; warnings: string[] }>(
      '/api/import/structured',
      { method: 'POST', body: formDataOrText }
    );
  },

  importWithAi: (formDataOrText: FormData | { text: string; language: Locale }) => {
    if (formDataOrText instanceof FormData) {
      return request<{ questions: Question[]; rawText: string; warnings: string[] }>(
        '/api/import/parse-document',
        { method: 'POST', body: formDataOrText }
      );
    }
    return request<{ questions: Question[]; rawText: string; warnings: string[] }>(
      '/api/import/parse-document',
      { method: 'POST', body: JSON.stringify(formDataOrText) }
    );
  },

  aiGenerateQuestions: (payload: {
    topic: string;
    grade: string;
    count: number;
    difficulty: 'easy' | 'medium' | 'hard';
    language: Locale;
  }) =>
    request<{ questions: Question[] }>('/api/ai/generate-questions', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  aiRefineQuestion: (payload: {
    question: Question;
    action: 'harder' | 'easier' | 'add_options' | 'write_explanation';
    language: Locale;
  }) =>
    request<{ suggestion: Partial<Question> }>('/api/ai/refine-question', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  aiAnalyzeSession: (sessionId: string, language: Locale) =>
    request<{ analysis: string }>(`/api/sessions/${sessionId}/ai-analysis`, {
      method: 'POST',
      body: JSON.stringify({ language }),
    }),

  // Rooms
  getRooms: () => request<{ rooms: Room[] }>('/api/rooms'),
  createRoom: (name: string) =>
    request<{ room: Room }>('/api/rooms', { method: 'POST', body: JSON.stringify({ name }) }),
  updateRoom: (id: string, payload: { name?: string; isLocked?: boolean; unblockName?: string }) =>
    request<{ room: Room }>(`/api/rooms/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  kickAllRoom: (id: string) =>
    request<{ ok: boolean }>(`/api/rooms/${id}/kick-all`, { method: 'POST' }),
  deleteRoom: (id: string) => request<{ ok: boolean }>(`/api/rooms/${id}`, { method: 'DELETE' }),

  // Sessions
  getSessions: () =>
    request<{
      sessions: {
        id: string;
        roomId: string;
        roomName: string;
        kind: SessionKind;
        title: string;
        status: Session['status'];
        startedAt: string;
        endedAt?: string;
        studentCount: number;
        averagePercent: number;
        pendingManualCount: number;
        questionCount: number;
      }[];
    }>('/api/sessions'),

  getStudentProgress: (q = '') =>
    request<{
      students: {
        key: string;
        displayName: string;
        studentCode?: string;
        points: { sessionId: string; title: string; date: string; percent: number; score: number }[];
      }[];
    }>(`/api/sessions/student-progress?q=${encodeURIComponent(q)}`),

  createSession: (payload: Record<string, unknown>) =>
    request<{ session: Session }>('/api/sessions', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getSession: (id: string) => request<{ session: Session }>(`/api/sessions/${id}`),
  getSessionReport: (id: string) =>
    request<{ session: Session; report: SessionReportSummary }>(`/api/sessions/${id}/report`),
  deleteSession: (id: string) =>
    request<{ ok: boolean }>(`/api/sessions/${id}`, { method: 'DELETE' }),

  startSession: (id: string) =>
    request<{ session: Session }>(`/api/sessions/${id}/start`, { method: 'POST' }),
  pauseSession: (id: string) =>
    request<{ session: Session }>(`/api/sessions/${id}/pause`, { method: 'POST' }),
  resumeSession: (id: string) =>
    request<{ session: Session }>(`/api/sessions/${id}/resume`, { method: 'POST' }),
  nextQuestion: (id: string, index?: number) =>
    request<{ session: Session }>(`/api/sessions/${id}/next`, {
      method: 'POST',
      body: JSON.stringify({ index }),
    }),
  prevQuestion: (id: string) =>
    request<{ session: Session }>(`/api/sessions/${id}/prev`, { method: 'POST' }),
  updateTimer: (id: string, action: 'add_seconds' | 'clear' | 'set_seconds', seconds?: number) =>
    request<{ session: Session }>(`/api/sessions/${id}/timer`, {
      method: 'POST',
      body: JSON.stringify({ action, seconds }),
    }),
  revealAnswer: (id: string, reveal: boolean) =>
    request<{ session: Session }>(`/api/sessions/${id}/reveal`, {
      method: 'POST',
      body: JSON.stringify({ reveal }),
    }),
  addQuickQuestion: (id: string, payload: Record<string, unknown>) =>
    request<{ session: Session }>(`/api/sessions/${id}/quick-question`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateVotePhase: (id: string, phase: 'collecting' | 'voting' | 'results', prompt?: string) =>
    request<{ session: Session }>(`/api/sessions/${id}/vote-phase`, {
      method: 'POST',
      body: JSON.stringify({ phase, prompt }),
    }),
  assignTeam: (id: string, studentId: string, teamId: string) =>
    request<{ session: Session }>(`/api/sessions/${id}/assign-team`, {
      method: 'POST',
      body: JSON.stringify({ studentId, teamId }),
    }),
  endSession: (id: string) =>
    request<{ session: Session }>(`/api/sessions/${id}/end`, { method: 'POST' }),
  kickStudent: (id: string, studentId: string, block = false) =>
    request<{ session: Session }>(`/api/sessions/${id}/kick`, {
      method: 'POST',
      body: JSON.stringify({ studentId, block }),
    }),
  allowRetryStudent: (id: string, studentId: string) =>
    request<{ session: Session }>(`/api/sessions/${id}/retry-student`, {
      method: 'POST',
      body: JSON.stringify({ studentId }),
    }),
  gradeAnswer: (
    id: string,
    payload: { answerId: string; points: number; isCorrect: boolean; acceptForAll?: boolean }
  ) =>
    request<{ session: Session; report: SessionReportSummary }>(`/api/sessions/${id}/grade`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  lockSessionRoom: (id: string, locked: boolean) =>
    request<{ room: Room }>(`/api/sessions/${id}/lock`, {
      method: 'POST',
      body: JSON.stringify({ locked }),
    }),

  // Public Student API
  lookupRoom: (name: string) =>
    request<{
      room: {
        id: string;
        name: string;
        hasActiveSession: boolean;
        sessionId?: string;
        kind?: SessionKind;
        title?: string;
        status?: Session['status'];
        requireNames?: boolean;
        requireStudentCode?: boolean;
        proctoring?: SessionSettings['proctoring'];
        teams?: Session['teams'];
      };
    }>(`/api/public/room/${encodeURIComponent(name)}`, {}, null),

  joinRoom: (payload: {
    roomName: string;
    displayName: string;
    studentCode?: string;
    teamId?: string;
  }) =>
    request<{ token: string; view: StudentSessionView }>(
      '/api/public/join',
      { method: 'POST', body: JSON.stringify(payload) },
      null
    ),

  studentState: (studentToken: string) =>
    request<{ view: StudentSessionView }>('/api/public/state', {}, studentToken),

  studentHeartbeat: (studentToken: string) =>
    request<{ view: StudentSessionView }>(
      '/api/public/heartbeat',
      { method: 'POST' },
      studentToken
    ),

  studentSubmitAnswer: (
    studentToken: string,
    payload: { questionId: string; value: string[]; timeSpentMs: number }
  ) =>
    request<{ answer: unknown; view: StudentSessionView }>(
      '/api/public/answer',
      { method: 'POST', body: JSON.stringify(payload) },
      studentToken
    ),

  studentVoteSubmit: (studentToken: string, text: string) =>
    request<{ view: StudentSessionView }>(
      '/api/public/vote-submit',
      { method: 'POST', body: JSON.stringify({ text }) },
      studentToken
    ),

  studentVoteBallot: (studentToken: string, submissionId: string) =>
    request<{ view: StudentSessionView }>(
      '/api/public/vote-ballot',
      { method: 'POST', body: JSON.stringify({ submissionId }) },
      studentToken
    ),

  studentFinish: (studentToken: string) =>
    request<{ view: StudentSessionView }>('/api/public/finish', { method: 'POST' }, studentToken),

  studentRetry: (studentToken: string) =>
    request<{ view: StudentSessionView }>('/api/public/retry', { method: 'POST' }, studentToken),

  studentViolation: (studentToken: string, type: ViolationType, details?: string) =>
    request<{ autoClosed: boolean; view: StudentSessionView }>(
      '/api/public/violation',
      { method: 'POST', body: JSON.stringify({ type, details }) },
      studentToken
    ),

  // Admin
  adminTeachers: () =>
    request<{
      teachers: {
        id: string;
        name: string;
        email: string;
        role: 'admin' | 'teacher';
        blocked: boolean;
        createdAt: string;
        lastLoginAt?: string;
        quizCount: number;
        sessionCount: number;
        roomName: string;
      }[];
    }>('/api/admin/teachers'),

  adminStats: () =>
    request<{
      fileSizeBytes: number;
      backupCount: number;
      dataDir: string;
      teacherCount: number;
      quizCount: number;
      sessionCount: number;
      activeSessionCount: number;
      todaySessionCount: number;
      activeStudentsCount: number;
    }>('/api/admin/stats'),

  adminBlockTeacher: (id: string) =>
    request<{ ok: boolean }>(`/api/admin/teachers/${id}/block`, { method: 'POST' }),
  adminUnblockTeacher: (id: string) =>
    request<{ ok: boolean }>(`/api/admin/teachers/${id}/unblock`, { method: 'POST' }),
  adminResetLink: (id: string) =>
    request<{ resetUrl: string; token: string }>(`/api/admin/teachers/${id}/reset-link`, {
      method: 'POST',
    }),
};
