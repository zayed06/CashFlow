import mongoose from 'mongoose';
const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name: { type: String, required: true, trim: true },
  amount: { type: Number, required: true, min: 0 },
  date: { type: String, required: true },
  active: { type: Boolean, default: true },
  processed: { type: Boolean, default: false }
}, { timestamps: true });
export default mongoose.model('Subscription', schema);
