import mongoose from 'mongoose';
const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  description: { type: String, required: true, trim: true },
  amount: { type: Number, required: true, min: 0 },
  category: { type: String, default: 'Other' },
  date: { type: Date, default: Date.now }
}, { timestamps: true });
export default mongoose.model('Expense', schema);
