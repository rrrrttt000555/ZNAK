import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import jwt from 'jsonwebtoken';
import { JSONFilePreset } from 'lowdb/node';
import { fileURLToPath } from 'url';
import path from 'path';
import nodemailer from 'nodemailer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET_KEY = process.env.SECRET_KEY || 'znak_secret_key';

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static('public'));

// Database initialization
const defaultData = { 
  users: [], 
  chats: [
    { id: 'znakAI', name: 'znakAI', type: 'bot', avatar: '🤖', pinned: true, description: 'Ваш учебный помощник с искусственным интеллектом.', members: [] },
    { id: 'group1', name: 'Группа ИТ-21', type: 'group', avatar: '👥', pinned: false, description: 'Официальный чат группы ИТ-21. Обсуждаем учёбу и проекты.', members: [] },
    { id: 'group2', name: 'Курс Дизайна', type: 'group', avatar: '🎨', pinned: false, description: 'Креативное пространство для студентов курса промышленного дизайна.', members: [] }
  ], 
  messages: [], 
  reports: [], // New: Store user reports
  study_schedule: [
    { day: 'понедельник', tasks: ['Математика 9:00', 'Физика 11:00'] },
    { day: 'вторник', tasks: ['Программирование 10:00', 'Английский 13:00'] },
    { day: 'среда', tasks: ['Математика 9:00', 'История 12:00'] },
    { day: 'четверг', tasks: ['Физкультура 10:00', 'Программирование 14:00'] },
    { day: 'пятница', tasks: ['Экзамен по JS 10:00'] },
    { day: 'суббота', tasks: ['Выходной'] },
    { day: 'воскресенье', tasks: ['Выходной'] }
  ],
  auth_codes: {} // Temp storage for email verification codes
};

const db = await JSONFilePreset('db.json', defaultData);

// Ensure all users have required fields
let dbChanged = false;
db.data.users.forEach(u => {
  if (u.isBetaTester === undefined) { u.isBetaTester = false; dbChanged = true; }
  if (u.isBlockedByMod === undefined) { u.isBlockedByMod = false; dbChanged = true; }
  if (u.lastSeen === undefined) { u.lastSeen = '1970-01-01T00:00:00.000Z'; dbChanged = true; }
});
if (dbChanged) await db.write();

// Set shopbighi@gmail.com as moderator if exists
const modUser = db.data.users.find(u => u.email === 'shopbighi@gmail.com');
if (modUser) {
  modUser.isModerator = true;
  modUser.isOfficial = true;
  await db.write();
}

// Helper for username suggestions
function suggestUsernames(base) {
  const suffixes = [
    Math.floor(Math.random() * 1000).toString(),
    '_official',
    '_' + Math.floor(Math.random() * 100).toString()
  ];
  return suffixes.map(s => base + s);
}

// Middleware for auth
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.sendStatus(401);

  jwt.verify(token, SECRET_KEY, (err, user) => {
    if (err) return res.sendStatus(403);
    
    // Check if user is blocked by moderator
    const dbUser = db.data.users.find(u => u.id === user.id);
    if (dbUser && dbUser.isBlockedByMod) {
      return res.status(403).json({ status: 'blocked', message: 'К сожалению, ваш аккаунт был заблокирован из-за нарушений правил.' });
    }
    
    req.user = user;
    next();
  });
};

// Auth Endpoints
app.post('/api/auth/send-code', async (req, res) => {
  const { email } = req.body;
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  
  db.data.auth_codes[email] = code;
  await db.write();

  console.log(`[AUTH] Verification code for ${email}: ${code}`);
  
  // Настройка SMTP
  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true, // true для 465, false для других портов
    auth: {
      user: 'ghhtu6u7@gmail.com',
      pass: 'ikph notx bnvb avgf'
    }
  });

  try {
    console.log(`[SMTP] Attempting to send email to ${email}...`);
    const info = await transporter.sendMail({
      from: '"ZNAK Messenger" <ghhtu6u7@gmail.com>',
      to: email,
      subject: "Ваш код подтверждения ZNAK",
      text: `Ваш код: ${code}`,
      html: `
        <div style="font-family: sans-serif; padding: 20px; background: #f4f4f4;">
          <h2 style="color: #3390ec;">ZNAK Messenger</h2>
          <p>Ваш код подтверждения для входа:</p>
          <h1 style="background: #fff; padding: 10px; display: inline-block; border-radius: 8px;">${code}</h1>
          <p>Если вы не запрашивали этот код, просто проигнорируйте письмо.</p>
        </div>
      `
    });
    console.log(`[SMTP] Email sent successfully: ${info.messageId}`);
    res.json({ message: 'Code sent', debugCode: code });
  } catch (error) {
    console.error(' [SMTP ERROR] ', error);
    // Даже если почта не отправилась, возвращаем код для отладки в консоли сервера
    res.json({ message: 'Code generated (SMTP failed)', debugCode: code, error: error.message });
  }
});

