import mongoose from 'mongoose';
const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  person: { type: String, required: true, trim: true },
  amount: { type: Number, required: true, min: 0 },
  repaidAmount: { type: Number, default: 0, min: 0 },
  date: { type: Date, default: Date.now }
}, { timestamps: true });
export default mongoose.model('Loan', schema);
