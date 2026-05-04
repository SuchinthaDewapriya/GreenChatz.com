const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  type:       { type: String, enum: ['private', 'public'], required: true },
  room:       { type: String, default: null },
  sender:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  receiver:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  text:       { type: String, default: '' },

  // Image fields
  image:          { type: String, default: null },   // filename stored in /uploads/images
  imageToken:     { type: String, default: null },   // secure one-time token
  imageMime:      { type: String, default: null },

  // Burn-after-view
  burnAfter:      { type: Number,  default: null },  // seconds (null = no burn)
  burnProtected:  { type: Boolean, default: false }, // block screenshot/download
  burnStartedAt:  { type: Date,    default: null },  // when countdown started
  burned:         { type: Boolean, default: false },

  readBy:    [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  createdAt: { type: Date, default: Date.now }
});

messageSchema.index({ type: 1, room: 1, createdAt: -1 });
messageSchema.index({ type: 1, sender: 1, receiver: 1, createdAt: -1 });
messageSchema.index({ burned: 1, burnStartedAt: 1 });

module.exports = mongoose.model('Message', messageSchema);
