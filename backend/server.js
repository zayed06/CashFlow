import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { connectDatabase } from './config/database.js';
import { handleApi } from './routes/api.js';
import User from './models/User.js';
import Expense from './models/Expense.js';
import Subscription from './models/Subscription.js';
import Loan from './models/Loan.js';
import CashAdjustment from './models/CashAdjustment.js';

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontend = path.resolve(__dirname, '../frontend');
const port = Number(process.env.PORT || 5000);

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml' };

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      return response.end();
    }
    if (request.url.startsWith('/api/')) return await handleApi(request, response);
    if (request.url === '/login' || request.url === '/signup') {
      const file = await fs.promises.readFile(path.join(frontend, 'auth.html'));
      response.writeHead(200, { 'Content-Type': mime['.html'] });
      return response.end(file);
    }

    let requestPath = new URL(request.url, `http://localhost:${port}`).pathname;
    if (requestPath === '/') requestPath = '/index.html';
    const filePath = path.normalize(path.join(frontend, requestPath));
    if (!filePath.startsWith(frontend)) return send404(response);
    const file = await fs.promises.readFile(filePath);
    response.writeHead(200, { 'Content-Type': mime[path.extname(filePath)] || 'application/octet-stream' });
    response.end(file);
  } catch (error) {
    if (error.code === 'ENOENT') return send404(response);
    console.error(error);
    response.writeHead(500); response.end('Server error');
  }
});

function send404(response) { response.writeHead(404); response.end('Not found'); }

async function migrateLegacyData() {
  const owner = await User.findOne().sort({ createdAt: 1, _id: 1 });
  if (!owner) return;

  const models = [Expense, Subscription, Loan, CashAdjustment];
  for (const Model of models) {
    await Model.updateMany(
      { $or: [{ userId: { $exists: false } }, { userId: null }] },
      { $set: { userId: owner._id } }
    );
  }
}

connectDatabase(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/cashflow')
  .then(async () => {
    await migrateLegacyData();
    server.listen(port, () => console.log(`CashFlow running at http://localhost:${port}`));
  })
  .catch(error => { console.error('MongoDB connection failed:', error.message); process.exit(1); });
