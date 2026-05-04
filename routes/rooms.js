const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const Room    = require('../models/Room');
const Message = require('../models/Message');
const router  = express.Router();

function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try { req.user = jwt.verify(token, process.env.JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Invalid token' }); }
}

/* GET all custom rooms */
router.get('/', auth, async (req, res) => {
  try {
    const now = new Date();
    // Auto-expire rooms past their time
    const expired = await Room.find({ expiresAt: { $lt: now }, isDefault: false });
    for (const r of expired) {
      await Message.deleteMany({ type: 'public', room: r.id });
      await Room.findByIdAndDelete(r._id);
    }
    const rooms = await Room.find({ isDefault: false }).sort({ createdAt: -1 }).limit(50);
    res.json(rooms.map(r => ({
      id: r.id, name: r.name, initials: r.initials,
      locked: r.locked, isDefault: false,
      createdBy: r.createdBy,
      expiresAt: r.expiresAt,
      members: 0
    })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* POST create room */
router.post('/', auth, async (req, res) => {
  try {
    const { name, password } = req.body;
    if (!name || name.trim().length < 2)
      return res.status(400).json({ error: 'Room name too short (min 2 chars)' });

    const id = 'room_' + uuidv4().split('-')[0];
    const initials = name.trim().substring(0, 2).toUpperCase();
    const hashedPw = password ? await bcrypt.hash(password, 10) : null;
    const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000); // 12 hours

    const room = await Room.create({
      id, name: name.trim(), initials,
      password: hashedPw,
      locked: !!password,
      createdBy: req.user.id,
      expiresAt
    });

    res.json({
      id: room.id, name: room.name, initials: room.initials,
      locked: room.locked, isDefault: false,
      createdBy: req.user.id,
      expiresAt: room.expiresAt,
      members: 0
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* POST verify room password */
router.post('/verify', auth, async (req, res) => {
  try {
    const { roomId, password } = req.body;
    const room = await Room.findOne({ id: roomId });
    if (!room) return res.status(404).json({ error: 'Room not found' });
    if (!room.locked) return res.json({ ok: true });
    const ok = await bcrypt.compare(password, room.password);
    if (!ok) return res.status(403).json({ error: 'Wrong password' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* DELETE room — only creator can delete */
router.delete('/:roomId', auth, async (req, res) => {
  try {
    const room = await Room.findOne({ id: req.params.roomId });
    if (!room) return res.status(404).json({ error: 'Room not found' });
    if (room.isDefault) return res.status(403).json({ error: 'Cannot delete default rooms' });
    if (room.createdBy !== req.user.id)
      return res.status(403).json({ error: 'Only the creator can delete this room' });
    // Delete all messages in this room
    await Message.deleteMany({ type: 'public', room: req.params.roomId });
    await Room.findByIdAndDelete(room._id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
