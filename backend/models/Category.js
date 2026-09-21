import mongoose from 'mongoose';
const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  name: { type: String, required: true, trim: true }
}, { timestamps: true });
export default mongoose.model('Category', schema);
