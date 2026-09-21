import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type: { 
    type: String, 
    enum: ['income', 'expense', 'add_money', 'deduct_money', 'loan_given', 'loan_repayment', 'subscription'], 
    required: true 
  },
  amount: { type: Number, required: true, min: 0.01 },
  description: { type: String, trim: true, maxlength: 200 },
  date: { type: Date, default: Date.now },
  relatedId: { type: mongoose.Schema.Types.ObjectId },
  categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category' },
  creditCardId: { type: mongoose.Schema.Types.ObjectId, ref: 'CreditCard', default: null }
}, { timestamps: true });

export default mongoose.model('Transaction', schema);
