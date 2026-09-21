import Expense from '../models/Expense.js';
import Subscription from '../models/Subscription.js';
import Loan from '../models/Loan.js';
import CashAdjustment from '../models/CashAdjustment.js';
import Transaction from '../models/Transaction.js';
import Category from '../models/Category.js';
import Budget from '../models/Budget.js';
import Notification from '../models/Notification.js';
import { getCurrentUser } from '../auth.js';
import { handleAuth, send } from './auth.js';

const models = { subscriptions: Subscription, loans: Loan, transactions: Transaction, categories: Category, budgets: Budget, notifications: Notification };

// Helper to validate amounts
function isValidAmount(amount) {
  return typeof amount === 'number' && !isNaN(amount) && isFinite(amount) && amount > 0;
}

function getLocalYYYYMMDD() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function getNextDate(dateStr, frequency) {
  const d = new Date(dateStr + 'T12:00:00');
  if (frequency === 'weekly') d.setDate(d.getDate() + 7);
  else if (frequency === 'monthly') d.setMonth(d.getMonth() + 1);
  else if (frequency === 'yearly') d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

const processingLocks = new Set();

async function processDueSubscriptions(userId) {
  if (processingLocks.has(userId.toString())) return;
  processingLocks.add(userId.toString());
  try {
    const todayStr = getLocalYYYYMMDD();
  
  // Upcoming notifications (due tomorrow)
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);
  
  const upcomingSubs = await Subscription.find({ userId, active: true, processed: false, date: tomorrowStr });
  for (const sub of upcomingSubs) {
    const msg = `${sub.name} payment of ₹${sub.amount} is due tomorrow.`;
    const exists = await Notification.exists({ userId, relatedId: sub._id, message: msg });
    if (!exists) await Notification.create({ userId, message: msg, type: 'info', relatedId: sub._id });
  }

  // Process due subscriptions
  let safetyCounter = 0;
  while (safetyCounter++ < 100) {
    const dueSubs = await Subscription.find({ userId, active: true, processed: false, date: { $lte: todayStr } });
    if (dueSubs.length === 0) break;
    
    for (const sub of dueSubs) {
      await Transaction.create({
        userId, type: 'subscription', amount: sub.amount, description: sub.name, relatedId: sub._id,
        categoryId: sub.categoryId, date: new Date(sub.date + 'T12:00:00')
      });
      
      const msg = `${sub.name} payment of ₹${sub.amount} was processed.`;
      const dateMsg = `${msg} [${sub.date}]`; // ensure uniqueness for multiple missed cycles
      const exists = await Notification.exists({ userId, relatedId: sub._id, message: dateMsg });
      if (!exists) await Notification.create({ userId, message: dateMsg, type: 'success', relatedId: sub._id });

      if (sub.frequency && sub.frequency !== 'one-time') {
        sub.date = getNextDate(sub.date, sub.frequency);
      } else {
        sub.processed = true;
      }
      await sub.save();
    }
  }
  } finally {
    processingLocks.delete(userId.toString());
  }
}

