const state={transactions:[],subscriptions:[],loans:[],moneyAction:'add'};
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

async function load(){
  try{
    [state.transactions,state.subscriptions,state.loans,state.analytics]=await Promise.all([api('transactions'),api('subscriptions'),api('loans'),api('analytics')]);
    render();
  }catch(e){toast('Could not connect to MongoDB/server');console.error(e)}
}

async function reloadAnalytics(){
  state.analytics = await api('analytics');
}

function calculate(){
  if(state.analytics) return { balance: state.analytics.balance, spent: state.analytics.monthly.spent };
  return { balance: 0, spent: 0 };
}

function render(){
  const c=calculate();
  $('balance').textContent=money(c.balance);
  $('spent').textContent=`Spent ${money(c.spent)}`;
  renderTransactions();renderSubscriptions();renderLoans();
  if(state.analytics) renderAnalytics();
}

const typeLabels = {
  income: 'Income', expense: 'Expense', add_money: 'Added Money', deduct_money: 'Deducted Money',
  loan_given: 'Loan Given', loan_repayment: 'Loan Repayment', subscription: 'Subscription'
};

function renderTransactions(){
  $('transactionList').innerHTML=state.transactions.map(t=>{
    const isPositive = ['add_money', 'income', 'loan_repayment'].includes(t.type);
    const sign = isPositive ? '+' : '-';
    return `<div class="item"><div class="item-main"><strong>${esc(t.description)}</strong><span>${typeLabels[t.type]} · ${new Date(t.date).toLocaleDateString('en-IN')}</span></div><div class="item-right"><span class="amount">${sign}${money(t.amount)}</span><button class="delete" onclick="removeItem('transactions','${t._id}')">Delete</button></div></div>`
  }).join('')||empty('No transactions yet.')
}

function renderSubscriptions(){$('subscriptionList').innerHTML=state.subscriptions.map(s=>`<div class="item"><div class="item-main"><strong>${esc(s.name)}</strong><span>${money(s.amount)} · ${s.date}</span></div><div class="item-right"><span class="status">${s.active?'Active':'Paused'}</span><button class="delete" onclick="toggleSub('${s._id}',${!s.active})">${s.active?'Pause':'Resume'}</button><button class="delete" onclick="removeItem('subscriptions','${s._id}')">Delete</button></div></div>`).join('')||empty('No subscriptions yet.')}

function renderLoans(){
  $('loanList').innerHTML=state.loans.map(l=>{
    const original=Number(l.amount||0);
    const repaid=Math.min(original,Number(l.repaidAmount||0));
    const outstanding=Math.max(0,original-repaid);
    const fullyRepaid=outstanding<=0;
    return `<div class="item"><div class="item-main"><strong>${esc(l.person)}</strong><span>Original ${money(original)} · Repaid ${money(repaid)} · Remaining ${money(outstanding)}</span></div><div class="item-right loan-actions"><span class="amount">${money(outstanding)}</span>${fullyRepaid?'<span class="status">Fully repaid</span>':`<button class="delete" onclick="repayLoan('${l._id}')">Repay</button><button class="delete" onclick="fullyRepayLoan('${l._id}')">Fully Repaid</button>`}<button class="delete" onclick="removeItem('loans','${l._id}')">Delete</button></div></div>`;
  }).join('')||empty('No lent money recorded.')
}

const empty=t=>`<div class="item"><span class="muted">${t}</span></div>`;
const esc=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

let spendingChartInstance = null;

function renderAnalytics() {
  const { monthly, breakdown, upcomingSubscriptions, loans } = state.analytics;
  
  // Monthly summary
  $('summaryIncome').textContent = money(monthly.income);
  $('summarySpent').textContent = money(monthly.spent);
  $('summarySubs').textContent = money(monthly.subs);
  $('summaryLent').textContent = money(monthly.lent);
  $('summaryRepayments').textContent = money(monthly.loanRepayments);

  // Loan summary
  $('loanTotal').textContent = money(loans.totalLent);
  $('loanRepaid').textContent = money(loans.totalRepayments);
  $('loanOutstanding').textContent = money(loans.outstanding);

  // Upcoming Subscriptions
  $('upcomingSubList').innerHTML = upcomingSubscriptions.length ? upcomingSubscriptions.map(s => 
    `<div class="item"><div class="item-main"><strong>${esc(s.name)}</strong><span>${money(s.amount)} · Due on ${s.date}</span></div></div>`
  ).join('') : empty('No upcoming subscriptions.');

  // Chart
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
    if(type === 'loans' || type === 'subscriptions') {
      state.transactions = state.transactions.filter(t => t.relatedId !== id);
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

$('expenseDate').value=new Date().toISOString().slice(0,10);
$('subscriptionDate').value=new Date().toISOString().slice(0,10);
$('today').textContent=new Date().toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short'});

document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tab,.tab-panel').forEach(x=>x.classList.remove('active'));b.classList.add('active');$(b.dataset.tab).classList.add('active')});

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
      date:new Date($('expenseDate').value+'T12:00:00')
    })});
    state.transactions.unshift(x);
    e.target.reset();
    $('expenseDate').value=new Date().toISOString().slice(0,10);
    await reloadAnalytics();
    render();toast('Transaction added')
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
    const sub=await api('subscriptions',{method:'POST',body:JSON.stringify({name:$('subscriptionName').value,amount,date:$('subscriptionDate').value})});
    state.subscriptions.unshift(sub);
    // Fetch transactions again to get the new subscription transaction
    state.transactions = await api('transactions');
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
    // Fetch transactions again to get the new loan_given transaction
    state.transactions = await api('transactions');
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
    // Reload transactions to get the new loan_repayment transaction
    state.transactions = await api('transactions');
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
    // Reload transactions
    state.transactions = await api('transactions');
    await reloadAnalytics();
    render();
    toast(`${money(outstanding)} added back to balance`)
  }catch(e){toast(e.message)}
}

$('themeButton').onclick=()=>{document.body.classList.toggle('dark');localStorage.setItem('cashflow-theme',document.body.classList.contains('dark')?'dark':'light')};
if(localStorage.getItem('cashflow-theme')==='dark')document.body.classList.add('dark');
function toast(t){$('toast').textContent=t;$('toast').classList.add('show');setTimeout(()=>$('toast').classList.remove('show'),2200)}

requireAuth().then(user=>{if(user)load();});
