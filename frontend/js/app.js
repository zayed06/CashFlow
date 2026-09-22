const state={transactions:[],subscriptions:[],loans:[],categories:[],notifications:[],creditCards:[],moneyAction:'add'};
const $=id=>document.getElementById(id);
let userCurrency = 'INR';
const money = n => new Intl.NumberFormat(undefined, { style: 'currency', currency: userCurrency }).format(Number(n || 0));
window.getLocalDateString = function() {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0,10);
};
window.lastDefaultDate = window.getLocalDateString();
const api=async(path,options={})=>{
  const r=await fetch('/api/'+path,{headers:{'Content-Type':'application/json'},...options});
  const data=await r.json();
  if(r.status===401){location.href='/login';throw new Error('Please log in');}
  if(!r.ok)throw new Error(data.message||'Request failed');
  return data
};

async function requireAuth(){
  const response=await fetch('/api/auth/me');
  if(!response.ok){location.href='/login';return null}
  const data=await response.json();
  $('userName').textContent=data.user.name;
  userCurrency = data.user.currency || 'INR';
  const cs = $('currencySelect');
  if (cs) cs.value = userCurrency;

  document.body.style.display = '';
  return data.user;
}

$('logoutButton').onclick=async()=>{
  try{await fetch('/api/auth/logout',{method:'POST'});}finally{location.href='/login';}
};

const filterParams = { search: '', category: '', type: '', dateFrom: '', dateTo: '', sort: 'newest', page: 1, limit: 8 };
let totalTransactions = 0;

async function fetchTransactions() {
  const query = new URLSearchParams(filterParams).toString();
  const res = await api(`transactions?${query}`);
  state.transactions = res.data;
  totalTransactions = res.total;
  const maxPage = Math.ceil(res.total / res.limit) || 1;
  $('pageInfo').textContent = `Page ${res.page} of ${maxPage}`;
}

async function load(){
  try{
    const results = await Promise.all([api('subscriptions'),api('loans'),api('categories'),api('notifications'),api('analytics'),api('credit-cards')]);
    [state.subscriptions,state.loans,state.categories,state.notifications,state.analytics,state.creditCards] = results;
    await fetchTransactions();
    render();
  }catch(e){toast('Could not connect to MongoDB/server');console.error(e)}
}

async function reloadAnalytics(){
  state.analytics = await api('analytics');
  state.notifications = await api('notifications');
  state.creditCards = await api('credit-cards');
}

function calculate(){
  if(state.analytics) return { balance: state.analytics.balance, spent: state.analytics.monthly.spent };
  return { balance: 0, spent: 0 };
}

function render(){
  const c=calculate();
  $('balance').textContent=money(c.balance);
    const tb = $('topbarBalance'); if (tb) tb.textContent = '💰 Current Balance: ' + money(c.balance);
  $('spent').textContent=`Spent ${money(c.spent)}`;
  renderTransactions();renderSubscriptions();renderLoans();renderCategories();renderNotifications();renderCreditCards();
    populateCreditCardDropdowns();
  if(state.analytics) renderAnalytics();
    if (window.renderLensState) window.renderLensState();
}

const typeLabels = {
  expense: 'Expense', income: 'Income', add_money: 'Added Money', deduct_money: 'Deducted Money',
  loan_given: 'Loan Given', loan_repayment: 'Loan Repayment', subscription: 'Subscription'
};


function populateCreditCardDropdowns() {
  const expenseCC = $('expenseCreditCard');
  const editCC = $('editTxCreditCard');
  if (!expenseCC || !editCC) return;
  const options = '<option value="">Select Credit Card</option>' + (state.creditCards || []).map(c => `<option value="${c._id}">${c.name} (•••• ${c.last4})</option>`).join('');
  
  // preserve existing selected value if any
  const oldExp = expenseCC.value;
  expenseCC.innerHTML = options;
  if (oldExp) expenseCC.value = oldExp;
  
  const oldEdit = editCC.value;
  editCC.innerHTML = options;
  if (oldEdit) editCC.value = oldEdit;
        if ($('lensCreditCard')) {
    const lensOptions = '<option value="">Select Credit Card</option>' + (state.creditCards || []).map(c => '<option value="' + c._id + '">' + esc(c.name) + ' (\u2022\u2022\u2022\u2022 ' + (c.last4||'xxxx') + ')</option>').join('');
    
    const oldLens = $('lensCreditCard').value; $('lensCreditCard').innerHTML = lensOptions; if (oldLens) $('lensCreditCard').value = oldLens;
    if ($('lensShockCard')) { const oldShock = $('lensShockCard').value; $('lensShockCard').innerHTML = lensOptions; if (oldShock) $('lensShockCard').value = oldShock; }
    if ($('lensCompareCard')) { const oldCmp = $('lensCompareCard').value; $('lensCompareCard').innerHTML = lensOptions; if (oldCmp) $('lensCompareCard').value = oldCmp; }
  }
}

function renderTransactions(){
  const catMap = {};
  state.categories.forEach(c => catMap[c._id] = c.name);
  $('transactionList').innerHTML=state.transactions.map(t=>{
    const isPositive = ['add_money', 'income', 'loan_repayment'].includes(t.type);
    const sign = isPositive ? '+' : '-';
    const catName = t.categoryId ? ` · ${esc(catMap[t.categoryId] || 'Unknown')}` : '';
      let paymentBadge = '';
      if (t.type === 'expense' && t.creditCardId) {
          const cCard = state.creditCards.find(c => c._id === t.creditCardId);
          paymentBadge = cCard ? ` • 💳 ${esc(cCard.name)} (•••• ${cCard.last4})` : ' • 💳 Credit Card';
      }
    let renderTypeLabel = typeLabels[t.type] || t.type;
    let amtSign = sign;
    if (t.type === 'credit_card_payment') {
        renderTypeLabel = 'Credit Card Payment';
        amtSign = '-';
        if (t.creditCardId) {
            const cCard = state.creditCards.find(c => c._id === t.creditCardId);
            paymentBadge = cCard ? ` • 💳 ${esc(cCard.name)} (•••• ${cCard.last4})` : ' • 💳 Credit Card';
        }
    }
    const editBtn = `<button class="delete" onclick="openEditTx('${t._id}')" style="color:var(--primary)">Edit</button>`;
    return `<div class="item"><div class="item-main"><strong>${esc(t.description)}</strong><span>${renderTypeLabel} · ${new Date(t.date).toLocaleDateString('en-IN')}${catName}${paymentBadge}</span></div><div class="item-right"><span class="amount">${amtSign}${money(t.amount)}</span>${editBtn}<button class="delete" onclick="removeItem('transactions','${t._id}')">Delete</button></div></div>`
  }).join('')||empty('No transactions found.')
}

function renderSubscriptions(){
  $('subscriptionList').innerHTML=state.subscriptions.map(s=>
    `<div class="item"><div class="item-main"><strong>${esc(s.name)}</strong><span>${money(s.amount)} · ${s.frequency} · Next: ${s.date}</span></div><div class="item-right"><span class="status">${s.active?'Active':'Paused'}</span><button class="delete" onclick="toggleSub('${s._id}',${!s.active})">${s.active?'Pause':'Resume'}</button><button class="delete" onclick="removeItem('subscriptions','${s._id}')">Delete</button></div></div>`
  ).join('')||empty('No subscriptions yet.')
}

function renderLoans(){
  $('loanList').innerHTML=state.loans.map(l=>{
    const original=Number(l.amount||0);
    const repaid=Math.min(original,Number(l.repaidAmount||0));
    const outstanding=Math.max(0,original-repaid);
    const fullyRepaid=outstanding<=0;
    return `<div class="item"><div class="item-main"><strong>${esc(l.person)}</strong><span>Original ${money(original)} · Repaid ${money(repaid)} · Remaining ${money(outstanding)}</span></div><div class="item-right loan-actions"><span class="amount">${money(outstanding)}</span>${fullyRepaid?'<span class="status">Fully repaid</span>':`<button class="delete" onclick="repayLoan('${l._id}')">Repay</button><button class="delete" onclick="fullyRepayLoan('${l._id}')">Fully Repaid</button>`}<button class="delete" onclick="removeItem('loans','${l._id}')">Delete</button></div></div>`;
  }).join('')||empty('No lent money recorded.')
}

function renderCategories(){
  const options = `<option value="">Select Category</option>` + state.categories.map(c=>`<option value="${c._id}">${esc(c.name)}</option>`).join('');
  $('expenseCategory').innerHTML = options;
  if ($('lensCategory')) $('lensCategory').innerHTML = options;
  if ($('filterCategory')) {
    $('filterCategory').innerHTML = `<option value="">All Categories</option>` + state.categories.map(c=>`<option value="${c._id}">${esc(c.name)}</option>`).join('');
    $('filterCategory').value = filterParams.category;
  }
  $('categoryList').innerHTML = state.categories.map(c=>
    `<div class="item"><div class="item-main"><strong>${esc(c.name)}</strong></div><div class="item-right"><button class="delete" style="color:var(--primary)" onclick="renameCategory('${c._id}')">Rename</button><button class="delete" onclick="removeItem('categories','${c._id}')">Delete</button></div></div>`
  ).join('') || empty('No custom categories.');
}

