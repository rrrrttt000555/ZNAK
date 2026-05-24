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

// Списки привилегированных пользователей
const ADMINS = ['zhukerrom2012@gmail.com']; 

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
  isBetaTester: { type: Boolean, default: true }, // ВСЕ ПО УМОЛЧАНИЮ БЕТА-ТЕСТЕРЫ
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

  // ОБНОВЛЕНИЕ ПРАВ ДЛЯ ВСЕХ ПОЛЬЗОВАТЕЛЕЙ (Бета-тест всем, админ только избранным)
  await User.updateMany({}, { $set: { isBetaTester: true } });
  await User.updateMany({ email: { $nin: ADMINS } }, { $set: { isOfficial: false, isModerator: false } });
  await User.updateMany({ email: { $in: ADMINS } }, { $set: { isOfficial: true, isModerator: true } });

  return cachedDb;
}

// Middleware for DB and Auth
const useDB = async (req, res, next) => {
  try { 
    await connectToDatabase(); 
    next(); 
  } catch (e) { 
    res.status(503).json({ error: 'DB Connection Error', details: e.message }); 
  }
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
  
  const transporter = nodemailer.createTransport({ 
    host: 'smtp.gmail.com', 
    port: 465, 
    secure: true, 
    auth: { user: 'ghhtu6u7@gmail.com', pass: 'ikph notx bnvb avgf' } 
  });

  const htmlContent = `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 500px; margin: 0 auto; padding: 40px; background-color: #f9f9f9; border-radius: 24px; border: 1px solid #eee; text-align: center; color: #333;">
      <div style="margin-bottom: 30px;">
        <h1 style="color: #3390ec; font-size: 32px; font-weight: 800; margin: 0; letter-spacing: -1px;">ZNAK</h1>
      </div>
      <h2 style="font-size: 22px; font-weight: 600; margin-bottom: 10px;">Ваш код подтверждения</h2>
      <p style="color: #707579; font-size: 16px; margin-bottom: 35px;">Используйте этот код для входа в ваш аккаунт ZNAK. Не передавайте его посторонним лицам.</p>
      
      <div style="background-color: #fff; padding: 25px; border-radius: 16px; border: 1px solid #e0e0e0; display: inline-block; min-width: 200px; box-shadow: 0 4px 12px rgba(0,0,0,0.03);">
        <span style="font-size: 42px; font-weight: 800; color: #3390ec; letter-spacing: 8px; font-family: monospace;">${code}</span>
      </div>
      
      <p style="color: #999; font-size: 13px; margin-top: 35px; line-height: 1.5;">Код действителен в течение 10 минут.<br>Если вы не запрашивали этот код, просто проигнорируйте это письмо.</p>
      <div style="margin-top: 40px; border-top: 1px solid #eee; padding-top: 25px;">
        <p style="color: #bbb; font-size: 11px; margin: 0;">© 2026 ZNAK Messenger. All rights reserved.</p>
      </div>
    </div>
  `;

  try {
    await transporter.sendMail({ 
      from: '"ZNAK" <ghhtu6u7@gmail.com>', 
      to: email, 
      subject: `ZNAK: ${code} — ваш код подтверждения`, 
      text: `Ваш код подтверждения: ${code}`,
      html: htmlContent
    });
    res.json({ message: 'Code sent', debugCode: code });
  } catch (e) { 
    console.error('Email error:', e);
    res.json({ message: 'Mail failed', debugCode: code }); 
  }
});

router.post('/auth/verify', useDB, async (req, res) => {
  const { email, code } = req.body;
  const auth = await AuthCode.findOne({ email, code });
  if (auth) {
    let user = await User.findOne({ email });
    if (!user) return res.json({ status: 'new_user', email });

    // Обновление прав
    user.isBetaTester = true; // Всем бета-тест
    if (ADMINS.includes(email)) {
      user.isOfficial = true;
      user.isModerator = true;
    }
    await user.save();

    const token = jwt.sign({ id: user.id, email: user.email }, SECRET_KEY);
    res.json({ status: 'ok', token, user });
  } else res.status(400).json({ message: 'Invalid code' });
});

router.post('/auth/register', useDB, async (req, res) => {
  const { email, name, surname, avatar, bio } = req.body;
  
  const isAdmin = ADMINS.includes(email);

  const newUser = new User({ 
    id: Date.now().toString(), 
    email, 
    name, 
    surname, 
    avatar: avatar || (name ? name[0] : '?'), 
    bio: bio || '', 
    lastSeen: new Date(),
    isOfficial: isAdmin,
    isModerator: isAdmin,
    isBetaTester: true // Всем бета-тест
  });
  
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
  const { username } = req.body;
  if (username) {
    const existing = await User.findOne({ username, id: { $ne: req.user.id } });
    if (existing) {
      const suggestions = [];
      for (let i = 1; i <= 3; i++) {
        const sugg = `${username}${Math.floor(Math.random() * 999)}`;
        const check = await User.findOne({ username: sugg });
        if (!check) suggestions.push(sugg);
      }
      return res.status(409).json({ message: 'Username taken', suggestions });
    }
  }
  const user = await User.findOneAndUpdate({ id: req.user.id }, { $set: req.body }, { new: true });
  res.json(user);
});

