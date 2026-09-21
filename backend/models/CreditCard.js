import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  userId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true, 
    index: true 
  },
  name: { 
    type: String, 
    required: true, 
    trim: true 
  },
  issuer: { 
    type: String, 
    required: true, 
    trim: true 
  },
  last4: { 
    type: String, 
    required: true, 
    match: [/^\d{4}$/, 'last4 must contain exactly 4 numeric digits'] 
  },
  network: { 
    type: String, 
    required: true, 
    enum: ['Visa', 'Mastercard', 'American Express', 'RuPay', 'Discover', 'Other'] 
  },
  creditLimit: { 
    type: Number, 
    required: true, 
    validate: {
      validator: function(v) {
        return v > 0;
      },
      message: 'creditLimit must be greater than 0'
    }
  },
  currentBalance: { 
    type: Number, 
    required: true, 
    min: [0, 'currentBalance must be >= 0'] 
  },
  statementBalance: { 
    type: Number, 
    required: true, 
    min: [0, 'statementBalance must be >= 0'] 
  },
  minimumPayment: { 
    type: Number, 
    required: true, 
    min: [0, 'minimumPayment must be >= 0'] 
  },
  statementDate: { 
    type: Number, 
    min: [1, 'statementDate must be >= 1'], 
    max: [31, 'statementDate must be <= 31'] 
  },
  dueDate: { 
    type: Number, 
    min: [1, 'dueDate must be >= 1'], 
    max: [31, 'dueDate must be <= 31'] 
  }
}, { timestamps: true });

export default mongoose.model('CreditCard', schema);
