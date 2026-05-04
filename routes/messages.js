const express = require('express');
const jwt     = require('jsonwebtoken');
const Message = require('../models/Message');
const User    = require('../models/User');
const router  = express.Router();

function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try { req.user = jwt.verify(token, process.env.JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Invalid token' }); }
}

// Strip file path from image field — only expose token + messageId
function sanitizeMsg(msg, userId) {
  const m = msg.toObject ? msg.toObject() : { ...msg };
  if (m.image && !m.burned) {
    m.imageUrl = `/api/images/img/${m._id}/${m.imageToken}`;
  } else {
    m.imageUrl = null;
  }
  delete m.image;
  delete m.imageToken;
  return m;
}

/* GET private history */
router.get('/private/:userId', auth, async (req, res) => {
  try {
    const msgs = await Message.find({
      type: 'private',
      $or: [
        { sender: req.user.id, receiver: req.params.userId },
        { sender: req.params.userId, receiver: req.user.id }
      ]
    }).sort({ createdAt: 1 }).limit(100).populate('sender', 'username gender age');
    res.json(msgs.map(m => sanitizeMsg(m, req.user.id)));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* GET public room history */
router.get('/public/:room', auth, async (req, res) => {
  try {
    const msgs = await Message.find({ type: 'public', room: req.params.room })
      .sort({ createdAt: 1 }).limit(100).populate('sender', 'username gender age');
    res.json(msgs.map(m => sanitizeMsg(m, req.user.id)));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* GET online users */
router.get('/users/online', auth, async (req, res) => {
  try {
    const users = await User.find({ isOnline: true, _id: { $ne: req.user.id } })
      .select('username gender age isOnline lastSeen').limit(50);
    res.json(users);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
