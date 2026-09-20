import Expense from '../models/Expense.js';
import Subscription from '../models/Subscription.js';
import Loan from '../models/Loan.js';
import CashAdjustment from '../models/CashAdjustment.js';
import Transaction from '../models/Transaction.js';
import { getCurrentUser } from '../auth.js';
import { handleAuth, send } from './auth.js';

const models = { subscriptions: Subscription, loans: Loan, transactions: Transaction };

// Helper to validate amounts
function isValidAmount(amount) {
  return typeof amount === 'number' && !isNaN(amount) && isFinite(amount) && amount > 0;
}

function getLocalYYYYMMDD() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

async function processDueSubscriptions(userId) {
  const todayStr = getLocalYYYYMMDD();
  const dueSubs = await Subscription.find({ 
    userId, 
    active: true, 
    processed: false, 
    date: { $lte: todayStr } 
  });
  
  for (const sub of dueSubs) {
    sub.processed = true;
    await sub.save();
    await Transaction.create({
      userId: userId,
      type: 'subscription',
      amount: sub.amount,
      description: sub.name,
      relatedId: sub._id,
      date: new Date()
    });
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
      }
    });

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
      upcomingSubscriptions,
      loans: { totalLent, totalRepayments, outstanding: outstandingLoans }
    });
  }

  if (!models[resource]) return send(response, 404, { message: 'API route not found' });

  try {
    const model = models[resource];

    if (request.method === 'GET' && !id) {
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
        const todayStr = getLocalYYYYMMDD();
        if (created.date <= todayStr) {
          created.processed = true;
          await created.save();
          await Transaction.create({
            userId: user._id,
            type: 'subscription',
            amount: created.amount,
            description: created.name,
            relatedId: created._id,
            date: new Date()
          });
        }
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

    if (request.method === 'DELETE' && id) {
      const deleted = await model.findOneAndDelete({ _id: id, userId: user._id });
      if (!deleted) return send(response, 404, { message: 'Record not found' });
      
      // Cascade delete related transactions for loans and subscriptions
      if (resource === 'loans' || resource === 'subscriptions') {
        await Transaction.deleteMany({ relatedId: id, userId: user._id });
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
