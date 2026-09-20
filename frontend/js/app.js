const state={expenses:[],subscriptions:[],loans:[],adjustments:[],moneyAction:'add'};
const $=id=>document.getElementById(id);
const money=n=>`₹${Number(n||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const api=async(path,options={})=>{const r=await fetch('/api/'+path,{headers:{'Content-Type':'application/json'},...options});const data=await r.json();if(r.status===401){location.href='/login';throw new Error('Please log in');}if(!r.ok)throw new Error(data.message||'Request failed');return data};
async function requireAuth(){
  const response=await fetch('/api/auth/me');
  if(!response.ok){location.href='/login';return null}
  const data=await response.json();
  $('userName').textContent=data.user.name;
  return data.user;
}

$('logoutButton').onclick=async()=>{
  try{await fetch('/api/auth/logout',{method:'POST'});}finally{location.href='/login';}
};

function sameMonth(d){const x=new Date(d),n=new Date();return x.getMonth()===n.getMonth()&&x.getFullYear()===n.getFullYear()}
function beforeOrToday(date){return new Date(date)<=new Date()}

async function load(){
  try{
    [state.expenses,state.subscriptions,state.loans,state.adjustments]=await Promise.all([api('expenses'),api('subscriptions'),api('loans'),api('adjustments')]);
    render();
  }catch(e){toast('Could not connect to MongoDB/server');console.error(e)}
}

/*
  Balance = all money added - all money deducted - expenses - subscriptions - outstanding lent money.
  There is no monthly/continuous mode. Adding money records money available to the user.
*/
function calculate(){
  const adjustmentsAll=state.adjustments.reduce((total,a)=>total+(a.type==='add'?Number(a.amount):-Number(a.amount)),0);
  const expensesAll=state.expenses.reduce((total,e)=>total+Number(e.amount||0),0);
  const currentDay=new Date().getDate();
  const subscriptionsAll=state.subscriptions.filter(s=>s.active && s.date && Number(String(s.date).split('-')[2])<=currentDay).reduce((total,s)=>total+Number(s.amount||0),0);
  const loansOutstanding=state.loans.reduce((total,l)=>total+Math.max(0,Number(l.amount||0)-Number(l.repaidAmount||0)),0);
  return {balance:adjustmentsAll-expensesAll-subscriptionsAll-loansOutstanding,spent:expensesAll+subscriptionsAll+loansOutstanding};
}

function render(){
  const c=calculate();
  $('balance').textContent=money(c.balance);
  $('spent').textContent=`Spent ${money(c.spent)}`;
  $('expenseCount').textContent=`(${state.expenses.length})`;
  renderExpenses();renderSubscriptions();renderLoans();
}

function renderExpenses(){$('expenseList').innerHTML=state.expenses.map(e=>`<div class="item"><div class="item-main"><strong>${esc(e.description)}</strong><span>${esc(e.category||'Other')} · ${new Date(e.date).toLocaleDateString('en-IN')}</span></div><div class="item-right"><span class="amount">-${money(e.amount)}</span><button class="delete" onclick="removeItem('expenses','${e._id}')">Delete</button></div></div>`).join('')||empty('No expenses yet.')}
function renderSubscriptions(){$('subscriptionList').innerHTML=state.subscriptions.map(s=>`<div class="item"><div class="item-main"><strong>${esc(s.name)}</strong><span>${money(s.amount)} · ${s.date}</span></div><div class="item-right"><span class="status">${s.active?'Active':'Paused'}</span><button class="delete" onclick="toggleSub('${s._id}',${!s.active})">${s.active?'Pause':'Resume'}</button><button class="delete" onclick="removeItem('subscriptions','${s._id}')">Delete</button></div></div>`).join('')||empty('No subscriptions yet.')}
function renderLoans(){
  $('loanList').innerHTML=state.loans.map(l=>{
    const original=Number(l.amount||0);
    const repaid=Math.min(original,Number(l.repaidAmount||0));
    const outstanding=Math.max(0,original-repaid);
    const fullyRepaid=outstanding<=0;
    return `<div class="item"><div class="item-main"><strong>${esc(l.person)}</strong><span>Original ${money(original)} · Repaid ${money(repaid)} · Remaining ${money(outstanding)}</span></div><div class="item-right loan-actions"><span class="amount">${money(outstanding)}</span>${fullyRepaid?'<span class="status">Fully repaid</span>':`<button class="delete" onclick="repayLoan('${l._id}')">Repay</button><button class="delete" onclick="fullyRepayLoan('${l._id}')">Fully Repaid</button>`}<button class="delete" onclick="removeItem('loans','${l._id}')">Delete</button></div></div>`;
  }).join('')||empty('No lent money recorded.')}

const empty=t=>`<div class="item"><span class="muted">${t}</span></div>`;
const esc=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

async function removeItem(type,id){try{await api(type+'/'+id,{method:'DELETE'});state[type]=state[type].filter(x=>x._id!==id);render();toast('Deleted')}catch(e){toast(e.message)}}
async function toggleSub(id,active){const x=state.subscriptions.find(s=>s._id===id);if(!x)return;try{const u=await api('subscriptions/'+id,{method:'PUT',body:JSON.stringify({active})});Object.assign(x,u);render()}catch(e){toast(e.message)}}

$('expenseDate').value=new Date().toISOString().slice(0,10);
$('subscriptionDate').value=new Date().toISOString().slice(0,10);
$('today').textContent=new Date().toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short'});

document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tab,.tab-panel').forEach(x=>x.classList.remove('active'));b.classList.add('active');$(b.dataset.tab).classList.add('active')});

$('expenseForm').onsubmit=async e=>{e.preventDefault();try{const x=await api('expenses',{method:'POST',body:JSON.stringify({description:$('expenseDescription').value,amount:+$('expenseAmount').value,category:$('expenseCategory').value,date:new Date($('expenseDate').value+'T12:00:00')})});state.expenses.unshift(x);e.target.reset();$('expenseDate').value=new Date().toISOString().slice(0,10);$('expenseCategory').value='Other';render();toast('Expense added')}catch(e){toast(e.message)}};
$('subscriptionForm').onsubmit=async e=>{e.preventDefault();try{const x=await api('subscriptions',{method:'POST',body:JSON.stringify({name:$('subscriptionName').value,amount:+$('subscriptionAmount').value,date:$('subscriptionDate').value})});state.subscriptions.unshift(x);e.target.reset();$('subscriptionDate').value=new Date().toISOString().slice(0,10);render();toast('Subscription added')}catch(e){toast(e.message)}};
$('loanForm').onsubmit=async e=>{e.preventDefault();try{const x=await api('loans',{method:'POST',body:JSON.stringify({person:$('loanPerson').value,amount:+$('loanAmount').value})});state.loans.unshift(x);render();e.target.reset();toast('Lent money added')}catch(e){toast(e.message)}};

$('addMoney').onclick=()=>openMoney('add');
$('deductMoney').onclick=()=>openMoney('deduct');
function openMoney(action){state.moneyAction=action;$('moneyTitle').textContent=action==='add'?'Add Money':'Deduct Money';$('saveMoney').textContent=action==='add'?'Add Money':'Deduct Money';$('moneyAmount').value='';$('moneyDialog').showModal();$('moneyAmount').focus()}
$('cancelMoney').onclick=()=>$('moneyDialog').close();
$('moneyForm').onsubmit=async e=>{e.preventDefault();try{const amount=Number($('moneyAmount').value);if(!Number.isFinite(amount)||amount<=0){toast('Enter an amount greater than 0');return}const x=await api('adjustments',{method:'POST',body:JSON.stringify({type:state.moneyAction,amount,date:new Date()})});state.adjustments.unshift(x);$('moneyDialog').close();render();toast(state.moneyAction==='add'?'Money added':'Money deducted')}catch(e){toast(e.message)}};

async function repayLoan(id){
  const loan=state.loans.find(l=>l._id===id); if(!loan)return;
  const original=Number(loan.amount||0), repaid=Number(loan.repaidAmount||0);
  const outstanding=Math.max(0,original-repaid);
  const value=prompt(`Enter repayment amount (remaining ${money(outstanding)}):`,'');
  if(value===null)return;
  const amount=Number(value);
  if(!Number.isFinite(amount)||amount<=0){toast('Enter a repayment amount greater than 0');return}
  if(amount>outstanding){toast(`Repayment cannot exceed ${money(outstanding)}`);return}
  try{const updated=await api('loans/'+id,{method:'PUT',body:JSON.stringify({repaidAmount:repaid+amount})});Object.assign(loan,updated);render();toast(`${money(amount)} repaid and added back to balance`)}catch(e){toast(e.message)}
}
async function fullyRepayLoan(id){
  const loan=state.loans.find(l=>l._id===id); if(!loan)return;
  const original=Number(loan.amount||0), repaid=Number(loan.repaidAmount||0);
  const outstanding=Math.max(0,original-repaid); if(outstanding<=0)return;
  if(!confirm(`Mark ${money(outstanding)} as fully repaid? This amount will be added back to your balance.`))return;
  try{const updated=await api('loans/'+id,{method:'PUT',body:JSON.stringify({repaidAmount:original})});Object.assign(loan,updated);render();toast(`${money(outstanding)} added back to balance`)}catch(e){toast(e.message)}
}

$('themeButton').onclick=()=>{document.body.classList.toggle('dark');localStorage.setItem('cashflow-theme',document.body.classList.contains('dark')?'dark':'light')};
if(localStorage.getItem('cashflow-theme')==='dark')document.body.classList.add('dark');
function toast(t){$('toast').textContent=t;$('toast').classList.add('show');setTimeout(()=>$('toast').classList.remove('show'),2200)}
requireAuth().then(user=>{if(user)load();});
