const express  = require('express');
const bcrypt    = require('bcryptjs');
const jwt       = require('jsonwebtoken');
const User      = require('../models/User');
const router    = express.Router();

const signToken = (user) =>
  jwt.sign({ id: user._id, username: user.username, gender: user.gender, country: user.country||null },
    process.env.JWT_SECRET, { expiresIn: '7d' });

/* ---- REGISTER ---- */
router.post('/register', async (req, res) => {
  try {
    const { username, email, password, fullName, age, gender, country } = req.body;
    if (!username || !email || !password || !gender)
      return res.status(400).json({ error: 'All fields required' });

    const exists = await User.findOne({ $or: [{ username }, { email }] });
    if (exists) return res.status(409).json({ error: 'Username or email already taken' });

    const hash = await bcrypt.hash(password, 10);
    const user = await User.create({ username, email, password: hash, fullName, age, gender, country: country||null });
    res.json({ token: signToken(user), user: { id: user._id, username, gender, age, fullName, country: user.country } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ---- LOGIN ---- */
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user) return res.status(401).json({ error: 'User not found' });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'Wrong password' });

    res.json({ token: signToken(user), user: { id: user._id, username, gender: user.gender, age: user.age, fullName: user.fullName, country: user.country } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ---- GUEST LOGIN ---- */
router.post('/guest', async (req, res) => {
  try {
    const { username, age, gender, country } = req.body;
    if (!username || !gender) return res.status(400).json({ error: 'Username & gender required' });

    // make unique guest username
    const guestName = username + '_' + Date.now().toString().slice(-4);
    const hash = await bcrypt.hash('guest_' + Date.now(), 10);
    const user = await User.create({
      username: guestName, email: guestName + '@guest.local',
      password: hash, age, gender, country: country||null, isGuest: true
    });
    res.json({ token: signToken(user), user: { id: user._id, username: guestName, gender, age, country: country||null, isGuest: true } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
