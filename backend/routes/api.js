import Expense from '../models/Expense.js';
import Subscription from '../models/Subscription.js';
import Loan from '../models/Loan.js';
import CashAdjustment from '../models/CashAdjustment.js';
import Transaction from '../models/Transaction.js';
import Category from '../models/Category.js';
import Budget from '../models/Budget.js';
import Notification from '../models/Notification.js';
import CreditCard from '../models/CreditCard.js';
import { getCurrentUser } from '../auth.js';
import { handleAuth, send } from './auth.js';
import { enrichCreditCard } from '../utils/creditCardUtils.js';

const models = { subscriptions: Subscription, loans: Loan, transactions: Transaction, categories: Category, budgets: Budget, notifications: Notification, 'credit-cards': CreditCard };

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


const ccLocks = new Set();
async function processCreditCardAlerts(user) {
    if (ccLocks.has(user._id.toString())) return;
    ccLocks.add(user._id.toString());
    try {
        const cards = await CreditCard.find({ userId: user._id });
        for (const cardRaw of cards) {
            const card = enrichCreditCard(cardRaw);
            if (card.statementStatus === 'No Statement') continue;

            const cur = user.currency || 'INR';
            
            if (card.daysUntilStatement >= 0 && card.daysUntilStatement <= 3) {
                const msg = `${card.name} statement is due in ${card.daysUntilStatement} days.`;
                const ref = `${card.nextStatementDate.toISOString().slice(0,10)}`;
                const exists = await Notification.exists({ userId: user._id, relatedId: card._id, alertType: 'upcoming_statement', referenceDate: ref });
                if (!exists) {
                    await Notification.create({ userId: user._id, message: msg, type: 'info', relatedId: card._id, alertType: 'upcoming_statement', referenceDate: ref });
                }
            }

            if (card.paymentStatus !== 'Paid') {
                const dueRef = `${card.nextDueDate.toISOString().slice(0,10)}`;
                if (card.daysUntilDue > 0 && card.daysUntilDue <= 3) {
                    const msg = `${card.name} payment of ${cur} ${card.statementBalance} is due in ${card.daysUntilDue} days.`;
                    const exists = await Notification.exists({ userId: user._id, relatedId: card._id, alertType: 'payment_due', referenceDate: dueRef });
                    if (!exists) await Notification.create({ userId: user._id, message: msg, type: 'warning', relatedId: card._id, alertType: 'payment_due', referenceDate: dueRef });
                }
                
                if (card.daysUntilDue === 0) {
                    const msg = `${card.name} payment of ${cur} ${card.statementBalance} is due today.`;
                    const exists = await Notification.exists({ userId: user._id, relatedId: card._id, alertType: 'due_today', referenceDate: dueRef });
                    if (!exists) await Notification.create({ userId: user._id, message: msg, type: 'warning', relatedId: card._id, alertType: 'due_today', referenceDate: dueRef });
                }
                
                if (card.daysUntilDue < 0) {
                    const msg = `${card.name} payment is overdue.`;
                    const exists = await Notification.exists({ userId: user._id, relatedId: card._id, alertType: 'overdue', referenceDate: dueRef });
                    if (!exists) await Notification.create({ userId: user._id, message: msg, type: 'warning', relatedId: card._id, alertType: 'overdue', referenceDate: dueRef });
                }
            }

            const today = new Date();
            today.setHours(0,0,0,0);
            const lastStmt = new Date(card.lastStatementDate);
            lastStmt.setHours(0,0,0,0);
            const daysSinceStatement = Math.floor((today - lastStmt) / (1000 * 60 * 60 * 24));
            
            if (daysSinceStatement >= 0 && daysSinceStatement <= 3) {
                const msg = `${card.name} statement generated for ${cur} ${card.statementBalance}.`;
                const ref = `${card.lastStatementDate.toISOString().slice(0,10)}`;
                const exists = await Notification.exists({ userId: user._id, relatedId: card._id, alertType: 'statement_generated', referenceDate: ref });
                if (!exists) await Notification.create({ userId: user._id, message: msg, type: 'info', relatedId: card._id, alertType: 'statement_generated', referenceDate: ref });
            }
        }
    } catch(e) {
        console.error('Error CC alerts:', e);
    } finally {
        ccLocks.delete(user._id.toString());
    }
}

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
      let catId = sub.categoryId;
      let subCat = await Category.findOne({ userId, name: 'Subscriptions' });
      if (!subCat) subCat = await Category.create({ userId, name: 'Subscriptions' });
      catId = subCat._id; // Force Subscriptions category
      sub.categoryId = catId;

      await Transaction.create({
        userId, type: 'subscription', amount: sub.amount, description: sub.name, relatedId: sub._id,
        categoryId: catId, date: new Date(sub.date + 'T12:00:00')
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
  await processCreditCardAlerts(user);

    if (parts[1] === 'user' && parts[2] === 'settings' && request.method === 'PUT') {
      const body = await readJson(request);
      const validCurrencies = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'CAD', 'AUD', 'JPY', 'CHF'];
      if (body.currency && validCurrencies.includes(body.currency)) {
        user.currency = body.currency;
        await user.save();
      }
      return send(response, 200, { success: true, currency: user.currency || 'INR' });
    }


  const resource = parts[1];
  const id = parts[2];

  if (resource === 'ai' && id === 'chat') {
    if (request.method !== 'POST') return send(response, 405, { message: 'Method not allowed' });
    const body = await readJson(request);
    if (!body.question) return send(response, 400, { message: 'Question required' });

    try {
      const txs = await Transaction.find({ userId: user._id });
      const cats = await Category.find({ userId: user._id });
      const subs = await Subscription.find({ userId: user._id });
      const loans = await Loan.find({ userId: user._id });
      const budgets = await Budget.find({ userId: user._id });

      let balance = 0;
      let totalInflows = 0;
      let totalOutflows = 0;
      txs.forEach(t => {
         if (['income', 'add_money', 'loan_repayment'].includes(t.type)) { balance += t.amount; totalInflows += t.amount; }
         if (['expense', 'deduct_money', 'loan_given', 'subscription'].includes(t.type)) { balance -= t.amount; totalOutflows += t.amount; }
      });

      const simplifiedTxs = txs.map(t => ({ date: t.date, type: t.type, amount: t.amount, desc: t.description, cat: t.categoryId ? cats.find(c => c._id.equals(t.categoryId))?.name : null }));
      const simplifiedSubs = subs.map(s => ({ name: s.name, amt: s.amount, freq: s.frequency, next: s.date, active: s.active, processed: s.processed }));
      const simplifiedLoans = loans.map(l => ({ name: l.personName, amt: l.amount, repaid: l.repaidAmount }));
      const simplifiedBudgets = budgets.map(b => ({ month: b.month, amount: b.amount }));

      const catMap = {};
      cats.forEach(c => catMap[c._id.toString()] = c.name);

      function calculateCatSpending(startStr, endStr) {
         const start = new Date(startStr + 'T00:00:00.000Z');
         const end = new Date(endStr + 'T23:59:59.999Z');
         let spending = {};
         txs.forEach(t => {
            const d = new Date(t.date);
            if (d >= start && d <= end && ['expense', 'subscription'].includes(t.type) && t.categoryId) {
               const cName = catMap[t.categoryId.toString()] || 'Unknown';
               spending[cName] = (spending[cName] || 0) + t.amount;
            }
         });
         return spending;
      }

      function formatLocal(date) {
         return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
      }

      const d = new Date();
      // This Month
      const monthStart = new Date(d.getFullYear(), d.getMonth(), 1);
      const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      const catSpendingThisMonth = calculateCatSpending(formatLocal(monthStart), formatLocal(monthEnd));

      // This Year
      const yearStart = new Date(d.getFullYear(), 0, 1);
      const yearEnd = new Date(d.getFullYear(), 11, 31);
      const catSpendingThisYear = calculateCatSpending(formatLocal(yearStart), formatLocal(yearEnd));
      
      // Last Month
      const lastMonthStart = new Date(d.getFullYear(), d.getMonth() - 1, 1);
      const lastMonthEnd = new Date(d.getFullYear(), d.getMonth(), 0);
      const catSpendingLastMonth = calculateCatSpending(formatLocal(lastMonthStart), formatLocal(lastMonthEnd));

      // This Week
      const current = new Date();
      current.setDate(current.getDate() - current.getDay());
      const weekStart = new Date(current);
      const weekEnd = new Date(current);
      weekEnd.setDate(weekEnd.getDate() + 6);
      const catSpendingThisWeek = calculateCatSpending(formatLocal(weekStart), formatLocal(weekEnd));

      // Monthly breakdown for This Year (Jan-Dec)
      let catSpendingByMonthThisYear = {};
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      months.forEach(m => catSpendingByMonthThisYear[m] = {});
      
      const yStart = new Date(formatLocal(yearStart) + 'T00:00:00.000Z');
      const yEnd = new Date(formatLocal(yearEnd) + 'T23:59:59.999Z');

      txs.forEach(t => {
         const txDate = new Date(t.date);
         if (txDate >= yStart && txDate <= yEnd && ['expense', 'subscription'].includes(t.type) && t.categoryId) {
            const cName = catMap[t.categoryId.toString()] || 'Unknown';
            const m = txDate.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
            if (catSpendingByMonthThisYear[m]) {
               catSpendingByMonthThisYear[m][cName] = (catSpendingByMonthThisYear[m][cName] || 0) + t.amount;
            }
         }
      });

            const currency = user.currency || 'INR';
      const symMap = { INR: '₹', USD: '$', EUR: '€', GBP: '£', AED: 'د.إ', CAD: 'CA$', AUD: 'A$', JPY: '¥', CHF: 'CHF' };
      const sym = symMap[currency] || '₹';
      const systemInstruction = `You are CashFlow AI, a read-only financial assistant. Answer the user's questions clearly based ONLY on this JSON data representing their finances. Use ${sym} for amounts. Distinguish past (processed) from future (scheduled). Be concise and do not invent transactions.
IMPORTANT FORMATTING RULES:
- Do NOT use LaTeX.
- Do NOT use $$...$$.
- Do NOT use \\mathbf{}, \\text{}, or other LaTeX commands.
- Write calculations as normal plain text (e.g. Current Balance = ${sym}11,200 - ${sym}3,120 = ${sym}8,080).
- Continue using normal Markdown for headings, bold text, and bullet lists.

Data:
Current Balance: ${sym}${balance}
Total Inflows: ${sym}${totalInflows}
Total Outflows: ${sym}${totalOutflows}
Budgets: ${JSON.stringify(simplifiedBudgets)}
Loans: ${JSON.stringify(simplifiedLoans)}
Subscriptions: ${JSON.stringify(simplifiedSubs)}

Category Spending Totals (Already Calculated):
This Week (${formatLocal(weekStart)} to ${formatLocal(weekEnd)}): ${JSON.stringify(catSpendingThisWeek)}
This Month (${formatLocal(monthStart)} to ${formatLocal(monthEnd)}): ${JSON.stringify(catSpendingThisMonth)}
Last Month (${formatLocal(lastMonthStart)} to ${formatLocal(lastMonthEnd)}): ${JSON.stringify(catSpendingLastMonth)}
This Year (${formatLocal(yearStart)} to ${formatLocal(yearEnd)}): ${JSON.stringify(catSpendingThisYear)}
This Year (2026) broken down by month: ${JSON.stringify(catSpendingByMonthThisYear)}

Transactions: ${JSON.stringify(simplifiedTxs)}`;

      const { GoogleGenAI } = await import('@google/genai');
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const result = await ai.models.generateContent({
         model: 'gemini-3.6-flash',
         contents: body.question,
         config: { systemInstruction }
      });
      return send(response, 200, { answer: result.text });
    } catch (err) {
      console.error('AI Error:', err);
      const apiKey = process.env.GEMINI_API_KEY || 'HIDDEN_KEY';
      const safeErrorMsg = (err.message || String(err)).replace(new RegExp(apiKey, 'g'), '[REDACTED_API_KEY]');
      const safeStack = (err.stack || '').replace(new RegExp(apiKey, 'g'), '[REDACTED_API_KEY]');
      return send(response, 500, { 
         message: `AI failed to process the request.\n\nError: ${safeErrorMsg}\n\nStack:\n${safeStack}`
      });
    }
  }

  if (parts[1] === 'analytics') {
    if (request.method !== 'GET') return send(response, 405, { message: 'Method not allowed' });
    
    const txs = await Transaction.find({ userId: user._id });
    const subs = await Subscription.find({ userId: user._id });
    const loans = await Loan.find({ userId: user._id });

    // Current Balance
    const balance = txs.reduce((tot, t) => {
      if (['add_money', 'income', 'loan_repayment'].includes(t.type)) return tot + t.amount;
      if (['deduct_money', 'loan_given', 'subscription', 'credit_card_payment'].includes(t.type)) return tot - t.amount;
        if (t.type === 'expense' && !t.creditCardId) return tot - t.amount;
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

    const catStart = url.searchParams.get('catStart');
    const catEnd = url.searchParams.get('catEnd');
    const catPeriodType = url.searchParams.get('catPeriodType');
    const cStart = catStart ? new Date(catStart + 'T00:00:00.000Z') : new Date(Date.UTC(currentYear, currentMonth, 1));
    const cEnd = catEnd ? new Date(catEnd + 'T23:59:59.999Z') : new Date(Date.UTC(currentYear, currentMonth + 1, 0, 23, 59, 59, 999));

    let categorySpending = {};
    let categoryMonthlySpending = {};
    if (catPeriodType === 'year') {
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      months.forEach(m => categoryMonthlySpending[m] = {});
    }

    txs.forEach(t => {
      const d = new Date(t.date);
      const isCurrentMonth = d.getMonth() === currentMonth && d.getFullYear() === currentYear;
      
      // Spending breakdown (all time)
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

      // Category spending (dynamic period)
      if (d >= cStart && d <= cEnd && ['expense', 'subscription'].includes(t.type) && t.categoryId) {
         const cName = catMap[t.categoryId.toString()] || 'Unknown';
         categorySpending[cName] = (categorySpending[cName] || 0) + t.amount;
         
         if (catPeriodType === 'year') {
            const m = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
            if (categoryMonthlySpending[m]) {
               categoryMonthlySpending[m][cName] = (categoryMonthlySpending[m][cName] || 0) + t.amount;
            }
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
      categoryMonthlySpending,
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

      let data = await model.find({ userId: user._id }).sort({ createdAt: -1 });
      if (resource === 'credit-cards') {
        data = data.map(c => enrichCreditCard(c));
      }
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
          const allowedTypes = ['income', 'expense', 'add_money', 'deduct_money', 'credit_card_payment'];
          if (!allowedTypes.includes(body.type)) {
            return send(response, 400, { message: 'Invalid transaction type' });
          }
          if (body.type === 'expense' && body.creditCardId) {
             const card = await CreditCard.findOne({ _id: body.creditCardId, userId: user._id });
             if (!card) return send(response, 404, { message: 'Credit card not found or unauthorized' });
             card.currentBalance += Number(body.amount);
             await card.save();
          }
          
            if (body.type === 'credit_card_payment') {
               if (!body.creditCardId) return send(response, 400, { message: 'Credit card ID required for payment' });
               const card = await CreditCard.findOne({ _id: body.creditCardId, userId: user._id });
               if (!card) return send(response, 404, { message: 'Credit card not found or unauthorized' });
               if (card.currentBalance <= 0) return send(response, 400, { message: 'Card balance is already zero' });
               if (Number(body.amount) > card.currentBalance) return send(response, 400, { message: 'Payment amount cannot exceed the current card balance.' });
               card.currentBalance -= Number(body.amount);
               await card.save();
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
        let subCat = await Category.findOne({ userId: user._id, name: 'Subscriptions' });
        if (!subCat) subCat = await Category.create({ userId: user._id, name: 'Subscriptions' });

        created = await Subscription.create({ ...body, userId: user._id, categoryId: subCat._id });
        await processDueSubscriptions(user._id);

    if (parts[1] === 'user' && parts[2] === 'settings' && request.method === 'PUT') {
      const body = await readJson(request);
      const validCurrencies = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'CAD', 'AUD', 'JPY', 'CHF'];
      if (body.currency && validCurrencies.includes(body.currency)) {
        user.currency = body.currency;
        await user.save();
      }
      return send(response, 200, { success: true, currency: user.currency || 'INR' });
    }

        created = await Subscription.findById(created._id);
        }
        else if (resource === 'credit-cards') {
          created = await CreditCard.create({ ...body, userId: user._id });
            created = enrichCreditCard(created);
          }

        return send(response, 201, created);
    }

    if (request.method === 'PUT' && id) {
        const body = await readJson(request);
        delete body.userId; delete body._id; delete body.createdAt; delete body.updatedAt;
        
        if (resource === 'transactions') {
           const oldTx = await Transaction.findOne({ _id: id, userId: user._id });
           if (!oldTx) return send(response, 404, { message: 'Record not found' });
           
           const oldIsCardExp = (oldTx.type === 'expense' && !!oldTx.creditCardId);
           const oldIsCardPay = (oldTx.type === 'credit_card_payment' && !!oldTx.creditCardId);
           const newType = body.type || oldTx.type;
             const newIsCardExp = (newType === 'expense' && !!body.creditCardId);
           const newIsCardPay = (newType === 'credit_card_payment' && !!body.creditCardId);
           
           if (oldIsCardExp || newIsCardExp || oldIsCardPay || newIsCardPay) {
               const oldCardId = (oldIsCardExp || oldIsCardPay) ? oldTx.creditCardId.toString() : null;
               const newCardId = (newIsCardExp || newIsCardPay) ? body.creditCardId.toString() : null;
               const oldAmount = (oldIsCardExp || oldIsCardPay) ? oldTx.amount : 0;
               const newAmount = (newIsCardExp || newIsCardPay) ? Number(body.amount) : 0;
               
               let oldCard = oldCardId ? await CreditCard.findOne({ _id: oldCardId, userId: user._id }) : null;
               let newCard = (newCardId && newCardId !== oldCardId) ? await CreditCard.findOne({ _id: newCardId, userId: user._id }) : oldCard;
               
               if ((oldIsCardExp || oldIsCardPay) && !oldCard) return send(response, 404, { message: 'Old credit card not found' });
               if ((newIsCardExp || newIsCardPay) && !newCard) return send(response, 404, { message: 'New credit card not found or unauthorized' });

               if (oldCardId === newCardId) {
                   const diff = newAmount - oldAmount;
                   let resultingBal = oldCard.currentBalance;
                     if (newIsCardExp) resultingBal += diff;
                     if (newIsCardPay) resultingBal -= diff;
                     if (resultingBal < 0) return send(response, 400, { message: 'Resulting card balance would be negative' });
                     oldCard.currentBalance = resultingBal;
                   await oldCard.save();
               } else {
                   if (oldCard) {
                       let resultingOldBal = oldCard.currentBalance;
                       if (oldIsCardExp) resultingOldBal -= oldAmount;
                       if (oldIsCardPay) resultingOldBal += oldAmount;
                       if (resultingOldBal < 0) return send(response, 400, { message: 'Resulting old card balance would be negative' });
                   }
                   if (oldCard) {
                       if (oldIsCardExp) oldCard.currentBalance -= oldAmount;
                         if (oldIsCardPay) oldCard.currentBalance += oldAmount;
                       await oldCard.save();
                   }
                   if (newCard) {
                       let resultingNewBal = newCard.currentBalance;
                       if (newIsCardExp) resultingNewBal += newAmount;
                       if (newIsCardPay) resultingNewBal -= newAmount;
                       if (resultingNewBal < 0) return send(response, 400, { message: 'Resulting new card balance would be negative' });
                       newCard.currentBalance = resultingNewBal;
                       await newCard.save();
                   }
               }
           }
        }

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
      if (updated && resource === 'credit-cards') {
        return send(response, 200, enrichCreditCard(updated));
      }
      return updated ? send(response, 200, updated) : send(response, 404, { message: 'Record not found' });
    }

    if (request.method === 'DELETE' && !id && resource === 'notifications') {
      await Notification.deleteMany({ userId: user._id });
      return send(response, 200, { message: 'All notifications cleared' });
    }

    if (request.method === 'DELETE' && id) {
        if (resource === 'transactions') {
           const tx = await Transaction.findOne({ _id: id, userId: user._id });
           if (!tx) return send(response, 404, { message: 'Record not found' });
                      if (tx.type === 'expense' && tx.creditCardId) {
               const card = await CreditCard.findOne({ _id: tx.creditCardId, userId: user._id });
               if (card) {
                   if (card.currentBalance - tx.amount < 0) return send(response, 400, { message: 'Deleting this transaction would cause card balance to become negative.' });
                   card.currentBalance -= tx.amount;
                   await card.save();
               }
           }
           if (tx.type === 'credit_card_payment' && tx.creditCardId) {
               const card = await CreditCard.findOne({ _id: tx.creditCardId, userId: user._id });
               if (card) {
                   card.currentBalance += tx.amount;
                   await card.save();
               }
           }
        }
        
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