function renderNotifications() {
  const unreadCount = state.notifications.filter(n => !n.read).length;
  if (unreadCount > 0) {
    $('notificationBadge').textContent = unreadCount;
    $('notificationBadge').style.display = 'grid';
  } else {
    $('notificationBadge').style.display = 'none';
  }
  
  const sortedNotifs = [...state.notifications].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  $('notificationList').innerHTML = sortedNotifs.length ? sortedNotifs.map(n => 
    `<div class="item" style="opacity: ${n.read ? '0.6' : '1'}; flex-direction: column; align-items: flex-start; padding: 10px;">
      <div style="width:100%; display:flex; justify-content: space-between; gap:10px;">
        <span style="font-size: 13px; color: var(${n.type === 'danger' || n.type === 'warning' ? '--danger' : n.type === 'success' ? '--primary' : '--text'})">${esc(n.message)}</span>
        ${!n.read ? `<button class="delete" style="color:var(--primary); font-size:11px;" onclick="markNotificationRead('${n._id}')">Read</button>` : ''}
      </div>
      <small class="muted" style="font-size:10px; margin-top: 4px;">${new Date(n.createdAt).toLocaleString()}</small>
    </div>`
  ).join('') : empty('No notifications.');
}

const empty=t=>`<div class="item"><span class="muted">${t}</span></div>`;
const esc=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

let spendingChartInstance = null;

function renderAnalytics() {
  const { monthly, breakdown, categorySpending, categoryMonthlySpending, budget, upcomingSubscriptions, loans } = state.analytics;

  $('summaryIncome').textContent = money(monthly.income);
  $('summarySpent').textContent = money(monthly.spent);
  $('summarySubs').textContent = money(monthly.subs);
  $('summaryLent').textContent = money(monthly.lent);
  $('summaryRepayments').textContent = money(monthly.loanRepayments);

  if (budget) {
    $('budgetAmount').value = budget;
    $('budgetCard').style.display = 'block';
    $('budgetTotalAmount').textContent = money(budget);
    $('budgetUsedAmount').textContent = money(monthly.spent);
    const pct = Math.min(100, Math.round((monthly.spent / budget) * 100));
    $('budgetPercentage').textContent = pct + '%';
    $('budgetPercentage').style.color = pct >= 100 ? 'var(--danger)' : '';
    $('budgetProgressBar').style.width = pct + '%';
    $('budgetProgressBar').style.background = pct >= 100 ? 'var(--danger)' : 'var(--primary)';
    const remaining = budget - monthly.spent;
    if (remaining < 0) {
      $('budgetRemainingText').textContent = `Over budget by ${money(Math.abs(remaining))}`;
      $('budgetRemainingText').style.color = 'var(--danger)';
    } else {
      $('budgetRemainingText').textContent = `${money(remaining)} remaining`;
      $('budgetRemainingText').style.color = 'var(--muted)';
    }
  } else {
    $('budgetCard').style.display = 'none';
  }

  const catEntries = Object.entries(categorySpending || {}).sort((a,b)=>b[1]-a[1]);
  $('categorySpendingList').innerHTML = catEntries.length ? catEntries.map(([name, amount]) => 
    `<div class="item"><div class="item-main"><strong>${esc(name)}</strong></div><div class="item-right"><span class="amount">${money(amount)}</span></div></div>`
  ).join('') : empty('No category spending for this period.');

  if (catPeriodType === 'year' && categoryMonthlySpending) {
     $('yearCategoryChart').style.display = 'block';
     if (yearCategoryChartInstance) yearCategoryChartInstance.destroy();
     
     const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
     const categoriesSet = new Set();
     months.forEach(m => Object.keys(categoryMonthlySpending[m] || {}).forEach(c => categoriesSet.add(c)));
     
     const colors = ['#3b82f6', '#8b5cf6', '#ef4444', '#10b981', '#f59e0b', '#06b6d4', '#6366f1', '#ec4899', '#84cc16'];
     const datasets = Array.from(categoriesSet).map((catName, idx) => ({
        label: catName,
        data: months.map(m => categoryMonthlySpending[m][catName] || 0),
        backgroundColor: colors[idx % colors.length]
     }));

     yearCategoryChartInstance = new Chart($('yearCategoryChart').getContext('2d'), {
       type: 'bar',
       data: { labels: months, datasets },
       options: {
         responsive: true,
         maintainAspectRatio: false,
         scales: {
           x: { stacked: true },
           y: { stacked: true, beginAtZero: true }
         },
         plugins: { legend: { position: 'right' } }
       }
     });
  } else {
     $('yearCategoryChart').style.display = 'none';
  }

  $('loanTotal').textContent = money(loans.totalLent);
  $('loanRepaid').textContent = money(loans.totalRepayments);
  $('loanOutstanding').textContent = money(loans.outstanding);

  $('upcomingSubList').innerHTML = upcomingSubscriptions.length ? upcomingSubscriptions.map(s => 
    `<div class="item"><div class="item-main"><strong>${esc(s.name)}</strong><span>${money(s.amount)} · ${s.frequency} · Due: ${s.date}</span></div></div>`
  ).join('') : empty('No upcoming subscriptions.');

  if (spendingChartInstance) spendingChartInstance.destroy();
  const ctx = $('spendingChart').getContext('2d');
  
  if (breakdown.expenses === 0 && breakdown.subscriptions === 0 && breakdown.deductions === 0) {
     $('spendingChart').style.display = 'none';
     if (!$('chartEmpty')) {
       const emptyMsg = document.createElement('div');
       emptyMsg.id = 'chartEmpty';
       emptyMsg.className = 'item';
       emptyMsg.innerHTML = '<span class="muted">Not enough data to display chart.</span>';
       $('spendingChart').parentNode.appendChild(emptyMsg);
     }
  } else {
     $('spendingChart').style.display = 'block';
     if ($('chartEmpty')) $('chartEmpty').remove();
     spendingChartInstance = new Chart(ctx, {
       type: 'doughnut',
       data: {
         labels: ['Expenses', 'Subscriptions', 'Manual Deductions'],
         datasets: [{
           data: [breakdown.expenses, breakdown.subscriptions, breakdown.deductions],
           backgroundColor: ['#3b82f6', '#8b5cf6', '#ef4444'],
           borderWidth: 0
         }]
       },
       options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right' } } }
     });
  }

    const ccContainer = $('dashboardCCContent');
    if (ccContainer) {
      if (!state.creditCards || state.creditCards.length === 0) {
        ccContainer.innerHTML = `
          <div style="text-align:center; padding: 10px;">
            <p class="muted" style="margin-bottom: 10px; font-size: 13px;">No credit cards added</p>
            <button class="secondary-button" style="width: auto; padding: 0.4rem 0.8rem; font-size: 12px;" onclick="document.querySelector('.tab[data-tab=\\'creditcards\\']').click()">Go to Credit Cards</button>
          </div>
        `;
      } else {
        let totalLimit = 0;
        let totalCurrent = 0;
        let dueCount = 0;
        let overdueCount = 0;
        let paidCount = 0;
        
        let mostImportantCard = null;
        
        for (const c of state.creditCards) {
           const limit = Number(c.creditLimit) || 0;
           const current = Number(c.currentBalance) || 0;
           totalLimit += limit;
           totalCurrent += current;
           
           const status = c.paymentStatus || '';
           if (status.includes('Overdue')) overdueCount++;
           else if (status === 'Paid') paidCount++;
           else if (status !== 'No Due') dueCount++;
           
           if (!mostImportantCard) {
             mostImportantCard = c;
           } else {
             const isCOverdue = c.paymentStatus && c.paymentStatus.includes('Overdue');
             const isMOverdue = mostImportantCard.paymentStatus && mostImportantCard.paymentStatus.includes('Overdue');
             if (isCOverdue && !isMOverdue) {
                mostImportantCard = c;
             } else if (isCOverdue === isMOverdue) {
                const dC = c.daysUntilDue !== null && c.daysUntilDue !== undefined ? c.daysUntilDue : Infinity;
                const dM = mostImportantCard.daysUntilDue !== null && mostImportantCard.daysUntilDue !== undefined ? mostImportantCard.daysUntilDue : Infinity;
                if (dC < dM) {
                   mostImportantCard = c;
                }
             }
           }
        }
        
        const totalAvailable = Math.max(0, totalLimit - totalCurrent);
        let overallUtil = totalLimit > 0 ? (totalCurrent / totalLimit) * 100 : 0;
        if (!isFinite(overallUtil) || isNaN(overallUtil)) overallUtil = 0;
        
        let utilColor = 'var(--text)';
        if (overallUtil >= 90) utilColor = 'var(--danger)';
        else if (overallUtil >= 50) utilColor = '#f59e0b';

        const importantCardHtml = mostImportantCard ? `
          <div style="margin-top: 15px; padding-top: 12px; border-top: 1px dashed var(--border);">
            <div style="font-size: 11px; color: var(--muted); margin-bottom: 6px; font-weight: 600; letter-spacing: 0.5px;">UPCOMING / IMPORTANT</div>
            <div style="display: flex; justify-content: space-between; font-size: 13px;">
               <strong>${esc(mostImportantCard.name)} (•••• ${esc(mostImportantCard.last4)})</strong>
               <span style="color: ${mostImportantCard.paymentStatus && mostImportantCard.paymentStatus.includes('Overdue') ? 'var(--danger)' : 'var(--text)'}; font-weight: 600;">
                 ${mostImportantCard.paymentStatus || '-'}
               </span>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 12px; margin-top: 4px;">
               <span class="muted">Due: ${mostImportantCard.dueDate || '-'}</span>
               <span class="muted">${mostImportantCard.nextDueDate ? new Date(mostImportantCard.nextDueDate).toLocaleDateString() : '-'}</span>
            </div>
          </div>
        ` : '';

        ccContainer.innerHTML = `
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 15px;">
            <div>
              <div style="font-size: 11px; color: var(--muted); font-weight: 600; letter-spacing: 0.5px;">TOTAL OUTSTANDING</div>
              <div style="font-size: 16px; font-weight: bold; margin-top: 2px;">${money(totalCurrent)}</div>
            </div>
            <div>
              <div style="font-size: 11px; color: var(--muted); font-weight: 600; letter-spacing: 0.5px;">TOTAL AVAILABLE</div>
              <div style="font-size: 16px; font-weight: bold; margin-top: 2px;">${money(totalAvailable)}</div>
            </div>
            <div>
              <div style="font-size: 11px; color: var(--muted); font-weight: 600; letter-spacing: 0.5px;">TOTAL LIMIT</div>
              <div style="font-size: 14px; margin-top: 2px;">${money(totalLimit)}</div>
            </div>
            <div>
              <div style="font-size: 11px; color: var(--muted); font-weight: 600; letter-spacing: 0.5px;">UTILIZATION</div>
              <div style="font-size: 14px; font-weight: 600; color: ${utilColor}; margin-top: 2px;">${overallUtil.toFixed(2)}%</div>
            </div>
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 12px; background: var(--bg); padding: 10px; border-radius: 6px;">
            <div style="text-align: center;"><div style="color: var(--danger); font-weight: bold; font-size: 14px;">${overdueCount}</div><div class="muted" style="font-size: 10px; text-transform: uppercase;">Overdue</div></div>
            <div style="text-align: center;"><div style="font-weight: bold; font-size: 14px;">${dueCount}</div><div class="muted" style="font-size: 10px; text-transform: uppercase;">Due</div></div>
            <div style="text-align: center;"><div style="color: var(--primary); font-weight: bold; font-size: 14px;">${paidCount}</div><div class="muted" style="font-size: 10px; text-transform: uppercase;">Paid</div></div>
          </div>
          ${importantCardHtml}
        `;
      }
    }
}

