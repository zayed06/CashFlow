import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String },
  googleId: { type: String, unique: true, sparse: true },
  currency: { type: String, default: 'INR', uppercase: true, trim: true, maxlength: 3 },
}, { timestamps: true });

export default mongoose.model('User', schema);
