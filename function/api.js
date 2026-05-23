import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import nodemailer from 'nodemailer';
import serverless from 'serverless-http';

const app = express();
const SECRET_KEY = process.env.SECRET_KEY || 'znak_secret_key';
const MONGODB_URI = process.env.MONGODB_URI;

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

// MongoDB Schemas (same as server.js)
const userSchema = new mongoose.Schema({
  id: { type: String, index: true },
  email: { type: String, unique: true, index: true },
  name: String,
  surname: String,
  username: { type: String, index: true },
  avatar: String,
  bio: String,
  theme: { type: String, default: 'light' },
  lang: { type: String, default: 'ru' },
  fontSize: { type: String, default: 'medium' },
  isModerator: { type: Boolean, default: false },
  isOfficial: { type: Boolean, default: false },
  isBetaTester: { type: Boolean, default: false },
  isBlockedByMod: { type: Boolean, default: false },
  blockedUsers: [String],
  lastSeen: { type: Date, default: Date.now }
});

const chatSchema = new mongoose.Schema({
  id: { type: String, index: true },
  name: String,
  type: String, 
  avatar: String,
  description: String,
  pinned: { type: Boolean, default: false },
  members: { type: [String], index: true },
  ownerId: String,
  isPublic: { type: Boolean, default: false },
  pinnedMsgId: String
});

const messageSchema = new mongoose.Schema({
  id: { type: String, index: true },
  chatId: { type: String, index: true },
  senderId: String,
  text: String,
  fileData: String,
  fileName: String,
  replyTo: { msgId: String, text: String, senderName: String },
  forwardFrom: { senderName: String, text: String },
  time: { type: Date, default: Date.now, index: true },
  readBy: [String],
  isEdited: { type: Boolean, default: false }
});

const reportSchema = new mongoose.Schema({
  id: String, reporterId: String, reporterName: String, targetId: String, targetName: String, reason: String, reportedMessage: String, time: { type: Date, default: Date.now }, status: { type: String, default: 'pending' }
});

const authCodeSchema = new mongoose.Schema({
  email: String, code: String, createdAt: { type: Date, expires: '10m', default: Date.now }
});

const scheduleSchema = new mongoose.Schema({ day: String, tasks: [String] });

const User = mongoose.models.User || mongoose.model('User', userSchema);
const Chat = mongoose.models.Chat || mongoose.model('Chat', chatSchema);
const Message = mongoose.models.Message || mongoose.model('Message', messageSchema);
const Report = mongoose.models.Report || mongoose.model('Report', reportSchema);
const AuthCode = mongoose.models.AuthCode || mongoose.model('AuthCode', authCodeSchema);
const Schedule = mongoose.models.Schedule || mongoose.model('Schedule', scheduleSchema);

// Connection helper
let cachedDb = null;
async function connectToDatabase() {
  if (cachedDb && mongoose.connection.readyState === 1) return cachedDb;
  mongoose.set('strictQuery', true);
  cachedDb = await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  return cachedDb;
}

// Middleware to ensure DB connection
app.use(async (req, res, next) => {
  try {
    await connectToDatabase();
    next();
  } catch (err) {
    res.status(503).json({ message: 'Database connection error' });
  }
});

// --- API Endpoints (copy-pasted from server.js and adapted) ---

app.post('/api/auth/send-code', async (req, res) => {
  const { email } = req.body;
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  await AuthCode.findOneAndUpdate({ email }, { code }, { upsert: true });
  
  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 465, secure: true,
    auth: { user: process.env.EMAIL_USER || 'ghhtu6u7@gmail.com', pass: process.env.EMAIL_PASS || 'ikph notx bnvb avgf' }
  });

  try {
    await transporter.sendMail({
      from: '"ZNAK Messenger" <ghhtu6u7@gmail.com>', to: email,
      subject: "Ваш код подтверждения ZNAK",
      text: `Ваш код: ${code}`,
      html: `<div style="font-family: sans-serif; padding: 20px; background: #f4f4f4;"><h2>ZNAK Messenger</h2><p>Ваш код: <b>${code}</b></p></div>`
    });
    res.json({ message: 'Code sent', debugCode: code });
  } catch (error) {
    res.json({ message: 'Code generated (SMTP failed)', debugCode: code, error: error.message });
  }
});

app.post('/api/auth/verify', async (req, res) => {
  const { email, code } = req.body;
  const authRecord = await AuthCode.findOne({ email, code });
  if (authRecord) {
    let user = await User.findOne({ email });
    if (user && user.isBlockedByMod) return res.status(403).json({ status: 'blocked', message: 'Account blocked' });
    if (!user) return res.json({ status: 'new_user', email });
    const token = jwt.sign({ id: user.id, email: user.email }, SECRET_KEY);
    res.json({ status: 'ok', token, user });
  } else {
    res.status(400).json({ message: 'Invalid code' });
  }
});

app.post('/api/auth/register', async (req, res) => {
  const { email, name, surname, avatar, bio } = req.body;
  const newUser = new User({ id: Date.now().toString(), email, name, surname, avatar: avatar || (name ? name[0] : '?'), bio: bio || '', lastSeen: new Date() });
  await newUser.save();
  await Chat.updateMany({ type: { $in: ['group', 'bot'] } }, { $addToSet: { members: newUser.id } });
  const token = jwt.sign({ id: newUser.id, email: newUser.email }, SECRET_KEY);
  res.json({ status: 'ok', token, user: newUser });
});

app.post('/api/user/ping', async (req, res) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.sendStatus(401);
  const decoded = jwt.verify(token, SECRET_KEY);
  const user = await User.findOneAndUpdate({ id: decoded.id }, { lastSeen: new Date() }, { new: true });
  res.json({ status: 'ok', lastSeen: user ? user.lastSeen : null });
});

app.get('/api/user/me', async (req, res) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.sendStatus(401);
  const decoded = jwt.verify(token, SECRET_KEY);
  const user = await User.findOne({ id: decoded.id });
  res.json(user);
});

app.get('/api/chats', async (req, res) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.sendStatus(401);
  const decoded = jwt.verify(token, SECRET_KEY);
  const chats = await Chat.find({ members: decoded.id });
  const mappedChats = await Promise.all(chats.map(async c => {
    if (c.id === 'znakAI') return { ...c.toObject(), name: 'znakAI', avatar: '🤖', type: 'bot' };
    if (c.type === 'private') {
      const otherId = c.members.find(m => m !== decoded.id) || decoded.id;
      const otherUser = await User.findOne({ id: otherId });
      if (otherUser) {
        return { ...c.toObject(), name: `${otherUser.name} ${otherUser.surname || ''}`, avatar: otherUser.avatar, username: otherUser.username, lastSeen: otherUser.lastSeen };
      }
    }
    return c;
  }));
  res.json(mappedChats);
});

app.get('/api/messages/:chatId', async (req, res) => {
  const messages = await Message.find({ chatId: req.params.chatId }).sort({ time: 1 });
  res.json(messages);
});

app.post('/api/messages', async (req, res) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.sendStatus(401);
  const decoded = jwt.verify(token, SECRET_KEY);
  const { chatId, text, fileData, fileName, replyTo, forwardFrom } = req.body;
  const msg = new Message({ id: Date.now().toString(), chatId, senderId: decoded.id, text, fileData, fileName, replyTo, forwardFrom, readBy: [decoded.id] });
  await msg.save();
  res.json(msg);
});

app.get('/api/admin/users', async (req, res) => {
  const users = await User.find({});
  res.json(users);
});

// Export handler for Netlify
export const handler = serverless(app);