router.get('/users/search', useDB, authenticate, async (req, res) => {
  const { query } = req.query;
  const results = await User.find({ $or: [{ name: { $regex: query, $options: 'i' } }, { username: { $regex: query, $options: 'i' } }] }).limit(10);
  res.json(results);
});

// ПОЛУЧЕНИЕ КОНКРЕТНОГО ПОЛЬЗОВАТЕЛЯ (Исправляет 404)
router.get('/users/:userId', useDB, authenticate, async (req, res) => {
  const user = await User.findOne({ id: req.params.userId });
  if (user) res.json(user);
  else res.status(404).json({ message: 'User not found' });
});

// --- CHATS & MESSAGES ---
router.get('/chats', useDB, authenticate, async (req, res) => {
  const chats = await Chat.find({ members: req.user.id });
  const mapped = await Promise.all(chats.map(async c => {
    if (c.type === 'private') {
      const otherId = c.members.find(m => m !== req.user.id);
      const other = await User.findOne({ id: otherId });
      return { 
        ...c.toObject(), 
        name: other ? `${other.name} ${other.surname || ''}` : 'Пользователь', 
        avatar: other?.avatar || '👤',
        lastSeen: other?.lastSeen
      };
    }
    return c;
  }));
  res.json(mapped);
});

router.post('/chats', useDB, authenticate, async (req, res) => {
  const { name, type, members = [], targetId, description, isPublic } = req.body;
  if (type === 'private') {
    const existing = await Chat.findOne({ type: 'private', members: { $all: [req.user.id, targetId] } });
    if (existing) return res.json(existing);
    const newChat = new Chat({ id: Date.now().toString(), type: 'private', members: [req.user.id, targetId] });
    await newChat.save();
    return res.json(newChat);
  }
  const newChat = new Chat({ 
    id: Date.now().toString(), 
    name, 
    type, 
    members: [req.user.id, ...members], 
    ownerId: req.user.id,
    description: description || '',
    isPublic: !!isPublic
  });
  await newChat.save();
  res.json(newChat);
});

router.get('/messages/:chatId', useDB, authenticate, async (req, res) => {
  const messages = await Message.find({ chatId: req.params.chatId }).sort({ time: 1 });
  res.json(messages);
});

async function callSambaNova(text, userLang = 'en') {
  const API_KEY = '7d5e6dd5-5a6e-4ec8-90b0-8f4357d53cf1';
  try {
    const response = await fetch('https://api.sambanova.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: "meta-llama/Llama-3.1-8B-Instruct", // Или другой доступный в SambaNova
        messages: [
          { role: "system", content: `You are ZNAK AI, a helpful assistant. Always respond in the user's language (${userLang}).` },
          { role: "user", content: text }
        ],
        temperature: 0.7
      })
    });
    const data = await response.json();
    return data.choices[0].message.content;
  } catch (error) {
    console.error('SambaNova error:', error);
    return 'Sorry, I am having trouble connecting to my brain right now.';
  }
}

router.post('/messages', useDB, authenticate, async (req, res) => {
  const { chatId, text, fileData, fileName, replyTo } = req.body;
  const msg = new Message({ id: Date.now().toString(), chatId, senderId: req.user.id, text, fileData, fileName, replyTo, readBy: [req.user.id] });
  await msg.save();

  // AI response logic
  if (chatId === 'znakAI') {
    const user = await User.findOne({ id: req.user.id });
    const aiResponse = await callSambaNova(text, user?.lang || 'ru');
    const botMsg = new Message({
      id: (Date.now() + 1).toString(),
      chatId: 'znakAI',
      senderId: 'znakAI',
      text: aiResponse,
      time: new Date()
    });
    await botMsg.save();
  }

  res.json(msg);
});

router.post('/messages/read', useDB, authenticate, async (req, res) => {
  await Message.updateMany({ id: { $in: req.body.messageIds } }, { $addToSet: { readBy: req.user.id } });
  res.json({ status: 'ok' });
});

