require('dotenv').config();
const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const mongoose   = require('mongoose');
const cors       = require('cors');
const jwt        = require('jsonwebtoken');
const path       = require('path');

const User    = require('./models/User');
const Message = require('./models/Message');
const Room    = require('./models/Room');
const { router: imagesRouter, burnImage } = require('./routes/images');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });

/* ===== MIDDLEWARE ===== */
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

/* ===== ROUTES ===== */
app.use('/api/auth',     require('./routes/auth'));
app.use('/api/messages', require('./routes/messages'));
app.use('/api/images',   imagesRouter);
app.use('/api/rooms',    require('./routes/rooms'));

// Logout & clear history
app.post('/api/auth/logout', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    const jwt = require('jsonwebtoken');
    const user = jwt.verify(token, process.env.JWT_SECRET);
    // Delete all messages sent or received by this user
    await Message.deleteMany({ $or: [{ sender: user.id }, { receiver: user.id }] });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

/* ===== MONGODB ===== */
mongoose.connect(process.env.MONGODB_URI)
  .then(() => { console.log('✅ MongoDB connected'); startBurnCleanup(); })
  .catch(e  => console.error('❌ MongoDB error:', e.message));

/* ===== BURN CLEANUP JOB every 30s ===== */
function startBurnCleanup() {
  setInterval(async () => {
    try {
      const now = new Date();
      // Burn expired images
      const expired = await Message.find({ burned: false, burnStartedAt: { $ne: null }, image: { $ne: null } });
      for (const msg of expired) {
        const expireAt = new Date(msg.burnStartedAt.getTime() + msg.burnAfter * 1000);
        if (now >= expireAt) {
          await burnImage(msg._id);
          io.emit('image:burned', { messageId: msg._id.toString() });
        }
      }
      // Auto-delete expired custom rooms
      const expiredRooms = await Room.find({ expiresAt: { $lt: now }, isDefault: { $ne: true } });
      for (const room of expiredRooms) {
        await Message.deleteMany({ type: 'public', room: room.id });
        await Room.findByIdAndDelete(room._id);
        io.emit('room:deleted', { roomId: room.id });
        console.log('🗑️  Room expired: ' + room.name);
      }
    } catch (e) { console.error('Cleanup error:', e.message); }
  }, 30000);
}

/* ===== SOCKET AUTH ===== */
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('No token'));
  try { socket.user = jwt.verify(token, process.env.JWT_SECRET); next(); }
  catch { next(new Error('Invalid token')); }
});

const onlineUsers = new Map();

