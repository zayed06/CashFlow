import User from '../models/User.js';
import Session from '../models/Session.js';
import Expense from '../models/Expense.js';
import Subscription from '../models/Subscription.js';
import Loan from '../models/Loan.js';
import CashAdjustment from '../models/CashAdjustment.js';
import { hashPassword, verifyPassword, createSession, sessionCookie, getCurrentUser, getCookie, logout } from '../auth.js';
import { OAuth2Client } from 'google-auth-library';

const models = [Expense, Subscription, Loan, CashAdjustment];

export async function handleAuth(request, response) {
  const url = new URL(request.url, 'http://localhost');
  const route = url.pathname.replace(/^\/api\/auth\/?/, '');

  try {
    if (request.method === 'POST' && route === 'signup') {
      const body = await readJson(request);
      const name = String(body.name || '').trim();
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      if (name.length < 2) return send(response, 400, { message: 'Enter your name.' });
      if (!/^\S+@\S+\.\S+$/.test(email)) return send(response, 400, { message: 'Enter a valid email address.' });
      if (password.length < 8) return send(response, 400, { message: 'Password must be at least 8 characters.' });
      if (await User.exists({ email })) return send(response, 409, { message: 'An account with this email already exists.' });

      const userCount = await User.countDocuments();
      const user = await User.create({ name, email, passwordHash: await hashPassword(password) });
      // If this is the first account, claim records created by the old single-user version.
      if (userCount === 0) await Promise.all(models.map(Model => Model.updateMany({ userId: { $exists: false } }, { $set: { userId: user._id } })));

      const session = await createSession(user._id);
      response.setHeader('Set-Cookie', sessionCookie(session.token));
      return send(response, 201, { user: safeUser(user) });
    }

    if (request.method === 'POST' && route === 'login') {
      const body = await readJson(request);
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      const user = await User.findOne({ email });
      if (!user || !user.passwordHash || !(await verifyPassword(password, user.passwordHash))) return send(response, 401, { message: 'Incorrect email or password.' });
      const session = await createSession(user._id);
      response.setHeader('Set-Cookie', sessionCookie(session.token));
      return send(response, 200, { user: safeUser(user) });
    }

    if (request.method === 'POST' && route === 'google') {
      const body = await readJson(request);
      const { credential } = body;
      if (!credential) return send(response, 400, { message: 'Missing credential' });

      const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
      const ticket = await client.verifyIdToken({
        idToken: credential,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      const payload = ticket.getPayload();
      const email = payload.email.toLowerCase();
      const name = payload.name;
      const googleId = payload.sub;

      let user = await User.findOne({ email });
      if (user) {
        if (!user.googleId) {
          user.googleId = googleId;
          await user.save();
        }
      } else {
        const userCount = await User.countDocuments();
        user = await User.create({ name, email, googleId });
        if (userCount === 0) await Promise.all(models.map(Model => Model.updateMany({ userId: { $exists: false } }, { $set: { userId: user._id } })));
      }

      const session = await createSession(user._id);
      response.setHeader('Set-Cookie', sessionCookie(session.token));
      return send(response, 200, { user: safeUser(user) });
    }

    if (request.method === 'POST' && route === 'logout') {
      await logout(request);
      response.setHeader('Set-Cookie', sessionCookie('', 0));
      return send(response, 200, { success: true });
    }

    if (request.method === 'GET' && route === 'me') {
      const user = await getCurrentUser(request);
      return user ? send(response, 200, { user }) : send(response, 401, { message: 'Not authenticated.' });
    }

    return send(response, 404, { message: 'Auth route not found' });
  } catch (error) {
    console.error(error);
    return send(response, 400, { message: error.message });
  }
}

export function send(response, status, data) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(data));
  return true;
}

function safeUser(user) { return { id: user._id, name: user.name, email: user.email, currency: user.currency || 'INR', dateFormat: user.dateFormat || 'DD/MM/YYYY', firstDayOfWeek: user.firstDayOfWeek || 'Monday', numberFormat: user.numberFormat || 'Indian', createdAt: user.createdAt }; }

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', chunk => body += chunk);
    request.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error('Invalid JSON')); } });
    request.on('error', reject);
  });
}

