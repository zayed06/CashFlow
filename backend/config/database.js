import mongoose from 'mongoose';

export async function connectDatabase(uri) {
  await mongoose.connect(uri);
  console.log('MongoDB connected');
}
