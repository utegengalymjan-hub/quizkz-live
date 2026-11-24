export type Locale = 'kk' | 'ru' | 'en';
export type ThemeMode = 'light' | 'dark' | 'system';

export type QuestionType = 'multiple_choice' | 'true_false' | 'short_answer';
export type MultiCorrectMode = 'all_or_nothing' | 'partial';

export interface QuestionOption {
  id: string;
  text: string;
}

export interface Question {
  id: string;
  type: QuestionType;
  text: string;
  imageUrl?: string;
  options?: QuestionOption[];
  correct: string[];
  points: number;
  explanation?: string;
  caseSensitive?: boolean;
  ignoreSpacesAndDashes?: boolean;
  multiCorrectMode?: MultiCorrectMode;
  timeLimitSeconds?: number;
  order: number;
}

export interface Quiz {
  id: string;
  ownerId: string;
  title: string;
  description?: string;
  folderId: string | null;
  questions: Question[];
  shareCode: string;
  isPublic?: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface Folder {
  id: string;
  ownerId: string;
  name: string;
  parentId: string | null;
  createdAt: string;
}

export interface Room {
  id: string;
  ownerId: string;
  name: string;
  isPersistent: boolean;
  isLocked: boolean;
  blockedStudents: string[];
  currentSessionId: string | null;
  createdAt: string;
}

export type SessionKind = 'quiz' | 'space_race' | 'quick_question' | 'exit_ticket' | 'vote';
export type SessionStatus = 'lobby' | 'running' | 'paused' | 'ended';
export type SessionPacing = 'student_paced_open' | 'student_paced_forward' | 'teacher_paced';
export type SpaceRaceIcon = 'rocket' | 'bicycle' | 'bee';
export type SpaceRaceAssignment = 'auto' | 'student_choice' | 'manual';

export interface ProctoringSettings {
  enabled: boolean;
  requireFullscreen: boolean;
  detectTabSwitch: boolean;
  blockCopyPaste: boolean;
  maxViolations: number; // 0 = unlimited, 1-20 = limit
  actionOnLimit: 'log_only' | 'auto_submit';
}

export interface SessionSettings {
  pacing: SessionPacing;
  requireNames: boolean;
  requireStudentCode?: boolean;
  shuffleQuestions: boolean;
  shuffleAnswers: boolean;
  showFeedbackAfterEach: boolean;
  showFinalScore: boolean;
  allowRetry: boolean;
  multiCorrectMode?: MultiCorrectMode;
  timeLimitSeconds?: number;
  perQuestionSeconds?: number;
  proctoring?: ProctoringSettings;
  spaceRaceIcon?: SpaceRaceIcon;
  spaceRaceTeamCount?: number;
  spaceRaceAssignment?: SpaceRaceAssignment;
  revealCorrectAnswer?: boolean;
}

export type ViolationType =
  | 'tab_switch'
  | 'window_blur'
  | 'fullscreen_exit'
  | 'copy_attempt'
  | 'paste_attempt'
  | 'context_menu';

export interface ViolationEvent {
  id: string;
  type: ViolationType;
  at: string;
  details?: string;
}

export interface Student {
  id: string;
  displayName: string;
  studentCode?: string;
  joinedAt: string;
  lastSeenAt: string;
  connected: boolean;
  teamId?: string;
  finishedAt?: string;
  attemptNumber?: number;
  kicked?: boolean;
  autoClosedByProctoring?: boolean;
  questionOrder?: string[];
  optionOrders?: Record<string, string[]>;
  violations: ViolationEvent[];
}

export interface ManualGrade {
  points: number;
  isCorrect: boolean;
  gradedBy: string;
  at: string;
}

export interface Answer {
  id: string;
  studentId: string;
  questionId: string;
  value: string[];
  isCorrect: boolean | null;
  points: number;
  submittedAt: string;
  timeSpentMs: number;
  manualGrade?: ManualGrade;
}

export interface Team {
  id: string;
  name: string;
  color: string;
  score: number;
  progress: number; // 0..100
}

export interface VoteSubmission {
  id: string;
  studentId: string;
  text: string;
  createdAt: string;
}

export interface VoteBallot {
  studentId: string;
  submissionId: string;
  at: string;
}

export interface VoteRound {
  id: string;
  prompt: string;
  phase: 'collecting' | 'voting' | 'results';
  submissions: VoteSubmission[];
  ballots: VoteBallot[];
  createdAt: string;
}

export interface Session {
  id: string;
  roomId: string;
  roomName: string;
  ownerId: string;
  kind: SessionKind;
  title: string;
  quizId?: string;
  quizSnapshot: Quiz;
  settings: SessionSettings;
  status: SessionStatus;
  currentQuestionIndex: number;
  timerEndsAt?: string | null;
  questionTimerEndsAt?: string | null;
  startedAt: string;
  endedAt?: string;
  lastActivityAt: string;
  students: Student[];
  answers: Answer[];
  teams?: Team[];
  votes?: VoteRound[];
  aiAnalysis?: string;
}

export interface Teacher {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  passwordSalt: string;
  role: 'admin' | 'teacher';
  blocked: boolean;
  language: Locale;
  defaultSessionSettings: SessionSettings;
  resetToken?: string | null;
  resetTokenExpiresAt?: string | null;
  createdAt: string;
  lastLoginAt?: string;
}

export interface PublicTeacher {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'teacher';
  blocked: boolean;
  language: Locale;
  defaultSessionSettings: SessionSettings;
  createdAt: string;
  lastLoginAt?: string;
  persistentRoom?: Room;
}

export interface StoreData {
  schemaVersion: number;
  teachers: Teacher[];
  folders: Folder[];
  quizzes: Quiz[];
  rooms: Room[];
  sessions: Session[];
  lastBackupDate?: string;
}

export interface SessionReportSummary {
  sessionId: string;
  title: string;
  kind: SessionKind;
  roomName: string;
  startedAt: string;
  endedAt?: string;
  studentCount: number;
  finishedCount: number;
  totalPointsPossible: number;
  averageScore: number;
  averagePercent: number;
  medianPercent: number;
  averageTimeMs: number;
  pendingManualCount: number;
  hardestQuestions: QuestionReportStat[];
  easiestQuestions: QuestionReportStat[];
  questionStats: QuestionReportStat[];
  studentStats: StudentReportStat[];
  teamStats?: Team[];
  aiAnalysis?: string;
}

export interface QuestionReportStat {
  questionId: string;
  order: number;
  text: string;
  type: QuestionType;
  points: number;
  answeredCount: number;
  correctCount: number;
  incorrectCount: number;
  pendingCount: number;
  accuracyPercent: number;
  averageTimeMs: number;
  optionDistribution: Record<string, number>;
}

export interface StudentReportStat {
  studentId: string;
  displayName: string;
  studentCode?: string;
  teamId?: string;
  answeredCount: number;
  correctCount: number;
  pendingCount: number;
  earnedPoints: number;
  totalPointsPossible: number;
  percent: number;
  totalTimeMs: number;
  violationCount: number;
  violations: ViolationEvent[];
  finishedAt?: string;
  autoClosedByProctoring?: boolean;
  answersByQuestion: Record<string, Answer>;
}

export interface SSEEnvelope {
  seq: number;
  event: string;
  data: unknown;
  at: string;
}

export interface StudentSessionView {
  seq: number;
  sessionId: string;
  roomName: string;
  kind: SessionKind;
  title: string;
  status: Session['status'];
  currentQuestionIndex: number;
  timerEndsAt?: string | null;
  questionTimerEndsAt?: string | null;
  settings: SessionSettings;
  student: Student;
  lobbyCount: number;
  questions: Array<
    Omit<Question, 'correct' | 'explanation'> & {
      correct?: string[];
      explanation?: string;
    }
  >;
  myAnswers: Record<string, Answer>;
  teams?: Team[];
  activeVote?: {
    id: string;
    prompt: string;
    phase: VoteRound['phase'];
    mySubmissionId?: string;
    myBallotSubmissionId?: string;
    submissions: { id: string; text: string; votes?: number }[];
  };
  finalSummary?: {
    earnedPoints: number;
    totalPointsPossible: number;
    percent: number;
    correctCount: number;
    totalQuestions: number;
  };
}

export const TEAM_COLORS: { id: string; nameKk: string; nameRu: string; nameEn: string; hex: string }[] = [
  { id: 'emerald', nameKk: 'Изумруд', nameRu: 'Изумруд', nameEn: 'Emerald', hex: '#059669' },
  { id: 'blue', nameKk: 'Көк', nameRu: 'Синий', nameEn: 'Blue', hex: '#2563EB' },
  { id: 'amber', nameKk: 'Кәріптас', nameRu: 'Янтарь', nameEn: 'Amber', hex: '#D97706' },
  { id: 'rose', nameKk: 'Қызыл', nameRu: 'Алый', nameEn: 'Crimson', hex: '#E11D48' },
  { id: 'violet', nameKk: 'Күлгін', nameRu: 'Фиолетовый', nameEn: 'Violet', hex: '#7C3AED' },
  { id: 'cyan', nameKk: 'Көгілдір', nameRu: 'Голубой', nameEn: 'Cyan', hex: '#0891B2' },
  { id: 'orange', nameKk: 'Қызғылт сары', nameRu: 'Оранжевый', nameEn: 'Orange', hex: '#EA580C' },
  { id: 'lime', nameKk: 'Жасыл-сары', nameRu: 'Лайм', nameEn: 'Lime', hex: '#65A30D' },
  { id: 'fuchsia', nameKk: 'Қызғылт', nameRu: 'Фуксия', nameEn: 'Fuchsia', hex: '#C026D3' },
  { id: 'slate', nameKk: 'Графит', nameRu: 'Графит', nameEn: 'Slate', hex: '#475569' },
];

export const DEFAULT_SESSION_SETTINGS: SessionSettings = {
  pacing: 'student_paced_open',
  requireNames: true,
  requireStudentCode: false,
  shuffleQuestions: false,
  shuffleAnswers: false,
  showFeedbackAfterEach: true,
  showFinalScore: true,
  allowRetry: false,
  multiCorrectMode: 'all_or_nothing',
  proctoring: {
    enabled: false,
    requireFullscreen: false,
    detectTabSwitch: true,
    blockCopyPaste: false,
    maxViolations: 3,
    actionOnLimit: 'log_only',
  },
  spaceRaceIcon: 'rocket',
  spaceRaceTeamCount: 4,
  spaceRaceAssignment: 'auto',
};
