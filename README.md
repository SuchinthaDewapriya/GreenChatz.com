# 🟢 GreenChat — Realtime Chat App

Node.js + Express + Socket.io + MongoDB

---

## 📁 Project Structure

```
greenchat/
├── server.js           ← Main server (Express + Socket.io)
├── .env                ← Config (port, MongoDB URI, JWT secret)
├── package.json
├── models/
│   ├── User.js         ← User schema
│   └── Message.js      ← Message schema
├── routes/
│   ├── auth.js         ← Register / Login / Guest login
│   └── messages.js     ← Message history REST API
└── public/
    └── index.html      ← Full frontend (Login + Register + Chat)
```

---

## 🚀 Setup & Run

### 1. MongoDB install (locally)
```bash
# Ubuntu/Debian
sudo apt install mongodb

# macOS
brew install mongodb-community
brew services start mongodb-community

# Windows — download from https://www.mongodb.com/try/download/community
```

### 2. Install dependencies
```bash
cd greenchat
npm install
```

### 3. Configure .env
```env
PORT=3000
MONGODB_URI=mongodb://localhost:27017/greenchat
JWT_SECRET=greenchat_super_secret_key_2024
```
> MongoDB Atlas use කරනවා නම් MONGODB_URI එකට Atlas connection string දාන්න.

### 4. Run
```bash
# Development (auto-restart)
npm run dev

# Production
npm start
```

### 5. Open browser
```
http://localhost:3000
```

---

## ✨ Features

| Feature | Description |
|---|---|
| 🔐 Guest Login | Username + Age + Gender only |
| 📝 Register | Full account with email + password |
| 🔒 Private Chat | 1-on-1 realtime messages |
| 🌐 Public Rooms | General, Sri Lanka, Music, Gaming, Tech |
| 📷 Image Upload | Send images in chat (base64) |
| ⌨️ Typing Indicator | See when someone is typing |
| 🟢 Online Users | Live online user list |
| 💾 MongoDB | All messages saved to database |
| 📱 Mobile Responsive | Works on all screen sizes |

---

## 🔌 Socket.io Events

| Event | Direction | Description |
|---|---|---|
| `private:message` | emit / on | Send/receive private message |
| `public:message` | emit / on | Send/receive public room message |
| `typing:private` | emit / on | Private typing indicator |
| `typing:public` | emit / on | Public room typing indicator |
| `users:online` | on | Updated online users list |

---

## 🌐 REST API

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/auth/guest` | Guest login |
| POST | `/api/auth/login` | Password login |
| POST | `/api/auth/register` | Register new account |
| GET | `/api/messages/private/:userId` | Private chat history |
| GET | `/api/messages/public/:room` | Public room history |
| GET | `/api/messages/users/online` | Online users list |
