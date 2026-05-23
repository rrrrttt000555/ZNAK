import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import nodemailer from 'nodemailer';
import serverless from 'serverless-http';

const app = express();
const router = express.Router();

const SECRET_KEY = process.env.SECRET_KEY || 'znak_secret_key';
const MONGODB_URI = process.env.MONGODB_URI;

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

// MongoDB Schemas
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

const User = mongoose.models.User || mongoose.model('User', userSchema);
const Chat = mongoose.models.Chat || mongoose.model('Chat', chatSchema);
const Message = mongoose.models.Message || mongoose.model('Message', messageSchema);
const AuthCode = mongoose.models.AuthCode || mongoose.model('AuthCode', authCodeSchema);
const Report = mongoose.models.Report || mongoose.model('Report', reportSchema);

let cachedDb = null;
async function connectToDatabase() {
  if (cachedDb && mongoose.connection.readyState === 1) return cachedDb;
  if (!MONGODB_URI) throw new Error('MONGODB_URI is missing');
  cachedDb = await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  
  // Seed initial chats if empty
  const count = await Chat.countDocuments();
  if (count === 0) {
    await Chat.insertMany([
      { id: 'znakAI', name: 'znakAI', type: 'bot', avatar: '🤖', pinned: true, description: 'Ваш помощник' },
      { id: 'group1', name: 'Общий чат', type: 'group', avatar: '👥', members: [] }
    ]);
  }
  return cachedDb;
}

// Middleware for DB and Auth
const useDB = async (req, res, next) => {
  try { await connectToDatabase(); next(); } catch (e) { res.status(503).json({ error: 'DB Connection Error' }); }
};

const authenticate = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.sendStatus(401);
  try {
    const decoded = jwt.verify(token, SECRET_KEY);
    const user = await User.findOne({ id: decoded.id });
    if (user && user.isBlockedByMod) return res.status(403).json({ status: 'blocked', message: 'Blocked' });
    req.user = decoded;
    next();
  } catch (err) { res.sendStatus(403); }
};

// --- AUTH ---
router.post('/auth/send-code', useDB, async (req, res) => {
  const { email } = req.body;
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  await AuthCode.findOneAndUpdate({ email }, { code }, { upsert: true });
  const transporter = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: 'ghhtu6u7@gmail.com', pass: 'ikph notx bnvb avgf' } });
  try {
    await transporter.sendMail({ from: '"ZNAK" <ghhtu6u7@gmail.com>', to: email, subject: "Код ZNAK", text: `Код: ${code}` });
    res.json({ message: 'Code sent', debugCode: code });
  } catch (e) { res.json({ message: 'Mail failed', debugCode: code }); }
});

router.post('/auth/verify', useDB, async (req, res) => {
  const { email, code } = req.body;
  const auth = await AuthCode.findOne({ email, code });
  if (auth) {
    let user = await User.findOne({ email });
    if (!user) return res.json({ status: 'new_user', email });
    const token = jwt.sign({ id: user.id, email: user.email }, SECRET_KEY);
    res.json({ status: 'ok', token, user });
  } else res.status(400).json({ message: 'Invalid code' });
});

router.post('/auth/register', useDB, async (req, res) => {
  const { email, name, surname, avatar, bio } = req.body;
  const newUser = new User({ id: Date.now().toString(), email, name, surname, avatar: avatar || name[0], bio: bio || '', lastSeen: new Date() });
  await newUser.save();
  await Chat.updateMany({ type: { $in: ['group', 'bot'] } }, { $addToSet: { members: newUser.id } });
  const token = jwt.sign({ id: newUser.id, email: newUser.email }, SECRET_KEY);
  res.json({ status: 'ok', token, user: newUser });
});

// --- USER ---
router.post('/user/ping', useDB, authenticate, async (req, res) => {
  const user = await User.findOneAndUpdate({ id: req.user.id }, { lastSeen: new Date() }, { new: true });
  res.json({ status: 'ok', lastSeen: user?.lastSeen });
});

router.get('/user/me', useDB, authenticate, async (req, res) => {
  const user = await User.findOne({ id: req.user.id });
  res.json(user);
});

router.put('/user/me', useDB, authenticate, async (req, res) => {
  const user = await User.findOneAndUpdate({ id: req.user.id }, { $set: req.body }, { new: true });
  res.json(user);
});

router.get('/users/search', useDB, authenticate, async (req, res) => {
  const { query } = req.query;
  const results = await User.find({ $or: [{ name: { $regex: query, $options: 'i' } }, { username: { $regex: query, $options: 'i' } }] }).limit(10);
  res.json(results);
});

// --- CHATS & MESSAGES ---
router.get('/chats', useDB, authenticate, async (req, res) => {
  const chats = await Chat.find({ members: req.user.id });
  const mapped = await Promise.all(chats.map(async c => {
    if (c.type === 'private') {
      const otherId = c.members.find(m => m !== req.user.id);
      const other = await User.findOne({ id: otherId });
      return { ...c.toObject(), name: other?.name || 'User', avatar: other?.avatar || '👤' };
    }
    return c;
  }));
  res.json(mapped);
});

router.post('/chats', useDB, authenticate, async (req, res) => {
  const { name, type, members, targetId } = req.body;
  if (type === 'private') {
    const existing = await Chat.findOne({ type: 'private', members: { $all: [req.user.id, targetId] } });
    if (existing) return res.json(existing);
    const newChat = new Chat({ id: Date.now().toString(), type: 'private', members: [req.user.id, targetId] });
    await newChat.save();
    return res.json(newChat);
  }
  const newChat = new Chat({ id: Date.now().toString(), name, type, members: [req.user.id, ...members], ownerId: req.user.id });
  await newChat.save();
  res.json(newChat);
});

router.get('/messages/:chatId', useDB, authenticate, async (req, res) => {
  const messages = await Message.find({ chatId: req.params.chatId }).sort({ time: 1 });
  res.json(messages);
});

router.post('/messages', useDB, authenticate, async (req, res) => {
  const { chatId, text, fileData, fileName, replyTo } = req.body;
  const msg = new Message({ id: Date.now().toString(), chatId, senderId: req.user.id, text, fileData, fileName, replyTo, readBy: [req.user.id] });
  await msg.save();
  res.json(msg);
});

router.post('/messages/read', useDB, authenticate, async (req, res) => {
  await Message.updateMany({ id: { $in: req.body.messageIds } }, { $addToSet: { readBy: req.user.id } });
  res.json({ status: 'ok' });
});

// --- ADMIN ---
router.get('/admin/users', useDB, authenticate, async (req, res) => {
  const users = await User.find({});
  res.json(users);
});

app.use('/.netlify/functions/api', router);
app.use('/api', router);
app.use('/', router);

export const handler = serverless(app);
