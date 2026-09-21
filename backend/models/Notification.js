import mongoose from 'mongoose';
const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  message: { type: String, required: true },
  type: { type: String, default: 'info' }, // 'info', 'warning', 'success'
  read: { type: Boolean, default: false },
  relatedId: { type: mongoose.Schema.Types.ObjectId },
  alertType: { type: String }, // 'upcoming_statement', 'payment_due', 'due_today', 'overdue', 'statement_generated'
  referenceDate: { type: String } // 'YYYY-MM-DD'
}, { timestamps: true });
export default mongoose.model('Notification', schema);
