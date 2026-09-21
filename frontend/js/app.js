const state={transactions:[],subscriptions:[],loans:[],categories:[],notifications:[],moneyAction:'add'};
const $=id=>document.getElementById(id);
const money=n=>`₹${Number(n||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
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
  document.body.style.display = '';
  return data.user;
}

$('logoutButton').onclick=async()=>{
  try{await fetch('/api/auth/logout',{method:'POST'});}finally{location.href='/login';}
};

const filterParams = { search: '', category: '', type: '', dateFrom: '', dateTo: '', sort: 'newest', page: 1, limit: 10 };
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
    const results = await Promise.all([api('subscriptions'),api('loans'),api('categories'),api('notifications'),api('analytics')]);
    [state.subscriptions,state.loans,state.categories,state.notifications,state.analytics] = results;
    await fetchTransactions();
    render();
  }catch(e){toast('Could not connect to MongoDB/server');console.error(e)}
}

async function reloadAnalytics(){
  state.analytics = await api('analytics');
  state.notifications = await api('notifications');
}

function calculate(){
  if(state.analytics) return { balance: state.analytics.balance, spent: state.analytics.monthly.spent };
  return { balance: 0, spent: 0 };
}

function render(){
  const c=calculate();
  $('balance').textContent=money(c.balance);
  $('spent').textContent=`Spent ${money(c.spent)}`;
  renderTransactions();renderSubscriptions();renderLoans();renderCategories();renderNotifications();
  if(state.analytics) renderAnalytics();
}

const typeLabels = {
  expense: 'Expense', income: 'Income', add_money: 'Added Money', deduct_money: 'Deducted Money',
  loan_given: 'Loan Given', loan_repayment: 'Loan Repayment', subscription: 'Subscription'
};

function renderTransactions(){
  const catMap = {};
  state.categories.forEach(c => catMap[c._id] = c.name);
  $('transactionList').innerHTML=state.transactions.map(t=>{
    const isPositive = ['add_money', 'income', 'loan_repayment'].includes(t.type);
    const sign = isPositive ? '+' : '-';
    const catName = t.categoryId ? ` · ${esc(catMap[t.categoryId] || 'Unknown')}` : '';
    const editBtn = `<button class="delete" onclick="openEditTx('${t._id}')" style="color:var(--primary)">Edit</button>`;
    return `<div class="item"><div class="item-main"><strong>${esc(t.description)}</strong><span>${typeLabels[t.type]} · ${new Date(t.date).toLocaleDateString('en-IN')}${catName}</span></div><div class="item-right"><span class="amount">${sign}${money(t.amount)}</span>${editBtn}<button class="delete" onclick="removeItem('transactions','${t._id}')">Delete</button></div></div>`
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
  const { monthly, breakdown, categorySpending, budget, upcomingSubscriptions, loans } = state.analytics;
  
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
  ).join('') : empty('No category spending this month.');

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
    const updated = await api(`transactions/${id}`, { method: 'PUT', body: JSON.stringify({ amount, description, categoryId }) });
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

$('expenseDate').value=new Date().toISOString().slice(0,10);
$('subscriptionDate').value=new Date().toISOString().slice(0,10);
$('today').textContent=new Date().toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short'});

document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tab,.tab-panel').forEach(x=>x.classList.remove('active'));b.classList.add('active');$(b.dataset.tab).classList.add('active')});

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
      date:new Date($('expenseDate').value+'T12:00:00')
    })});
    state.transactions.unshift(x);
    e.target.reset();
    $('expenseDate').value=new Date().toISOString().slice(0,10);
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
    $('subscriptionDate').value=new Date().toISOString().slice(0,10);
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
