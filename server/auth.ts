import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import type { PublicTeacher, Room, Teacher } from '../src/types.ts';

const TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
const STUDENT_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

let runtimeSecret: string | null = null;

export function getAuthSecret(): string {
  if (process.env.AUTH_SECRET && process.env.AUTH_SECRET.trim().length >= 16) {
    return process.env.AUTH_SECRET.trim();
  }
  if (!runtimeSecret) {
    if (process.env.NODE_ENV === 'production') {
      console.warn(
        '[SECURITY WARNING] AUTH_SECRET environment variable is not set or too short (<16 chars). Generating an ephemeral in-memory secret; sessions will reset on restart. Configure AUTH_SECRET in production!'
      );
    }
    runtimeSecret = crypto.randomBytes(32).toString('hex');
  }
  return runtimeSecret;
}

export function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString('hex');
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) reject(err);
      else resolve({ hash: derivedKey.toString('hex'), salt });
    });
  });
}

export function verifyPassword(password: string, hash: string, salt: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) {
        reject(err);
        return;
      }
      const keyBuf = Buffer.from(hash, 'hex');
      if (keyBuf.length !== derivedKey.length) {
        resolve(false);
        return;
      }
      resolve(crypto.timingSafeEqual(keyBuf, derivedKey));
    });
  });
}

interface TeacherTokenPayload {
  kind: 'teacher';
  sub: string;
  role: 'admin' | 'teacher';
  iat: number;
  exp: number;
}

interface StudentTokenPayload {
  kind: 'student';
  sessionId: string;
  studentId: string;
  roomId: string;
  iat: number;
  exp: number;
}

function signPayload(payload: object): string {
  const secret = getAuthSecret();
  const body = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyTokenRaw<T>(token: string): T | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const secret = getAuthSecret();
  const expectedSig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8')) as T & {
      exp?: number;
    };
    if (typeof parsed.exp === 'number' && parsed.exp < Date.now()) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function createTeacherToken(teacher: Teacher): string {
  const now = Date.now();
  const payload: TeacherTokenPayload = {
    kind: 'teacher',
    sub: teacher.id,
    role: teacher.role,
    iat: now,
    exp: now + TOKEN_TTL_MS,
  };
  return signPayload(payload);
}

export function verifyTeacherToken(token: string): TeacherTokenPayload | null {
  const payload = verifyTokenRaw<TeacherTokenPayload>(token);
  if (!payload || payload.kind !== 'teacher' || !payload.sub) return null;
  return payload;
}

export function createStudentToken(sessionId: string, studentId: string, roomId: string): string {
  const now = Date.now();
  const payload: StudentTokenPayload = {
    kind: 'student',
    sessionId,
    studentId,
    roomId,
    iat: now,
    exp: now + STUDENT_TOKEN_TTL_MS,
  };
  return signPayload(payload);
}

export function verifyStudentToken(token: string): StudentTokenPayload | null {
  const payload = verifyTokenRaw<StudentTokenPayload>(token);
  if (!payload || payload.kind !== 'student' || !payload.sessionId || !payload.studentId) {
    return null;
  }
  return payload;
}

export function extractBearerToken(req: Request): string | null {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    return auth.slice(7).trim();
  }
  const queryToken = req.query.token;
  if (typeof queryToken === 'string' && queryToken.trim()) {
    return queryToken.trim();
  }
  return null;
}

export function toPublicTeacher(teacher: Teacher, persistentRoom?: Room): PublicTeacher {
  return {
    id: teacher.id,
    name: teacher.name,
    email: teacher.email,
    role: teacher.role,
    blocked: teacher.blocked,
    language: teacher.language,
    defaultSessionSettings: teacher.defaultSessionSettings,
    createdAt: teacher.createdAt,
    lastLoginAt: teacher.lastLoginAt,
    persistentRoom,
  };
}

// Simple per-IP sliding window rate limiter
interface RateEntry {
  timestamps: number[];
}

export function createRateLimiter(maxRequests: number, windowMs: number) {
  const map = new Map<string, RateEntry>();

  const cleanup = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [key, entry] of map.entries()) {
      entry.timestamps = entry.timestamps.filter((t) => t > cutoff);
      if (entry.timestamps.length === 0) map.delete(key);
    }
  }, Math.max(windowMs, 30_000));
  if (cleanup.unref) cleanup.unref();

  return (req: Request, res: Response, next: NextFunction) => {
    const ip =
      (typeof req.headers['x-forwarded-for'] === 'string'
        ? req.headers['x-forwarded-for'].split(',')[0].trim()
        : req.ip) || 'unknown';
    const now = Date.now();
    const cutoff = now - windowMs;
    const entry = map.get(ip) || { timestamps: [] };
    entry.timestamps = entry.timestamps.filter((t) => t > cutoff);
    if (entry.timestamps.length >= maxRequests) {
      res.status(429).json({
        error: 'Сұраныстар саны тым көп. Бір минуттан кейін қайталап көріңіз.',
        code: 'RATE_LIMITED',
      });
      return;
    }
    entry.timestamps.push(now);
    map.set(ip, entry);
    next();
  };
}