export async function handleApi(request, response) {
  const url = new URL(request.url, 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] !== 'api') return false;
  if (parts[1] === 'auth') return handleAuth(request, response);
  if (parts[1] === 'health') return send(response, 200, { status: 'ok' });

  const user = await getCurrentUser(request);
  if (!user) return send(response, 401, { message: 'Please log in to continue.' });

  await processDueSubscriptions(user._id);

  const resource = parts[1];
  const id = parts[2];

  if (parts[1] === 'analytics') {
    if (request.method !== 'GET') return send(response, 405, { message: 'Method not allowed' });
    
    const txs = await Transaction.find({ userId: user._id });
    const subs = await Subscription.find({ userId: user._id });
    const loans = await Loan.find({ userId: user._id });

    // Current Balance
    const balance = txs.reduce((tot, t) => {
      if (['add_money', 'income', 'loan_repayment'].includes(t.type)) return tot + t.amount;
      if (['deduct_money', 'expense', 'loan_given', 'subscription'].includes(t.type)) return tot - t.amount;
      return tot;
    }, 0);

    // Monthly Summary & Spending Breakdown
    const today = new Date();
    const currentMonth = today.getMonth();
    const currentYear = today.getFullYear();

    let monthlyIncome = 0;
    let monthlySpent = 0;
    let monthlySubs = 0;
    let monthlyLoanRepayments = 0;
    let monthlyLent = 0;

    let totalExpenses = 0;
    let totalSubs = 0;
    let totalDeductions = 0;

    const monthStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;
    const budgetDoc = await Budget.findOne({ userId: user._id, month: monthStr });
    const categories = await Category.find({ userId: user._id });
    const catMap = {};
    categories.forEach(c => catMap[c._id.toString()] = c.name);

    let categorySpending = {};

    txs.forEach(t => {
      const d = new Date(t.date);
      const isCurrentMonth = d.getMonth() === currentMonth && d.getFullYear() === currentYear;
      
      // Spending breakdown (all time or current month? let's do all-time for breakdown to show total distribution)
      if (t.type === 'expense') totalExpenses += t.amount;
      if (t.type === 'subscription') totalSubs += t.amount;
      if (t.type === 'deduct_money') totalDeductions += t.amount;

      // Monthly summary
      if (isCurrentMonth) {
        if (['add_money', 'income'].includes(t.type)) monthlyIncome += t.amount;
        if (['expense', 'deduct_money'].includes(t.type)) monthlySpent += t.amount;
        if (t.type === 'subscription') { monthlySpent += t.amount; monthlySubs += t.amount; }
        if (t.type === 'loan_repayment') monthlyLoanRepayments += t.amount;
        if (t.type === 'loan_given') { monthlySpent += t.amount; monthlyLent += t.amount; }
        
        // Category spending (only actual spending counts)
        if (['expense', 'subscription'].includes(t.type) && t.categoryId) {
           const cName = catMap[t.categoryId.toString()] || 'Unknown';
           categorySpending[cName] = (categorySpending[cName] || 0) + t.amount;
        }
      }
    });

    if (budgetDoc && budgetDoc.amount > 0) {
      const pct = (monthlySpent / budgetDoc.amount) * 100;
      if (pct >= 80) {
        const roundedPct = Math.round(pct);
        const warnMsg = `Your monthly budget is ${roundedPct >= 100 ? 'fully' : roundedPct + '%'} used.`;
        const exists = await Notification.exists({ userId: user._id, message: warnMsg });
        if (!exists) await Notification.create({ userId: user._id, message: warnMsg, type: pct >= 100 ? 'danger' : 'warning' });
      }
    }

    const upcomingSubscriptions = subs.filter(s => !s.processed && s.active);

    let totalLent = 0;
    let totalRepayments = 0;
    loans.forEach(l => {
      totalLent += (l.amount || 0);
      totalRepayments += (l.repaidAmount || 0);
    });
    const outstandingLoans = Math.max(0, totalLent - totalRepayments);

    return send(response, 200, {
      balance,
      monthly: { income: monthlyIncome, spent: monthlySpent, subs: monthlySubs, loanRepayments: monthlyLoanRepayments, lent: monthlyLent },
      breakdown: { expenses: totalExpenses, subscriptions: totalSubs, deductions: totalDeductions },
      categorySpending,
      budget: budgetDoc ? budgetDoc.amount : null,
      upcomingSubscriptions,
      loans: { totalLent, totalRepayments, outstanding: outstandingLoans }
    });
  }

  if (!models[resource]) return send(response, 404, { message: 'API route not found' });

  try {
    const model = models[resource];

    if (request.method === 'GET' && !id) {
      if (resource === 'categories') {
        let cats = await Category.find({ userId: user._id });
        if (cats.length === 0) {
          const defaults = ['Food', 'Transport', 'Shopping', 'Bills', 'Entertainment', 'Health', 'Education', 'Travel', 'Other'];
          await Category.insertMany(defaults.map(name => ({ name, userId: user._id })));
          cats = await Category.find({ userId: user._id });
        }
        return send(response, 200, cats);
      }
      if (resource === 'transactions') {
        const query = { userId: user._id };
        const search = url.searchParams.get('search');
        if (search) {
          const cats = await Category.find({ userId: user._id, name: { $regex: search, $options: 'i' } });
          const catIds = cats.map(c => c._id);
          const typeLabels = { 'expense': 'expense', 'income': 'income', 'add money': 'add_money', 'deduct money': 'deduct_money', 'loan given': 'loan_given', 'loan repayment': 'loan_repayment', 'subscription': 'subscription' };
          const matchedTypes = Object.keys(typeLabels).filter(k => k.includes(search.toLowerCase())).map(k => typeLabels[k]);
          query.$or = [
            { description: { $regex: search, $options: 'i' } },
            ...(catIds.length ? [{ categoryId: { $in: catIds } }] : []),
            ...(matchedTypes.length ? [{ type: { $in: matchedTypes } }] : [])
          ];
        }
        if (url.searchParams.get('type')) query.type = url.searchParams.get('type');
        if (url.searchParams.get('category')) query.categoryId = url.searchParams.get('category');
        
        const dateFrom = url.searchParams.get('dateFrom');
        const dateTo = url.searchParams.get('dateTo');
        if (dateFrom || dateTo) {
          query.date = {};
          if (dateFrom) query.date.$gte = new Date(dateFrom + 'T00:00:00.000Z');
          if (dateTo) query.date.$lte = new Date(dateTo + 'T23:59:59.999Z');
        }

        let sort = { date: -1, createdAt: -1 };
        const s = url.searchParams.get('sort');
        if (s === 'oldest') sort = { date: 1, createdAt: 1 };
        if (s === 'amount_desc') sort = { amount: -1 };
        if (s === 'amount_asc') sort = { amount: 1 };

        const isExport = url.searchParams.get('export') === 'true';
        if (isExport) {
          const exportFormat = url.searchParams.get('format') || 'csv';
          const txs = await model.find(query).sort(sort);
          const allCats = await Category.find({ userId: user._id });
          const catMap = {};
          allCats.forEach(c => catMap[c._id.toString()] = c.name);

          if (exportFormat === 'json') {
            const mapped = txs.map(t => ({
              date: new Date(t.date).toISOString().slice(0, 10),
              type: t.type,
              description: t.description,
              amount: t.amount,
              category: t.categoryId ? (catMap[t.categoryId.toString()] || '') : ''
            }));
            response.writeHead(200, {
              'Content-Type': 'application/json',
              'Content-Disposition': 'attachment; filename="transactions.json"'
            });
            response.end(JSON.stringify(mapped, null, 2));
            return true;
          } else {
            let csv = 'Date,Type,Description,Category,Amount\n';
            for (const t of txs) {
              const d = new Date(t.date).toISOString().slice(0, 10);
              const type = t.type;
              const desc = `"${(t.description||'').replace(/"/g, '""')}"`;
              const cat = `"${t.categoryId ? (catMap[t.categoryId.toString()]||'') : ''}"`;
              const amt = t.amount;
              csv += `${d},${type},${desc},${cat},${amt}\n`;
            }
            response.writeHead(200, {
              'Content-Type': 'text/csv',
              'Content-Disposition': 'attachment; filename="transactions.csv"'
            });
            response.end(csv);
            return true;
          }
        }

        const page = parseInt(url.searchParams.get('page') || '1');
        const limit = parseInt(url.searchParams.get('limit') || '50');
        const skip = (page - 1) * limit;

        const data = await model.find(query).sort(sort).skip(skip).limit(limit);
        const total = await model.countDocuments(query);
        return send(response, 200, { data, total, page, limit });
      }

      const data = await model.find({ userId: user._id }).sort({ createdAt: -1 });
      return send(response, 200, data);
    }

    if (request.method === 'POST' && !id) {
      const body = await readJson(request);
      delete body.userId; delete body._id; delete body.createdAt; delete body.updatedAt;

      if (body.amount !== undefined && !isValidAmount(Number(body.amount))) {
        return send(response, 400, { message: 'Amount must be greater than 0' });
      }

      let created;

      if (resource === 'transactions') {
        const allowedTypes = ['income', 'expense', 'add_money', 'deduct_money'];
        if (!allowedTypes.includes(body.type)) {
          return send(response, 400, { message: 'Invalid transaction type' });
        }
        created = await Transaction.create({ ...body, userId: user._id });
      } 
      else if (resource === 'categories') {
        created = await Category.create({ ...body, userId: user._id });
      }
      else if (resource === 'budgets') {
        const { month, amount } = body;
        created = await Budget.findOneAndUpdate({ userId: user._id, month }, { amount }, { new: true, upsert: true });
      }
      else if (resource === 'loans') {
        created = await Loan.create({ ...body, userId: user._id });
        await Transaction.create({
          userId: user._id,
          type: 'loan_given',
          amount: created.amount,
          description: `Loan to ${created.person}`,
          relatedId: created._id
        });
      }
      else if (resource === 'subscriptions') {
        created = await Subscription.create({ ...body, userId: user._id });
        await processDueSubscriptions(user._id);
        created = await Subscription.findById(created._id);
      }

      return send(response, 201, created);
    }

    if (request.method === 'PUT' && id) {
      const body = await readJson(request);
      delete body.userId; delete body._id; delete body.createdAt; delete body.updatedAt;

      if (resource === 'loans' && body.repaidAmount !== undefined) {
        const loan = await Loan.findOne({ _id: id, userId: user._id });
        if (!loan) return send(response, 404, { message: 'Record not found' });

        const newRepaid = Number(body.repaidAmount);
        if (!isValidAmount(newRepaid) && newRepaid !== 0) return send(response, 400, { message: 'Invalid repayment amount' });
        
        const repaymentDiff = newRepaid - loan.repaidAmount;
        if (repaymentDiff > 0) {
          const outstanding = loan.amount - loan.repaidAmount;
          if (repaymentDiff > outstanding) {
             return send(response, 400, { message: 'Repayment exceeds outstanding loan amount' });
          }
          await Transaction.create({
            userId: user._id,
            type: 'loan_repayment',
            amount: repaymentDiff,
            description: `Repayment from ${loan.person}`,
            relatedId: loan._id
          });
        }
      }

      const updated = await model.findOneAndUpdate({ _id: id, userId: user._id }, body, { new: true, runValidators: true });
      return updated ? send(response, 200, updated) : send(response, 404, { message: 'Record not found' });
    }

    if (request.method === 'DELETE' && !id && resource === 'notifications') {
      await Notification.deleteMany({ userId: user._id });
      return send(response, 200, { message: 'All notifications cleared' });
    }

    if (request.method === 'DELETE' && id) {
      const deleted = await model.findOneAndDelete({ _id: id, userId: user._id });
      if (!deleted) return send(response, 404, { message: 'Record not found' });
      
      // Cascade delete related transactions for loans and subscriptions
      if (resource === 'loans' || resource === 'subscriptions') {
        await Transaction.deleteMany({ relatedId: id, userId: user._id });
      }
      
      if (resource === 'categories') {
        await Transaction.updateMany({ categoryId: id, userId: user._id }, { $unset: { categoryId: "" } });
        await Subscription.updateMany({ categoryId: id, userId: user._id }, { $unset: { categoryId: "" } });
      }

      return send(response, 200, { success: true });
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
