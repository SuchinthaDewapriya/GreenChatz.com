const mongoose = require('mongoose');

const roomSchema = new mongoose.Schema({
  id:        { type: String, required: true, unique: true },
  name:      { type: String, required: true, trim: true },
  initials:  { type: String, default: 'RM' },
  password:  { type: String, default: null },
  locked:    { type: Boolean, default: false },
  isDefault: { type: Boolean, default: false },
  createdBy: { type: String, default: null },  // user id string
  expiresAt: { type: Date, default: null },     // 12hr auto-delete
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Room', roomSchema);