app.post('/api/auth/verify', async (req, res) => {
  const { email, code } = req.body;
  
  if (db.data.auth_codes[email] === code) {
    let user = db.data.users.find(u => u.email === email);
    
    if (user && user.isBlockedByMod) {
      return res.status(403).json({ status: 'blocked', message: 'К сожалению, ваш аккаунт был заблокирован из-за нарушений правил.' });
    }

    if (!user) {
      // First time registration - will need name/surname later
      return res.json({ status: 'new_user', email });
    }

    // Force moderator status for specific email
    if (email === 'shopbighi@gmail.com') {
      user.isModerator = true;
      user.isOfficial = true;
      if (!user.username) user.username = '@admin';
      await db.write();
    }

    const token = jwt.sign({ id: user.id, email: user.email }, SECRET_KEY);
    res.json({ status: 'ok', token, user });
  } else {
    res.status(400).json({ message: 'Invalid code' });
  }
});

app.post('/api/auth/register', async (req, res) => {
  const { email, name, surname, avatar, bio } = req.body;
  
  const newUser = {
    id: Date.now().toString(),
    email,
    name,
    surname,
    username: '', // New field
    avatar: avatar || (name ? name[0] : '?'),
    bio: bio || '',
    theme: 'light',
    lang: 'ru',
    fontSize: 'medium',
    isModerator: email === 'shopbighi@gmail.com', // Pre-set moderator
    isOfficial: email === 'shopbighi@gmail.com',
    isBetaTester: false,
    blockedUsers: [], // IDs of users this user blocked
    isBlockedByMod: false, // If this user is banned by a moderator
    lastSeen: new Date().toISOString()
  };

  db.data.users.push(newUser);
  
  // Add user to all initial groups
  db.data.chats.forEach(chat => {
    if (chat.type === 'group' || chat.type === 'bot') {
      if (!chat.members.includes(newUser.id)) {
        chat.members.push(newUser.id);
      }
    }
  });
  
  await db.write();

  const token = jwt.sign({ id: newUser.id, email: newUser.email }, SECRET_KEY);
  res.json({ status: 'ok', token, user: newUser });
});

// User Endpoints
app.post('/api/user/ping', authenticateToken, async (req, res) => {
  const user = db.data.users.find(u => u.id === req.user.id);
  if (user) {
    user.lastSeen = new Date().toISOString();
    // Use a non-blocking write or only write periodically if needed, but for now let's ensure it's saved
    await db.write();
  }
  res.json({ status: 'ok', lastSeen: user ? user.lastSeen : null });
});

app.get('/api/user/me', authenticateToken, async (req, res) => {
  const user = db.data.users.find(u => u.id === req.user.id);
  if (user && user.email === 'shopbighi@gmail.com') {
    let changed = false;
    if (!user.isModerator) { user.isModerator = true; changed = true; }
    if (!user.isOfficial) { user.isOfficial = true; changed = true; }
    if (!user.username) { user.username = '@admin'; changed = true; }
    if (changed) await db.write();
  }
  res.json(user);
});