// --- ADMIN ---
router.get('/admin/stats', useDB, authenticate, async (req, res) => {
  const userCount = await User.countDocuments();
  const chatCount = await Chat.countDocuments();
  const messageCount = await Message.countDocuments();
  const reportCount = await Report.countDocuments({ status: 'pending' });
  
  // Aggregate chart data (last 7 days)
  const chartData = {
    labels: [],
    messages: [],
    registrations: [],
    chatsCreated: []
  };
  
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    d.setHours(0,0,0,0);
    const nextD = new Date(d);
    nextD.setDate(nextD.getDate() + 1);
    
    const dayLabel = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
    chartData.labels.push(dayLabel);
    
    const msgDay = await Message.countDocuments({ time: { $gte: d, $lt: nextD } });
    chartData.messages.push(msgDay);
    
    // Using Date.now() logic for IDs in our mock, but in real app we'd have createdAt
    // Let's approximate registrations by parsing ID if it looks like timestamp
    const regDay = await User.countDocuments({ id: { $gte: d.getTime().toString(), $lt: nextD.getTime().toString() } });
    chartData.registrations.push(regDay);

    const chatsDay = await Chat.countDocuments({ id: { $gte: d.getTime().toString(), $lt: nextD.getTime().toString() } });
    chartData.chatsCreated.push(chatsDay);
  }

  res.json({ totalUsers: userCount, totalChats: chatCount, totalMessages: messageCount, pendingReports: reportCount, chartData });
});

router.post('/admin/login-as/:userId', useDB, authenticate, async (req, res) => {
  const isAdmin = ADMINS.includes(req.user.email);
  if (!isAdmin) return res.sendStatus(403);
  
  const user = await User.findOne({ id: req.params.userId });
  if (!user) return res.status(404).json({ message: 'User not found' });
  
  const token = jwt.sign({ id: user.id, email: user.email }, SECRET_KEY);
  res.json({ token, user });
});

router.get('/admin/reports', useDB, authenticate, async (req, res) => {
  const reports = await Report.find({}).sort({ time: -1 });
  res.json(reports);
});

router.get('/admin/users', useDB, authenticate, async (req, res) => {
  const users = await User.find({});
  res.json(users);
});

router.post('/admin/users/:userId/:action', useDB, authenticate, async (req, res) => {
  const { userId, action } = req.params;
  const isAdmin = ADMINS.includes(req.user.email);
  if (!isAdmin) return res.sendStatus(403);

  if (action === 'block') {
    await User.findOneAndUpdate({ id: userId }, { isBlockedByMod: true });
  } else if (action === 'unblock') {
    await User.findOneAndUpdate({ id: userId }, { isBlockedByMod: false });
  }
  res.json({ status: 'ok' });
});

router.post('/admin/promote', useDB, authenticate, async (req, res) => {
  const { username, type, value } = req.body;
  const isAdmin = ADMINS.includes(req.user.email);
  if (!isAdmin) return res.sendStatus(403);

  const update = {};
  if (type === 'beta') update.isBetaTester = value;
  else {
    update.isModerator = true;
    update.isOfficial = true;
  }

  const user = await User.findOneAndUpdate({ username }, { $set: update }, { new: true });
  if (user) res.json(user);
  else res.status(404).json({ message: 'User not found' });
});

router.post('/admin/reports/:reportId/action', useDB, authenticate, async (req, res) => {
  const { reportId } = req.params;
  const { action } = req.body;
  const isAdmin = ADMINS.includes(req.user.email);
  if (!isAdmin) return res.sendStatus(403);

  const report = await Report.findOne({ id: reportId });
  if (!report) return res.status(404).json({ message: 'Report not found' });

  if (action === 'block') {
    await User.findOneAndUpdate({ id: report.targetId }, { isBlockedByMod: true });
    report.status = 'blocked';
  } else if (action === 'reject') {
    report.status = 'rejected';
  }
  
  await report.save();
  res.json({ status: 'ok' });
});

// --- REPORTS ---
router.post('/reports', useDB, authenticate, async (req, res) => {
  const { targetId, reason, messageId, reportedText } = req.body;
  const target = await User.findOne({ id: targetId });
  const reporter = await User.findOne({ id: req.user.id });
  
  const newReport = new Report({
    id: Date.now().toString(),
    reporterId: req.user.id,
    reporterName: reporter ? `${reporter.name} ${reporter.surname || ''}` : 'Unknown',
    targetId,
    targetName: target ? `${target.name} ${target.surname || ''}` : 'Unknown',
    reason,
    reportedMessage: reportedText || messageId || '',
    time: new Date()
  });
  
  await newReport.save();
  res.json({ status: 'ok' });
});

router.get('/hello', (req, res) => res.json({ message: "API is working!" }));

app.use('/.netlify/functions/api', router);
app.use('/api', router);
app.use('/', router);

export const handler = serverless(app);
