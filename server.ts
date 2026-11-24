import 'dotenv/config';
import express, { type Request, type Response, type NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import http from 'http';
import crypto from 'crypto';
import multer from 'multer';
import {
  DEFAULT_SESSION_SETTINGS,
  type Folder,
  type Locale,
  type Question,
  type Quiz,
  type Room,
  type SessionKind,
  type SessionSettings,
  type Teacher,
  type ViolationType,
} from './src/types.ts';
import {
  createWelcomeQuiz,
  generateId,
  generateRoomName,
  generateShareCode,
  store,
} from './server/store.ts';
import {
  createRateLimiter,
  createStudentToken,
  createTeacherToken,
  extractBearerToken,
  getAuthSecret,
  hashPassword,
  toPublicTeacher,
  verifyPassword,
  verifyStudentToken,
  verifyTeacherToken,
} from './server/auth.ts';
import { buildSessionReport } from './server/scoring.ts';
import { sessionManager } from './server/sessions.ts';
import {
  buildExcelTemplateBuffer,
  extractRawTextFromBuffer,
  parseSpreadsheetBuffer,
  parseStructuredText,
} from './server/importers.ts';
import {
  exportQuizToDocxBuffer,
  exportSessionToCsv,
  exportSessionToDocxBuffer,
  exportSessionToExcelBuffer,
} from './server/exporters.ts';
import {
  analyzeSessionReportWithAi,
  generateQuestionsWithAi,
  isAiAvailable,
  parseQuestionsWithAi,
  refineQuestionWithAi,
} from './server/ai.ts';

const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

const MAX_QUESTIONS = 200;
const MAX_OPTIONS = 6;
const MAX_IMAGE_DATA_URL_BYTES = 2.8 * 1024 * 1024; // ~2MB binary in base64

interface AuthedRequest extends Request {
  teacher?: Teacher;
  studentAuth?: { sessionId: string; studentId: string; roomId: string };
}

function validateAndSanitizeQuestions(rawQuestions: unknown): {
  questions?: Question[];
  error?: string;
} {
  if (!Array.isArray(rawQuestions)) {
    return { error: 'Сұрақтар тізімі дұрыс форматта емес.' };
  }
  if (rawQuestions.length > MAX_QUESTIONS) {
    return { error: `Сұрақ саны ${MAX_QUESTIONS}-ден аспауы керек.` };
  }

  const sanitized: Question[] = [];
  for (let i = 0; i < rawQuestions.length; i++) {
    const raw = rawQuestions[i] as Partial<Question>;
    if (!raw || typeof raw !== 'object') continue;

    const type =
      raw.type === 'true_false' || raw.type === 'short_answer' ? raw.type : 'multiple_choice';
    const text = String(raw.text ?? '').slice(0, 5000);
    let imageUrl: string | undefined;
    if (typeof raw.imageUrl === 'string' && raw.imageUrl.trim()) {
      const trimmed = raw.imageUrl.trim();
      if (!trimmed.startsWith('data:image/')) {
        return { error: 'Тек жүктелген сурет (data:image/*) рұқсат етіледі.' };
      }
      if (Buffer.byteLength(trimmed, 'utf-8') > MAX_IMAGE_DATA_URL_BYTES) {
        return { error: 'Сурет өлшемі 2 МБ-тан аспауы керек.' };
      }
      imageUrl = trimmed;
    }

    let options = raw.options;
    if (type === 'multiple_choice') {
      if (!Array.isArray(options)) options = [];
      if (options.length > MAX_OPTIONS) {
        return { error: `Нұсқалар саны ${MAX_OPTIONS}-дан аспауы керек.` };
      }
      options = options.map((o, oi) => ({
        id: String(o?.id || String.fromCharCode(97 + oi)).slice(0, 16),
        text: String(o?.text ?? '').slice(0, 1000),
      }));
    } else if (type === 'true_false') {
      options = [
        { id: 'true', text: 'Дұрыс' },
        { id: 'false', text: 'Қате' },
      ];
    } else {
      options = undefined;
    }

    const correct = Array.isArray(raw.correct)
      ? raw.correct.map((c) => String(c).slice(0, 500)).filter((c) => c.length > 0)
      : [];

    sanitized.push({
      id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim().slice(0, 64) : generateId('q'),
      type,
      text,
      imageUrl,
      options,
      correct,
      points: Math.max(0, Math.min(100, Number(raw.points ?? 1) || 0)),
      explanation: raw.explanation ? String(raw.explanation).slice(0, 2000) : undefined,
      caseSensitive: Boolean(raw.caseSensitive),
      ignoreSpacesAndDashes: raw.ignoreSpacesAndDashes !== false,
      multiCorrectMode: raw.multiCorrectMode === 'partial' ? 'partial' : 'all_or_nothing',
      timeLimitSeconds:
        raw.timeLimitSeconds && Number(raw.timeLimitSeconds) > 0
          ? Math.min(3600, Math.round(Number(raw.timeLimitSeconds)))
          : undefined,
      order: i,
    });
  }

  return { questions: sanitized };
}

function requireTeacher(req: AuthedRequest, res: Response, next: NextFunction) {
  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'Авторизация қажет.' });
    return;
  }
  const payload = verifyTeacherToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Сессия мерзімі аяқталды. Қайта кіріңіз.' });
    return;
  }
  const teacher = store.getTeacherById(payload.sub);
  if (!teacher) {
    res.status(401).json({ error: 'Пайдаланушы табылмады.' });
    return;
  }
  if (teacher.blocked) {
    res.status(403).json({ error: 'Аккаунтыңыз әкімші тарапынан блокталған.' });
    return;
  }
  req.teacher = teacher;
  next();
}

function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  requireTeacher(req, res, () => {
    if (req.teacher?.role !== 'admin') {
      res.status(403).json({ error: 'Тек әкімшіге қолжетімді.' });
      return;
    }
    next();
  });
}

function requireStudent(req: AuthedRequest, res: Response, next: NextFunction) {
  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'Оқушы токені жоқ.' });
    return;
  }
  const payload = verifyStudentToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Оқушы сессиясы жарамсыз. Бөлмеге қайта кіріңіз.' });
    return;
  }
  req.studentAuth = {
    sessionId: payload.sessionId,
    studentId: payload.studentId,
    roomId: payload.roomId,
  };
  next();
}

function setupSSEHeaders(res: Response) {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
}

