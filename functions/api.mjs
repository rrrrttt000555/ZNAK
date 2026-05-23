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
  members: { type: [String], index: true },
  ownerId: String,
  isPublic: { type: Boolean, default: false }
});

const messageSchema = new mongoose.Schema({
  id: { type: String, index: true },
  chatId: { type: String, index: true },
  senderId: String,
  text: String,
  time: { type: Date, default: Date.now, index: true },
  readBy: [String]
});

const authCodeSchema = new mongoose.Schema({
  email: String, code: String, createdAt: { type: Date, expires: '10m', default: Date.now }
});

const User = mongoose.models.User || mongoose.model('User', userSchema);
const Chat = mongoose.models.Chat || mongoose.model('Chat', chatSchema);
const Message = mongoose.models.Message || mongoose.model('Message', messageSchema);
const AuthCode = mongoose.models.AuthCode || mongoose.model('AuthCode', authCodeSchema);

let cachedDb = null;
async function connectToDatabase() {
  if (cachedDb && mongoose.connection.readyState === 1) return cachedDb;
  if (!MONGODB_URI) throw new Error('MONGODB_URI is missing');
  cachedDb = await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  return cachedDb;
}

// --- API Routes ---

router.get('/hello', (req, res) => res.json({ message: "API is working!" }));

router.post('/auth/send-code', async (req, res) => {
  const { email } = req.body;
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  try {
    await connectToDatabase();
    await AuthCode.findOneAndUpdate({ email }, { code }, { upsert: true });
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com', port: 465, secure: true,
      auth: { user: 'ghhtu6u7@gmail.com', pass: 'ikph notx bnvb avgf' }
    });
    try {
      await transporter.sendMail({ from: '"ZNAK" <ghhtu6u7@gmail.com>', to: email, subject: "Код ZNAK", text: `Код: ${code}` });
      res.json({ message: 'Code sent', debugCode: code });
    } catch (e) { res.json({ message: 'Mail failed', debugCode: code }); }
  } catch (e) { res.status(503).json({ error: e.message }); }
});

router.post('/auth/verify', async (req, res) => {
  const { email, code } = req.body;
  try {
    await connectToDatabase();
    const auth = await AuthCode.findOne({ email, code });
    if (auth) {
      let user = await User.findOne({ email });
      if (!user) return res.json({ status: 'new_user', email });
      const token = jwt.sign({ id: user.id }, SECRET_KEY);
      res.json({ status: 'ok', token, user });
    } else res.status(400).json({ message: 'Invalid code' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/auth/register', async (req, res) => {
  const { email, name, surname } = req.body;
  try {
    await connectToDatabase();
    const newUser = new User({ id: Date.now().toString(), email, name, surname, avatar: name ? name[0] : '?' });
    await newUser.save();
    const token = jwt.sign({ id: newUser.id }, SECRET_KEY);
    res.json({ status: 'ok', token, user: newUser });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/user/ping', async (req, res) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.sendStatus(401);
  try {
    const decoded = jwt.verify(token, SECRET_KEY);
    await connectToDatabase();
    const user = await User.findOneAndUpdate({ id: decoded.id }, { lastSeen: new Date() }, { new: true });
    res.json({ status: 'ok', lastSeen: user?.lastSeen });
  } catch (e) { res.sendStatus(403); }
});

router.get('/user/me', async (req, res) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.sendStatus(401);
  try {
    const decoded = jwt.verify(token, SECRET_KEY);
    await connectToDatabase();
    const user = await User.findOne({ id: decoded.id });
    res.json(user);
  } catch (e) { res.sendStatus(403); }
});

router.get('/users/search', async (req, res) => {
  const { query } = req.query;
  if (!query) return res.json([]);
  try {
    await connectToDatabase();
    const results = await User.find({
      $or: [
        { name: { $regex: query, $options: 'i' } },
        { username: { $regex: query, $options: 'i' } }
      ]
    }).limit(10);
    res.json(results);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/chats', async (req, res) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.sendStatus(401);
  try {
    const decoded = jwt.verify(token, SECRET_KEY);
    await connectToDatabase();
    const chats = await Chat.find({ members: decoded.id });
    res.json(chats);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/messages/:chatId', async (req, res) => {
  try {
    await connectToDatabase();
    const messages = await Message.find({ chatId: req.params.chatId }).sort({ time: 1 });
    res.json(messages);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/messages', async (req, res) => {
  const { chatId, text, senderId } = req.body;
  try {
    await connectToDatabase();
    const msg = new Message({ id: Date.now().toString(), chatId, senderId, text, readBy: [senderId] });
    await msg.save();
    res.json(msg);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/admin/users', async (req, res) => {
  try {
    await connectToDatabase();
    const users = await User.find({});
    res.json(users);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Монтируем роутер
app.use('/.netlify/functions/api', router);
app.use('/api', router);
app.use('/', router);

export const handler = serverless(app);
