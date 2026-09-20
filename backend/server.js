import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { connectDatabase } from './config/database.js';
import { handleApi } from './routes/api.js';
import User from './models/User.js';
import Expense from './models/Expense.js';
import Subscription from './models/Subscription.js';
import Loan from './models/Loan.js';
import CashAdjustment from './models/CashAdjustment.js';

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontend = path.resolve(__dirname, '../frontend');
const port = Number(process.env.PORT || 5000);

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml' };

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      return response.end();
    }
    if (request.url.startsWith('/api/')) return await handleApi(request, response);
    if (request.url === '/login' || request.url === '/signup') {
      let file = await fs.promises.readFile(path.join(frontend, 'auth.html'), 'utf-8');
      file = file.replace('__GOOGLE_CLIENT_ID__', process.env.GOOGLE_CLIENT_ID || '');
      response.writeHead(200, { 'Content-Type': mime['.html'] });
      return response.end(file);
    }

    let requestPath = new URL(request.url, `http://localhost:${port}`).pathname;
    if (requestPath === '/') requestPath = '/index.html';
    
    if (requestPath === '/index.html') {
      const { getCurrentUser } = await import('./auth.js');
      const user = await getCurrentUser(request);
      if (!user) {
        response.writeHead(302, { 'Location': '/login' });
        return response.end();
      }
    }

    const filePath = path.normalize(path.join(frontend, requestPath));
    if (!filePath.startsWith(frontend)) return send404(response);
    const file = await fs.promises.readFile(filePath);
    response.writeHead(200, { 'Content-Type': mime[path.extname(filePath)] || 'application/octet-stream' });
    response.end(file);
  } catch (error) {
    if (error.code === 'ENOENT') return send404(response);
    console.error(error);
    response.writeHead(500); response.end('Server error');
  }
});

function send404(response) { response.writeHead(404); response.end('Not found'); }

async function migrateLegacyData() {
  const owner = await User.findOne().sort({ createdAt: 1, _id: 1 });
  if (!owner) return;

  const models = [Expense, Subscription, Loan, CashAdjustment];
  for (const Model of models) {
    await Model.updateMany(
      { $or: [{ userId: { $exists: false } }, { userId: null }] },
      { $set: { userId: owner._id } }
    );
  }

  // Migrate old Expenses and CashAdjustments to Transactions
  const { default: Transaction } = await import('./models/Transaction.js');
  const count = await Transaction.countDocuments();
  if (count === 0) {
    console.log('Migrating old records to Transaction model...');
    const allExpenses = await Expense.find();
    for (const e of allExpenses) {
      await Transaction.create({ userId: e.userId, type: 'expense', amount: e.amount, description: e.description || 'Expense', date: e.date, createdAt: e.createdAt });
    }
    const allAdjustments = await CashAdjustment.find();
    for (const a of allAdjustments) {
      await Transaction.create({ userId: a.userId, type: a.type === 'add' ? 'add_money' : 'deduct_money', amount: a.amount, description: a.type === 'add' ? 'Added Money' : 'Deducted Money', date: a.date, createdAt: a.createdAt });
    }
    const allLoans = await Loan.find();
    for (const l of allLoans) {
      await Transaction.create({ userId: l.userId, type: 'loan_given', amount: l.amount, description: `Loan to ${l.person}`, date: l.date, createdAt: l.createdAt, relatedId: l._id });
      if (l.repaidAmount > 0) {
         await Transaction.create({ userId: l.userId, type: 'loan_repayment', amount: l.repaidAmount, description: `Repayment from ${l.person}`, date: l.updatedAt || l.createdAt, createdAt: l.updatedAt || l.createdAt, relatedId: l._id });
      }
    }
    const allSubs = await Subscription.find();
    for (const s of allSubs) {
      await Transaction.create({ userId: s.userId, type: 'subscription', amount: s.amount, description: s.name, date: s.createdAt, createdAt: s.createdAt, relatedId: s._id });
    }
    console.log('Migration complete.');
  }
}

connectDatabase(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/cashflow')
  .then(async () => {
    await migrateLegacyData();
    server.listen(port, () => console.log(`CashFlow running at http://localhost:${port}`));
  })
  .catch(error => { console.error('MongoDB connection failed:', error.message); process.exit(1); });
