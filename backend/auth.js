import crypto from 'node:crypto';
import User from './models/User.js';
import Session from './models/Session.js';

const SESSION_DAYS = 7;

export function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString('hex');
    crypto.scrypt(password, salt, 64, (error, derivedKey) => {
      if (error) return reject(error);
      resolve(`${salt}:${derivedKey.toString('hex')}`);
    });
  });
}

export function verifyPassword(password, stored) {
  return new Promise((resolve, reject) => {
    const [salt, key] = String(stored).split(':');
    if (!salt || !key) return resolve(false);
    crypto.scrypt(password, salt, 64, (error, derivedKey) => {
      if (error) return reject(error);
      const expected = Buffer.from(key, 'hex');
      const actual = derivedKey;
      resolve(expected.length === actual.length && crypto.timingSafeEqual(expected, actual));
    });
  });
}

function newToken() {
  return crypto.randomBytes(32).toString('hex');
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function createSession(userId) {
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await Session.create({ userId, tokenHash: tokenHash(token), expiresAt });
  return { token, expiresAt };
}

export function sessionCookie(token, maxAge = SESSION_DAYS * 24 * 60 * 60) {
  return `cashflow_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}`;
}

export function getCookie(request, name) {
  const header = request.headers.cookie || '';
  const found = header.split(';').map(v => v.trim()).find(v => v.startsWith(`${name}=`));
  return found ? decodeURIComponent(found.slice(name.length + 1)) : null;
}

export async function getCurrentUser(request) {
  const token = getCookie(request, 'cashflow_session');
  if (!token) return null;
  const session = await Session.findOne({ tokenHash: tokenHash(token), expiresAt: { $gt: new Date() } });
  if (!session) return null;
  return User.findById(session.userId).select('_id name email currency dateFormat numberFormat notificationPreferences createdAt');
}

export async function logout(request) {
  const token = getCookie(request, 'cashflow_session');
  if (token) await Session.deleteOne({ tokenHash: tokenHash(token) });
}

