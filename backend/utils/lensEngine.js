export function simulateCashFlowLens({
    transactions = [],
    subscriptions = [],
    loans = [],
    creditCards = [],
    scenario = {}
}) {
    let amount = Number(scenario.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
        return { error: 'Invalid scenario amount' };
    }
    const paymentMethod = scenario.paymentMethod || 'cash';
    if (!['cash', 'credit_card'].includes(paymentMethod)) {
        return { error: 'Unsupported payment method' };
    }
    const sDate = scenario.date ? new Date(scenario.date) : new Date();
    if (isNaN(sDate.getTime())) {
        return { error: 'Invalid scenario date' };
    }

    const currentBalance = transactions.reduce((tot, t) => {
        if (['add_money', 'income', 'loan_repayment'].includes(t.type)) return tot + t.amount;
        if (['deduct_money', 'loan_given', 'subscription', 'credit_card_payment'].includes(t.type)) return tot - t.amount;
        if (t.type === 'expense' && !t.creditCardId) return tot - t.amount;
        return tot;
    }, 0);
    
    let totalLent = 0;
    let totalRepayments = 0;
    loans.forEach(l => {
        totalLent += (l.amount || 0);
        totalRepayments += (l.repaidAmount || 0);
    });
    const outstandingLent = Math.max(0, totalLent - totalRepayments);

    let totalExpense = 0;
    let monthSet = new Set();
    transactions.forEach(t => {
        if (['expense', 'subscription'].includes(t.type)) {
            totalExpense += t.amount;
            const d = new Date(t.date || new Date());
            monthSet.add(`${d.getFullYear()}-${d.getMonth()}`);
        }
    });
    const monthsActive = Math.max(1, monthSet.size);
    const historicalSpending = {
        total: totalExpense,
        monthlyAverage: totalExpense / monthsActive
    };

    let upcomingImpact = 0;
    let upcomingCommitments = [];
    const scenarioDateStr = sDate.toISOString().slice(0, 10);
    const endOfMonthYear = sDate.getFullYear();
    const endOfMonthMonth = sDate.getMonth() + 1;
    const endOfMonthDay = new Date(endOfMonthYear, endOfMonthMonth, 0).getDate();
    const endOfMonthStr = endOfMonthYear + '-' + String(endOfMonthMonth).padStart(2, '0') + '-' + String(endOfMonthDay).padStart(2, '0');

    const getNextDate = (dateStr, frequency) => {
        const d = new Date(dateStr + 'T12:00:00');
        if (frequency === 'weekly') d.setDate(d.getDate() + 7);
        else if (frequency === 'monthly') d.setMonth(d.getMonth() + 1);
        else if (frequency === 'yearly') d.setFullYear(d.getFullYear() + 1);
        return d.toISOString().slice(0, 10);
    };

    subscriptions.forEach(sub => {
        if (sub.active && !sub.processed) {
            let curDate = sub.date;
            let safety = 0;
                        while (curDate && curDate <= endOfMonthStr && safety < 100) {
                if (curDate >= scenarioDateStr) {
                    upcomingImpact += sub.amount;
                    upcomingCommitments.push({
                        name: sub.name,
                        amount: sub.amount,
                        date: curDate
                    });
                }
                
                if (sub.frequency && sub.frequency !== 'one-time') {
                    curDate = getNextDate(curDate, sub.frequency);
                } else {
                    break;
                }
                safety++;
            }
        }
    });

    let projectedBalance = currentBalance - upcomingImpact - (historicalSpending.monthlyAverage || 0);
    let creditCardImpact = null;

    if (paymentMethod === 'cash') {
        projectedBalance -= amount;
    } else if (paymentMethod === 'credit_card') {
        if (!scenario.creditCardId) {
            return { error: 'No credit card selected for credit_card simulation' };
        }
        const card = creditCards.find(c => c._id && c._id.toString() === scenario.creditCardId.toString());
        if (!card) {
            return { error: 'Selected credit card not found' };
        }
        
        let cBal = typeof card.currentBalance === 'number' ? card.currentBalance : 0;
        let cLim = typeof card.creditLimit === 'number' ? card.creditLimit : 0;
        
        let projCardBal = cBal + amount;
        let projAvail = Math.max(0, cLim - projCardBal);
        let projUtil = cLim > 0 ? (projCardBal / cLim) * 100 : 0;

        creditCardImpact = {
            cardId: card._id,
            name: card.name,
            projectedCardBalance: projCardBal,
            projectedAvailableCredit: projAvail,
            projectedUtilization: projUtil
        };
    }

        let status = 'projected_positive';
    if (projectedBalance < 0) status = 'projected_negative';
    else if (projectedBalance === 0) status = 'projected_zero';

    let availableToSpend = null;
    let financialShock = null;
    let paymentComparison = null;

    if (scenario.advancedTool === 'availableToSpend') {
        const safety = Number(scenario.safetyReserve) || 0;
        let cmt = scenario.commitmentsSelected === false ? 0 : upcomingImpact;
        let exp = scenario.expectedSelected === false ? 0 : (historicalSpending.monthlyAverage || 0);
        let avail = currentBalance - cmt - exp - safety;
        availableToSpend = Math.max(0, avail);
    }

    if (scenario.advancedTool === 'financialShock') {
        const shock = Number(scenario.shockAmount) || 0;
        const method = scenario.shockPaymentMethod || 'cash';
        
        let cmt = scenario.commitmentsSelected === false ? 0 : upcomingImpact;
        let exp = scenario.expectedSelected === false ? 0 : (historicalSpending.monthlyAverage || 0);
        
        if (method === 'cash') {
            financialShock = {
                method: 'cash',
                cashImpact: shock,
                creditCardImpact: 0,
                projectedBalance: currentBalance - shock - cmt - exp
            };
        } else {
            financialShock = {
                method: 'credit_card',
                cashImpact: 0,
                projectedBalance: currentBalance - cmt - exp,
                creditCardImpact: shock
            };
            const cardId = scenario.shockCardId;
            if (cardId) {
                const card = creditCards.find(c => c._id && c._id.toString() === cardId.toString());
                if (card) {
                    let cBal = typeof card.currentBalance === 'number' ? card.currentBalance : 0;
                    let cLim = typeof card.creditLimit === 'number' ? card.creditLimit : 0;
                    let projCardBal = cBal + shock;
                    let projAvail = Math.max(0, cLim - projCardBal);
                    let projUtil = cLim > 0 ? (projCardBal / cLim) * 100 : 0;
                    financialShock.cardDetails = {
                        name: card.name,
                        projectedCardBalance: projCardBal,
                        projectedAvailableCredit: projAvail,
                        projectedUtilization: projUtil
                    };
                }
            }
        }
    }

    if (scenario.advancedTool === 'paymentComparison') {
        const pAmt = Number(scenario.comparisonAmount) || 0;
        const pCardId = scenario.comparisonCardId;
        
        let cmt = scenario.commitmentsSelected === false ? 0 : upcomingImpact;
        let exp = scenario.expectedSelected === false ? 0 : (historicalSpending.monthlyAverage || 0);
        
        paymentComparison = {
            cash: {
                cashImpact: pAmt,
                projectedBalance: currentBalance - pAmt - cmt - exp
            },
            creditCard: null
        };
        
        if (pCardId) {
            const card = creditCards.find(c => c._id && c._id.toString() === pCardId.toString());
            if (card) {
                let cBal = typeof card.currentBalance === 'number' ? card.currentBalance : 0;
                let cLim = typeof card.creditLimit === 'number' ? card.creditLimit : 0;
                let projCardBal = cBal + pAmt;
                let projAvail = Math.max(0, cLim - projCardBal);
                let projUtil = cLim > 0 ? (projCardBal / cLim) * 100 : 0;
                paymentComparison.creditCard = {
                    cardId: card._id,
                    name: card.name,
                    cashImpact: 0,
                    projectedCardBalance: projCardBal,
                    projectedAvailableCredit: projAvail,
                    projectedUtilization: projUtil
                };
            }
        }
    }

    return {
        currentBalance,
        simulatedAmount: amount,
        paymentMethod,
        scenarioDate: scenarioDateStr,
        upcomingCommitments,
        historicalSpending,
        projectedBalance,
        creditCardImpact,
        outstandingLent,
        status,
        availableToSpend,
        financialShock,
        paymentComparison
    };
}
