export function getSafeDate(y, m, d) {
    const date = new Date(y, m, 1);
    const lastDayOfMonth = new Date(y, m + 1, 0).getDate();
    date.setDate(Math.min(d, lastDayOfMonth));
    return date;
}

export function getCycleDates(statementDay, dueDay, todayDate = new Date(), isPaid = false, createdAt = null) {
    const t = new Date(todayDate);
    const year = t.getFullYear();
    const month = t.getMonth();
    const todayDay = t.getDate();
    
    let currentStatementMonth = month;
    let currentStatementYear = year;
    
    let thisMonthStatementDay = getSafeDate(year, month, statementDay).getDate();
    
    if (todayDay < thisMonthStatementDay) {
        currentStatementMonth -= 1;
        if (currentStatementMonth < 0) {
            currentStatementMonth = 11;
            currentStatementYear -= 1;
        }
    }
    
    const lastStatementDate = getSafeDate(currentStatementYear, currentStatementMonth, statementDay);
    
    let nextStatementMonth = currentStatementMonth + 1;
    let nextStatementYear = currentStatementYear;
    if (nextStatementMonth > 11) {
        nextStatementMonth = 0;
        nextStatementYear += 1;
    }
    const nextStatementDate = getSafeDate(nextStatementYear, nextStatementMonth, statementDay);
    
    let dueMonth = currentStatementMonth;
    let dueYear = currentStatementYear;
    
    if (dueDay < statementDay) {
        dueMonth += 1;
        if (dueMonth > 11) {
            dueMonth = 0;
            dueYear += 1;
        }
    }
    
    let nextDueDate = getSafeDate(dueYear, dueMonth, dueDay);
    
    // If the next due date has already passed (e.g. Sep 5 on Sep 21),
    // and we are before the next statement date, tie the due date to the UPCOMING statement,
    // BUT ONLY if the relevant statement is fully paid OR if the past due date occurred before the card was created.
    let wasCreatedAfterDue = false;
    if (createdAt) {
        const createdDate = new Date(createdAt);
        if (nextDueDate < createdDate) {
            wasCreatedAfterDue = true;
        }
    }
    
    if (nextDueDate < t && t < nextStatementDate && (isPaid || wasCreatedAfterDue)) {
        let upcomingDueMonth = nextStatementMonth;
        let upcomingDueYear = nextStatementYear;
        if (dueDay < statementDay) {
            upcomingDueMonth += 1;
            if (upcomingDueMonth > 11) {
                upcomingDueMonth = 0;
                upcomingDueYear += 1;
            }
        }
        nextDueDate = getSafeDate(upcomingDueYear, upcomingDueMonth, dueDay);
    }
    
    return { lastStatementDate, nextStatementDate, nextDueDate };
}

export function enrichCreditCard(cardRaw, todayOverride) {
    const card = cardRaw.toObject ? cardRaw.toObject() : { ...cardRaw };
    
    if (!card.statementDate || !card.dueDate) {
        return { 
            ...card, 
            statementStatus: 'No Statement', 
            paymentStatus: 'No Due', 
            daysUntilStatement: null, 
            daysUntilDue: null 
        };
    }
    
    const today = todayOverride ? new Date(todayOverride) : new Date();
    today.setHours(0, 0, 0, 0);

    let paymentStatus = 'Payment Due';
    let isPaid = false;
    
    if (card.statementBalance === 0 || card.currentBalance === 0) {
        paymentStatus = 'Paid';
        isPaid = true;
    } else if (card.currentBalance < card.statementBalance) {
        paymentStatus = 'Partially Paid';
    }

    const dates = getCycleDates(card.statementDate, card.dueDate, today, isPaid, card.createdAt);
    
    const nextStmt = new Date(dates.nextStatementDate);
    nextStmt.setHours(0, 0, 0, 0);
    const daysUntilStatement = Math.floor((nextStmt - today) / (1000 * 60 * 60 * 24));
    
    const due = new Date(dates.nextDueDate);
    due.setHours(0, 0, 0, 0);
    const daysUntilDue = Math.floor((due - today) / (1000 * 60 * 60 * 24));
    
    if (!isPaid && paymentStatus !== 'Partially Paid') {
        if (daysUntilDue < 0) {
            paymentStatus = 'Overdue';
        } else if (daysUntilDue === 0) {
            paymentStatus = 'Due Today';
        } else if (daysUntilDue <= 3) {
            paymentStatus = `Due in ${daysUntilDue} days`;
        }
    } else if (paymentStatus === 'Partially Paid' && daysUntilDue < 0) {
        paymentStatus = 'Overdue';
    }
    
    let statementStatus = 'Upcoming';
    if (daysUntilStatement === 0) statementStatus = 'Generating Today';
    else if (daysUntilStatement <= 3) statementStatus = 'Generating Soon';
    
    return {
        ...card,
        statementStatus,
        paymentStatus,
        daysUntilStatement,
        daysUntilDue,
        lastStatementDate: dates.lastStatementDate,
        nextStatementDate: dates.nextStatementDate,
        nextDueDate: dates.nextDueDate
    };
}
