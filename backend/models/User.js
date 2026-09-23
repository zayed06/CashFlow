import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String },
  googleId: { type: String, unique: true, sparse: true },
    currency: { type: String, default: 'INR', uppercase: true, trim: true, maxlength: 3 },
  dateFormat: { type: String, default: 'DD/MM/YYYY', enum: ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'] },
  numberFormat: { type: String, default: 'Indian', enum: ['Indian', 'International'] },
  notificationPreferences: {
    subscriptionReminders: { type: Boolean, default: true },
    budgetAlerts: { type: Boolean, default: true },
    creditCardDueReminders: { type: Boolean, default: true },
  },
}, { timestamps: true });

export default mongoose.model('User', schema);