async function removeItem(type,id){
  try{
    await api(type+'/'+id,{method:'DELETE'});
    if(type === 'loans' || type === 'subscriptions' || type === 'categories') {
      await fetchTransactions();
    }
    state[type]=state[type].filter(x=>x._id!==id);
    await reloadAnalytics();
    render();toast('Deleted')
  }catch(e){toast(e.message)}
}

async function toggleSub(id,active){
  const x=state.subscriptions.find(s=>s._id===id);if(!x)return;
  try{const u=await api('subscriptions/'+id,{method:'PUT',body:JSON.stringify({active})});Object.assign(x,u);await reloadAnalytics();render()}catch(e){toast(e.message)}
}

window.renameCategory = async id => {
  const cat = state.categories.find(c => c._id === id);
  if (!cat) return;
  const newName = prompt('Enter new name for category:', cat.name);
  if (!newName || newName.trim() === '' || newName.trim() === cat.name) return;
  try {
    const updated = await api(`categories/${id}`, { method: 'PUT', body: JSON.stringify({ name: newName.trim() }) });
    Object.assign(cat, updated);
    await reloadAnalytics();
    render();
    toast('Category renamed');
  } catch(e) { toast(e.message); }
};

window.openEditTx = id => {
  const t = state.transactions.find(x => x._id === id);
  if(!t) return;
  $('editTxId').value = t._id;
  $('editTxDescription').value = t.description;
  $('editTxAmount').value = t.amount;
  const options = `<option value="">No Category</option>` + state.categories.map(c=>`<option value="${c._id}" ${c._id===t.categoryId?'selected':''}>${esc(c.name)}</option>`).join('');
  $('editTxCategory').innerHTML = options;
  $('editTxCategory').style.display = ['expense', 'income', 'subscription'].includes(t.type) ? 'block' : 'none';
    
    if (t.type === 'credit_card_payment') {
        $('editTxPaymentMethod').style.display = 'none';
        $('editTxCreditCard').style.display = 'block';
        $('editTxCreditCard').value = t.creditCardId || '';
    } else if (t.type === 'expense') {
        $('editTxPaymentMethod').style.display = 'block';
        if (t.creditCardId) {
            $('editTxPaymentMethod').value = 'credit_card';
            $('editTxCreditCard').style.display = 'block';
            $('editTxCreditCard').value = t.creditCardId;
        } else {
            $('editTxPaymentMethod').value = 'cash';
            $('editTxCreditCard').style.display = 'none';
            $('editTxCreditCard').value = '';
        }
    } else {
        $('editTxPaymentMethod').style.display = 'none';
        $('editTxCreditCard').style.display = 'none';
    }
    
    $('editTxDialog').showModal();
};

$('editTxForm').onsubmit = async e => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  try {
    const id = $('editTxId').value;
    const amount = +$('editTxAmount').value;
    const description = $('editTxDescription').value;
    const categoryId = $('editTxCategory').value || null;
    if (amount <= 0) throw new Error('Invalid amount');
    
      let creditCardId = undefined;
      const tOld = state.transactions.find(x => x._id === id);
      if (tOld && (tOld.type === 'expense' || tOld.type === 'credit_card_payment')) {
         if (tOld.type === 'credit_card_payment' || $('editTxPaymentMethod').value === 'credit_card') {
             creditCardId = $('editTxCreditCard').value || null;
         } else {
             creditCardId = null;
         }
      }
      const updated = await api(`transactions/${id}`, { method: 'PUT', body: JSON.stringify({ amount, description, categoryId, ...(creditCardId !== undefined && { creditCardId }) }) });
    const idx = state.transactions.findIndex(x => x._id === id);
    if(idx !== -1) state.transactions[idx] = updated;
    $('editTxDialog').close();
    await reloadAnalytics();
    render();
    toast('Transaction updated');
  } catch(err) { toast(err.message); } finally { btn.disabled = false; }
};

$('notificationButton').onclick = () => {
  const panel = $('notificationPanel');
  panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
};

window.markNotificationRead = async id => {
  try {
    const n = state.notifications.find(x => x._id === id);
    if(n) n.read = true;
    await api(`notifications/${id}`, { method: 'PUT', body: JSON.stringify({ read: true }) });
    renderNotifications();
  } catch(e) { toast(e.message); }
};

window.markAllNotificationsRead = async () => {
  try {
    const unread = state.notifications.filter(n => !n.read);
    for (const n of unread) {
      n.read = true;
      api(`notifications/${n._id}`, { method: 'PUT', body: JSON.stringify({ read: true }) });
    }
    renderNotifications();
  } catch(e) { toast(e.message); }
};

window.clearAllNotifications = async () => {
  try {
    await api('notifications', { method: 'DELETE' });
    state.notifications = [];
    renderNotifications();
  } catch(e) { toast(e.message); }
};

$('expenseDate').value=window.getLocalDateString();
$('subscriptionDate').value=window.getLocalDateString();
$('today').textContent=new Date().toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short'});

  document.querySelectorAll('.tab').forEach(b => b.onclick = () => {
    document.querySelectorAll('.tab,.tab-panel').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    $(b.dataset.tab).classList.add('active');
    const bc = $('mainBalanceCard');
    if (bc) bc.style.display = (b.dataset.tab === 'ai') ? 'none' : '';

    const newDate = window.getLocalDateString();
    if (newDate !== window.lastDefaultDate) {
        if ($('expenseDate') && $('expenseDate').value === window.lastDefaultDate) $('expenseDate').value = newDate;
        if ($('subscriptionDate') && $('subscriptionDate').value === window.lastDefaultDate) $('subscriptionDate').value = newDate;
        if ($('lensDate') && $('lensDate').value === window.lastDefaultDate) $('lensDate').value = newDate;
        window.lastDefaultDate = newDate;
        $('today').textContent = new Date().toLocaleDateString('en-IN', {weekday:'short', day:'numeric', month:'short'});
    }
  });