app.put('/api/user/me', authenticateToken, async (req, res) => {
  const index = db.data.users.findIndex(u => u.id === req.user.id);
  if (index !== -1) {
    const { username } = req.body;
    
    // Validate username if provided
    if (username !== undefined && username !== '' && username !== db.data.users[index].username) {
      const exists = db.data.users.find(u => u.username === username);
      if (exists) {
        return res.status(400).json({ 
          message: 'Данный username занят другим пользователем! Пожалуйста, выберите другой!',
          suggestions: suggestUsernames(username)
        });
      }
    }

    db.data.users[index] = { ...db.data.users[index], ...req.body };
    await db.write();
    res.json(db.data.users[index]);
  } else {
    res.status(404).json({ message: 'User not found' });
  }
});

// Username check endpoint
app.get('/api/users/check-username', authenticateToken, (req, res) => {
  const { username } = req.query;
  if (!username) return res.json({ available: true });
  
  const user = db.data.users.find(u => u.username === username);
  if (user && user.id !== req.user.id) {
    return res.json({ 
      available: false, 
      message: 'Данный username занят другим пользователем! Пожалуйста, выберите другой!',
      suggestions: suggestUsernames(username)
    });
  }
  res.json({ available: true });
});

// Search for users to add to group
app.get('/api/users/search-all', authenticateToken, (req, res) => {
  const { query } = req.query;
  if (!query) return res.json([]);
  
  const results = db.data.users
    .filter(u => 
      u.name.toLowerCase().includes(query.toLowerCase()) || 
      (u.username && u.username.toLowerCase().includes(query.toLowerCase()))
    )
    .slice(0, 10)
    .map(u => ({ id: u.id, name: u.name, surname: u.surname, username: u.username, avatar: u.avatar }));
  res.json(results);
});

// Add member to group
app.post('/api/chats/:chatId/members', authenticateToken, async (req, res) => {
  const { chatId } = req.params;
  const { userId } = req.body;
  
  const chat = db.data.chats.find(c => c.id === chatId);
  if (!chat) return res.status(404).json({ message: 'Chat not found' });
  
  if (chat.ownerId !== req.user.id) return res.status(403).json({ message: 'Only owner can add members' });
  
  if (!chat.members.includes(userId)) {
    chat.members.push(userId);
    await db.write();
  }
  res.json({ status: 'ok', members: chat.members });
});

// Delete account
app.delete('/api/user/me', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const user = db.data.users.find(u => u.id === userId);
  
  if (user) {
    console.log(`[MAIL] To: ${user.email} - Ваш аккаунт был успешно удален.`);
    
    // Remove user from database
    db.data.users = db.data.users.filter(u => u.id !== userId);
    
    // Remove user from all chats
    db.data.chats.forEach(chat => {
      chat.members = chat.members.filter(m => m !== userId);
    });
    
    // Cleanup empty private chats
    db.data.chats = db.data.chats.filter(chat => {
      if (chat.type === 'private' && chat.members.length < 2) return false;
      return true;
    });

    await db.write();
    res.json({ status: 'ok' });
  } else {
    res.status(404).json({ message: 'User not found' });
  }
});

// Block/Unblock
app.post('/api/users/block/:targetId', authenticateToken, async (req, res) => {
  const { targetId } = req.params;
  
  if (targetId === 'znakAI' || targetId === '1779451744698') {
    return res.status(403).json({ message: 'Этого пользователя нельзя заблокировать!' });
  }

  const user = db.data.users.find(u => u.id === req.user.id);
  if (!user.blockedUsers) user.blockedUsers = [];
  
  if (!user.blockedUsers.includes(targetId)) {
    user.blockedUsers.push(targetId);
    await db.write();
  }
  res.json({ status: 'ok', blockedUsers: user.blockedUsers });
});

app.post('/api/users/unblock/:targetId', authenticateToken, async (req, res) => {
  const { targetId } = req.params;
  const user = db.data.users.find(u => u.id === req.user.id);
  if (user.blockedUsers) {
    user.blockedUsers = user.blockedUsers.filter(id => id !== targetId);
    await db.write();
  }
  res.json({ status: 'ok', blockedUsers: user.blockedUsers });
});