io.on('connection', async (socket) => {
  const { id: userId, username, gender, country } = socket.user;
  console.log(`🟢 ${username} connected`);

  await User.findByIdAndUpdate(userId, { isOnline: true, socketId: socket.id });
  const userDoc = await User.findById(userId).select('country').lean();
  onlineUsers.set(userId, { socketId: socket.id, username, gender, country: userDoc?.country||null });
  broadcastOnlineUsers();

  // Deliver any pending messages (sent while offline)
  try {
    const pending = await Message.find({
      type: 'private', receiver: userId,
      readBy: { $ne: userId }
    }).select('_id sender').lean();
    if(pending.length > 0){
      // Group by sender and notify each
      const bySender = {};
      pending.forEach(m => {
        const sid = m.sender.toString();
        if(!bySender[sid]) bySender[sid] = [];
        bySender[sid].push(m._id.toString());
      });
      for(const [senderId, msgIds] of Object.entries(bySender)){
        const sInfo = onlineUsers.get(senderId);
        if(sInfo) io.to(sInfo.socketId).emit('message:delivered', { msgIds });
      }
    }
  } catch(e) { console.error('Deliver pending:', e.message); }

  ['public','srilanka','music','gaming','tech'].forEach(r => socket.join('pub:' + r));

  /* ---- PRIVATE TEXT ---- */
  socket.on('private:message', async (data) => {
    try {
      const msg = await Message.create({ type: 'private', sender: userId, receiver: data.receiverId, text: data.text || '' });
      const payload = mkPrivPayload(msg, userId, username, gender, country);
      const recv = onlineUsers.get(data.receiverId);
      if (recv) io.to(recv.socketId).emit('private:message', payload);
      socket.emit('private:message', payload);
    } catch (e) { socket.emit('error', { message: e.message }); }
  });

  /* ---- PRIVATE IMAGE (after REST upload) ---- */
  socket.on('private:image', async (data) => {
    try {
      const msg = await Message.findById(data.messageId);
      if (!msg) return;
      const payload = mkPrivPayload(msg, userId, username, gender, country);
      const recv = onlineUsers.get(data.receiverId);
      if (recv) io.to(recv.socketId).emit('private:message', payload);
      socket.emit('private:message', payload);
    } catch (e) { socket.emit('error', { message: e.message }); }
  });

  /* ---- PUBLIC TEXT ---- */
  socket.on('public:message', async (data) => {
    // Allow default rooms + custom rooms (room_ prefix)
    const defaultRooms = ['public','srilanka','music','gaming','tech'];
    const isCustom = data.room && data.room.startsWith('room_');
    if (!defaultRooms.includes(data.room) && !isCustom) return;
    try {
      const msg = await Message.create({ type: 'public', room: data.room, sender: userId, text: data.text || '' });
      const payload = mkPubPayload(msg, userId, username, gender, country);
      io.to('pub:' + data.room).emit('public:message', payload);
      // Trim to 50 messages in DB (background)
      Message.countDocuments({ type:'public', room: data.room }).then(cnt => {
        if (cnt > 50) {
          Message.find({ type:'public', room: data.room }).sort({ createdAt:1 }).limit(cnt-50)
            .then(old => Message.deleteMany({ _id: { $in: old.map(m=>m._id) } }));
        }
      });
    } catch (e) { socket.emit('error', { message: e.message }); }
  });

  /* ---- PUBLIC IMAGE ---- */
  socket.on('public:image', async (data) => {
    const defaultRooms = ['public','srilanka','music','gaming','tech'];
    const isCustom = data.room && data.room.startsWith('room_');
    if (!defaultRooms.includes(data.room) && !isCustom) return;
    try {
      const msg = await Message.findById(data.messageId);
      if (!msg) return;
      const payload = mkPubPayload(msg, userId, username, gender, country);
      io.to('pub:' + data.room).emit('public:message', payload);
    } catch (e) { socket.emit('error', { message: e.message }); }
  });

  /* ---- TYPING ---- */
  socket.on('typing:private', ({ receiverId, typing }) => {
    const recv = onlineUsers.get(receiverId);
    if (recv) io.to(recv.socketId).emit('typing:private', { senderId: userId, username, typing });
  });
  socket.on('typing:public', ({ room, typing }) => {
    socket.to('pub:' + room).emit('typing:public', { senderId: userId, username, typing });
  });

  /* ---- IMAGE VIEWED → start per-user burn ---- */
  socket.on('image:viewed', async ({ messageId, isPublic }) => {
    try {
      const msg = await Message.findById(messageId);
      if (!msg || !msg.burnAfter) return;
      if (userId === msg.sender.toString()) return; // sender viewing never starts timer

      if (isPublic) {
        // PUBLIC ROOM: per-user burn — each viewer gets their own timer
        // Don't touch msg.burnStartedAt (shared), instead schedule only for THIS user
        const cd = { messageId: msg._id.toString(), burnAfter: msg.burnAfter };
        socket.emit('image:countdown', cd); // only to this viewer

        setTimeout(async () => {
          // Only burn for this specific user — emit targeted event
          socket.emit('image:burned', { messageId: msg._id.toString(), forUserId: userId });
        }, msg.burnAfter * 1000);
      } else {
        // PRIVATE CHAT: shared burn — starts when first viewed
        if (msg.burnStartedAt) return; // already started
        msg.burnStartedAt = new Date();
        await msg.save();

        const cd = { messageId: msg._id.toString(), burnAfter: msg.burnAfter };
        const sInfo = onlineUsers.get(msg.sender.toString());
        const rInfo = onlineUsers.get(userId);
        if (sInfo) io.to(sInfo.socketId).emit('image:countdown', cd);
        if (rInfo) io.to(rInfo.socketId).emit('image:countdown', cd);

        setTimeout(async () => {
          await burnImage(msg._id);
          // Burn for both users — no forUserId = burns for everyone
          io.emit('image:burned', { messageId: msg._id.toString() });
        }, msg.burnAfter * 1000);
      }
    } catch (e) { console.error(e.message); }
  });


  /* ---- ROOM JOIN (password verify) ---- */
  socket.on('room:join', async ({ roomId, password }) => {
    try {
      const room = await Room.findOne({ id: roomId });
      if (!room) return socket.emit('room:join:fail', { roomId });
      if (room.locked) {
        const bcrypt = require('bcryptjs');
        const ok = await bcrypt.compare(password, room.password);
        if (!ok) return socket.emit('room:join:fail', { roomId });
      }
      socket.join('pub:' + roomId);
      socket.emit('room:join:ok', { roomId });
    } catch(e) { socket.emit('room:join:fail', { roomId }); }
  });

  /* ---- ROOM SUBSCRIBE (after join ok) ---- */
  socket.on('room:subscribe', ({ roomId }) => {
    socket.join('pub:' + roomId);
  });

  /* ---- UNSEND ---- */
  socket.on('message:unsend', async ({ messageId }) => {
    try {
      const msg = await Message.findById(messageId);
      if (!msg || msg.sender.toString() !== userId) return;
      const isPriv = msg.type === 'private';
      const room   = msg.room;
      const recv   = msg.receiver?.toString();
      // delete image file
      if (msg.image) {
        const fp = require('path').join(__dirname, 'uploads', 'images', msg.image);
        if (require('fs').existsSync(fp)) require('fs').unlinkSync(fp);
      }
      await Message.findByIdAndDelete(messageId);
      const payload = { messageId };
      if (isPriv && recv) {
        const rInfo = onlineUsers.get(recv);
        if (rInfo) io.to(rInfo.socketId).emit('message:unsent', payload);
      } else if (!isPriv && room) {
        io.to('pub:' + room).emit('message:unsent', payload);
      }
      socket.emit('message:unsent', payload);
    } catch(e) { console.error('Unsend:', e.message); }
  });



  /* ---- MESSAGE SEEN ---- */
  socket.on('message:seen', async ({ toUser, lastMsgId }) => {
    try {
      // Mark all unread messages from toUser → userId as seen in DB
      await Message.updateMany(
        { type:'private', sender: toUser, receiver: userId, readBy: { $ne: userId } },
        { $addToSet: { readBy: userId } }
      );
      // Notify sender that messages were seen
      const senderInfo = onlineUsers.get(toUser);
      if (senderInfo) {
        io.to(senderInfo.socketId).emit('message:seen_ack', { byUser: userId });
      }
    } catch(e) { console.error('Seen error:', e.message); }
  });

  /* ---- ROOM ANNOUNCE (broadcast new custom room) ---- */
  socket.on('room:announce', (room) => {
    socket.broadcast.emit('room:new', { room });
    socket.join('pub:' + room.id);
  });

  /* ---- ROOM DELETED broadcast ---- */
  socket.on('room:deleted', ({ roomId }) => {
    socket.broadcast.emit('room:deleted', { roomId });
    socket.leave('pub:' + roomId);
  });

  /* ---- SCREENSHOT NOTIFICATION ---- */
  socket.on('screenshot:taken', ({ room, toUser, by }) => {
    const payload = { by: by || username };
    if (toUser) {
      // Private chat — notify the other user
      const rInfo = onlineUsers.get(toUser);
      if (rInfo) io.to(rInfo.socketId).emit('screenshot:notify', payload);
    } else if (room) {
      // Public room — notify everyone else in room
      socket.to('pub:' + room).emit('screenshot:notify', payload);
    }
  });

  /* ---- DISCONNECT ---- */
  socket.on('disconnect', async () => {
    console.log(`🔴 ${username} disconnected`);
    await User.findByIdAndUpdate(userId, { isOnline: false, socketId: null, lastSeen: new Date() });
    onlineUsers.delete(userId);
    broadcastOnlineUsers();
  });
});

function mkPrivPayload(msg, userId, username, gender, country) {
  return {
    _id: msg._id, type: 'private',
    sender: { _id: userId, username, gender, country: country||null },
    receiver: msg.receiver,
    text: msg.text,
    imageUrl: msg.image ? `/api/images/img/${msg._id}/${msg.imageToken}` : null,
    burnAfter: msg.burnAfter,
    burnProtected: msg.burnProtected,
    burned: false,
    createdAt: msg.createdAt
  };
}

function mkPubPayload(msg, userId, username, gender, country) {
  return {
    _id: msg._id, type: 'public', room: msg.room,
    sender: { _id: userId, username, gender, country: country||null },
    text: msg.text,
    imageUrl: msg.image ? `/api/images/img/${msg._id}/${msg.imageToken}` : null,
    burnAfter: msg.burnAfter,
    burnProtected: msg.burnProtected,
    burned: false,
    createdAt: msg.createdAt
  };
}

function broadcastOnlineUsers() {
  const list = Array.from(onlineUsers.entries()).map(([id, info]) => ({ _id: id, username: info.username, gender: info.gender, country: info.country||null }));
  io.emit('users:online', list);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 GreenChat running at http://localhost:${PORT}`));
