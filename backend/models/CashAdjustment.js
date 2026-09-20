import mongoose from 'mongoose';
const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type: { type: String, enum: ['add', 'deduct'], required: true },
  amount: { type: Number, required: true, min: 0 },
  date: { type: Date, default: Date.now }
}, { timestamps: true });
export default mongoose.model('CashAdjustment', schema);