$('categoryForm').onsubmit=async e=>{
  e.preventDefault();
  const btn = e.target.querySelector('button');
  btn.disabled = true;
  try{
    const name = $('categoryName').value;
    const cat = await api('categories', {method:'POST', body:JSON.stringify({name})});
    state.categories.push(cat);
    $('categoryName').value='';
    await reloadAnalytics();
    render(); toast('Category added');
  }catch(e){toast(e.message)}
  finally{btn.disabled = false;}
};

$('budgetForm').onsubmit=async e=>{
  e.preventDefault();
  const btn = e.target.querySelector('button');
  btn.disabled = true;
  try{
    const amount = +$('budgetAmount').value;
    if(amount<=0) throw new Error('Invalid budget');
    const today = new Date();
    const month = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}`;
    await api('budgets', {method:'POST', body:JSON.stringify({month, amount})});
    $('budgetAmount').value='';
    await reloadAnalytics();
    render(); toast('Budget set');
  }catch(e){toast(e.message)}
  finally{btn.disabled = false;}
};

$('expenseForm').onsubmit=async e=>{
  e.preventDefault();
  const btn = $('addTransactionBtn');
  btn.disabled = true;
  try{
    const amount = +$('expenseAmount').value;
    if (amount <= 0) throw new Error('Amount must be greater than 0');
    const x=await api('transactions',{method:'POST',body:JSON.stringify({
        type:$('expenseType').value,
        description:$('expenseDescription').value,
        amount,
        categoryId:$('expenseCategory').value || null,
        creditCardId: ($('expenseType').value === 'expense' && $('expensePaymentMethod').value === 'credit_card') ? $('expenseCreditCard').value || null : undefined,
        date:new Date($('expenseDate').value+'T12:00:00')
      })});
    state.transactions.unshift(x);
    e.target.reset();
    $('expenseDate').value=window.getLocalDateString();
    await reloadAnalytics();
    render();toast('Transaction logged')
  }catch(e){toast(e.message)}
  finally{btn.disabled = false;}
};

$('subscriptionForm').onsubmit=async e=>{
  e.preventDefault();
  const btn = e.target.querySelector('button');
  btn.disabled = true;
  try{
    const amount = +$('subscriptionAmount').value;
    if (amount <= 0) throw new Error('Amount must be greater than 0');
    const sub=await api('subscriptions',{method:'POST',body:JSON.stringify({
      name:$('subscriptionName').value,
      amount,
      frequency:$('subscriptionFrequency').value,
      date:$('subscriptionDate').value
    })});
    state.subscriptions.unshift(sub);
    await fetchTransactions();
    e.target.reset();
    $('subscriptionDate').value=window.getLocalDateString();
    await reloadAnalytics();
    render();toast('Subscription added')
  }catch(e){toast(e.message)}
  finally{btn.disabled = false;}
};

$('loanForm').onsubmit=async e=>{
  e.preventDefault();
  const btn = e.target.querySelector('button');
  btn.disabled = true;
  try{
    const amount = +$('loanAmount').value;
    if (amount <= 0) throw new Error('Amount must be greater than 0');
    const loan=await api('loans',{method:'POST',body:JSON.stringify({person:$('loanPerson').value,amount})});
    state.loans.unshift(loan);
    await fetchTransactions();
    await reloadAnalytics();
    render();
    e.target.reset();
    toast('Lent money added')
  }catch(e){toast(e.message)}
  finally{btn.disabled = false;}
};

$('addMoney').onclick=()=>openMoney('add');
$('deductMoney').onclick=()=>openMoney('deduct');

function openMoney(action){
  state.moneyAction=action;
  $('moneyTitle').textContent=action==='add'?'Add Money':'Deduct Money';
  $('saveMoney').textContent=action==='add'?'Add Money':'Deduct Money';
  $('moneyAmount').value='';
  $('moneyDialog').showModal();
  $('moneyAmount').focus()
}

$('cancelMoney').onclick=()=>$('moneyDialog').close();

$('moneyForm').onsubmit=async e=>{
  e.preventDefault();
  const btn = $('saveMoney');
  btn.disabled = true;
  try{
    const amount=Number($('moneyAmount').value);
    if(!Number.isFinite(amount)||amount<=0){toast('Enter an amount greater than 0');return}
    const x=await api('transactions',{method:'POST',body:JSON.stringify({
      type:state.moneyAction==='add'?'add_money':'deduct_money',
      amount,
      description:state.moneyAction==='add'?'Added Money':'Deducted Money',
      date:new Date()
    })});
    state.transactions.unshift(x);
    $('moneyDialog').close();
    await reloadAnalytics();
    render();
    toast(state.moneyAction==='add'?'Money added':'Money deducted')
  }catch(e){toast(e.message)}
  finally{btn.disabled = false;}
};

async function repayLoan(id){
  const loan=state.loans.find(l=>l._id===id); if(!loan)return;
  const original=Number(loan.amount||0), repaid=Number(loan.repaidAmount||0);
  const outstanding=Math.max(0,original-repaid);
  const value=prompt(`Enter repayment amount (remaining ${money(outstanding)}):`,'');
  if(value===null)return;
  const amount=Number(value);
  if(!Number.isFinite(amount)||amount<=0){toast('Enter a repayment amount greater than 0');return}
  if(amount>outstanding){toast(`Repayment cannot exceed ${money(outstanding)}`);return}
  try{
    const updated=await api('loans/'+id,{method:'PUT',body:JSON.stringify({repaidAmount:repaid+amount})});
    Object.assign(loan,updated);
    await fetchTransactions();
    await reloadAnalytics();
    render();
    toast(`${money(amount)} repaid and added back to balance`)
  }catch(e){toast(e.message)}
}

async function fullyRepayLoan(id){
  const loan=state.loans.find(l=>l._id===id); if(!loan)return;
  const original=Number(loan.amount||0), repaid=Number(loan.repaidAmount||0);
  const outstanding=Math.max(0,original-repaid); if(outstanding<=0)return;
  if(!confirm(`Mark ${money(outstanding)} as fully repaid? This amount will be added back to your balance.`))return;
  try{
    const updated=await api('loans/'+id,{method:'PUT',body:JSON.stringify({repaidAmount:original})});
    Object.assign(loan,updated);
    await fetchTransactions();
    await reloadAnalytics();
    render();
    toast(`${money(outstanding)} added back to balance`)
  }catch(e){toast(e.message)}
}

$('themeButton').onclick=()=>{document.body.classList.toggle('dark');localStorage.setItem('cashflow-theme',document.body.classList.contains('dark')?'dark':'light')};
if(localStorage.getItem('cashflow-theme')==='dark')document.body.classList.add('dark');
function toast(t){$('toast').textContent=t;$('toast').classList.add('show');setTimeout(()=>$('toast').classList.remove('show'),2200)}

requireAuth().then(user=>{if(user)load();});

$('filterForm').onsubmit = async (e) => {
  e.preventDefault();
  filterParams.search = $('filterSearch').value;
  filterParams.category = $('filterCategory').value;
  filterParams.type = $('filterType').value;
  filterParams.dateFrom = $('filterDateFrom').value;
  filterParams.dateTo = $('filterDateTo').value;
  filterParams.sort = $('filterSort').value;
  filterParams.page = 1;
  await fetchTransactions();
  renderTransactions();
};

window.resetFilters = async () => {
  $('filterForm').reset();
  filterParams.search = '';
  filterParams.category = '';
  filterParams.type = '';
  filterParams.dateFrom = '';
  filterParams.dateTo = '';
  filterParams.sort = 'newest';
  filterParams.page = 1;
  await fetchTransactions();
  renderTransactions();
};

window.prevPage = async () => {
  if (filterParams.page > 1) {
    filterParams.page--;
    await fetchTransactions();
    renderTransactions();
  }
};

window.nextPage = async () => {
  const maxPage = Math.ceil(totalTransactions / filterParams.limit) || 1;
  if (filterParams.page < maxPage) {
    filterParams.page++;
    await fetchTransactions();
    renderTransactions();
  }
};

window.exportTransactions = async (format) => {
  const query = new URLSearchParams({ ...filterParams, export: 'true', format }).toString();
  const t = localStorage.getItem('cashflow-token');
  const headers = t ? { Authorization: `Bearer ${t}` } : {}; // Wait! We switched back to cookies!
  // We can just open the URL in a new tab to trigger the native browser download, since cookies are automatically sent!
  // Wait, if it's an API route with cookies, opening in new tab will send the cookie.
  window.open(`/api/transactions?${query}`, '_blank');
};

let catPeriodType = 'month';
let catPeriodOffset = 0;

function formatLocal(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}

function getCatPeriodDates() {
  const d = new Date();
  if (catPeriodType === 'month') {
    const start = new Date(d.getFullYear(), d.getMonth() + catPeriodOffset, 1);
    const end = new Date(d.getFullYear(), d.getMonth() + catPeriodOffset + 1, 0);
    return { 
      start: formatLocal(start), 
      end: formatLocal(end),
      label: start.toLocaleString('default', { month: 'short', year: 'numeric' })
    };
  } else if (catPeriodType === 'year') {
    const start = new Date(d.getFullYear() + catPeriodOffset, 0, 1);
    const end = new Date(d.getFullYear() + catPeriodOffset, 11, 31);
    return {
      start: formatLocal(start),
      end: formatLocal(end),
      label: start.getFullYear().toString()
    };
  } else if (catPeriodType === 'week') {
    const current = new Date();
    current.setDate(current.getDate() - current.getDay() + (catPeriodOffset * 7));
    const start = new Date(current);
    const end = new Date(current);
    end.setDate(end.getDate() + 6);
    
    const sm = start.toLocaleString('default', { month: 'short', day: 'numeric' });
    const em = end.toLocaleString('default', { month: 'short', day: 'numeric' });
    return {
      start: formatLocal(start),
      end: formatLocal(end),
      label: sm + ' - ' + em
    };
  }
}

window.changeCatPeriodType = async () => {
  catPeriodType = document.getElementById('catPeriodType').value;
  catPeriodOffset = 0;
  await updateCatPeriod();
};

window.navCatPeriod = async (dir) => {
  catPeriodOffset += dir;
  await updateCatPeriod();
};

async function updateCatPeriod() {
  const { start, end, label } = getCatPeriodDates();
  document.getElementById('catPeriodLabel').textContent = label;
  state.analytics = await api('analytics?catStart=' + start + '&catEnd=' + end + '&catPeriodType=' + catPeriodType);
  renderAnalytics();
}

// Initialize the label on load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('catPeriodLabel').textContent = getCatPeriodDates().label;
  });
} else {
  document.getElementById('catPeriodLabel').textContent = getCatPeriodDates().label;
}

let yearCategoryChartInstance = null;

window.sendAiMessage = async () => {
  const input = document.getElementById('aiInput');
  const text = input.value.trim();
  if (!text) return;
  const chatWin = document.getElementById('aiChatWindow');
  const userMsg = document.createElement('div');
  userMsg.style = 'align-self: flex-end; background: var(--primary); color: white; padding: 10px 14px; border-radius: 14px; border-bottom-right-radius: 4px; max-width: 80%;';
  userMsg.textContent = text;
  chatWin.appendChild(userMsg);
  input.value = '';
  const loadMsg = document.createElement('div');
  loadMsg.style = 'align-self: flex-start; background: var(--bg); padding: 10px 14px; border-radius: 14px; border-bottom-left-radius: 4px; max-width: 80%; border: 1px solid var(--border); color: var(--muted);';
  loadMsg.textContent = 'Thinking...';
  chatWin.appendChild(loadMsg);
  chatWin.scrollTop = chatWin.scrollHeight;
  try {
    document.getElementById('aiSendBtn').disabled = true;
    const res = await api('ai/chat', { method: 'POST', body: JSON.stringify({ question: text }) });
    loadMsg.style.color = 'var(--text)';
    
    let cleanAnswer = res.answer || '';
    cleanAnswer = cleanAnswer.replace(/\$\$(.*?)\$\$/gs, '\n\n$1\n\n');
    cleanAnswer = cleanAnswer.replace(/\\\[(.*?)\\\]/gs, '\n\n$1\n\n');
    cleanAnswer = cleanAnswer.replace(/\\\((.*?)\\\)/g, '$1');
    cleanAnswer = cleanAnswer.replace(/\$(.*?)\$/g, '$1');
    
    cleanAnswer = cleanAnswer.replace(/\\mathbf\{([^}]*)\}/g, '**$1**');
    cleanAnswer = cleanAnswer.replace(/\\textbf\{([^}]*)\}/g, '**$1**');
    cleanAnswer = cleanAnswer.replace(/\\textit\{([^}]*)\}/g, '*$1*');
    cleanAnswer = cleanAnswer.replace(/\\text\{([^}]*)\}/g, '$1');
    cleanAnswer = cleanAnswer.replace(/\\mathrm\{([^}]*)\}/g, '$1');
    cleanAnswer = cleanAnswer.replace(/\\math[a-zA-Z]+\{([^}]*)\}/g, '$1');
    
    cleanAnswer = cleanAnswer.replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, '$1/$2');
    cleanAnswer = cleanAnswer.replace(/\\times/g, 'x');
    cleanAnswer = cleanAnswer.replace(/\\div/g, '/');
    cleanAnswer = cleanAnswer.replace(/\\cdot/g, '*');
    cleanAnswer = cleanAnswer.replace(/\\approx/g, '≈');
    cleanAnswer = cleanAnswer.replace(/\\neq/g, '≠');
    cleanAnswer = cleanAnswer.replace(/\\leq/g, '≤');
    cleanAnswer = cleanAnswer.replace(/\\geq/g, '≥');
    cleanAnswer = cleanAnswer.replace(/\\_/g, '_');
    
    if (window.DOMPurify && window.marked) {
       const parsedHtml = typeof marked.parse === 'function' ? marked.parse(cleanAnswer) : marked(cleanAnswer);
       loadMsg.innerHTML = DOMPurify.sanitize(parsedHtml);
    } else {
       loadMsg.innerHTML = esc(cleanAnswer).replace(/\n/g, '<br>');
    }
  } catch (err) {
    loadMsg.style.color = 'var(--danger)';
    loadMsg.textContent = err.message || 'Failed to reach AI Assistant.';
  } finally {
    document.getElementById('aiSendBtn').disabled = false;
    chatWin.scrollTop = chatWin.scrollHeight;
  }
};
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    const aiInput = document.getElementById('aiInput');
    if (aiInput) aiInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendAiMessage(); });
  });
} else {
  const aiInput = document.getElementById('aiInput');
  if (aiInput) aiInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendAiMessage(); });
}

async function updateCurrency() {
  const newCurrency = $('currencySelect').value;
  try {
    const res = await api('user/settings', { method: 'PUT', body: JSON.stringify({ currency: newCurrency }) });
    if (res.success) {
      userCurrency = res.currency;
      render();
      await reloadAnalytics();
      toast('Currency updated');
    }
  } catch (e) {
    toast(e.message);
  }
}
window.updateCurrency = updateCurrency;

function renderCreditCards() {
  const ccList = $('ccList');
  if (!ccList) return;
  if (!state.creditCards || state.creditCards.length === 0) {
    ccList.innerHTML = `
      <div style="text-align:center; padding: 30px 15px;">
        <p class="muted" style="font-size: 16px; font-weight: 500;">No credit cards added yet.</p>
        <p class="muted" style="margin-bottom: 20px; font-size: 14px;">Add your first credit card to start tracking<br>your credit limit and balances.</p>
        <button class="primary-button" style="width: auto; padding: 0.6rem 1.2rem;" onclick="openCCModal()">+ Add Credit Card</button>
      </div>
    `;
    return;
  }
  
  ccList.innerHTML = state.creditCards.map(c => {
    const current = (typeof c.currentBalance === 'number') ? c.currentBalance : 0;
    const limit = (typeof c.creditLimit === 'number' && c.creditLimit > 0) ? c.creditLimit : 0;
    
    const availableCredit = Math.max(0, limit - current);
    let utilRaw = (limit > 0) ? (current / limit) * 100 : 0;
    if (!isFinite(utilRaw) || isNaN(utilRaw)) utilRaw = 0;
    
    const utilization = utilRaw.toFixed(2) + '%';
    const utilBarWidth = Math.min(Math.max(utilRaw, 0), 100);
    
    const statBal = (c.statementBalance != null) ? money(c.statementBalance) : '-';
    const minPay = (c.minimumPayment != null) ? money(c.minimumPayment) : '-';
    const statDate = c.statementDate ? c.statementDate : '-';
    const dueDate = c.dueDate ? c.dueDate : '-';
    
    return `
      <div class="card" style="margin-bottom: 20px; border: 1px solid var(--border); box-shadow: none;">
        <!-- Header -->
        <div style="display:flex; justify-content:space-between; align-items:flex-start; border-bottom: 1px solid var(--border); padding-bottom: 14px; margin-bottom: 16px;">
          <div>
            <h3 style="margin:0; font-size:18px;">${c.name ? c.name.replace(/</g, "&lt;") : '-'}</h3>
            <p class="muted" style="margin:4px 0 0 0; font-size:13px;">${c.issuer ? c.issuer.replace(/</g, "&lt;") : '-'} &bull; ${c.network ? c.network.replace(/</g, "&lt;") : '-'} &bull;&bull;&bull;&bull; ${c.last4 ? c.last4.replace(/</g, "&lt;") : '-'}</p>
          </div>
          <div style="display:flex; gap:8px;">
            <button class="primary-button" onclick="openPayCC('${c._id}')" style="padding: 4px 8px; font-size: 12px; margin-right: 8px; width: auto;">Pay Bill</button>
              <button class="icon-button" onclick="editCC('${c._id}')" title="Edit">✏️</button>
            <button class="icon-button" onclick="deleteCC('${c._id}')" title="Delete" style="color:var(--danger)">🗑️</button>
          </div>
        </div>
        
        <!-- Main Information -->
        <div style="margin-bottom: 18px;">
          <span class="muted" style="font-size:12px; font-weight:600; letter-spacing:0.5px;">CURRENT BALANCE</span>
          <div style="font-size:26px; font-weight:bold; color:var(--text); margin-top:2px;">${money(current)}</div>
        </div>

        <!-- Utilization Visual -->
        <div style="margin-bottom: 20px;">
          <div style="display:flex; justify-content:space-between; font-size:12px; font-weight:600; letter-spacing:0.5px; margin-bottom: 8px;">
            <span class="muted">CREDIT UTILIZATION</span>
            <span>${utilization}</span>
          </div>
          <div style="height:8px; background:var(--border); border-radius:4px; overflow:hidden;">
            <div style="height:100%; width:${utilBarWidth}%; background:var(--primary); border-radius:4px;"></div>
          </div>
        </div>

        <!-- Secondary Information -->
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(140px, 1fr)); gap:16px; font-size:14px; margin-bottom: 20px;">
          <div>
            <strong style="color:var(--muted); font-size:12px; letter-spacing:0.5px;">AVAILABLE CREDIT</strong><br>
            <span style="font-size:15px;">${money(availableCredit)}</span>
          </div>
          <div>
            <strong style="color:var(--muted); font-size:12px; letter-spacing:0.5px;">CREDIT LIMIT</strong><br>
            <span style="font-size:15px;">${money(limit)}</span>
          </div>
        </div>

        <!-- Payment Information & Dates -->
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(140px, 1fr)); gap:16px; font-size:14px; padding-top: 16px; border-top: 1px dashed var(--border);">
          <div>
            <strong style="color:var(--muted); font-size:12px; letter-spacing:0.5px;">STATEMENT BALANCE</strong><br>
            <span style="font-size:14px;">${statBal}</span>
          </div>
          <div>
            <strong style="color:var(--muted); font-size:12px; letter-spacing:0.5px;">MINIMUM PAYMENT</strong><br>
            <span style="font-size:14px;">${minPay}</span>
          </div>
          <div>
            <strong style="color:var(--muted); font-size:12px; letter-spacing:0.5px;">STATEMENT DATE</strong><br>
            <span style="font-size:14px;">${statDate}</span>
          </div>
          <div>
            <strong style="color:var(--muted); font-size:12px; letter-spacing:0.5px;">DUE DATE</strong><br>
              <span style="font-size:14px;">${dueDate}</span>
            </div>
            <div>
              <strong style="color:var(--muted); font-size:12px; letter-spacing:0.5px;">STATEMENT STATUS</strong><br>
              <span style="font-size:14px;">${c.statementStatus || '-'}</span>
            </div>
            <div>
              <strong style="color:var(--muted); font-size:12px; letter-spacing:0.5px;">PAYMENT STATUS</strong><br>
              <span style="font-size:14px; ${(c.paymentStatus||'').includes('Overdue') ? 'color:var(--danger);font-weight:600;' : ''}">${c.paymentStatus || '-'}</span>
            </div>
        </div>
        
      </div>
    `;
  }).join('');
}

window.openCCModal = () => {
  $('ccForm').reset();
  $('ccId').value = '';
  $('ccTitle').textContent = 'Add Credit Card';
  $('ccDialog').showModal();
};

window.editCC = (id) => {
  const c = state.creditCards.find(x => x._id === id);
  if (!c) return;
  $('ccId').value = c._id;
  $('ccName').value = c.name;
  $('ccIssuer').value = c.issuer;
  $('ccLast4').value = c.last4;
  $('ccNetwork').value = c.network;
  $('ccLimit').value = c.creditLimit;
  $('ccBalance').value = c.currentBalance;
  $('ccStatementBalance').value = c.statementBalance;
  $('ccMinPayment').value = c.minimumPayment;
  $('ccStatementDate').value = c.statementDate || '';
  $('ccDueDate').value = c.dueDate || '';
  $('ccTitle').textContent = 'Edit Credit Card';
  $('ccDialog').showModal();
};

window.deleteCC = async (id) => {
  if (!confirm('Are you sure you want to delete this credit card?')) return;
  try {
    await api('credit-cards/' + id, { method: 'DELETE' });
    await reloadAnalytics();
    render();
    toast('Credit card deleted');
  } catch(e) { toast(e.message); }
};

if ($('ccForm')) {
  $('ccForm').onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    const body = {
      name: $('ccName').value,
      issuer: $('ccIssuer').value,
      last4: $('ccLast4').value,
      network: $('ccNetwork').value,
      creditLimit: Number($('ccLimit').value),
      currentBalance: Number($('ccBalance').value),
      statementBalance: Number($('ccStatementBalance').value),
      minimumPayment: Number($('ccMinPayment').value)
    };
    if ($('ccStatementDate').value) body.statementDate = Number($('ccStatementDate').value);
    if ($('ccDueDate').value) body.dueDate = Number($('ccDueDate').value);
    
    const id = $('ccId').value;
    try {
      if (id) {
        await api('credit-cards/' + id, { method: 'PUT', body: JSON.stringify(body) });
        toast('Credit card updated');
      } else {
        await api('credit-cards', { method: 'POST', body: JSON.stringify(body) });
        toast('Credit card added');
      }
      await reloadAnalytics();
      render();
      $('ccDialog').close();
    } catch(err) {
      toast(err.message);
    } finally {
      btn.disabled = false;
    }
  };
}

$('expenseType').onchange = function() {
    const isExpense = this.value === 'expense';
    const pm = $('expensePaymentMethod');
    const cc = $('expenseCreditCard');
    if (pm) pm.style.display = isExpense ? 'block' : 'none';
    if (cc && pm && pm.value === 'credit_card' && isExpense) {
        cc.style.display = 'block';
    } else if (cc) {
        cc.style.display = 'none';
    }
};

window.openPayCC = id => {
  const c = state.creditCards.find(x => x._id === id);
  if (!c) return;
  $('payCCId').value = id;
  $('payCCSubtitle').textContent = `Paying ${c.name} (•••• ${c.last4})`;
  $('payCCAmount').value = '';
  $('payCCAmount').max = c.currentBalance;
  $('payCCDialog').showModal();
};

if ($('payCCForm')) {
  $('payCCForm').onsubmit = async e => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      const creditCardId = $('payCCId').value;
      const amount = +$('payCCAmount').value;
      if (amount <= 0) throw new Error('Invalid amount');
      
      const x = await api('transactions', {
        method: 'POST',
        body: JSON.stringify({
          type: 'credit_card_payment',
          amount,
          description: 'Credit Card Payment',
          creditCardId,
          date: new Date()
        })
      });
      state.transactions.unshift(x);
      $('payCCDialog').close();
      await reloadAnalytics();
      render();
      toast('Payment successful');
    } catch (e) {
      toast(e.message);
    } finally {
      btn.disabled = false;
    }
  };
}


// CashFlow Lens
if ($('lensDate')) $('lensDate').value = window.getLocalDateString();

window.lensState = { commitmentsSelected: true, expectedSelected: true };

window.toggleLensNode = function(type) {
    if (type === 'commitments') {
        lensState.commitmentsSelected = !lensState.commitmentsSelected;
        if (lensState.commitmentsSelected) $('tlCommitmentsNode').classList.remove('unselected');
        else $('tlCommitmentsNode').classList.add('unselected');
    } else if (type === 'expected') {
        lensState.expectedSelected = !lensState.expectedSelected;
        if (lensState.expectedSelected) $('tlExpectedNode').classList.remove('unselected');
        else $('tlExpectedNode').classList.add('unselected');
    }
    window.updateLensProjectedBalance();
};


  if ($('lensForm')) {
    $('lensForm').onsubmit = async (e) => {
        e.preventDefault();
        const btn = $('lensSimulateBtn');
        btn.disabled = true;
        btn.textContent = 'Simulating...';
        $('lensError').style.display = 'none';
        $('lensResultSection').style.display = 'none';
        if ($('lensAdvancedTools')) $('lensAdvancedTools').style.display = 'none';
        $('lensCcSection').style.display = 'none';

        try {
            const payload = {
                amount: $('lensAmount').value,
                category: $('lensCategory').options[$('lensCategory').selectedIndex].text,
                paymentMethod: $('lensPaymentMethod').value,
                creditCardId: $('lensPaymentMethod').value === 'credit_card' ? $('lensCreditCard').value : null,
                date: $('lensDate').value
            };

            const json = await api('lens/simulate', {
                method: 'POST',
                body: JSON.stringify(payload)
            });

            if (!json.success) throw new Error(json.error || 'Simulation failed');

            const data = json.data;
            lensState.currentBalance = data.currentBalance;
            lensState.baseProjectedBalance = data.projectedBalance;
            lensState.simulatedAmount = data.simulatedAmount;
            lensState.lastData = data;
            lensState.paymentMethod = data.paymentMethod;
            lensState.upcomingCommitmentsTotal = data.upcomingCommitments ? data.upcomingCommitments.reduce((sum, c) => sum + c.amount, 0) : 0;
            lensState.upcomingCommitmentsEmpty = !data.upcomingCommitments || data.upcomingCommitments.length === 0;
            lensState.historicalAverage = (data.historicalSpending && data.historicalSpending.monthlyAverage !== undefined) ? data.historicalSpending.monthlyAverage : 0;
            lensState.historicalEmpty = !data.historicalSpending || data.historicalSpending.monthlyAverage === undefined;

            $('tlCurrentBalance').textContent = money(data.currentBalance);
            
            // Decision
            let decisionDetails = payload.category + ' &bull; ' + (data.paymentMethod === 'cash' ? 'Cash' : 'Credit Card');
            $('tlDecisionDetails').innerHTML = decisionDetails;
            
            if (data.paymentMethod === 'cash') {
                $('tlDecisionImpact').textContent = '-' + money(data.simulatedAmount);
                $('tlDecisionImpact').style.color = 'var(--danger)';
            } else {
                $('tlDecisionImpact').innerHTML = '<div style="font-size: 13px; color: var(--muted); font-weight: normal; margin-bottom: 2px;">Cash impact: ' + money(0) + '</div><div style="color: var(--primary);">Credit card impact: +' + money(data.simulatedAmount) + '</div>';
                $('tlDecisionImpact').style.color = '';
            }

            if (lensState.upcomingCommitmentsEmpty) {
                $('tlCommitmentsDetails').textContent = 'No upcoming commitments';
            } else {
                let html = '';
                data.upcomingCommitments.forEach(c => {
                    let dateStr = '';
                    if (c.date) {
                        const d = new Date(c.date + 'T12:00:00');
                        const day = d.getDate();
                        const month = d.toLocaleString('en-US', { month: 'short' });
                        dateStr = ' &middot; ' + day + ' ' + month;
                    }
                    html += '<div style="display: flex; justify-content: space-between; margin-bottom: 2px;"><span>' + c.name + '</span><span>' + money(c.amount) + dateStr + '</span></div>';
                });
                html += '<div style="display: flex; justify-content: space-between; margin-top: 6px; padding-top: 6px; border-top: 1px solid var(--border); font-weight: bold;"><span>Total</span><span>' + money(lensState.upcomingCommitmentsTotal) + '</span></div>';
                $('tlCommitmentsDetails').innerHTML = html;
            }

            if (lensState.historicalEmpty) {
                $('tlExpectedNode').classList.remove('selectable');
                $('tlExpectedNode').onclick = null;
            } else {
                $('tlExpectedNode').classList.add('selectable');
                $('tlExpectedNode').onclick = function() { window.toggleLensNode('expected') };
            }

            if (lensState.upcomingCommitmentsEmpty) {
                $('tlCommitmentsNode').classList.remove('selectable');
                $('tlCommitmentsNode').onclick = null;
            } else {
                $('tlCommitmentsNode').classList.add('selectable');
                $('tlCommitmentsNode').onclick = function() { window.toggleLensNode('commitments') };
            }

            window.updateLensProjectedBalance();

            // Credit Card Section
            if (data.paymentMethod === 'credit_card' && data.creditCardImpact) {
                $('lensCcSection').style.display = 'block';
                $('lensCcCurrent').textContent = money(data.creditCardImpact.projectedCardBalance - data.simulatedAmount);
                $('lensCcProjected').textContent = money(data.creditCardImpact.projectedCardBalance);
                $('lensCcAvail').textContent = money(data.creditCardImpact.projectedAvailableCredit);
                $('lensCcUtil').textContent = (data.creditCardImpact.projectedUtilization || 0).toFixed(1) + '%';
            } else {
                $('lensCcSection').style.display = 'none';
            }

            $('lensResultSection').style.display = 'block';
            if ($('lensAdvancedTools')) $('lensAdvancedTools').style.display = 'block';
            
        } catch(err) {
            $('lensError').textContent = err.message || 'Network or server error';
            $('lensError').style.display = 'block';
        } finally {
            btn.disabled = false;
            btn.textContent = 'Simulate Decision';
        }
    };
  }


window.toggleLensShockMethod = function() {
    const method = $('lensShockMethod').value;
    if (method === 'credit_card') {
        $('lensShockCard').style.display = 'block';
    } else {
        $('lensShockCard').style.display = 'none';
    }
};

window.resetLens = function() {
    $('lensForm').reset();
    if ($('lensDate')) $('lensDate').value = window.getLocalDateString();
    $('lensResultSection').style.display = 'none';
        if ($('lensAdvancedTools')) $('lensAdvancedTools').style.display = 'none';
    if ($('lensAdvancedTools')) $('lensAdvancedTools').style.display = 'none';
    $('lensCcSection').style.display = 'none';
    
    lensState = {
        commitmentsSelected: true,
        expectedSelected: true
    };
    if ($('tlCommitmentsNode')) $('tlCommitmentsNode').classList.remove('unselected');
    if ($('tlExpectedNode')) $('tlExpectedNode').classList.remove('unselected');
    
    $('lensBtnAvailableToSpend').disabled = false;
    $('lensAvailableResult').style.display = 'none';
    $('lensSafetyReserve').value = '';
    
    $('lensBtnShock').disabled = false;
    $('lensShockResult').style.display = 'none';
    $('lensShockAmount').value = '';
    
    $('lensBtnCompare').disabled = false;
    $('lensCompareResult').style.display = 'none';
    $('lensCompareAmount').value = '';
};

window.calculateLensAvailableToSpend = async function() {
    const reserve = Number($('lensSafetyReserve').value);
    if (isNaN(reserve) || reserve < 0) return toast('Please enter a valid safety reserve');
    
    $('lensBtnAvailableToSpend').disabled = true;
    $('lensBtnAvailableToSpend').textContent = '...';
    
    try {
        const payload = {
            amount: $('lensAmount').value || 1, // base requirements
            category: 'Lens',
            paymentMethod: 'cash',
            date: $('lensDate').value,
            advancedTool: 'availableToSpend',
            safetyReserve: reserve,
            commitmentsSelected: lensState.commitmentsSelected,
            expectedSelected: lensState.expectedSelected
        };
        const json = await api('lens/simulate', { method: 'POST', body: JSON.stringify(payload) });
        if (!json.success) throw new Error(json.error);
        
        lensState.lastAvailableToSpend = json.data.availableToSpend;
          $('lensAvailableAmount').textContent = money(json.data.availableToSpend);
        $('lensAvailableResult').style.display = 'block';
    } catch(err) {
        toast(err.message || 'Error calculating Available to Spend');
    } finally {
        $('lensBtnAvailableToSpend').disabled = false;
        $('lensBtnAvailableToSpend').textContent = 'Calculate';
    }
};

window.calculateLensShock = async function() {
    const shockAmt = Number($('lensShockAmount').value);
    if (isNaN(shockAmt) || shockAmt <= 0) return toast('Please enter a valid shock amount');
    if ($('lensShockMethod').value === 'credit_card' && !$('lensShockCard').value) return toast('Please add and select a credit card first');
    
    $('lensBtnShock').disabled = true;
    $('lensBtnShock').textContent = '...';
    
    try {
        const payload = {
            amount: $('lensAmount').value || 1,
            category: $('lensShockType').value,
            paymentMethod: 'cash',
            date: $('lensDate').value,
            advancedTool: 'financialShock',
            shockAmount: shockAmt,
            shockPaymentMethod: $('lensShockMethod').value,
            shockCardId: $('lensShockMethod').value === 'credit_card' ? $('lensShockCard').value : null,
            commitmentsSelected: lensState.commitmentsSelected,
            expectedSelected: lensState.expectedSelected
        };
        const json = await api('lens/simulate', { method: 'POST', body: JSON.stringify(payload) });
        if (!json.success) throw new Error(json.error);
        
        const shock = json.data.financialShock;
          lensState.lastShock = shock;
        if (shock.method === 'cash') {
            $('lensShockCashDetails').style.display = 'block';
            $('lensShockCcDetails').style.display = 'none';
            $('lensShockImpact').textContent = '-' + money(shock.cashImpact);
            $('lensShockImpact').style.color = 'var(--danger)';
            $('lensShockProjBalance').textContent = money(shock.projectedBalance);
        } else {
            $('lensShockCashDetails').style.display = 'none';
            $('lensShockCcDetails').style.display = 'block';
            $('lensShockCashImpact').textContent = money(shock.cashImpact);
            $('lensShockCcImpact').textContent = '+' + money(shock.creditCardImpact);
            $('lensShockCcImpact').style.color = 'var(--primary)';
            $('lensShockCcProj').textContent = money(shock.cardDetails.projectedCardBalance);
            $('lensShockCcAvail').textContent = money(shock.cardDetails.projectedAvailableCredit);
            $('lensShockCcUtil').textContent = shock.cardDetails.projectedUtilization.toFixed(1) + '%';
        }
        $('lensShockResult').style.display = 'block';
    } catch(err) {
        toast(err.message || 'Error calculating Financial Shock');
    } finally {
        $('lensBtnShock').disabled = false;
        $('lensBtnShock').textContent = 'Calculate';
    }
};

window.calculateLensCompare = async function() {
    const pAmt = Number($('lensCompareAmount').value);
    if (isNaN(pAmt) || pAmt <= 0) return toast('Please enter a valid purchase amount');
    if (!$('lensCompareCard').value) return toast('Please add and select a credit card first');
    
    $('lensBtnCompare').disabled = true;
    $('lensBtnCompare').textContent = '...';
    
    try {
        const payload = {
            amount: $('lensAmount').value || 1,
            category: 'Compare',
            paymentMethod: 'cash',
            date: $('lensDate').value,
            advancedTool: 'paymentComparison',
            comparisonAmount: pAmt,
            comparisonCardId: $('lensCompareCard').value,
            commitmentsSelected: lensState.commitmentsSelected,
            expectedSelected: lensState.expectedSelected
        };
        const json = await api('lens/simulate', { method: 'POST', body: JSON.stringify(payload) });
        if (!json.success) throw new Error(json.error);
        
                const cmp = json.data.paymentComparison;
          lensState.lastCompare = cmp;
        
        $('lensCmpCashImpact').textContent = '-' + money(cmp.cash.cashImpact);
        $('lensCmpCashProj').textContent = money(cmp.cash.projectedBalance);
        
        $('lensCmpCashZero').textContent = money(0);
        
        if (cmp.creditCard) {
            $('lensCmpCcProj').textContent = money(cmp.creditCard.projectedCardBalance);
            $('lensCmpCcAvail').textContent = money(cmp.creditCard.projectedAvailableCredit);
            $('lensCmpCcUtil').textContent = cmp.creditCard.projectedUtilization.toFixed(1) + '%';
        }
        
        $('lensCompareResult').style.display = 'block';
    } catch(err) {
        toast(err.message || 'Error calculating Comparison');
    } finally {
        $('lensBtnCompare').disabled = false;
        $('lensBtnCompare').textContent = 'Calculate';
    }
};

window.renderLensState = function() {
    if (!$('lensResultSection') || $('lensResultSection').style.display === 'none') return;
    if (!lensState) return;
    const data = lensState.lastData;
    if (!data) return;

    $('tlCurrentBalance').textContent = money(data.currentBalance);

    if (data.paymentMethod === 'cash') {
        $('tlDecisionImpact').textContent = '-' + money(data.simulatedAmount);
    } else {
        $('tlDecisionImpact').innerHTML = '<div style="font-size: 13px; color: var(--muted); font-weight: normal; margin-bottom: 2px;">Cash impact: ' + money(0) + '</div><div style="color: var(--primary);">Credit card impact: +' + money(data.simulatedAmount) + '</div>';
    }

    if (!lensState.upcomingCommitmentsEmpty && data.upcomingCommitments) {
        let html = '';
        data.upcomingCommitments.forEach(c => {
            let dateStr = '';
            if (c.date) {
                const d = new Date(c.date + 'T12:00:00');
                const day = d.getDate();
                const month = d.toLocaleString('en-US', { month: 'short' });
                dateStr = ' &middot; ' + day + ' ' + month;
            }
            html += '<div style="display: flex; justify-content: space-between; margin-bottom: 2px;"><span>' + esc(c.name) + '</span><span>' + money(c.amount) + dateStr + '</span></div>';
        });
        html += '<div style="display: flex; justify-content: space-between; margin-top: 6px; padding-top: 6px; border-top: 1px solid var(--border); font-weight: bold;"><span>Total</span><span>' + money(lensState.upcomingCommitmentsTotal) + '</span></div>';
        $('tlCommitmentsDetails').innerHTML = html;
    }

    if (data.paymentMethod === 'credit_card' && data.creditCardImpact) {
        $('lensCcCurrent').textContent = money(data.creditCardImpact.projectedCardBalance - data.simulatedAmount);
        $('lensCcProjected').textContent = money(data.creditCardImpact.projectedCardBalance);
        $('lensCcAvail').textContent = money(data.creditCardImpact.projectedAvailableCredit);
    }

    if (window.updateLensProjectedBalance) window.updateLensProjectedBalance();

    if (lensState.lastAvailableToSpend !== undefined) {
        $('lensAvailableAmount').textContent = money(lensState.lastAvailableToSpend);
    }

    if (lensState.lastShock) {
        const shock = lensState.lastShock;
        if (shock.method === 'cash') {
            $('lensShockImpact').textContent = '-' + money(shock.cashImpact);
            $('lensShockProjBalance').textContent = money(shock.projectedBalance);
        } else {
            $('lensShockCashImpact').textContent = money(shock.cashImpact);
            $('lensShockCcImpact').textContent = '+' + money(shock.creditCardImpact);
            $('lensShockCcProj').textContent = money(shock.cardDetails.projectedCardBalance);
            $('lensShockCcAvail').textContent = money(shock.cardDetails.projectedAvailableCredit);
        }
    }

    if (lensState.lastCompare) {
        const cmp = lensState.lastCompare;
        $('lensCmpCashImpact').textContent = '-' + money(cmp.cash.cashImpact);
        $('lensCmpCashProj').textContent = money(cmp.cash.projectedBalance);
        $('lensCmpCashZero').textContent = money(0);
        if (cmp.creditCard) {
            $('lensCmpCcProj').textContent = money(cmp.creditCard.projectedCardBalance);
            $('lensCmpCcAvail').textContent = money(cmp.creditCard.projectedAvailableCredit);
        }
    }
};

window.updateLensProjectedBalance = function() {
    if (!lensState) return;
    
    let pBalance = lensState.baseProjectedBalance;
    
    // Add back the values if they are deselected
    if (!lensState.commitmentsSelected) {
        pBalance += (lensState.upcomingCommitmentsTotal || 0);
    }
    if (!lensState.expectedSelected) {
        pBalance += (lensState.historicalAverage || 0);
    }
    
    // Commitments
    if (lensState.commitmentsSelected) {
        if (lensState.upcomingCommitmentsEmpty) {
            $('tlCommitmentsImpact').textContent = money(0);
            $('tlCommitmentsImpact').style.color = 'var(--muted)';
        } else {
            $('tlCommitmentsImpact').innerHTML = '-' + money(lensState.upcomingCommitmentsTotal) + '<div style="font-size: 12px; font-weight: normal; color: var(--text); margin-top: 4px;">Included in simulation</div>';
            $('tlCommitmentsImpact').style.color = 'var(--danger)';
        }
    } else {
        if (lensState.upcomingCommitmentsEmpty) {
            $('tlCommitmentsImpact').innerHTML = money(0) + '<div style="font-size: 12px; font-weight: normal; margin-top: 4px;">Excluded from simulation</div>';
            $('tlCommitmentsImpact').style.color = 'var(--muted)';
        } else {
            $('tlCommitmentsImpact').innerHTML = money(lensState.upcomingCommitmentsTotal) + '<div style="font-size: 12px; font-weight: normal; color: var(--muted); margin-top: 4px;">Excluded from simulation</div>';
            $('tlCommitmentsImpact').style.color = 'var(--text)';
        }
    }

    // Expected Spending
    if (!lensState.historicalEmpty) {
        if (lensState.expectedSelected) {
            $('tlExpectedDetails').textContent = 'Historical spending estimate';
            $('tlExpectedImpact').innerHTML = '-' + money(lensState.historicalAverage) + ' / month<div style="font-size: 12px; font-weight: normal; color: var(--text); margin-top: 4px;">Included in simulation</div>';
            $('tlExpectedImpact').style.color = 'var(--danger)';
        } else {
            $('tlExpectedDetails').textContent = 'Historical spending estimate';
            $('tlExpectedImpact').innerHTML = money(lensState.historicalAverage) + ' / month<div style="font-size: 12px; font-weight: normal; color: var(--muted); margin-top: 4px;">Reference only</div>';
            $('tlExpectedImpact').style.color = 'var(--text)';
        }
    } else {
        $('tlExpectedDetails').textContent = 'Historical spending data unavailable';
        $('tlExpectedImpact').textContent = '';
    }

    // Projected Balance
    $('tlProjectedBalance').textContent = money(pBalance);
    
    let statusText = 'Projected positive';
    if (pBalance < 0) statusText = 'Projected negative';
    else if (pBalance === 0) statusText = 'Projected zero';
    
    if ($('tlProjectedStatus')) $('tlProjectedStatus').textContent = statusText;
};































