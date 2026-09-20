# CashFlow

CashFlow is a plain JavaScript frontend with a Node.js backend and MongoDB database. It does not use React or Express.

## Stack
- Frontend: HTML, CSS, JavaScript
- Backend: Node.js built-in HTTP server
- Database: MongoDB + Mongoose
- Authentication: secure password hashing with Node.js crypto and HTTP-only session cookies

## Run
1. Make sure MongoDB is running.
2. Create `.env` from `.env.example` if needed.
3. Run `npm install`.
4. Run `npm start`.
5. Open http://localhost:5000

## Account system
- Sign up and log in with email/password.
- Passwords are never stored in plain text.
- Sessions are stored in MongoDB and sent using an HTTP-only cookie.
- All expenses, subscriptions, loans and cash adjustments are associated with the logged-in user.
- If this is the first account on an existing single-user database, previously unowned records are assigned to that account.


## Step 2: User-owned financial data

Every financial record belongs to the authenticated user through `userId`. The backend never trusts a `userId` sent by the browser.

- GET requests return only the logged-in user's records.
- POST requests assign the logged-in user's ID on the server.
- PUT and DELETE requests require both the record ID and the logged-in user's ID to match.
- Legacy records without an owner are assigned to the oldest account once the server starts.
- This keeps expenses, subscriptions, loans, repayments and cash adjustments isolated between accounts.

### Step 2 test
1. Create Account A. Add an expense, loan and cash adjustment.
2. Log out and create Account B.
3. Account B should start with no Account A financial records.
4. Add a record as Account B.
5. Log back into Account A. Account B's record should not appear.