// Reports
app.post('/api/reports', authenticateToken, async (req, res) => {
  try {
    const { targetId, reason, messageId } = req.body;
    
    // Prevent reporting the bot or the main admin
    if (targetId === 'znakAI' || targetId === '1779451744698') {
      return res.status(403).json({ message: 'На данного пользователя нельзя жаловаться!' });
    }

    const reporter = db.data.users.find(u => u.id === req.user.id);
    const target = db.data.users.find(u => u.id === targetId) || { name: 'Unknown', surname: 'User' };
    const reportedMsg = db.data.messages.find(m => m.id === messageId);
    
    // Ensure reports array exists
    if (!db.data.reports) db.data.reports = [];

    const newReport = {
      id: Date.now().toString(),
      reporterId: req.user.id,
      reporterName: reporter ? `${reporter.name} ${reporter.surname}` : 'Unknown',
      targetId,
      targetName: `${target.name} ${target.surname}`,
      reason,
      reportedMessage: reportedMsg ? reportedMsg.text : 'No message',
      time: new Date().toISOString(),
      status: 'pending'
    };
    
    db.data.reports.push(newReport);
    await db.write();
    res.json({ status: 'ok' });
  } catch (error) {
    console.error('Error in /api/reports:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
});

// Username search
app.get('/api/users/search', authenticateToken, (req, res) => {
  const { query } = req.query;
  if (!query) return res.json([]);
  
  const normalizedQuery = query.toLowerCase();
  const searchUsername = normalizedQuery.startsWith('@') ? normalizedQuery : '@' + normalizedQuery;

  const results = db.data.users
    .filter(u => {
      const uName = u.name.toLowerCase();
      const uSurname = (u.surname || '').toLowerCase();
      const uUsername = (u.username || '').toLowerCase();
      
      return uUsername.includes(normalizedQuery) || 
             uUsername.includes(searchUsername) ||
             uName.includes(normalizedQuery) ||
             uSurname.includes(normalizedQuery);
    })
    .map(u => {
      const isBlockedByOther = u.blockedUsers && u.blockedUsers.includes(req.user.id);
      return {
        id: u.id,
        name: u.name,
        surname: u.surname,
        username: u.username,
        avatar: isBlockedByOther ? '👤' : u.avatar,
        isOfficial: u.isOfficial,
        isBetaTester: u.isBetaTester,
        lastSeen: isBlockedByOther ? '1970-01-01T00:00:00.000Z' : u.lastSeen
      };
    })
    .slice(0, 10);
  res.json(results);
});

// Admin stats with chart data
app.get('/api/admin/stats', authenticateToken, (req, res) => {
  try {
    const user = db.data.users.find(u => u.id === req.user.id);
    if (!user || (!user.isModerator && !user.isBetaTester)) return res.status(403).send();
    
    // Ensure reports array exists
    if (!db.data.reports) db.data.reports = [];

    // Grouping by date for chart
    const last7Days = [...Array(7)].map((_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - i);
      return d.toISOString().split('T')[0];
    }).reverse();

    const stats = {
      totalUsers: db.data.users.length,
      totalChats: db.data.chats.length,
      totalMessages: db.data.messages.length,
      pendingReports: db.data.reports.filter(r => r.status === 'pending').length,
      chartData: {
        labels: last7Days,
        messages: last7Days.map(date => db.data.messages.filter(m => m.time && m.time.startsWith(date)).length),
        registrations: last7Days.map(date => {
          return db.data.users.filter(u => {
            try {
              const regDate = new Date(parseInt(u.id)).toISOString().split('T')[0];
              return regDate === date;
            } catch (e) { return false; }
          }).length;
        }),
        chatsCreated: last7Days.map(date => {
          return db.data.chats.filter(c => {
            try {
              if (!c.id || isNaN(parseInt(c.id))) return false;
              const createDate = new Date(parseInt(c.id)).toISOString().split('T')[0];
              return createDate === date;
            } catch (e) { return false; }
          }).length;
        })
      }
    };
    
    res.json(stats);
  } catch (error) {
    console.error('Error in /api/admin/stats:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
});

app.get('/api/admin/users', authenticateToken, (req, res) => {
  const user = db.data.users.find(u => u.id === req.user.id);
  if (!user.isModerator && !user.isBetaTester) return res.status(403).send();
  res.json(db.data.users);
});

app.get('/api/admin/reports', authenticateToken, (req, res) => {
  const user = db.data.users.find(u => u.id === req.user.id);
  if (!user.isModerator && !user.isBetaTester) return res.status(403).send();
  res.json(db.data.reports);
});

app.post('/api/admin/users/:userId/block', authenticateToken, async (req, res) => {
  const admin = db.data.users.find(u => u.id === req.user.id);
  if (!admin.isModerator) return res.status(403).send();
  
  const targetId = req.params.userId;
  if (targetId === '1779451744698') {
    return res.status(403).json({ message: 'Этого пользователя нельзя заблокировать!' });
  }

  const targetUser = db.data.users.find(u => u.id === targetId);
  if (!targetUser) return res.status(404).send();
  
  targetUser.isBlockedByMod = true;
  await db.write();
  
  console.log(`[MAIL] To: ${targetUser.email} - Ваш аккаунт был удален (заблокирован)`);
  res.json({ status: 'ok' });
});

app.post('/api/admin/users/:userId/unblock', authenticateToken, async (req, res) => {
  const admin = db.data.users.find(u => u.id === req.user.id);
  if (!admin.isModerator) return res.status(403).send();
  
  const targetUser = db.data.users.find(u => u.id === req.params.userId);
  if (!targetUser) return res.status(404).send();
  
  targetUser.isBlockedByMod = false;
  await db.write();
  
  console.log(`[MAIL] To: ${targetUser.email} - Ваш аккаунт был успешно восстановлен. Возвращайтесь скорее!`);
  res.json({ status: 'ok' });
});

app.post('/api/admin/reports/:reportId/action', authenticateToken, async (req, res) => {
  const user = db.data.users.find(u => u.id === req.user.id);
  if (!user.isModerator && !user.isBetaTester) return res.status(403).send();
  
  const { reportId } = req.params;
  const { action } = req.body; // 'block' or 'reject'
  const report = db.data.reports.find(r => r.id === reportId);
  if (!report) return res.status(404).send();
  
  report.status = action === 'block' ? 'resolved_blocked' : 'rejected';
  
  if (action === 'block') {
    if (report.targetId === '1779451744698') {
      return res.status(403).json({ message: 'Этого пользователя нельзя заблокировать!' });
    }
    const targetUser = db.data.users.find(u => u.id === report.targetId);
    if (targetUser) targetUser.isBlockedByMod = true;
  }
  
  // Create system notification for reporter
  const reporterId = report.reporterId;
  const targetName = report.targetName;
  const notificationText = action === 'block' 
    ? `Данный пользователь ${targetName}, был наказан модерацией. Спасибо, за заявку! Удачного дня`
    : `К сожалению, данный пользователь ${targetName} не был наказан модерацией, потому что не нашли доказательств нарушений правил. Удачного дня!`;
  
  db.data.messages.push({
    id: Date.now().toString(),
    chatId: 'znakAI',
    senderId: 'znakAI',
    text: notificationText,
    time: new Date().toISOString(),
    readBy: [reporterId]
  });

  await db.write();
  res.json({ status: 'ok' });
});

app.post('/api/admin/promote', authenticateToken, async (req, res) => {
  const currentUser = db.data.users.find(u => u.id === req.user.id);
  // Only existing moderators can promote others for this demo
  if (!currentUser.isModerator) return res.status(403).send();
  
  const { username, type, value } = req.body; // type: 'moderator' or 'beta', value: true/false
  const targetUser = db.data.users.find(u => u.username === username);
  if (!targetUser) return res.status(404).json({ message: 'User not found' });
  
  if (type === 'beta') {
    targetUser.isBetaTester = value !== undefined ? value : true;
  } else {
    targetUser.isModerator = value !== undefined ? value : true;
    targetUser.isOfficial = targetUser.isModerator;
  }
  
  await db.write();
  res.json({ status: 'ok' });
});

// Chat Endpoints
app.get('/api/chats', authenticateToken, (req, res) => {
  const userChats = db.data.chats
    .filter(c => c.members.includes(req.user.id))
    .map(c => {
      if (c.id === 'znakAI') {
        return {
          ...c,
          name: 'znakAI',
          avatar: '🤖',
          type: 'bot'
        };
      }
      if (c.type === 'private') {
        const otherUserId = c.members.find(m => m !== req.user.id) || req.user.id;
        const otherUser = db.data.users.find(u => u.id === otherUserId);
        const currentUserObj = db.data.users.find(u => u.id === req.user.id);
        
        if (otherUser) {
          const isBlockedByOther = otherUser.blockedUsers && otherUser.blockedUsers.includes(req.user.id);
          const hasBlockedOther = currentUserObj && currentUserObj.blockedUsers && currentUserObj.blockedUsers.includes(otherUserId);
          
          return {
            ...c,
            name: `${otherUser.name} ${otherUser.surname || ''}`,
            avatar: isBlockedByOther ? '👤' : otherUser.avatar,
            username: otherUser.username,
            lastSeen: isBlockedByOther ? '1970-01-01T00:00:00.000Z' : otherUser.lastSeen, // "Long ago" if blocked
            isOfficial: otherUser.isOfficial,
            isBetaTester: otherUser.isBetaTester
          };
        }
      }
      return c;
    });
  res.json(userChats);
});

app.post('/api/chats/:chatId/leave', authenticateToken, async (req, res) => {
  const { chatId } = req.params;
  const chat = db.data.chats.find(c => c.id === chatId);
  if (!chat) return res.status(404).json({ message: 'Chat not found' });
  
  if (chat.type === 'group' || chat.type === 'channel') {
    chat.members = chat.members.filter(m => m !== req.user.id);
    if (chat.members.length === 0 && chatId !== 'znakAI') {
      db.data.chats = db.data.chats.filter(c => c.id !== chatId);
    }
    await db.write();
    res.json({ status: 'ok' });
  } else {
    res.status(400).json({ message: 'Cannot leave private chat' });
  }
});

app.get('/api/messages/:chatId', authenticateToken, (req, res) => {
  const { chatId } = req.params;
  const messages = db.data.messages.filter(m => m.chatId === chatId);
  res.json(messages);
});

app.post('/api/chats', authenticateToken, async (req, res) => {
  const { name, type, avatar, description, isPublic, targetId } = req.body;
  
  if (type === 'private') {
    const existing = db.data.chats.find(c => 
      c.type === 'private' && 
      c.members.includes(req.user.id) && 
      c.members.includes(targetId)
    );
    if (existing) return res.json(existing);
    
    const targetUser = db.data.users.find(u => u.id === targetId);
    const newChat = {
      id: Date.now().toString(),
      name: `${targetUser.name} ${targetUser.surname || ''}`,
      type: 'private',
      avatar: targetUser.avatar,
      members: [req.user.id, targetId]
    };
    db.data.chats.push(newChat);
    await db.write();
    return res.json(newChat);
  }

  const newChat = {
    id: Date.now().toString(),
    name,
    type,
    avatar: avatar || (type === 'group' ? '👥' : '📢'),
    description: description || '',
    pinned: false,
    members: [req.user.id],
    isPublic: !!isPublic,
    ownerId: req.user.id
  };
  db.data.chats.push(newChat);
  await db.write();
  res.json(newChat);
});

app.put('/api/chats/:chatId', authenticateToken, async (req, res) => {
  const { chatId } = req.params;
  const { name, description, avatar } = req.body;
  const chat = db.data.chats.find(c => c.id === chatId);
  if (!chat) return res.status(404).send();
  
  if (chat.ownerId !== req.user.id) return res.status(403).send();
  
  if (name) chat.name = name;
  if (description) chat.description = description;
  if (avatar) chat.avatar = avatar;
  
  await db.write();
  res.json(chat);
});

app.delete('/api/chats/:chatId', authenticateToken, async (req, res) => {
  const { chatId } = req.params;
  const chat = db.data.chats.find(c => c.id === chatId);
  if (!chat) return res.status(404).send();
  
  if (chat.ownerId !== req.user.id) return res.status(403).send();
  
  db.data.chats = db.data.chats.filter(c => c.id !== chatId);
  db.data.messages = db.data.messages.filter(m => m.chatId !== chatId);
  
  await db.write();
  res.json({ status: 'ok' });
});

app.post('/api/messages/read', authenticateToken, async (req, res) => {
  const { messageIds } = req.body;
  if (!messageIds || !Array.isArray(messageIds)) return res.status(400).send();
  
  messageIds.forEach(id => {
    const msg = db.data.messages.find(m => m.id === id);
    if (msg) {
      if (!msg.readBy) msg.readBy = [];
      if (!msg.readBy.includes(req.user.id)) msg.readBy.push(req.user.id);
    }
  });
  
  await db.write();
  res.json({ status: 'ok' });
});

app.post('/api/messages', authenticateToken, async (req, res) => {
  const { chatId, text, fileData, fileName, replyTo, forwardFrom } = req.body;
  
  const chat = db.data.chats.find(c => c.id === chatId);
  if (!chat) return res.status(404).json({ message: 'Chat not found' });

  // Check if sender is blocked by recipient in private chat
  if (chat.type === 'private') {
    const recipientId = chat.members.find(m => m !== req.user.id);
    const recipient = db.data.users.find(u => u.id === recipientId);
    if (recipient && recipient.blockedUsers && recipient.blockedUsers.includes(req.user.id)) {
      return res.status(403).json({ message: 'Вы заблокированы этим пользователем' });
    }
  }

  const newMessage = {
    id: Date.now().toString(),
    chatId,
    senderId: req.user.id,
    text,
    fileData,
    fileName,
    replyTo, // { msgId, text, senderName }
    forwardFrom, // { senderName, text }
    time: new Date().toISOString(),
    readBy: [req.user.id]
  };
  db.data.messages.push(newMessage);
  await db.write();
  
  if (chatId === 'znakAI') {
    const botReply = await processBotMessage(text);
    if (botReply) {
      const botMessage = {
        id: (Date.now() + 1).toString(),
        chatId,
        senderId: 'znakAI',
        text: botReply,
        time: new Date().toISOString(),
        readBy: [req.user.id]
      };
      db.data.messages.push(botMessage);
      await db.write();
    }
  }
  
  res.json(newMessage);
});

app.delete('/api/messages/:msgId', authenticateToken, async (req, res) => {
  const { msgId } = req.params;
  const { mode } = req.query; // 'self' or 'all'
  
  const msgIndex = db.data.messages.findIndex(m => m.id === msgId);
  if (msgIndex === -1) return res.status(404).send();
  
  const msg = db.data.messages[msgIndex];
  
  if (mode === 'all') {
    if (msg.senderId !== req.user.id) return res.status(403).send();
    db.data.messages.splice(msgIndex, 1);
  } else {
    db.data.messages.splice(msgIndex, 1);
  }
  
  await db.write();
  res.json({ status: 'ok' });
});

app.put('/api/messages/:msgId', authenticateToken, async (req, res) => {
  const { msgId } = req.params;
  const { text } = req.body;
  const msg = db.data.messages.find(m => m.id === msgId);
  if (!msg) return res.status(404).send();
  if (msg.senderId !== req.user.id) return res.status(403).send();
  
  msg.text = text;
  msg.isEdited = true;
  await db.write();
  res.json(msg);
});

app.post('/api/chats/:chatId/pin', authenticateToken, async (req, res) => {
  const { chatId } = req.params;
  const { msgId } = req.body;
  const chat = db.data.chats.find(c => c.id === chatId);
  if (!chat) return res.status(404).send();
  
  chat.pinnedMsgId = msgId;
  await db.write();
  res.json({ status: 'ok' });
});

async function processBotMessage(text) {
  const lowerText = text.toLowerCase();
  if (lowerText.startsWith('/расписание')) {
    const day = lowerText.replace('/расписание', '').trim();
    if (!day) return 'Пожалуйста, укажите день недели. Пример: /расписание понедельник';
    
    const schedule = db.data.study_schedule.find(s => s.day === day);
    if (schedule) {
      return `Расписание на ${day}:\n${schedule.tasks.join('\n')}`;
    } else {
      return 'День недели не найден. Используйте: понедельник, вторник, среда, четверг, пятница, суббота, воскресенье.';
    }
  }
  
  if (lowerText.includes('привет')) {
    return 'Привет! Я знакAI. Чем могу помочь? Ты можешь спросить у меня расписание командой /расписание [день].';
  }

  return 'Интересно! Но я пока понимаю только команду /расписание [день].';
}

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