async function bootstrap() {
  getAuthSecret();
  await store.init();
  await sessionManager.init();

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '15mb' }));
  app.use(express.urlencoded({ extended: true, limit: '15mb' }));

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 12 * 1024 * 1024 },
  });

  const authRateLimit = createRateLimiter(10, 60_000);

  // --- Health & Capabilities ---
  app.get('/healthz', (_req, res) => {
    res.json({ status: 'ok', uptime: Math.round(process.uptime()), aiEnabled: isAiAvailable() });
  });

  app.get('/api/config', (_req, res) => {
    res.json({
      aiEnabled: isAiAvailable(),
      appName: 'QuizKZ Live',
      maxStudentsPerRoom: 150,
      maxQuestions: MAX_QUESTIONS,
    });
  });

  // =========================================================================
  // AUTH ROUTES
  // =========================================================================
  app.post('/api/auth/register', authRateLimit, async (req, res) => {
    try {
      const name = String(req.body?.name ?? '').trim();
      const email = String(req.body?.email ?? '').trim().toLowerCase();
      const password = String(req.body?.password ?? '');
      const language: Locale = ['kk', 'ru', 'en'].includes(req.body?.language)
        ? req.body.language
        : 'kk';

      if (name.length < 2 || name.length > 80) {
        res.status(400).json({ error: 'Аты-жөніңіз 2–80 таңба аралығында болуы керек.' });
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        res.status(400).json({ error: 'Дұрыс email мекенжайын енгізіңіз.' });
        return;
      }
      if (password.length < 8 || password.length > 128) {
        res.status(400).json({ error: 'Құпиясөз кемінде 8 таңбадан тұруы керек.' });
        return;
      }
      if (store.getTeacherByEmail(email)) {
        res.status(409).json({ error: 'Бұл email мекенжайы бұрын тіркелген.' });
        return;
      }

      const isFirstTeacher = store.getAllTeachers().length === 0;
      const { hash, salt } = await hashPassword(password);
      const now = new Date().toISOString();

      const teacher: Teacher = {
        id: generateId('tch'),
        name,
        email,
        passwordHash: hash,
        passwordSalt: salt,
        role: isFirstTeacher ? 'admin' : 'teacher',
        blocked: false,
        language,
        defaultSessionSettings: structuredClone(DEFAULT_SESSION_SETTINGS),
        createdAt: now,
        lastLoginAt: now,
      };
      await store.saveTeacher(teacher);

      // Auto-create persistent room
      const existingRooms = new Set(store.getAllRooms().map((r) => r.name.toLowerCase()));
      const persistentRoom: Room = {
        id: generateId('rm'),
        ownerId: teacher.id,
        name: generateRoomName(existingRooms),
        isPersistent: true,
        isLocked: false,
        blockedStudents: [],
        currentSessionId: null,
        createdAt: now,
      };
      await store.saveRoom(persistentRoom);

      // Auto-create welcome math sample quiz (8 questions)
      const existingCodes = new Set(
        store.getQuizzesByOwner(teacher.id, true).map((q) => q.shareCode)
      );
      const sampleQuiz = createWelcomeQuiz(teacher.id, existingCodes);
      await store.saveQuiz(sampleQuiz);

      const token = createTeacherToken(teacher);
      res.status(201).json({
        token,
        teacher: toPublicTeacher(teacher, persistentRoom),
      });
    } catch (err) {
      console.error('[auth/register]', err);
      res.status(500).json({ error: 'Тіркелу кезінде қате шықты.' });
    }
  });

  app.post('/api/auth/login', authRateLimit, async (req, res) => {
    try {
      const email = String(req.body?.email ?? '').trim().toLowerCase();
      const password = String(req.body?.password ?? '');
      const teacher = store.getTeacherByEmail(email);

      if (!teacher) {
        res.status(401).json({ error: 'Email немесе құпиясөз қате.' });
        return;
      }
      const valid = await verifyPassword(password, teacher.passwordHash, teacher.passwordSalt);
      if (!valid) {
        res.status(401).json({ error: 'Email немесе құпиясөз қате.' });
        return;
      }
      if (teacher.blocked) {
        res.status(403).json({ error: 'Аккаунтыңыз әкімші тарапынан блокталған.' });
        return;
      }

      teacher.lastLoginAt = new Date().toISOString();
      await store.saveTeacher(teacher);

      let persistentRoom = store.getRoomsByOwner(teacher.id).find((r) => r.isPersistent);
      if (!persistentRoom) {
        const existingRooms = new Set(store.getAllRooms().map((r) => r.name.toLowerCase()));
        persistentRoom = {
          id: generateId('rm'),
          ownerId: teacher.id,
          name: generateRoomName(existingRooms),
          isPersistent: true,
          isLocked: false,
          blockedStudents: [],
          currentSessionId: null,
          createdAt: new Date().toISOString(),
        };
        await store.saveRoom(persistentRoom);
      }

      const token = createTeacherToken(teacher);
      res.json({
        token,
        teacher: toPublicTeacher(teacher, persistentRoom),
      });
    } catch (err) {
      console.error('[auth/login]', err);
      res.status(500).json({ error: 'Кіру кезінде қате шықты.' });
    }
  });

  app.post('/api/auth/logout', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/auth/me', requireTeacher, (req: AuthedRequest, res) => {
    const teacher = req.teacher!;
    const persistentRoom = store.getRoomsByOwner(teacher.id).find((r) => r.isPersistent);
    res.json({ teacher: toPublicTeacher(teacher, persistentRoom) });
  });

  app.put('/api/auth/profile', requireTeacher, async (req: AuthedRequest, res) => {
    try {
      const teacher = req.teacher!;
      if (typeof req.body?.name === 'string') {
        const name = req.body.name.trim();
        if (name.length < 2 || name.length > 80) {
          res.status(400).json({ error: 'Аты-жөні 2–80 таңба аралығында болуы керек.' });
          return;
        }
        teacher.name = name;
      }
      if (typeof req.body?.email === 'string') {
        const email = req.body.email.trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          res.status(400).json({ error: 'Дұрыс email енгізіңіз.' });
          return;
        }
        const existing = store.getTeacherByEmail(email);
        if (existing && existing.id !== teacher.id) {
          res.status(409).json({ error: 'Бұл email бос емес.' });
          return;
        }
        teacher.email = email;
      }
      if (['kk', 'ru', 'en'].includes(req.body?.language)) {
        teacher.language = req.body.language;
      }
      if (req.body?.defaultSessionSettings && typeof req.body.defaultSessionSettings === 'object') {
        teacher.defaultSessionSettings = {
          ...teacher.defaultSessionSettings,
          ...req.body.defaultSessionSettings,
        };
      }
      await store.saveTeacher(teacher);
      const persistentRoom = store.getRoomsByOwner(teacher.id).find((r) => r.isPersistent);
      res.json({ teacher: toPublicTeacher(teacher, persistentRoom) });
    } catch {
      res.status(500).json({ error: 'Профильді сақтау мүмкін болмады.' });
    }
  });

  app.post('/api/auth/change-password', requireTeacher, async (req: AuthedRequest, res) => {
    try {
      const teacher = req.teacher!;
      const currentPassword = String(req.body?.currentPassword ?? '');
      const newPassword = String(req.body?.newPassword ?? '');

      if (newPassword.length < 8 || newPassword.length > 128) {
        res.status(400).json({ error: 'Жаңа құпиясөз кемінде 8 таңба болуы керек.' });
        return;
      }
      const valid = await verifyPassword(currentPassword, teacher.passwordHash, teacher.passwordSalt);
      if (!valid) {
        res.status(400).json({ error: 'Ағымдағы құпиясөз қате.' });
        return;
      }
      const { hash, salt } = await hashPassword(newPassword);
      teacher.passwordHash = hash;
      teacher.passwordSalt = salt;
      await store.saveTeacher(teacher);
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: 'Құпиясөзді өзгерту кезінде қате шықты.' });
    }
  });

  app.post('/api/auth/reset-password', authRateLimit, async (req, res) => {
    try {
      const token = String(req.body?.token ?? '').trim();
      const newPassword = String(req.body?.newPassword ?? '');
      if (newPassword.length < 8) {
        res.status(400).json({ error: 'Құпиясөз кемінде 8 таңба болуы керек.' });
        return;
      }
      const teacher = store.getTeacherByResetToken(token);
      if (!teacher) {
        res.status(400).json({ error: 'Сілтеме жарамсыз немесе мерзімі өтіп кеткен.' });
        return;
      }
      const { hash, salt } = await hashPassword(newPassword);
      teacher.passwordHash = hash;
      teacher.passwordSalt = salt;
      teacher.resetToken = null;
      teacher.resetTokenExpiresAt = null;
      await store.saveTeacher(teacher);
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: 'Құпиясөзді қалпына келтіру сәтсіз болды.' });
    }
  });

  app.get('/api/auth/export-data', requireTeacher, (req: AuthedRequest, res) => {
    const data = store.exportTeacherData(req.teacher!.id);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="quizkz-my-data-${new Date().toISOString().slice(0, 10)}.json"`
    );
    res.send(JSON.stringify(data, null, 2));
  });

  app.delete('/api/auth/account', requireTeacher, async (req: AuthedRequest, res) => {
    try {
      const teacher = req.teacher!;
      const password = String(req.body?.password ?? '');
      const valid = await verifyPassword(password, teacher.passwordHash, teacher.passwordSalt);
      if (!valid) {
        res.status(400).json({ error: 'Аккаунтты жою үшін құпиясөзді дұрыс енгізіңіз.' });
        return;
      }
      // End active sessions owned by teacher
      for (const s of store.getSessionsByOwner(teacher.id)) {
        if (s.status !== 'ended') {
          await sessionManager.endSession(s.id);
        }
      }
      await store.deleteTeacherCascade(teacher.id);
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: 'Аккаунтты жою кезінде қате шықты.' });
    }
  });

  // =========================================================================
  // FOLDERS ROUTES
  // =========================================================================
  app.get('/api/folders', requireTeacher, (req: AuthedRequest, res) => {
    res.json({ folders: store.getFoldersByOwner(req.teacher!.id) });
  });

  app.post('/api/folders', requireTeacher, async (req: AuthedRequest, res) => {
    const name = String(req.body?.name ?? '').trim();
    const parentId = req.body?.parentId ? String(req.body.parentId) : null;
    if (!name || name.length > 80) {
      res.status(400).json({ error: 'Қалта атауы 1–80 таңба болуы керек.' });
      return;
    }
    if (parentId) {
      const parent = store.getFolderById(parentId);
      if (!parent || parent.ownerId !== req.teacher!.id) {
        res.status(404).json({ error: 'Ата-аналық қалта табылмады.' });
        return;
      }
    }
    const folder: Folder = {
      id: generateId('fld'),
      ownerId: req.teacher!.id,
      name,
      parentId,
      createdAt: new Date().toISOString(),
    };
    await store.saveFolder(folder);
    res.status(201).json({ folder });
  });

  app.put('/api/folders/:id', requireTeacher, async (req: AuthedRequest, res) => {
    const folder = store.getFolderById(String(req.params.id));
    if (!folder || folder.ownerId !== req.teacher!.id) {
      res.status(404).json({ error: 'Қалта табылмады.' });
      return;
    }
    if (typeof req.body?.name === 'string') {
      const name = req.body.name.trim();
      if (!name || name.length > 80) {
        res.status(400).json({ error: 'Қалта атауы 1–80 таңба болуы керек.' });
        return;
      }
      folder.name = name;
    }
    if (req.body?.parentId !== undefined) {
      const nextParent = req.body.parentId ? String(req.body.parentId) : null;
      if (nextParent === folder.id) {
        res.status(400).json({ error: 'Қалтаны өз ішіне салуға болмайды.' });
        return;
      }
      folder.parentId = nextParent;
    }
    await store.saveFolder(folder);
    res.json({ folder });
  });

  app.delete('/api/folders/:id', requireTeacher, async (req: AuthedRequest, res) => {
    const folder = store.getFolderById(String(req.params.id));
    if (!folder || folder.ownerId !== req.teacher!.id) {
      res.status(404).json({ error: 'Қалта табылмады.' });
      return;
    }
    await store.deleteFolder(folder.id, req.teacher!.id);
    res.json({ ok: true });
  });

  // =========================================================================
  // QUIZZES ROUTES
  // =========================================================================
  app.get('/api/quizzes', requireTeacher, (req: AuthedRequest, res) => {
    const includeDeleted = req.query.trash === 'true';
    const all = store.getQuizzesByOwner(req.teacher!.id, true);
    const quizzes = includeDeleted
      ? all.filter((q) => Boolean(q.deletedAt))
      : all.filter((q) => !q.deletedAt);
    res.json({ quizzes });
  });

  // Public share view (no auth required when quiz.isPublic = true)
  app.get('/api/public/quiz/:code', (req, res) => {
    const quiz = store.getQuizByShareCode(String(req.params.code));
    if (!quiz || !quiz.isPublic) {
      res.status(404).json({ error: 'Жария викторина табылмады.' });
      return;
    }
    res.json({
      quiz: {
        id: quiz.id,
        title: quiz.title,
        description: quiz.description,
        shareCode: quiz.shareCode,
        questionCount: quiz.questions.length,
        questions: quiz.questions.map((q) => ({
          id: q.id,
          type: q.type,
          text: q.text,
          imageUrl: q.imageUrl,
          options: q.options,
          points: q.points,
          order: q.order,
        })),
      },
    });
  });

  app.get('/api/quizzes/by-share-code/:code', requireTeacher, (req: AuthedRequest, res) => {
    const quiz = store.getQuizByShareCode(String(req.params.code));
    if (!quiz) {
      res.status(404).json({ error: 'Бұл бөлісу коды бойынша викторина табылмады.' });
      return;
    }
    res.json({ quiz });
  });

  app.post('/api/quizzes/import-share-code', requireTeacher, async (req: AuthedRequest, res) => {
    const code = String(req.body?.code ?? '').trim();
    const source = store.getQuizByShareCode(code);
    if (!source) {
      res.status(404).json({ error: 'Бөлісу коды бойынша викторина табылмады.' });
      return;
    }
    const existingCodes = new Set(
      store.getAllTeachers().flatMap((t) => store.getQuizzesByOwner(t.id, true).map((q) => q.shareCode))
    );
    const now = new Date().toISOString();
    const copy: Quiz = {
      ...structuredClone(source),
      id: generateId('qz'),
      ownerId: req.teacher!.id,
      folderId: req.body?.folderId ? String(req.body.folderId) : null,
      shareCode: generateShareCode(existingCodes),
      isPublic: false,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      questions: source.questions.map((q, i) => ({ ...structuredClone(q), id: generateId('q'), order: i })),
    };
    await store.saveQuiz(copy);
    res.status(201).json({ quiz: copy });
  });

  app.get('/api/quizzes/:id', requireTeacher, (req: AuthedRequest, res) => {
    const quiz = store.getQuizById(String(req.params.id));
    if (!quiz || quiz.ownerId !== req.teacher!.id) {
      res.status(404).json({ error: 'Викторина табылмады.' });
      return;
    }
    res.json({ quiz });
  });

  app.post('/api/quizzes', requireTeacher, async (req: AuthedRequest, res) => {
    const title = String(req.body?.title ?? '').trim() || 'Атаусыз викторина';
    const description = req.body?.description ? String(req.body.description).slice(0, 1000) : undefined;
    const folderId = req.body?.folderId ? String(req.body.folderId) : null;
    const { questions, error } = validateAndSanitizeQuestions(req.body?.questions ?? []);
    if (error) {
      res.status(400).json({ error });
      return;
    }
    const existingCodes = new Set(
      store.getAllTeachers().flatMap((t) => store.getQuizzesByOwner(t.id, true).map((q) => q.shareCode))
    );
    const now = new Date().toISOString();
    const quiz: Quiz = {
      id: generateId('qz'),
      ownerId: req.teacher!.id,
      title: title.slice(0, 200),
      description,
      folderId,
      questions: questions || [],
      shareCode: generateShareCode(existingCodes),
      isPublic: Boolean(req.body?.isPublic),
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    await store.saveQuiz(quiz);
    res.status(201).json({ quiz });
  });

  app.put('/api/quizzes/:id', requireTeacher, async (req: AuthedRequest, res) => {
    const quiz = store.getQuizById(String(req.params.id));
    if (!quiz || quiz.ownerId !== req.teacher!.id) {
      res.status(404).json({ error: 'Викторина табылмады.' });
      return;
    }
    if (typeof req.body?.title === 'string') {
      quiz.title = (req.body.title.trim() || 'Атаусыз викторина').slice(0, 200);
    }
    if (req.body?.description !== undefined) {
      quiz.description = String(req.body.description ?? '').slice(0, 1000) || undefined;
    }
    if (req.body?.folderId !== undefined) {
      quiz.folderId = req.body.folderId ? String(req.body.folderId) : null;
    }
    if (typeof req.body?.isPublic === 'boolean') {
      quiz.isPublic = req.body.isPublic;
    }
    if (req.body?.questions !== undefined) {
      const { questions, error } = validateAndSanitizeQuestions(req.body.questions);
      if (error) {
        res.status(400).json({ error });
        return;
      }
      quiz.questions = questions!;
    }
    quiz.updatedAt = new Date().toISOString();
    await store.saveQuiz(quiz);
    res.json({ quiz });
  });

  app.delete('/api/quizzes/:id', requireTeacher, async (req: AuthedRequest, res) => {
    const quiz = store.getQuizById(String(req.params.id));
    if (!quiz || quiz.ownerId !== req.teacher!.id) {
      res.status(404).json({ error: 'Викторина табылмады.' });
      return;
    }
    if (req.query.permanent === 'true' || quiz.deletedAt) {
      await store.deleteQuizPermanently(quiz.id);
    } else {
      quiz.deletedAt = new Date().toISOString();
      await store.saveQuiz(quiz);
    }
    res.json({ ok: true });
  });

  app.post('/api/quizzes/:id/restore', requireTeacher, async (req: AuthedRequest, res) => {
    const quiz = store.getQuizById(String(req.params.id));
    if (!quiz || quiz.ownerId !== req.teacher!.id) {
      res.status(404).json({ error: 'Викторина табылмады.' });
      return;
    }
    quiz.deletedAt = null;
    quiz.updatedAt = new Date().toISOString();
    await store.saveQuiz(quiz);
    res.json({ quiz });
  });

  app.post('/api/quizzes/:id/duplicate', requireTeacher, async (req: AuthedRequest, res) => {
    const source = store.getQuizById(String(req.params.id));
    if (!source || source.ownerId !== req.teacher!.id) {
      res.status(404).json({ error: 'Викторина табылмады.' });
      return;
    }
    const existingCodes = new Set(
      store.getAllTeachers().flatMap((t) => store.getQuizzesByOwner(t.id, true).map((q) => q.shareCode))
    );
    const now = new Date().toISOString();
    const copy: Quiz = {
      ...structuredClone(source),
      id: generateId('qz'),
      title: `${source.title} (көшірме)`,
      shareCode: generateShareCode(existingCodes),
      isPublic: false,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      questions: source.questions.map((q, i) => ({ ...structuredClone(q), id: generateId('q'), order: i })),
    };
    await store.saveQuiz(copy);
    res.status(201).json({ quiz: copy });
  });

  app.post('/api/quizzes/:id/share', requireTeacher, async (req: AuthedRequest, res) => {
    const quiz = store.getQuizById(String(req.params.id));
    if (!quiz || quiz.ownerId !== req.teacher!.id) {
      res.status(404).json({ error: 'Викторина табылмады.' });
      return;
    }
    if (typeof req.body?.isPublic === 'boolean') {
      quiz.isPublic = req.body.isPublic;
    }
    if (req.body?.regenerateCode) {
      const existingCodes = new Set(
        store.getAllTeachers().flatMap((t) => store.getQuizzesByOwner(t.id, true).map((q) => q.shareCode))
      );
      quiz.shareCode = generateShareCode(existingCodes);
    }
    quiz.updatedAt = new Date().toISOString();
    await store.saveQuiz(quiz);
    res.json({ quiz });
  });

  app.post('/api/quizzes/merge', requireTeacher, async (req: AuthedRequest, res) => {
    const ids: string[] = Array.isArray(req.body?.quizIds) ? req.body.quizIds.map(String) : [];
    const title = String(req.body?.title ?? '').trim() || 'Біріктірілген викторина';
    if (ids.length < 2) {
      res.status(400).json({ error: 'Біріктіру үшін кемінде 2 викторина таңдаңыз.' });
      return;
    }
    const questions: Question[] = [];
    for (const id of ids) {
      const qz = store.getQuizById(id);
      if (!qz || qz.ownerId !== req.teacher!.id || qz.deletedAt) continue;
      for (const q of qz.questions) {
        if (questions.length >= MAX_QUESTIONS) break;
        questions.push({ ...structuredClone(q), id: generateId('q'), order: questions.length });
      }
    }
    const existingCodes = new Set(
      store.getAllTeachers().flatMap((t) => store.getQuizzesByOwner(t.id, true).map((q) => q.shareCode))
    );
    const now = new Date().toISOString();
    const merged: Quiz = {
      id: generateId('qz'),
      ownerId: req.teacher!.id,
      title: title.slice(0, 200),
      folderId: req.body?.folderId ? String(req.body.folderId) : null,
      questions,
      shareCode: generateShareCode(existingCodes),
      isPublic: false,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    await store.saveQuiz(merged);
    res.status(201).json({ quiz: merged });
  });

  app.get('/api/quizzes/:id/export.docx', requireTeacher, async (req: AuthedRequest, res) => {
    const quiz = store.getQuizById(String(req.params.id));
    if (!quiz || quiz.ownerId !== req.teacher!.id) {
      res.status(404).json({ error: 'Викторина табылмады.' });
      return;
    }
    const includeKey = req.query.key !== 'false';
    const buf = await exportQuizToDocxBuffer(quiz, includeKey);
    const safeName = quiz.title.replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 48) || 'quiz';
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(`${safeName}${includeKey ? '_key' : '_student'}.docx`)}`
    );
    res.send(buf);
  });

  // =========================================================================
  // IMPORT & AI ROUTES
  // =========================================================================
  app.get('/api/import/template.xlsx', requireTeacher, (_req, res) => {
    const buf = buildExcelTemplateBuffer();
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', 'attachment; filename="quizkz-template.xlsx"');
    res.send(buf);
  });

  app.post('/api/import/structured', requireTeacher, upload.single('file'), async (req: AuthedRequest, res) => {
    try {
      if (req.file) {
        const extracted = await extractRawTextFromBuffer(req.file.buffer, req.file.originalname);
        if (extracted.isSpreadsheet) {
          const parsed = parseSpreadsheetBuffer(req.file.buffer);
          res.json(parsed);
          return;
        }
        const parsed = parseStructuredText(extracted.text);
        res.json(parsed);
        return;
      }

      const rawText = String(req.body?.text ?? '');
      const parsed = parseStructuredText(rawText);
      res.json(parsed);
    } catch (err) {
      console.error('[import/structured]', err);
      res.status(400).json({ error: 'Құжатты оқу мүмкін болмады. Файл форматын тексеріңіз.' });
    }
  });

  app.post('/api/import/parse-document', requireTeacher, upload.single('file'), async (req: AuthedRequest, res) => {
    if (!isAiAvailable()) {
      res.status(503).json({
        error: 'GEMINI_API_KEY орнатылмаған. AI тану қолжетімсіз — жылдам құрылымдық тануды қолданыңыз.',
      });
      return;
    }
    try {
      let text = String(req.body?.text ?? '');
      if (req.file) {
        const extracted = await extractRawTextFromBuffer(req.file.buffer, req.file.originalname);
        if (extracted.isSpreadsheet) {
          const sp = parseSpreadsheetBuffer(req.file.buffer);
          text = sp.rawText;
        } else {
          text = extracted.text;
        }
      }
      if (!text.trim()) {
        res.status(400).json({ error: 'Құжаттан мәтін табылмады.' });
        return;
      }
      const language: Locale = ['kk', 'ru', 'en'].includes(req.body?.language)
        ? req.body.language
        : req.teacher!.language;
      const questions = await parseQuestionsWithAi(text, language);
      res.json({ questions, rawText: text, warnings: [] });
    } catch (err) {
      console.error('[import/parse-document]', err);
      res.status(502).json({ error: 'AI құжатты тану кезінде қате шықты. Қайталап көріңіз.' });
    }
  });

  app.post('/api/ai/generate-questions', requireTeacher, async (req: AuthedRequest, res) => {
    if (!isAiAvailable()) {
      res.status(503).json({ error: 'GEMINI_API_KEY орнатылмаған. AI генерация өшірулі.' });
      return;
    }
    try {
      const topic = String(req.body?.topic ?? '').trim();
      const grade = String(req.body?.grade ?? '7-сынып').trim();
      const count = Math.min(25, Math.max(1, Number(req.body?.count) || 5));
      const difficulty = ['easy', 'medium', 'hard'].includes(req.body?.difficulty)
        ? req.body.difficulty
        : 'medium';
      const language: Locale = ['kk', 'ru', 'en'].includes(req.body?.language)
        ? req.body.language
        : req.teacher!.language;

      if (!topic) {
        res.status(400).json({ error: 'Тақырыпты енгізіңіз.' });
        return;
      }
      const questions = await generateQuestionsWithAi({ topic, grade, count, difficulty, language });
      res.json({ questions });
    } catch (err) {
      console.error('[ai/generate-questions]', err);
      res.status(502).json({ error: 'AI сұрақтар генерациясында қате шықты.' });
    }
  });

  app.post('/api/ai/refine-question', requireTeacher, async (req: AuthedRequest, res) => {
    if (!isAiAvailable()) {
      res.status(503).json({ error: 'GEMINI_API_KEY орнатылмаған. AI көмекші өшірулі.' });
      return;
    }
    try {
      const question = req.body?.question as Question;
      const action = req.body?.action;
      if (!question || !['harder', 'easier', 'add_options', 'write_explanation'].includes(action)) {
        res.status(400).json({ error: 'Жарамсыз сұраныс.' });
        return;
      }
      const language: Locale = ['kk', 'ru', 'en'].includes(req.body?.language)
        ? req.body.language
        : req.teacher!.language;
      const suggestion = await refineQuestionWithAi({ question, action, language });
      res.json({ suggestion });
    } catch (err) {
      console.error('[ai/refine-question]', err);
      res.status(502).json({ error: 'AI ұсыныс жасау кезінде қате шықты.' });
    }
  });

  app.post('/api/sessions/:id/ai-analysis', requireTeacher, async (req: AuthedRequest, res) => {
    if (!isAiAvailable()) {
      res.status(503).json({ error: 'GEMINI_API_KEY орнатылмаған. AI талдау өшірулі.' });
      return;
    }
    const session = sessionManager.getSession(String(req.params.id));
    if (!session || session.ownerId !== req.teacher!.id) {
      res.status(404).json({ error: 'Сессия табылмады.' });
      return;
    }
    try {
      const report = buildSessionReport(session);
      const language: Locale = ['kk', 'ru', 'en'].includes(req.body?.language)
        ? req.body.language
        : req.teacher!.language;
      const analysis = await analyzeSessionReportWithAi(report, language);
      session.aiAnalysis = analysis;
      await store.saveSession(session);
      res.json({ analysis });
    } catch (err) {
      console.error('[ai/session-analysis]', err);
      res.status(502).json({ error: 'AI талдау жасау кезінде қате шықты.' });
    }
  });

  // =========================================================================
  // ROOMS ROUTES
  // =========================================================================
  app.get('/api/rooms', requireTeacher, (req: AuthedRequest, res) => {
    res.json({ rooms: store.getRoomsByOwner(req.teacher!.id) });
  });

  app.post('/api/rooms', requireTeacher, async (req: AuthedRequest, res) => {
    const rawName = String(req.body?.name ?? '').trim().toUpperCase();
    if (!/^[A-Z0-9_-]{3,24}$/.test(rawName)) {
      res.status(400).json({
        error: 'Бөлме атауы 3–24 латын әрпі, сан, «_» немесе «-» таңбасынан тұруы керек (мысалы: MATH7A).',
      });
      return;
    }
    if (store.getRoomByName(rawName)) {
      res.status(409).json({ error: 'Бұл бөлме атауы бос емес. Басқа атау таңдаңыз.' });
      return;
    }
    const room: Room = {
      id: generateId('rm'),
      ownerId: req.teacher!.id,
      name: rawName,
      isPersistent: false,
      isLocked: false,
      blockedStudents: [],
      currentSessionId: null,
      createdAt: new Date().toISOString(),
    };
    await store.saveRoom(room);
    res.status(201).json({ room });
  });

  app.put('/api/rooms/:id', requireTeacher, async (req: AuthedRequest, res) => {
    const room = store.getRoomById(String(req.params.id));
    if (!room || room.ownerId !== req.teacher!.id) {
      res.status(404).json({ error: 'Бөлме табылмады.' });
      return;
    }
    if (typeof req.body?.name === 'string') {
      const nextName = req.body.name.trim().toUpperCase();
      if (!/^[A-Z0-9_-]{3,24}$/.test(nextName)) {
        res.status(400).json({
          error: 'Бөлме атауы 3–24 латын әрпі, сан, «_» немесе «-» болуы керек.',
        });
        return;
      }
      const existing = store.getRoomByName(nextName);
      if (existing && existing.id !== room.id) {
        res.status(409).json({ error: 'Бұл бөлме атауы басқа мұғалімде тіркелген.' });
        return;
      }
      room.name = nextName;
    }
    if (typeof req.body?.isLocked === 'boolean') {
      room.isLocked = req.body.isLocked;
    }
    if (req.body?.unblockName) {
      const target = String(req.body.unblockName).toLowerCase();
      room.blockedStudents = room.blockedStudents.filter((b) => b !== target);
    }
    await store.saveRoom(room);
    res.json({ room });
  });

  app.post('/api/rooms/:id/kick-all', requireTeacher, async (req: AuthedRequest, res) => {
    const room = store.getRoomById(String(req.params.id));
    if (!room || room.ownerId !== req.teacher!.id) {
      res.status(404).json({ error: 'Бөлме табылмады.' });
      return;
    }
    await sessionManager.kickAllStudents(room.id);
    res.json({ ok: true });
  });

  app.delete('/api/rooms/:id', requireTeacher, async (req: AuthedRequest, res) => {
    const room = store.getRoomById(String(req.params.id));
    if (!room || room.ownerId !== req.teacher!.id) {
      res.status(404).json({ error: 'Бөлме табылмады.' });
      return;
    }
    if (room.isPersistent) {
      res.status(400).json({ error: 'Тұрақты негізгі бөлмені жоюға болмайды.' });
      return;
    }
    if (room.currentSessionId) {
      await sessionManager.endSession(room.currentSessionId);
    }
    await store.deleteRoom(room.id);
    res.json({ ok: true });
  });

  // =========================================================================
  // SESSIONS & LIVE CONTROL ROUTES
  // =========================================================================
  app.get('/api/sessions', requireTeacher, (req: AuthedRequest, res) => {
    const sessions = store.getSessionsByOwner(req.teacher!.id);
    const list = sessions.map((s) => {
      const report = buildSessionReport(s);
      return {
        id: s.id,
        roomId: s.roomId,
        roomName: s.roomName,
        kind: s.kind,
        title: s.title,
        status: s.status,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        studentCount: report.studentCount,
        averagePercent: report.averagePercent,
        pendingManualCount: report.pendingManualCount,
        questionCount: s.quizSnapshot.questions.length,
      };
    });
    res.json({ sessions: list });
  });

  app.get('/api/sessions/student-progress', requireTeacher, (req: AuthedRequest, res) => {
    const query = String(req.query.q ?? '').trim().toLowerCase();
    const sessions = store
      .getSessionsByOwner(req.teacher!.id)
      .filter((s) => s.status === 'ended')
      .reverse();

    const studentsIndex = new Map<
      string,
      {
        key: string;
        displayName: string;
        studentCode?: string;
        points: { sessionId: string; title: string; date: string; percent: number; score: number }[];
      }
    >();

    for (const s of sessions) {
      const report = buildSessionReport(s);
      for (const st of report.studentStats) {
        const key = (st.studentCode || st.displayName).trim().toLowerCase();
        if (query && !st.displayName.toLowerCase().includes(query) && !(st.studentCode || '').toLowerCase().includes(query)) {
          continue;
        }
        let entry = studentsIndex.get(key);
        if (!entry) {
          entry = {
            key,
            displayName: st.displayName,
            studentCode: st.studentCode,
            points: [],
          };
          studentsIndex.set(key, entry);
        }
        entry.points.push({
          sessionId: s.id,
          title: s.title,
          date: s.startedAt,
          percent: st.percent,
          score: st.earnedPoints,
        });
      }
    }

    res.json({ students: [...studentsIndex.values()] });
  });

  app.post('/api/sessions', requireTeacher, async (req: AuthedRequest, res) => {
    try {
      const teacher = req.teacher!;
      const kind: SessionKind = ['quiz', 'space_race', 'quick_question', 'exit_ticket', 'vote'].includes(
        req.body?.kind
      )
        ? req.body.kind
        : 'quiz';

      let room = req.body?.roomId
        ? store.getRoomById(String(req.body.roomId))
        : store.getRoomsByOwner(teacher.id).find((r) => r.isPersistent);

      if (!room || room.ownerId !== teacher.id) {
        res.status(404).json({ error: 'Бөлме табылмады.' });
        return;
      }

      const settings: SessionSettings = {
        ...DEFAULT_SESSION_SETTINGS,
        ...teacher.defaultSessionSettings,
        ...(req.body?.settings || {}),
        proctoring: {
          ...DEFAULT_SESSION_SETTINGS.proctoring!,
          ...(teacher.defaultSessionSettings.proctoring || {}),
          ...(req.body?.settings?.proctoring || {}),
        },
      };

      const now = new Date().toISOString();
      let quiz: Quiz;

      if (kind === 'quiz' || kind === 'space_race') {
        const found = store.getQuizById(String(req.body?.quizId ?? ''));
        if (!found || found.ownerId !== teacher.id || found.deletedAt) {
          res.status(404).json({ error: 'Викторина табылмады.' });
          return;
        }
        if (found.questions.length === 0) {
          res.status(400).json({ error: 'Викторинада кемінде 1 сұрақ болуы керек.' });
          return;
        }
        quiz = found;
        if (kind === 'space_race') {
          settings.shuffleQuestions = true;
          settings.pacing = 'student_paced_open';
        }
      } else if (kind === 'quick_question') {
        const qType = ['multiple_choice', 'true_false', 'short_answer'].includes(req.body?.questionType)
          ? req.body.questionType
          : 'multiple_choice';
        const qText = String(req.body?.questionText ?? '').trim() || 'Жылдам сұрақ №1';
        const customOpts = Array.isArray(req.body?.options) ? req.body.options : null;
        const firstQuestion: Question = {
          id: generateId('qq'),
          type: qType,
          text: qText,
          options:
            qType === 'multiple_choice'
              ? customOpts && customOpts.length >= 2
                ? customOpts
                : [
                    { id: 'a', text: 'A' },
                    { id: 'b', text: 'B' },
                    { id: 'c', text: 'C' },
                    { id: 'd', text: 'D' },
                  ]
              : qType === 'true_false'
              ? [
                  { id: 'true', text: 'Дұрыс' },
                  { id: 'false', text: 'Қате' },
                ]
              : undefined,
          correct: Array.isArray(req.body?.correct) ? req.body.correct : [],
          points: 1,
          order: 0,
        };
        settings.pacing = 'teacher_paced';
        quiz = {
          id: generateId('qz_tmp'),
          ownerId: teacher.id,
          title: String(req.body?.title ?? '').trim() || 'Жылдам сұрақ',
          folderId: null,
          questions: [firstQuestion],
          shareCode: 'QUICK',
          createdAt: now,
          updatedAt: now,
        };
      } else if (kind === 'exit_ticket') {
        const q1Text =
          String(req.body?.q1 ?? '').trim() || 'Бүгінгі сабақты қаншалықты түсіндің?';
        const q2Text = String(req.body?.q2 ?? '').trim() || 'Бүгін не үйрендің?';
        const q3Text =
          String(req.body?.q3 ?? '').trim() || 'Мұғалім берген қорытынды сұраққа жауап беріңіз:';
        settings.pacing = 'student_paced_open';
        settings.showFeedbackAfterEach = false;
        quiz = {
          id: generateId('qz_exit'),
          ownerId: teacher.id,
          title: String(req.body?.title ?? '').trim() || 'Шығу билеті (Exit Ticket)',
          folderId: null,
          shareCode: 'EXIT',
          createdAt: now,
          updatedAt: now,
          questions: [
            {
              id: generateId('et'),
              type: 'multiple_choice',
              text: q1Text,
              options: [
                { id: 'a', text: 'Толық түсіндім' },
                { id: 'b', text: 'Жалпы түсіндім' },
                { id: 'c', text: 'Аздап қиындық бар' },
                { id: 'd', text: 'Қайта түсіндіру керек' },
              ],
              correct: [],
              points: 0,
              order: 0,
            },
            {
              id: generateId('et'),
              type: 'short_answer',
              text: q2Text,
              correct: [],
              points: 0,
              order: 1,
            },
            {
              id: generateId('et'),
              type: 'short_answer',
              text: q3Text,
              correct: [],
              points: 0,
              order: 2,
            },
          ],
        };
      } else {
        // vote
        const prompt = String(req.body?.votePrompt ?? '').trim() || 'Ең үздік идеяңызды жазыңыз:';
        quiz = {
          id: generateId('qz_vote'),
          ownerId: teacher.id,
          title: String(req.body?.title ?? '').trim() || `Дауыс беру: ${prompt.slice(0, 40)}`,
          folderId: null,
          shareCode: 'VOTE',
          createdAt: now,
          updatedAt: now,
          questions: [],
        };
      }

      if (req.body?.saveAsDefault) {
        teacher.defaultSessionSettings = structuredClone(settings);
        await store.saveTeacher(teacher);
      }

      const session = await sessionManager.createSession({
        ownerId: teacher.id,
        room,
        kind,
        quiz,
        settings,
        title: req.body?.title,
        votePrompt: req.body?.votePrompt,
        startImmediately: Boolean(req.body?.startImmediately),
      });

      res.status(201).json({ session });
    } catch (err) {
      console.error('[sessions/create]', err);
      res.status(500).json({ error: 'Сессияны бастау кезінде қате шықты.' });
    }
  });

  app.get('/api/sessions/:id', requireTeacher, (req: AuthedRequest, res) => {
    const session = sessionManager.getSession(String(req.params.id));
    if (!session || session.ownerId !== req.teacher!.id) {
      res.status(404).json({ error: 'Сессия табылмады.' });
      return;
    }
    res.json({ session });
  });

  app.get('/api/sessions/:id/report', requireTeacher, (req: AuthedRequest, res) => {
    const session = sessionManager.getSession(String(req.params.id));
    if (!session || session.ownerId !== req.teacher!.id) {
      res.status(404).json({ error: 'Сессия табылмады.' });
      return;
    }
    res.json({ session, report: buildSessionReport(session) });
  });

  app.delete('/api/sessions/:id', requireTeacher, async (req: AuthedRequest, res) => {
    const session = sessionManager.getSession(String(req.params.id));
    if (!session || session.ownerId !== req.teacher!.id) {
      res.status(404).json({ error: 'Сессия табылмады.' });
      return;
    }
    if (session.status !== 'ended') {
      await sessionManager.endSession(session.id);
    }
    await store.deleteSession(session.id);
    res.json({ ok: true });
  });

  app.post('/api/sessions/:id/start', requireTeacher, async (req: AuthedRequest, res) => {
    const session = sessionManager.getSession(String(req.params.id));
    if (!session || session.ownerId !== req.teacher!.id) {
      res.status(404).json({ error: 'Сессия табылмады.' });
      return;
    }
    const updated = await sessionManager.startSession(session.id);
    res.json({ session: updated });
  });

  app.post('/api/sessions/:id/pause', requireTeacher, async (req: AuthedRequest, res) => {
    const session = sessionManager.getSession(String(req.params.id));
    if (!session || session.ownerId !== req.teacher!.id) {
      res.status(404).json({ error: 'Сессия табылмады.' });
      return;
    }
    const updated = await sessionManager.pauseSession(session.id);
    res.json({ session: updated });
  });

  app.post('/api/sessions/:id/resume', requireTeacher, async (req: AuthedRequest, res) => {
    const session = sessionManager.getSession(String(req.params.id));
    if (!session || session.ownerId !== req.teacher!.id) {
      res.status(404).json({ error: 'Сессия табылмады.' });
      return;
    }
    const updated = await sessionManager.resumeSession(session.id);
    res.json({ session: updated });
  });

  app.post('/api/sessions/:id/next', requireTeacher, async (req: AuthedRequest, res) => {
    const session = sessionManager.getSession(String(req.params.id));
    if (!session || session.ownerId !== req.teacher!.id) {
      res.status(404).json({ error: 'Сессия табылмады.' });
      return;
    }
    const idx =
      typeof req.body?.index === 'number'
        ? req.body.index
        : session.currentQuestionIndex + 1;
    const updated = await sessionManager.setQuestionIndex(session.id, idx);
    res.json({ session: updated });
  });

  app.post('/api/sessions/:id/prev', requireTeacher, async (req: AuthedRequest, res) => {
    const session = sessionManager.getSession(String(req.params.id));
    if (!session || session.ownerId !== req.teacher!.id) {
      res.status(404).json({ error: 'Сессия табылмады.' });
      return;
    }
    const updated = await sessionManager.setQuestionIndex(
      session.id,
      session.currentQuestionIndex - 1
    );
    res.json({ session: updated });
  });

  app.post('/api/sessions/:id/timer', requireTeacher, async (req: AuthedRequest, res) => {
    const session = sessionManager.getSession(String(req.params.id));
    if (!session || session.ownerId !== req.teacher!.id) {
      res.status(404).json({ error: 'Сессия табылмады.' });
      return;
    }
    const action = req.body?.action;
    if (!['add_seconds', 'clear', 'set_seconds'].includes(action)) {
      res.status(400).json({ error: 'Жарамсыз таймер әрекеті.' });
      return;
    }
    const updated = await sessionManager.updateTimer(session.id, action, Number(req.body?.seconds));
    res.json({ session: updated });
  });

  app.post('/api/sessions/:id/reveal', requireTeacher, async (req: AuthedRequest, res) => {
    const session = sessionManager.getSession(String(req.params.id));
    if (!session || session.ownerId !== req.teacher!.id) {
      res.status(404).json({ error: 'Сессия табылмады.' });
      return;
    }
    const updated = await sessionManager.toggleRevealAnswer(session.id, Boolean(req.body?.reveal));
    res.json({ session: updated });
  });

  app.post('/api/sessions/:id/quick-question', requireTeacher, async (req: AuthedRequest, res) => {
    const session = sessionManager.getSession(String(req.params.id));
    if (!session || session.ownerId !== req.teacher!.id) {
      res.status(404).json({ error: 'Сессия табылмады.' });
      return;
    }
    const qType = ['multiple_choice', 'true_false', 'short_answer'].includes(req.body?.type)
      ? req.body.type
      : 'multiple_choice';
    const qText =
      String(req.body?.text ?? '').trim() ||
      `Жылдам сұрақ №${session.quizSnapshot.questions.length + 1}`;
    const question: Question = {
      id: generateId('qq'),
      type: qType,
      text: qText,
      options:
        qType === 'multiple_choice'
          ? Array.isArray(req.body?.options) && req.body.options.length >= 2
            ? req.body.options
            : [
                { id: 'a', text: 'A' },
                { id: 'b', text: 'B' },
                { id: 'c', text: 'C' },
                { id: 'd', text: 'D' },
              ]
          : qType === 'true_false'
          ? [
              { id: 'true', text: 'Дұрыс' },
              { id: 'false', text: 'Қате' },
            ]
          : undefined,
      correct: Array.isArray(req.body?.correct) ? req.body.correct : [],
      points: 1,
      order: session.quizSnapshot.questions.length,
    };
    const updated = await sessionManager.addQuickQuestion(session.id, question);
    res.json({ session: updated });
  });

  app.post('/api/sessions/:id/vote-phase', requireTeacher, async (req: AuthedRequest, res) => {
    const session = sessionManager.getSession(String(req.params.id));
    if (!session || session.ownerId !== req.teacher!.id) {
      res.status(404).json({ error: 'Сессия табылмады.' });
      return;
    }
    const phase = req.body?.phase;
    if (!['collecting', 'voting', 'results'].includes(phase)) {
      res.status(400).json({ error: 'Жарамсыз дауыс беру кезеңі.' });
      return;
    }
    const updated = await sessionManager.updateVotePhase(
      session.id,
      phase,
      req.body?.prompt ? String(req.body.prompt) : undefined
    );
    res.json({ session: updated });
  });

  app.post('/api/sessions/:id/assign-team', requireTeacher, async (req: AuthedRequest, res) => {
    const session = sessionManager.getSession(String(req.params.id));
    if (!session || session.ownerId !== req.teacher!.id) {
      res.status(404).json({ error: 'Сессия табылмады.' });
      return;
    }
    try {
      const updated = await sessionManager.assignStudentTeam(
        session.id,
        String(req.body?.studentId),
        String(req.body?.teamId)
      );
      res.json({ session: updated });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post('/api/sessions/:id/end', requireTeacher, async (req: AuthedRequest, res) => {
    const session = sessionManager.getSession(String(req.params.id));
    if (!session || session.ownerId !== req.teacher!.id) {
      res.status(404).json({ error: 'Сессия табылмады.' });
      return;
    }
    const ended = await sessionManager.endSession(session.id);
    res.json({ session: ended });
  });

  app.post('/api/sessions/:id/kick', requireTeacher, async (req: AuthedRequest, res) => {
    const session = sessionManager.getSession(String(req.params.id));
    if (!session || session.ownerId !== req.teacher!.id) {
      res.status(404).json({ error: 'Сессия табылмады.' });
      return;
    }
    try {
      const updated = await sessionManager.kickStudent(
        session.id,
        String(req.body?.studentId),
        Boolean(req.body?.block)
      );
      res.json({ session: updated });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post('/api/sessions/:id/retry-student', requireTeacher, async (req: AuthedRequest, res) => {
    const session = sessionManager.getSession(String(req.params.id));
    if (!session || session.ownerId !== req.teacher!.id) {
      res.status(404).json({ error: 'Сессия табылмады.' });
      return;
    }
    try {
      const updated = await sessionManager.allowStudentRetry(
        session.id,
        String(req.body?.studentId)
      );
      res.json({ session: updated });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post('/api/sessions/:id/grade', requireTeacher, async (req: AuthedRequest, res) => {
    const session = sessionManager.getSession(String(req.params.id));
    if (!session || session.ownerId !== req.teacher!.id) {
      res.status(404).json({ error: 'Сессия табылмады.' });
      return;
    }
    try {
      const updated = await sessionManager.gradeAnswer({
        sessionId: session.id,
        answerId: String(req.body?.answerId),
        points: Number(req.body?.points ?? 0),
        isCorrect: Boolean(req.body?.isCorrect),
        gradedBy: req.teacher!.id,
        acceptForAll: Boolean(req.body?.acceptForAll),
      });
      res.json({ session: updated, report: buildSessionReport(updated) });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post('/api/sessions/:id/lock', requireTeacher, async (req: AuthedRequest, res) => {
    const session = sessionManager.getSession(String(req.params.id));
    if (!session || session.ownerId !== req.teacher!.id) {
      res.status(404).json({ error: 'Сессия табылмады.' });
      return;
    }
    const room = store.getRoomById(session.roomId);
    if (!room) {
      res.status(404).json({ error: 'Бөлме табылмады.' });
      return;
    }
    room.isLocked = Boolean(req.body?.locked);
    await store.saveRoom(room);
    res.json({ room });
  });

  // Session Export Routes
  app.get('/api/sessions/:id/export.xlsx', requireTeacher, (req: AuthedRequest, res) => {
    const session = sessionManager.getSession(String(req.params.id));
    if (!session || session.ownerId !== req.teacher!.id) {
      res.status(404).json({ error: 'Сессия табылмады.' });
      return;
    }
    const buf = exportSessionToExcelBuffer(session);
    const safeName = session.title.replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 48) || 'report';
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(`${safeName}_report.xlsx`)}`
    );
    res.send(buf);
  });

  app.get('/api/sessions/:id/export.docx', requireTeacher, async (req: AuthedRequest, res) => {
    const session = sessionManager.getSession(String(req.params.id));
    if (!session || session.ownerId !== req.teacher!.id) {
      res.status(404).json({ error: 'Сессия табылмады.' });
      return;
    }
    const buf = await exportSessionToDocxBuffer(session);
    const safeName = session.title.replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 48) || 'report';
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(`${safeName}_report.docx`)}`
    );
    res.send(buf);
  });

  app.get('/api/sessions/:id/export.csv', requireTeacher, (req: AuthedRequest, res) => {
    const session = sessionManager.getSession(String(req.params.id));
    if (!session || session.ownerId !== req.teacher!.id) {
      res.status(404).json({ error: 'Сессия табылмады.' });
      return;
    }
    const csv = exportSessionToCsv(session);
    const safeName = session.title.replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 48) || 'report';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(`${safeName}_report.csv`)}`
    );
    res.send(csv);
  });

  // =========================================================================
  // REAL-TIME SSE STREAMS
  // =========================================================================
  app.get('/api/stream/teacher/:sessionId', requireTeacher, (req: AuthedRequest, res) => {
    const session = sessionManager.getSession(String(req.params.sessionId));
    if (!session || session.ownerId !== req.teacher!.id) {
      res.status(404).json({ error: 'Сессия табылмады.' });
      return;
    }
    const lastIdRaw = req.headers['last-event-id'] || req.query.lastSeq;
    const lastSeq = lastIdRaw ? Number(lastIdRaw) : undefined;
    setupSSEHeaders(res);
    sessionManager.attachTeacherStream(session.id, res, Number.isFinite(lastSeq) ? lastSeq : undefined);
  });

  app.get('/api/stream/student/:sessionId', requireStudent, (req: AuthedRequest, res) => {
    const { sessionId, studentId } = req.studentAuth!;
    if (sessionId !== String(req.params.sessionId)) {
      res.status(403).json({ error: 'Сессияға рұқсат жоқ.' });
      return;
    }
    setupSSEHeaders(res);
    sessionManager.attachStudentStream(sessionId, studentId, res);
  });

  // =========================================================================
  // PUBLIC STUDENT API (NO ACCOUNT REQUIRED)
  // =========================================================================
  app.get('/api/public/room/:name', (req, res) => {
    const room = store.getRoomByName(String(req.params.name));
    if (!room) {
      res.status(404).json({ error: 'Бұндай бөлме табылмады. Атауын тексеріңіз.' });
      return;
    }
    if (room.isLocked) {
      res.status(423).json({ error: 'Бұл бөлме мұғалім тарапынан құлыпталған.' });
      return;
    }
    const activeSession = room.currentSessionId
      ? sessionManager.getSession(room.currentSessionId)
      : undefined;

    if (!activeSession || activeSession.status === 'ended') {
      res.json({
        room: { id: room.id, name: room.name, hasActiveSession: false },
      });
      return;
    }

    res.json({
      room: {
        id: room.id,
        name: room.name,
        hasActiveSession: true,
        sessionId: activeSession.id,
        kind: activeSession.kind,
        title: activeSession.title,
        status: activeSession.status,
        requireNames: activeSession.settings.requireNames,
        requireStudentCode: Boolean(activeSession.settings.requireStudentCode),
        proctoring: activeSession.settings.proctoring,
        teams:
          activeSession.kind === 'space_race' &&
          activeSession.settings.spaceRaceAssignment === 'student_choice'
            ? activeSession.teams
            : undefined,
      },
    });
  });

  app.post('/api/public/join', async (req, res) => {
    try {
      const roomName = String(req.body?.roomName ?? '').trim();
      const displayName = String(req.body?.displayName ?? '').trim().slice(0, 80);
      const studentCode = req.body?.studentCode
        ? String(req.body.studentCode).trim().slice(0, 40)
        : undefined;
      const teamId = req.body?.teamId ? String(req.body.teamId) : undefined;

      const room = store.getRoomByName(roomName);
      if (!room) {
        res.status(404).json({ error: 'Бөлме табылмады. Атауын тексеріңіз.' });
        return;
      }

      const { session, student } = await sessionManager.joinStudent({
        room,
        displayName,
        studentCode,
        teamId,
      });

      const token = createStudentToken(session.id, student.id, room.id);
      const view = sessionManager.getStudentSessionView(session, student.id);
      res.status(201).json({ token, view });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message || 'Бөлмеге кіру мүмкін болмады.' });
    }
  });

  app.get('/api/public/state', requireStudent, async (req: AuthedRequest, res) => {
    const { sessionId, studentId } = req.studentAuth!;
    const view = await sessionManager.heartbeatStudent(sessionId, studentId);
    if (!view) {
      res.status(404).json({ error: 'Сессия табылмады.' });
      return;
    }
    if (view.student.kicked) {
      res.status(403).json({ error: 'Мұғалім сізді бөлмеден шығарды.', kicked: true });
      return;
    }
    res.json({ view });
  });

  app.post('/api/public/heartbeat', requireStudent, async (req: AuthedRequest, res) => {
    const { sessionId, studentId } = req.studentAuth!;
    const view = await sessionManager.heartbeatStudent(sessionId, studentId);
    if (!view) {
      res.status(404).json({ error: 'Сессия табылмады.' });
      return;
    }
    if (view.student.kicked) {
      res.status(403).json({ error: 'Мұғалім сізді бөлмеден шығарды.', kicked: true });
      return;
    }
    res.json({ view });
  });

  app.post('/api/public/answer', requireStudent, async (req: AuthedRequest, res) => {
    try {
      const { sessionId, studentId } = req.studentAuth!;
      const questionId = String(req.body?.questionId ?? '');
      const value = Array.isArray(req.body?.value)
        ? req.body.value.map(String)
        : [String(req.body?.value ?? '')];
      const timeSpentMs = Number(req.body?.timeSpentMs ?? 0);

      const result = await sessionManager.submitAnswer({
        sessionId,
        studentId,
        questionId,
        value,
        timeSpentMs,
      });
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post('/api/public/vote-submit', requireStudent, async (req: AuthedRequest, res) => {
    try {
      const { sessionId, studentId } = req.studentAuth!;
      const view = await sessionManager.submitVoteEntry(
        sessionId,
        studentId,
        String(req.body?.text ?? '')
      );
      res.json({ view });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post('/api/public/vote-ballot', requireStudent, async (req: AuthedRequest, res) => {
    try {
      const { sessionId, studentId } = req.studentAuth!;
      const view = await sessionManager.submitVoteBallot(
        sessionId,
        studentId,
        String(req.body?.submissionId ?? '')
      );
      res.json({ view });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post('/api/public/finish', requireStudent, async (req: AuthedRequest, res) => {
    try {
      const { sessionId, studentId } = req.studentAuth!;
      const view = await sessionManager.finishStudent(sessionId, studentId);
      res.json({ view });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post('/api/public/retry', requireStudent, async (req: AuthedRequest, res) => {
    try {
      const { sessionId, studentId } = req.studentAuth!;
      const session = sessionManager.getSession(sessionId);
      if (!session || !session.settings.allowRetry) {
        res.status(403).json({ error: 'Бұл сессияда қайта тапсыруға рұқсат жоқ.' });
        return;
      }
      await sessionManager.allowStudentRetry(sessionId, studentId);
      const view = sessionManager.getStudentSessionView(session, studentId);
      res.json({ view });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post('/api/public/violation', requireStudent, async (req: AuthedRequest, res) => {
    try {
      const { sessionId, studentId } = req.studentAuth!;
      const validTypes: ViolationType[] = [
        'tab_switch',
        'window_blur',
        'fullscreen_exit',
        'copy_attempt',
        'paste_attempt',
        'context_menu',
      ];
      const type: ViolationType = validTypes.includes(req.body?.type)
        ? req.body.type
        : 'tab_switch';

      const result = await sessionManager.recordViolation({
        sessionId,
        studentId,
        type,
        details: req.body?.details ? String(req.body.details) : undefined,
      });
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // =========================================================================
  // ADMIN ROUTES
  // =========================================================================
  app.get('/api/admin/teachers', requireAdmin, (_req, res) => {
    const teachers = store.getAllTeachers().map((t) => ({
      id: t.id,
      name: t.name,
      email: t.email,
      role: t.role,
      blocked: t.blocked,
      createdAt: t.createdAt,
      lastLoginAt: t.lastLoginAt,
      quizCount: store.getQuizzesByOwner(t.id).length,
      sessionCount: store.getSessionsByOwner(t.id).length,
      roomName: store.getRoomsByOwner(t.id).find((r) => r.isPersistent)?.name || '—',
    }));
    res.json({ teachers });
  });

  app.get('/api/admin/stats', requireAdmin, async (_req, res) => {
    const stats = await store.getStorageStats();
    res.json({
      ...stats,
      activeStudentsCount: sessionManager.getActiveStudentCountTotal(),
    });
  });

  app.post('/api/admin/teachers/:id/block', requireAdmin, async (req: AuthedRequest, res) => {
    const target = store.getTeacherById(String(req.params.id));
    if (!target) {
      res.status(404).json({ error: 'Мұғалім табылмады.' });
      return;
    }
    if (target.id === req.teacher!.id) {
      res.status(400).json({ error: 'Өзіңізді блоктай алмайсыз.' });
      return;
    }
    target.blocked = true;
    await store.saveTeacher(target);
    res.json({ ok: true });
  });

  app.post('/api/admin/teachers/:id/unblock', requireAdmin, async (req: AuthedRequest, res) => {
    const target = store.getTeacherById(String(req.params.id));
    if (!target) {
      res.status(404).json({ error: 'Мұғалім табылмады.' });
      return;
    }
    target.blocked = false;
    await store.saveTeacher(target);
    res.json({ ok: true });
  });

  app.post('/api/admin/teachers/:id/reset-link', requireAdmin, async (req: AuthedRequest, res) => {
    const target = store.getTeacherById(String(req.params.id));
    if (!target) {
      res.status(404).json({ error: 'Мұғалім табылмады.' });
      return;
    }
    const token = crypto.randomBytes(24).toString('hex');
    target.resetToken = token;
    target.resetTokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await store.saveTeacher(target);
    const origin =
      process.env.APP_URL?.replace(/\/$/, '') ||
      `${req.protocol}://${req.get('host')}`;
    res.json({ resetUrl: `${origin}/reset-password?token=${token}`, token });
  });

  app.get('/api/admin/backup', requireAdmin, async (_req, res) => {
    await store.createBackupNow().catch(() => {});
    const snapshot = store.exportAll();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="quizkz-full-backup-${new Date().toISOString().slice(0, 10)}.json"`
    );
    res.send(JSON.stringify(snapshot, null, 2));
  });

  // Unknown /api/* returns JSON 404
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API бағыты табылмады.' });
  });

  // =========================================================================
  // VITE DEV MIDDLEWARE / PRODUCTION STATIC SERVING
  // =========================================================================
  const httpServer = http.createServer(app);

  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        ws: { server: httpServer },
        hmr: process.env.DISABLE_HMR !== 'true',
        watch: process.env.DISABLE_HMR === 'true' ? null : {},
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir, { maxAge: '1d' }));
    app.get('*', (_req, res) => {
      const indexHtml = path.join(distDir, 'index.html');
      if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        res.status(500).send('Production build not found. Run npm run build.');
      }
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(
      `[QuizKZ Live] Server running at http://0.0.0.0:${PORT} (${IS_PROD ? 'production' : 'development'}) | AI: ${isAiAvailable() ? 'enabled' : 'disabled'}`
    );
  });
}

bootstrap().catch((err) => {
  console.error('[QuizKZ Live] Fatal startup error:', err);
  process.exit(1);
});
