import Expense from '../models/Expense.js';
import Subscription from '../models/Subscription.js';
import Loan from '../models/Loan.js';
import CashAdjustment from '../models/CashAdjustment.js';
import { getCurrentUser } from '../auth.js';
import { handleAuth, send } from './auth.js';

const models = { expenses: Expense, subscriptions: Subscription, loans: Loan, adjustments: CashAdjustment };

// Every finance record is always scoped to the authenticated user.
// The client never controls userId. The server gets it from the session.

export async function handleApi(request, response) {
  const url = new URL(request.url, 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] !== 'api') return false;
  if (parts[1] === 'auth') return handleAuth(request, response);
  if (parts[1] === 'health') return send(response, 200, { status: 'ok' });

  const user = await getCurrentUser(request);
  if (!user) return send(response, 401, { message: 'Please log in to continue.' });

  const model = models[parts[1]];
  if (!model) return send(response, 404, { message: 'API route not found' });

  try {
    if (request.method === 'GET' && !parts[2]) {
      const data = await model.find({ userId: user._id }).sort({ createdAt: -1 });
      return send(response, 200, data);
    }
    if (request.method === 'POST' && !parts[2]) {
      const body = await readJson(request);
      delete body.userId;
      delete body._id;
      delete body.createdAt;
      delete body.updatedAt;
      const created = await model.create({ ...body, userId: user._id });
      return send(response, 201, created);
    }
    if (request.method === 'PUT' && parts[2]) {
      const body = await readJson(request);
      delete body.userId;
      delete body._id;
      delete body.createdAt;
      delete body.updatedAt;
      const updated = await model.findOneAndUpdate({ _id: parts[2], userId: user._id }, body, { new: true, runValidators: true });
      return updated ? send(response, 200, updated) : send(response, 404, { message: 'Record not found' });
    }
    if (request.method === 'DELETE' && parts[2]) {
      const deleted = await model.findOneAndDelete({ _id: parts[2], userId: user._id });
      return deleted ? send(response, 200, { success: true }) : send(response, 404, { message: 'Record not found' });
    }
    return send(response, 405, { message: 'Method not allowed' });
  } catch (error) {
    console.error(error);
    return send(response, 400, { message: error.message });
  }
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', chunk => body += chunk);
    request.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error('Invalid JSON')); } });
    request.on('error', reject);
  });
}
