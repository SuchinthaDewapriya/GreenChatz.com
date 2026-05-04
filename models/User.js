const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true, minlength: 3 },
  email:    { type: String, required: true, unique: true, trim: true, lowercase: true },
  password: { type: String, required: true },
  fullName: { type: String, trim: true },
  age:      { type: Number, min: 13, max: 99 },
  gender:   { type: String, enum: ['male', 'female'], required: true },
  isGuest:  { type: Boolean, default: false },
  country:  { type: String, default: null },
  isOnline: { type: Boolean, default: false },
  lastSeen: { type: Date, default: Date.now },
  socketId: { type: String, default: null },
  createdAt:{ type: Date, default: Date.now }
});

module.exports = mongoose.model('User', userSchema);
