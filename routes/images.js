const express  = require('express');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const jwt      = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const Message  = require('../models/Message');
const router   = express.Router();

function auth(req, res, next) {
  // Support token from header OR query param (needed for <img src> tags)
  const header = req.headers.authorization?.split(' ')[1];
  const query  = req.query.t;
  const token  = header || query;
  if (!token) return res.status(401).json({ error: 'No token' });
  try { req.user = jwt.verify(token, process.env.JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Invalid token' }); }
}

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'images');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename:    (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, uuidv4() + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    cb(null, ['image/jpeg','image/png','image/gif','image/webp'].includes(file.mimetype));
  }
});

/* ---- UPLOAD ---- */
router.post('/upload', auth, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No image file' });
    const { type='private', receiverId=null, room=null, text='', burnAfter=null, burnProtected='false' } = req.body;
    const imageToken = uuidv4();
    const msg = await Message.create({
      type, sender: req.user.id,
      receiver: receiverId || null,
      room: room || null,
      text,
      image: req.file.filename,
      imageToken,
      imageMime: req.file.mimetype,
      burnAfter: burnAfter ? parseInt(burnAfter) : null,
      burnProtected: burnProtected === 'true',
    });
    res.json({ messageId: msg._id, imageToken, burnAfter: msg.burnAfter, burnProtected: msg.burnProtected });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ---- SERVE image — token in URL path OR ?t= query ---- */
router.get('/img/:messageId/:token', async (req, res) => {
  try {
    // Verify JWT from query param
    const jwt_token = req.query.t;
    if (!jwt_token) return res.status(401).send('No auth');
    let user;
    try { user = jwt.verify(jwt_token, process.env.JWT_SECRET); }
    catch { return res.status(401).send('Invalid token'); }

    const msg = await Message.findById(req.params.messageId);
    if (!msg || !msg.image) return res.status(404).send('Not found');
    if (msg.burned)         return res.status(410).send('🔥 Image expired');
    if (msg.imageToken !== req.params.token) return res.status(403).send('Invalid image token');

    if (msg.type === 'private') {
      const uid = user.id;
      if (uid !== msg.sender.toString() && uid !== msg.receiver?.toString())
        return res.status(403).send('Forbidden');
    }

    const filePath = path.join(UPLOAD_DIR, msg.image);
    if (!fs.existsSync(filePath)) return res.status(404).send('File not found');

    res.set({
      'Content-Type':  msg.imageMime || 'image/jpeg',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Pragma':        'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    res.sendFile(filePath);
  } catch (e) { res.status(500).send(e.message); }
});

/* ---- UNSEND message (delete text or image) ---- */
router.delete('/unsend/:messageId', auth, async (req, res) => {
  try {
    const msg = await Message.findById(req.params.messageId);
    if (!msg) return res.status(404).json({ error: 'Not found' });
    if (msg.sender.toString() !== req.user.id) return res.status(403).json({ error: 'Not your message' });
    // Delete image file if exists
    if (msg.image) {
      const fp = path.join(UPLOAD_DIR, msg.image);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    }
    await Message.findByIdAndDelete(req.params.messageId);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ---- Helper: burn image ---- */
async function burnImage(msgId) {
  try {
    const msg = await Message.findById(msgId);
    if (!msg || msg.burned) return;
    if (msg.image) {
      const fp = path.join(UPLOAD_DIR, msg.image);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    }
    msg.burned = true; msg.image = null; msg.imageToken = null;
    await msg.save();
    console.log(`🔥 Burned: ${msgId}`);
  } catch (e) { console.error('Burn error:', e.message); }
}

module.exports = { router, burnImage };
