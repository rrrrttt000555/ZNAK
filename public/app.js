const API_URL = window.location.origin; // Автоматически берем адрес текущего сайта

let currentUser = null;
let translations = {
    'ru': {
        'chats': 'Чаты',
        'groups': 'Группы',
        'channels': 'Каналы',
        'settings': 'Настройки',
        'profile': 'Мой профиль',
        'new_group': 'Создать группу',
        'new_channel': 'Создать канал',
        'admin_panel': 'Админ панель',
        'search': 'Поиск',
        'online': 'в сети',
        'offline': 'не в сети',
        'bot': 'Бот',
        'group': 'Группа',
        'ai': 'Искусственный интеллект',
        'block': 'Заблокировать',
        'unblock': 'Разблокировать',
        'report': 'Пожаловаться',
        'leave': 'Выйти из группы',
        'copy': 'Скопировать',
        'edit': 'Изменить',
        'reply': 'Ответить',
        'forward': 'Переслать',
        'delete': 'Удалить',
        'pin': 'Закрепить',
        'unpin': 'Открепить',
        'save': 'Сохранить',
        'cancel': 'Отмена',
        'loading': 'Загрузка...',
        'no_chat': 'Выберите чат, чтобы начать общение'
    },
    'en': {
        'chats': 'Chats',
        'groups': 'Groups',
        'channels': 'Channels',
        'settings': 'Settings',
        'profile': 'My Profile',
        'new_group': 'New Group',
        'new_channel': 'New Channel',
        'admin_panel': 'Admin Panel',
        'search': 'Search',
        'online': 'online',
        'offline': 'offline',
        'bot': 'Bot',
        'group': 'Group',
        'ai': 'AI Assistant',
        'block': 'Block',
        'unblock': 'Unblock',
        'report': 'Report',
        'leave': 'Leave Group',
        'copy': 'Copy',
        'edit': 'Edit',
        'reply': 'Reply',
        'forward': 'Forward',
        'delete': 'Delete',
        'pin': 'Pin',
        'unpin': 'Unpin',
        'save': 'Save',
        'cancel': 'Cancel',
        'loading': 'Loading...',
        'no_chat': 'Select a chat to start messaging'
    }
};

function t(key) {
    const lang = (currentUser && currentUser.lang) || 'ru';
    return (translations[lang] && translations[lang][key]) || key;
}

let activeChatId = null;
let chats = [];
let messagesInterval = null;
let lastMessageIds = {}; // Track last message ID per chat for notifications
let accounts = JSON.parse(localStorage.getItem('accounts') || '[]');
let currentTab = 'chats';
let searchQuery = '';
let contextMenuMsgId = null;
let replyToMsg = null;
let forwardFromMsg = null;
let isEditing = false;
let selectedMsgIds = new Set();
let isSelectionMode = false;

const notificationSound = new Audio('https://assets.mixkit.co/active_storage/sfx/2358/2358-preview.mp3');

// DOM Elements (fetched inside init to ensure they exist)
let elements = {};

function setLoading(btnId, isLoading) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    if (isLoading) {
        btn.classList.add('btn-loading');
        btn.disabled = true;
    } else {
        btn.classList.remove('btn-loading');
        btn.disabled = false;
    }
}

function getElements() {
    elements = {
        authContainer: document.getElementById('auth-container'),
        appContainer: document.getElementById('app-container'),
        emailStep: document.getElementById('email-step'),
        codeStep: document.getElementById('code-step'),
        registerStep: document.getElementById('register-step'),
        chatList: document.getElementById('chat-list'),
        messageContainer: document.getElementById('message-container'),
        messageInput: document.getElementById('message-input'),
        chatActive: document.querySelector('.chat-active'),
        noChatSelected: document.querySelector('.no-chat-selected'),
        cancelAuthBtn: document.getElementById('cancel-auth-btn'),
        sendBtn: document.getElementById('send-btn'),
        saveEditBtn: document.getElementById('save-edit-btn'),
        themeToggle: document.getElementById('theme-toggle'),
        fontSizeSelect: document.getElementById('font-size-select'),
        langSelect: document.getElementById('lang-select'),
        sideDrawer: document.getElementById('side-drawer'),
        mainMenuBtn: document.getElementById('main-menu-btn'),
        drawerOverlay: document.querySelector('.drawer-overlay'),
        settingsModal: document.getElementById('settings-modal')
    };
}

// Auth Functions
async function sendCode() {
    const email = document.getElementById('email-input').value;
    if (!email) return alert('Введите email');
    
    setLoading('send-code-btn', true);
    try {
        console.log(`Sending code to ${email} via ${API_URL}/api/auth/send-code`);
        const res = await fetch(`${API_URL}/api/auth/send-code`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });
        
        const data = await res.json();
        
        if (!res.ok) {
            throw new Error(data.message || `Ошибка сервера: ${res.status}`);
        }
        
        showToast(`Код отправлен! Проверьте почту.`);
        console.log(`Debug code: ${data.debugCode}`);
        
        elements.emailStep.classList.add('hidden');
        elements.codeStep.classList.remove('hidden');
    } catch (e) {
        console.error('Send code error:', e);
        alert(`Ошибка при отправке кода: ${e.message}`);
    } finally {
        setLoading('send-code-btn', false);
    }
}

async function verifyCode() {
    const email = document.getElementById('email-input').value;
    const code = document.getElementById('code-input').value;
    if (!code) return alert('Введите код');

    setLoading('verify-code-btn', true);
    try {
        const res = await fetch(`${API_URL}/api/auth/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, code })
        });
        
        const data = await res.json();

        if (res.status === 403) {
            if (data.status === 'blocked') {
                showToast(data.message);
                return;
            }
        }

        if (!res.ok) {
            return alert(data.message || 'Ошибка при проверке кода');
        }

        if (data.status === 'new_user') {
            elements.codeStep.classList.add('hidden');
            elements.registerStep.classList.remove('hidden');
        } else if (data.status === 'ok') {
            saveAccount(data.token, data.user);
            login(data.token, data.user);
        } else {
            alert('Неверный код');
        }
    } catch (e) {
        alert('Ошибка при проверке кода');
    } finally {
        setLoading('verify-code-btn', false);
    }
}

async function register() {
    const email = document.getElementById('email-input').value;
    const name = document.getElementById('name-input').value;
    const surname = document.getElementById('surname-input').value;
    const bio = document.getElementById('bio-input').value;
    
    if (!name) return alert('Введите имя');

    setLoading('register-btn', true);
    try {
        const res = await fetch(`${API_URL}/api/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, name, surname, bio })
        });
        
        const data = await res.json();
        if (data.status === 'ok') {
            saveAccount(data.token, data.user);
            login(data.token, data.user);
        }
    } catch (e) {
        alert('Ошибка при регистрации');
    } finally {
        setLoading('register-btn', false);
    }
}

function saveAccount(token, user) {
    const existingIndex = accounts.findIndex(acc => acc.user.id === user.id);
    if (existingIndex !== -1) {
        accounts[existingIndex] = { token, user };
    } else {
        if (accounts.length >= 2) accounts.shift(); // Keep max 2 accounts
        accounts.push({ token, user });
    }
    localStorage.setItem('accounts', JSON.stringify(accounts));
}

function switchAccount(index) {
    const acc = accounts[index];
    localStorage.setItem('token', acc.token);
    // Clear active chat to prevent showing chat from previous account
    activeChatId = null;
    window.location.reload();
}

function renderAccounts() {
    const list = document.getElementById('accounts-list');
    if (!list) return;
    list.innerHTML = accounts.map((acc, index) => `
        <div class="setting-item ${acc.user.id === currentUser.id ? 'active-account' : ''}" onclick="switchAccount(${index})">
            <div style="display: flex; align-items: center; gap: 10px;">
                <div class="chat-avatar" style="width: 32px; height: 32px; font-size: 14px;">${acc.user.avatar || acc.user.name[0]}</div>
                <span>${acc.user.name} ${acc.user.surname || ''}</span>
            </div>
            ${acc.user.id === currentUser.id ? '<i class="fas fa-check" style="color: var(--primary-color)"></i>' : ''}
        </div>
    `).join('');
    
    const addBtn = document.getElementById('add-account-btn');
    if (addBtn) {
        if (accounts.length >= 2) addBtn.classList.add('hidden');
        else addBtn.classList.remove('hidden');
    }
}

function login(token, user) {
    localStorage.setItem('token', token);
    currentUser = user;
    activeChatId = null;
    elements.authContainer.classList.add('hidden');
    elements.appContainer.classList.remove('hidden');
    if (elements.cancelAuthBtn) elements.cancelAuthBtn.classList.add('hidden');
    applyUserSettings(user);
    loadChats();
    requestNotificationPermission();
    
    // Immediate ping on login
    fetch(`${API_URL}/api/user/ping`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
    });

    // Heartbeat for online status
    setInterval(async () => {
        const token = localStorage.getItem('token');
        if (token) {
            try {
                const res = await fetch(`${API_URL}/api/user/ping`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (res.status === 403) {
                    const data = await res.json();
                    if (data && data.status === 'blocked') {
                        document.getElementById('blocked-overlay').classList.remove('hidden');
                    }
                }
            } catch (e) {
                console.error('Heartbeat error:', e);
            }
        }
    }, 20000); // Ping every 20 seconds
}

function logout() {
    accounts = accounts.filter(acc => acc.user.id !== currentUser.id);
    localStorage.setItem('accounts', JSON.stringify(accounts));
    if (accounts.length > 0) switchAccount(0);
    else {
        localStorage.removeItem('token');
        window.location.reload();
    }
}

async function loadChats() {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API_URL}/api/chats`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    chats = await res.json();
    renderChatList();
}

let adminChart = null;

function isOnline(lastSeen) {
    if (!lastSeen || lastSeen === '1970-01-01T00:00:00.000Z') return false;
    const lastSeenDate = new Date(lastSeen);
    const now = new Date();
    // Allow up to 3 minutes difference (heartbeat is 20s) to account for clock drift
    const diff = Math.abs(now - lastSeenDate);
    return diff < 180000; 
}

function formatStatus(lastSeen, userId) {
    if (userId === currentUser.id) return t('online');
    
    if (isOnline(lastSeen)) return t('online');
    if (!lastSeen || lastSeen === '1970-01-01T00:00:00.000Z') return 'Был очень давно';
    
    const lastSeenDate = new Date(lastSeen);
    const now = new Date();
    const diffMs = now - lastSeenDate;
    
    // If lastSeen is in the future (client clock behind server)
    if (diffMs < 0) return t('online');

    const diffMinutes = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    const diffMonths = diffMs / (1000 * 60 * 60 * 24 * 30);
    
    if (diffMonths >= 2) return 'Был очень давно';
    if (diffDays > 0) return `Был ${diffDays} дн. назад`;
    if (diffHours > 0) return `Был ${diffHours} ч. назад`;
    
    return `Был в ${lastSeenDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

async function renderChatList() {
    if (!elements.chatList) return;
    
    // Local filter
    let filteredChats = chats.filter(chat => {
        const name = chat.name || '';
        const username = chat.username || '';
        const matchesSearch = name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                             username.toLowerCase().includes(searchQuery.toLowerCase());
        if (!matchesSearch) return false;
        if (currentTab === 'chats') return true;
        if (currentTab === 'groups') return chat.type === 'group';
        if (currentTab === 'channels') return chat.type === 'channel';
        return true;
    });

    // If query exists and no local results, or to show potential new contacts
    if (searchQuery.length > 0) { // Search even for 1 char if it's @
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_URL}/api/users/search?query=${encodeURIComponent(searchQuery)}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
            const globalUsers = await res.json();
            globalUsers.forEach(u => {
                // Don't add if already in chats or if it's the current user
                const existingChat = chats.find(c => c.type === 'private' && c.members && c.members.includes(u.id));
                if (u.id !== currentUser.id && !existingChat) {
                    // Create a temporary chat object for display
                    filteredChats.push({
                        id: `temp_${u.id}`,
                        name: `${u.name} ${u.surname || ''}`,
                        username: u.username,
                        avatar: u.avatar,
                        type: 'private',
                        isOfficial: u.isOfficial,
                        isTemp: true,
                        members: [currentUser.id, u.id],
                        lastSeen: u.lastSeen
                    });
                }
            });
        }
    }

    elements.chatList.innerHTML = filteredChats.map(chat => {
        let lastMsgText = chat.isTemp ? 'Новый контакт (нажмите, чтобы написать)' : '';
        if (!chat.isTemp) {
            if (chat.id === 'znakAI') lastMsgText = 'Бот-помощник';
            else if (chat.type === 'bot') lastMsgText = 'Бот';
            else if (chat.type === 'group') lastMsgText = 'Групповой чат';
            else if (chat.type === 'channel') lastMsgText = 'Канал';
            else lastMsgText = 'Личное сообщение';
        }

        const modBadge = chat.isOfficial ? '<i class="fas fa-check-circle mod-badge"></i>' : '';
        const onlineStatus = chat.type === 'private' && isOnline(chat.lastSeen) ? '<div class="online-dot"></div>' : '';

        return `
        <div class="chat-item ${activeChatId === chat.id ? 'active' : ''}" onclick="selectChat('${chat.id}', ${chat.isTemp || false})">
            <div class="chat-avatar">
                ${chat.avatar || chat.name[0]}
                ${onlineStatus}
            </div>
            <div class="chat-info-preview">
                <div class="chat-top-row">
                    <span class="chat-name">${chat.name} ${modBadge}</span>
                    <span class="chat-time">${chat.pinned ? '📌' : ''}</span>
                </div>
                <div class="chat-last-msg">${chat.type === 'private' ? formatStatus(chat.lastSeen, chat.members.find(m => m !== currentUser.id)) : lastMsgText}</div>
            </div>
        </div>`;
    }).join('');
}

function showToast(message) {
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `<i class="fas fa-info-circle"></i><span>${message}</span>`;
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.classList.add('hide');
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

async function selectChat(chatId, isTemp = false) {
    // Technical maintenance for znakAI
    if (chatId === 'znakAI') {
        showToast("На данный момент, znakAI на техническом осмотре!");
        return;
    }

    lastMessagesJson = ""; // Сбрасываем кэш сообщений при смене чата
    replyToMsg = null;
    forwardFromMsg = null;
    isEditing = false;
    const preview = document.getElementById('message-action-preview');
    if (preview) preview.classList.add('hidden');
    
    if (isTemp) {
        const targetId = chatId.replace('temp_', '');
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_URL}/api/chats`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ type: 'private', targetId })
        });
        if (res.ok) {
            const newChat = await res.json();
            if (!chats.find(c => c.id === newChat.id)) chats.push(newChat);
            activeChatId = newChat.id;
        } else {
            return alert('Не удалось начать чат');
        }
    } else {
        activeChatId = chatId;
    }

    const chat = chats.find(c => c.id === activeChatId);
    if (!chat) return;
    
    if (elements.noChatSelected) elements.noChatSelected.classList.add('hidden');
    if (elements.chatActive) elements.chatActive.classList.remove('hidden');
    
    const activeName = document.getElementById('active-chat-name');
    const activeAvatar = document.getElementById('active-chat-avatar');
    
    // Force correct name for znakAI
    const chatName = chat.id === 'znakAI' ? 'znakAI' : chat.name;
    if (activeName) activeName.innerText = chatName;
    if (activeAvatar) activeAvatar.innerText = chat.avatar || chatName[0];
    
    const statusEl = document.getElementById('active-chat-status');
    if (statusEl) {
        if (chat.id === 'znakAI') statusEl.innerText = t('ai');
        else if (chat.type === 'bot') statusEl.innerText = t('bot');
        else if (chat.type === 'group') statusEl.innerText = t('group');
        else if (chat.type === 'channel') statusEl.innerText = 'Канал';
        else {
            const otherUserId = chat.members.find(m => m !== currentUser.id);
            statusEl.innerText = formatStatus(chat.lastSeen, otherUserId);
        }
    }
    
    // Check if target user is blocked
    const unblockFooter = document.getElementById('unblock-footer');
    const chatFooter = document.querySelector('.chat-footer');
    
    // In private chats, find the other user's ID
    const otherUserId = (chat.type === 'private' || chat.type === 'bot') ? chat.members.find(m => m !== currentUser?.id) : null;
    const isBlocked = otherUserId && currentUser?.blockedUsers && currentUser.blockedUsers.includes(otherUserId);
    
    if (isBlocked) {
        if (chatFooter) chatFooter.classList.add('hidden');
        if (unblockFooter) unblockFooter.classList.remove('hidden');
        const unblockBtn = document.getElementById('unblock-action-btn');
        if (unblockBtn) unblockBtn.onclick = () => unblockUser(otherUserId);
    } else {
        if (chatFooter) chatFooter.classList.remove('hidden');
        if (unblockFooter) unblockFooter.classList.add('hidden');
    }

    updatePinPanel();
    renderChatList();
    loadMessages();
    
    if (messagesInterval) clearInterval(messagesInterval);
    messagesInterval = setInterval(loadMessages, 3000);

    const sidebar = document.querySelector('.sidebar');
    if (window.innerWidth <= 768 && sidebar) sidebar.classList.add('collapsed');
}

let userCache = {}; // Кэш для пользователей, чтобы не запрашивать их постоянно

let lastMessagesJson = ""; // Храним слепок последних сообщений

async function loadMessages() {
    if (!activeChatId) return;
    const token = localStorage.getItem('token');
    
    try {
        const res = await fetch(`${API_URL}/api/messages/${activeChatId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (res.status === 503) return;
        
        const messages = await res.json();
        const currentJson = JSON.stringify(messages);
        
        // Если сообщения не изменились, ничего не перерисовываем!
        if (currentJson === lastMessagesJson) {
            return;
        }
        lastMessagesJson = currentJson;

        // Загружаем кэш пользователей только если его нет
        if (Object.keys(userCache).length === 0) {
            const usersRes = await fetch(`${API_URL}/api/admin/users`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (usersRes.ok) {
                const allUsers = await usersRes.json();
                allUsers.forEach(u => userCache[u.id] = u);
            }
        }

        const needsReadUpdate = messages.some(m => m.senderId !== currentUser.id && (!m.readBy || !m.readBy.includes(currentUser.id)));
        if (needsReadUpdate) {
            const unreadIds = messages.filter(m => m.senderId !== currentUser.id && (!m.readBy || !m.readBy.includes(currentUser.id))).map(m => m.id);
            if (unreadIds.length > 0) {
                fetch(`${API_URL}/api/messages/read`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify({ messageIds: unreadIds })
                });
            }
        }

        if (messages.length > 0) {
            const latestMsg = messages[messages.length - 1];
            const lastKnownId = lastMessageIds[activeChatId];
            if (lastKnownId && latestMsg.id !== lastKnownId && latestMsg.senderId !== currentUser.id) notifyNewMessage(latestMsg);
            lastMessageIds[activeChatId] = latestMsg.id;
        }
        
        messages.forEach(m => { m.read = m.readBy && m.readBy.length > 1; });
        renderMessages(messages, userCache);
    } catch (e) {
        console.error('Load messages error:', e);
    }
}

function notifyNewMessage(msg) {
    const chat = chats.find(c => c.id === msg.chatId);
    notificationSound.play().catch(e => console.log('Sound failed:', e));
    if (Notification.permission === 'granted') {
        const n = new Notification(chat ? chat.name : 'Новое сообщение', { 
            body: msg.text || 'Файл',
            icon: '/favicon.ico'
        });
        n.onclick = () => {
            window.focus();
            if (chat) selectChat(chat.id);
        };
    }
}

function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission !== 'granted' && Notification.permission !== 'denied') {
        Notification.requestPermission();
    }
}

function renderMessages(messages, userMap = {}) {
    if (!elements.messageContainer) return;
    const container = elements.messageContainer;
    const isAtBottom = container.scrollHeight - container.scrollTop <= container.clientHeight + 100;
    const chat = chats.find(c => c.id === activeChatId);

    container.innerHTML = messages.map(m => {
        const isOut = m.senderId === currentUser?.id;
        let sender = userMap[m.senderId] || (isOut ? currentUser : { name: 'User', avatar: '👤' });
        
        // Ensure sender exists
        if (!sender) sender = { name: 'User', avatar: '👤' };

        // Force bot name
        if (m.senderId === 'znakAI') {
            sender = { name: 'znakAI', avatar: '🤖', isOfficial: true };
        }

        let statusHtml = '';
        if (isOut) {
            if (m.sending) statusHtml = '<i class="far fa-clock message-status"></i>';
            else if (m.read) statusHtml = '<i class="fas fa-check-double message-status"></i>';
            else statusHtml = '<i class="fas fa-check message-status"></i>';
        }

        const replyHtml = m.replyTo ? `<div class="reply-preview"><span>${m.replyTo.senderName}</span><p>${m.replyTo.text}</p></div>` : '';
        const forwardHtml = m.forwardFrom ? `<div class="forward-preview" style="color: #4caf50; font-size: 12px; margin-bottom: 4px;"><i class="fas fa-share"></i> Переслано от <b>${m.forwardFrom.senderName}</b></div>` : '';
        const isSelected = selectedMsgIds.has(m.id);
        
        const modBadge = sender.isOfficial ? '<i class="fas fa-check-circle mod-badge"></i>' : '';
        const betaBadge = sender.isBetaTester ? '<i class="fas fa-check-circle beta-badge" style="color: #9c27b0"></i>' : '';

        let contentHtml = m.text;
        if (m.fileName) {
            if (m.fileData && m.fileData.startsWith('data:image')) {
                contentHtml = `<img src="${m.fileData}" class="message-image" style="max-width: 100%; border-radius: 8px; cursor: pointer;" onclick="window.open('${m.fileData}')">`;
            } else {
                contentHtml = `<div class="file-box"><i class="fas fa-file"></i><div class="file-info"><span>${m.fileName}</span>${m.uploading ? `<div class="progress-container"><div class="progress-bar" style="width: ${m.progress}%"></div></div>` : `<a href="${m.fileData}" download="${m.fileName}">Скачать</a>`}</div></div>`;
            }
        }

        return `
        <div class="message ${isOut ? 'out' : 'in'} ${isSelected ? 'selected' : ''}" 
             data-id="${m.id}" data-sender-id="${m.senderId}" onclick="handleMessageClick(event, '${m.id}')" oncontextmenu="showContextMenu(event, '${m.id}')">
            <div class="message-avatar" onclick="showUserProfile('${m.senderId}')">${sender.avatar || (sender.name ? sender.name[0] : '?')}</div>
            <div class="message-content-wrapper">
                ${!isOut && chat && (chat.type === 'group' || chat.type === 'channel') ? `<div class="message-sender-name" onclick="showUserProfile('${m.senderId}')">${sender.name} ${sender.surname || ''} ${modBadge}${betaBadge}</div>` : ''}
                <div class="message-bubble">
                    ${replyHtml}${forwardHtml}
                    <div class="message-text">
                        ${contentHtml}
                    </div>
                    <div class="message-time">
                        ${m.isEdited ? '<i class="fas fa-pencil-alt"></i>' : ''}${new Date(m.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        ${statusHtml}
                    </div>
                </div>
            </div>
        </div>`
    }).join('');

    if (isAtBottom) container.scrollTop = container.scrollHeight;
}

function handleMessageClick(e, msgId) {
    if (!isSelectionMode) return;
    if (selectedMsgIds.has(msgId)) selectedMsgIds.delete(msgId);
    else selectedMsgIds.add(msgId);
    if (selectedMsgIds.size === 0) cancelSelection();
    else updateSelectionUI();
    loadMessages();
}

function updateSelectionUI() {
    document.querySelectorAll('.sel-count').forEach(el => el.innerText = selectedMsgIds.size);
}

function cancelSelection() {
    isSelectionMode = false;
    selectedMsgIds.clear();
    document.getElementById('normal-header').classList.remove('hidden');
    document.getElementById('selection-header').classList.add('hidden');
    loadMessages();
}

function showContextMenu(e, msgId) {
    e.preventDefault();
    contextMenuMsgId = msgId;
    const menu = document.getElementById('context-menu');
    if (!menu) return;
    
    menu.classList.remove('hidden');
    menu.style.top = `${e.clientY}px`;
    menu.style.left = `${e.clientX}px`;
    
    if (e.clientY + menu.offsetHeight > window.innerHeight) {
        menu.style.top = `${e.clientY - menu.offsetHeight}px`;
    }
    
    const chat = chats.find(c => c.id === activeChatId);
    if (chat) {
        const pinText = menu.querySelector('[data-action="pin"] span');
        if (pinText) pinText.innerText = chat.pinnedMsgId === msgId ? 'Открепить' : 'Закрепить';
    }

    // Hide report for bot messages
    const reportItem = menu.querySelector('[data-action="report"]');
    const deleteItem = menu.querySelector('[data-action="delete"]');
    
    if (reportItem || deleteItem) {
        const msgEl = document.querySelector(`.message[data-id="${msgId}"]`);
        const senderId = msgEl ? msgEl.getAttribute('data-sender-id') : null;
        
        if (senderId === 'znakAI') {
            if (reportItem) reportItem.classList.add('hidden');
            // User shouldn't be able to delete bot's message "for everyone", 
            // but they can delete it for themselves. The delete modal handles this.
        } else {
            if (reportItem) reportItem.classList.remove('hidden');
        }
    }
}

function setupReply(msg) {
    replyToMsg = msg;
    isEditing = false;
    const preview = document.getElementById('message-action-preview');
    document.getElementById('preview-title').innerText = `В ответ ${msg.senderId === currentUser.id ? 'вам' : 'пользователю'}`;
    document.getElementById('preview-body').innerText = msg.text || 'Файл';
    document.getElementById('preview-icon').className = 'fas fa-reply';
    preview.classList.remove('hidden');
    elements.messageInput.focus();
}

function setupEdit(msg) {
    if (msg.senderId !== currentUser.id) return alert('Можно редактировать только свои сообщения');
    isEditing = true;
    replyToMsg = msg;
    elements.messageInput.value = msg.text;
    const preview = document.getElementById('message-action-preview');
    document.getElementById('preview-title').innerText = 'Редактирование';
    document.getElementById('preview-body').innerText = msg.text;
    document.getElementById('preview-icon').className = 'fas fa-pencil-alt';
    preview.classList.remove('hidden');
    elements.sendBtn.classList.add('hidden');
    elements.saveEditBtn.classList.remove('hidden');
    elements.messageInput.focus();
}

function startSelection(msgId) {
    isSelectionMode = true;
    selectedMsgIds.add(msgId);
    document.getElementById('normal-header').classList.add('hidden');
    document.getElementById('selection-header').classList.remove('hidden');
    updateSelectionUI();
    loadMessages();
}

async function togglePin(msgId) {
    const token = localStorage.getItem('token');
    const chat = chats.find(c => c.id === activeChatId);
    const newPinId = chat.pinnedMsgId === msgId ? null : msgId;
    await fetch(`${API_URL}/api/chats/${activeChatId}/pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ msgId: newPinId })
    });
    chat.pinnedMsgId = newPinId;
    if (newPinId) {
        const res = await fetch(`${API_URL}/api/messages/${activeChatId}`, { headers: { 'Authorization': `Bearer ${token}` } });
        const msgs = await res.json();
        const msg = msgs.find(m => m.id === newPinId);
        document.getElementById('pin-msg-preview').innerText = msg ? msg.text : 'Сообщение';
    }
    updatePinPanel();
}

function updatePinPanel() {
    const chat = chats.find(c => c.id === activeChatId);
    const panel = document.getElementById('pin-panel');
    if (chat && chat.pinnedMsgId) panel.classList.remove('hidden');
    else panel.classList.add('hidden');
}

function showForwardList(msg) {
    forwardFromMsg = { senderName: msg.senderId === currentUser.id ? 'Вы' : 'Собеседник', text: msg.text || 'Файл' };
    const modal = document.getElementById('forward-modal');
    const list = document.getElementById('forward-chat-list');
    list.innerHTML = chats.map(chat => `<div class="chat-item" onclick="forwardToChat('${chat.id}')"><div class="chat-avatar">${chat.avatar || chat.name[0]}</div><div class="chat-name">${chat.name}</div></div>`).join('');
    modal.classList.remove('hidden');
}

function forwardToChat(chatId) {
    document.getElementById('forward-modal').classList.add('hidden');
    selectChat(chatId);
    const preview = document.getElementById('message-action-preview');
    document.getElementById('preview-title').innerText = `Переслать от ${forwardFromMsg.senderName}`;
    document.getElementById('preview-body').innerText = forwardFromMsg.text;
    document.getElementById('preview-icon').className = 'fas fa-share';
    preview.classList.remove('hidden');
    elements.messageInput.focus();
}

async function leaveGroup() {
    if (!activeChatId) return;
    const chat = chats.find(c => c.id === activeChatId);
    if (!chat || (chat.type !== 'group' && chat.type !== 'channel')) return;
    
    if (confirm(t('leave') + '?')) {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_URL}/api/chats/${activeChatId}/leave`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (res.ok) {
            chats = chats.filter(c => c.id !== activeChatId);
            activeChatId = null;
            elements.chatActive.classList.add('hidden');
            elements.noChatSelected.classList.remove('hidden');
            const infoModal = document.getElementById('chat-info-modal');
            if (infoModal) infoModal.classList.add('hidden');
            renderChatList();
            showSuccess(t('leave'));
        }
    }
}

let uploadIntervals = {};
let lastMessages = [];

function updateFileUploadUI(msgId, progress) {
    const msgEl = document.querySelector(`.message[data-id="${msgId}"]`);
    if (msgEl) {
        const circle = msgEl.querySelector('.progress-ring-circle');
        if (circle) {
            const radius = 18;
            const circumference = 2 * Math.PI * radius;
            const offset = circumference - (progress / 100) * circumference;
            circle.style.strokeDashoffset = offset;
        }
    }
}

function cancelUpload(msgId) {
    if (uploadIntervals[msgId]) {
        clearInterval(uploadIntervals[msgId]);
        delete uploadIntervals[msgId];
        loadMessages();
    }
}

async function sendMessage(fileInfo = null) {
    const text = elements.messageInput.value.trim();
    if (!text && !fileInfo && !forwardFromMsg) return;

    const chat = chats.find(c => c.id === activeChatId);
    if (chat && chat.type === 'channel' && chat.ownerId !== currentUser.id) {
        alert('Только владелец может писать в этом канале');
        return;
    }

    const token = localStorage.getItem('token');
    
    if (isEditing && replyToMsg) {
        await fetch(`${API_URL}/api/messages/${replyToMsg.id}`, { 
            method: 'PUT', 
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, 
            body: JSON.stringify({ text }) 
        });
        isEditing = false; 
        replyToMsg = null;
        document.getElementById('message-action-preview').classList.add('hidden');
        elements.sendBtn.classList.remove('hidden');
        elements.saveEditBtn.classList.add('hidden');
        elements.messageInput.value = ''; 
        loadMessages(); 
        return;
    }

    const body = { 
        chatId: activeChatId, 
        text, 
        replyTo: replyToMsg ? { msgId: replyToMsg.id, text: replyToMsg.text, senderName: replyToMsg.senderId === currentUser.id ? 'Вы' : 'Собеседник' } : null, 
        forwardFrom: forwardFromMsg ? { senderName: forwardFromMsg.senderName, text: forwardFromMsg.text } : null 
    };
    
    elements.messageInput.value = '';
    replyToMsg = null; 
    forwardFromMsg = null;
    document.getElementById('message-action-preview').classList.add('hidden');

    if (fileInfo) {
        // Handle file upload with progress
        const progressBar = document.getElementById('upload-progress-bar');
        const progressContainer = document.getElementById('upload-progress-container');
        if (progressContainer) progressContainer.style.display = 'block';
        if (progressBar) progressBar.style.width = '0%';

        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${API_URL}/api/messages`);
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        xhr.setRequestHeader('Content-Type', 'application/json');

        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
                const percent = (e.loaded / e.total) * 100;
                if (progressBar) progressBar.style.width = percent + '%';
            }
        };

        xhr.onload = () => {
            if (progressContainer) progressContainer.style.display = 'none';
            if (xhr.status === 200 || xhr.status === 201) {
                loadMessages();
            } else {
                alert('Ошибка загрузки файла');
            }
        };

        xhr.onerror = () => {
            if (progressContainer) progressContainer.style.display = 'none';
            alert('Ошибка сети при загрузке');
        };

        xhr.send(JSON.stringify({
            ...body,
            fileData: fileInfo.data,
            fileName: fileInfo.name
        }));
    } else {
        await sendToServer(body, token);
    }
}

async function sendToServer(body, token) {
    const res = await fetch(`${API_URL}/api/messages`, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, 
        body: JSON.stringify(body) 
    });
    if (res.ok) {
        const msg = await res.json();
        if (msg.chatId === 'znakAI') setTimeout(loadMessages, 1000);
        loadMessages();
    } else {
        const err = await res.json();
        alert(err.message || 'Ошибка при отправке сообщения');
    }
}

async function deleteMessage(mode) {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API_URL}/api/messages/${contextMenuMsgId}?mode=${mode}`, { 
        method: 'DELETE', 
        headers: { 'Authorization': `Bearer ${token}` } 
    });
    
    if (res.ok) {
        document.getElementById('delete-modal').classList.add('hidden');
        loadMessages();
    } else {
        const error = await res.json();
        alert(error.message || 'Не удалось удалить сообщение');
    }
}

function applyUserSettings(user) {
    document.body.className = user.theme === 'dark' ? 'dark-theme' : 'light-theme';
    document.body.classList.add(`font-${user.fontSize || 'medium'}`);
    
    // Update translations on change
    const lang = user.lang || 'ru';
    document.querySelectorAll('[data-t]').forEach(el => {
        const key = el.getAttribute('data-t');
        el.innerText = t(key);
    });
    
    // Update inputs placeholders
    const searchInput = document.getElementById('search-input');
    if (searchInput) searchInput.placeholder = t('search');
    
    const modBadge = user.isOfficial ? '<i class="fas fa-check-circle mod-badge"></i>' : '';
    const betaBadge = user.isBetaTester ? '<i class="fas fa-check-circle beta-badge" style="color: #9c27b0"></i>' : '';
    const nameEl = document.getElementById('settings-name-full');
    if (nameEl) nameEl.innerHTML = `${user.name} ${user.surname || ''} ${modBadge}${betaBadge}`;
    
    const bioEl = document.getElementById('settings-bio');
    if (bioEl) bioEl.innerText = user.bio || 'Нет информации';
    
    const avatarEl = document.getElementById('settings-avatar');
    if (avatarEl) avatarEl.innerText = user.avatar || user.name[0];
    
    // Update sidebar items manually if they don't use data-t
    const profileText = document.querySelector('#drawer-profile span');
    if (profileText) profileText.innerText = t('profile');
    const groupText = document.querySelector('#drawer-new-group span');
    if (groupText) groupText.innerText = t('new_group');
    const channelText = document.querySelector('#drawer-new-channel span');
    if (channelText) channelText.innerText = t('new_channel');
    const settingsText = document.querySelector('#drawer-settings span');
    if (settingsText) settingsText.innerText = t('settings');
    const adminText = document.querySelector('#drawer-admin span');
    if (adminText) adminText.innerText = t('admin_panel');

    // Add/Update username display in settings
    const profilePreview = document.querySelector('.profile-preview');
    if (profilePreview && user.username) {
        let usernameDiv = profilePreview.querySelector('.settings-username-display');
        if (!usernameDiv) {
            usernameDiv = document.createElement('div');
            usernameDiv.className = 'username-link settings-username-display';
            usernameDiv.style.marginBottom = '8px';
            const bio = document.getElementById('settings-bio');
            if (bio) bio.parentNode.insertBefore(usernameDiv, bio);
        }
        usernameDiv.innerText = user.username;
        usernameDiv.onclick = () => {
            navigator.clipboard.writeText(user.username);
            alert('Username скопирован!');
        };
    }

    if (elements.themeToggle) elements.themeToggle.checked = user.theme === 'dark';
    if (elements.fontSizeSelect) elements.fontSizeSelect.value = user.fontSize || 'medium';
    if (elements.langSelect) elements.langSelect.value = user.lang || 'ru';
    
    // Admin drawer item
    const adminDrawer = document.getElementById('drawer-admin');
    if (adminDrawer) {
        if (user.isModerator || user.isBetaTester) adminDrawer.classList.remove('hidden');
        else adminDrawer.classList.add('hidden');
    }

    renderAccounts();
}

async function renderGroupMembers(chat) {
    const list = document.getElementById('group-members-list');
    if (!list) return;
    
    const token = localStorage.getItem('token');
    const res = await fetch(`${API_URL}/api/admin/users`, { headers: { 'Authorization': `Bearer ${token}` } });
    if (res.ok) {
        const allUsers = await res.json();
        const members = allUsers.filter(u => chat.members.includes(u.id));
        
        list.innerHTML = '<h4>Участники</h4>' + members.map(m => `
            <div class="setting-item" onclick="window.showUserProfile('${m.id}')">
                <div style="display: flex; align-items: center; gap: 10px;">
                    <div class="chat-avatar" style="width: 32px; height: 32px; font-size: 14px;">${m.avatar || m.name[0]}</div>
                    <span>${m.name} ${m.surname || ''} ${m.id === chat.ownerId ? '<small>(Владелец)</small>' : ''}</span>
                </div>
            </div>
        `).join('');
    }
}

function openAddMember(chat) {
    const modal = document.getElementById('add-member-modal');
    modal.classList.remove('hidden');
    document.getElementById('chat-info-modal').classList.add('hidden');
    
    const input = document.getElementById('member-search-input');
    const results = document.getElementById('member-search-results');
    results.innerHTML = '';
    input.value = '';
    
    input.oninput = async () => {
        const query = input.value.trim();
        if (query.length < 2) { results.innerHTML = ''; return; }
        
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_URL}/api/users/search-all?query=${encodeURIComponent(query)}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
            const users = await res.json();
            results.innerHTML = users.map(u => `
                <div class="chat-item" onclick="addMemberToGroup('${chat.id}', '${u.id}')">
                    <div class="chat-avatar">${u.avatar || u.name[0]}</div>
                    <div class="chat-info-preview">
                        <span class="chat-name">${u.name} ${u.surname || ''}</span>
                        <div class="chat-last-msg">${u.username || ''}</div>
                    </div>
                </div>
            `).join('');
        }
    };
}

async function addMemberToGroup(chatId, userId) {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API_URL}/api/chats/${chatId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ userId })
    });
    if (res.ok) {
        document.getElementById('add-member-modal').classList.add('hidden');
        showSuccess('Пользователь добавлен');
        loadChats();
    } else {
        const data = await res.json();
        alert(data.message || 'Ошибка при добавлени');
    }
}

function openDeleteAccount() {
    document.getElementById('delete-account-modal').classList.remove('hidden');
    document.getElementById('settings-modal').classList.add('hidden');
}

async function confirmDeleteAccount() {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API_URL}/api/user/me`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
        localStorage.removeItem('token');
        accounts = accounts.filter(acc => acc.user.id !== currentUser.id);
        localStorage.setItem('accounts', JSON.stringify(accounts));
        window.location.reload();
    } else {
        alert('Ошибка при удалении аккаунта');
    }
}

async function updateSettings() {
    const theme = elements.themeToggle.checked ? 'dark' : 'light';
    const fontSize = elements.fontSizeSelect.value;
    const lang = elements.langSelect.value;
    const token = localStorage.getItem('token');
    const res = await fetch(`${API_URL}/api/user/me`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ theme, fontSize, lang }) });
    currentUser = await res.json(); applyUserSettings(currentUser);
}

async function checkUsername(username) {
    if (!username) return { available: true };
    if (!username.startsWith('@')) username = '@' + username;
    const token = localStorage.getItem('token');
    const res = await fetch(`${API_URL}/api/users/check-username?username=${encodeURIComponent(username)}`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    return await res.json();
}

async function saveProfile() {
    const name = document.getElementById('edit-name').value;
    const surname = document.getElementById('edit-surname').value;
    let username = document.getElementById('edit-username').value.trim();
    const bio = document.getElementById('edit-bio').value;
    const token = localStorage.getItem('token');

    if (username && !username.startsWith('@')) username = '@' + username;

    const res = await fetch(`${API_URL}/api/user/me`, { 
        method: 'PUT', 
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, 
        body: JSON.stringify({ name, surname, username, bio }) 
    });
    
    if (res.ok) {
        currentUser = await res.json(); 
        applyUserSettings(currentUser);
        document.getElementById('edit-profile-modal').classList.add('hidden');
        const errorEl = document.getElementById('username-error');
        const suggestionsEl = document.getElementById('username-suggestions');
        if (errorEl) errorEl.classList.add('hidden');
        if (suggestionsEl) suggestionsEl.classList.add('hidden');
    } else {
        const data = await res.json();
        const errorEl = document.getElementById('username-error');
        const suggestionsEl = document.getElementById('username-suggestions');
        if (errorEl) {
            errorEl.innerText = data.message;
            errorEl.classList.remove('hidden');
        }
        if (suggestionsEl && data.suggestions) {
            suggestionsEl.innerHTML = data.suggestions.map(s => `<div class="suggestion-item" onclick="selectSuggestion('${s}')">${s}</div>`).join('');
            suggestionsEl.classList.remove('hidden');
        }
    }
}

function selectSuggestion(s) {
    const input = document.getElementById('edit-username');
    if (input) {
        input.value = s;
        const errorEl = document.getElementById('username-error');
        const suggestionsEl = document.getElementById('username-suggestions');
        if (errorEl) errorEl.classList.add('hidden');
        if (suggestionsEl) suggestionsEl.classList.add('hidden');
    }
}

async function showUserProfile(userId) {
    if (userId === 'znakAI') {
        const botChat = chats.find(c => c.id === 'znakAI');
        if (botChat) return showChatInfo(botChat);
    }
    const token = localStorage.getItem('token');
    const res = await fetch(`${API_URL}/api/admin/users`, { headers: { 'Authorization': `Bearer ${token}` } });
    if (!res.ok) return;
    
    const users = await res.json();
    const user = users.find(u => u.id === userId);
    if (!user) return;

    const infoName = document.getElementById('info-name');
    const infoDesc = document.getElementById('info-description');
    const infoAvatar = document.getElementById('info-avatar');
    const infoStatus = document.getElementById('info-status');
    
    reportedTargetId = user.id;
    
    const modBadge = user.isOfficial ? '<i class="fas fa-check-circle mod-badge"></i>' : '';
    const betaBadge = user.isBetaTester ? '<i class="fas fa-check-circle beta-badge" style="color: #9c27b0"></i>' : '';
    
    infoName.innerHTML = `${user.name} ${user.surname || ''} ${modBadge}${betaBadge}`;
    document.getElementById('info-modal-title').innerText = 'Профиль';
    infoAvatar.innerText = user.avatar || user.name[0];
    infoStatus.innerText = formatStatus(user.lastSeen, user.id);
    
    let description = '';
    if (user.username) {
        description = `<div class="username-link" onclick="navigator.clipboard.writeText('${user.username}'); alert('Скопировано!')">${user.username}</div><br>`;
    }
    description += user.bio || 'Нет описания';
    infoDesc.innerHTML = description;
    
    const stats = document.getElementById('group-stats');
    const userActions = document.getElementById('user-actions');
    const leaveBtn = document.getElementById('leave-group-btn');
    const chatAdminActions = document.getElementById('chat-admin-actions');
    
    if (stats) stats.classList.add('hidden');
    if (userActions) {
        if (user.id === currentUser.id) userActions.classList.add('hidden');
        else userActions.classList.remove('hidden');
    }
    if (leaveBtn) leaveBtn.classList.add('hidden');
    if (chatAdminActions) chatAdminActions.classList.add('hidden');
    
    // Block button logic
    const blockBtn = document.getElementById('block-user-btn');
    const reportBtn = document.getElementById('report-user-btn');
    const isBlocked = currentUser.blockedUsers && currentUser.blockedUsers.includes(user.id);
    
    if (blockBtn) {
        if (user.id === 'znakAI' || user.id === '1779451744698') {
            blockBtn.classList.add('hidden');
        } else {
            blockBtn.classList.remove('hidden');
            blockBtn.innerText = isBlocked ? t('unblock') : t('block');
            blockBtn.onclick = () => isBlocked ? unblockUser(user.id) : blockUser(user.id);
        }
    }
    
    if (reportBtn) {
        if (user.id === 'znakAI' || user.id === '1779451744698') {
            reportBtn.classList.add('hidden');
        } else {
            reportBtn.classList.remove('hidden');
        }
    }
    
    document.getElementById('chat-info-modal').classList.remove('hidden');
}
window.showUserProfile = showUserProfile;

async function showChatInfo(chat) {
    const infoName = document.getElementById('info-name');
    const infoDesc = document.getElementById('info-description');
    const infoAvatar = document.getElementById('info-avatar');
    const infoStatus = document.getElementById('info-status');
    
    // Get target user info if private chat
    let targetUser = null;
    reportedTargetId = null; // Reset
    
    if (chat.type === 'private' || chat.type === 'bot') {
        const token = localStorage.getItem('token');
        const otherUserId = chat.members.find(m => m !== currentUser?.id);
        reportedTargetId = otherUserId; // Set for potential profile report
        
        if (otherUserId === 'znakAI') {
            targetUser = { id: 'znakAI', name: 'znakAI', avatar: '🤖', bio: 'Ваш личный ИИ-помощник', type: 'bot' };
        } else {
            const res = await fetch(`${API_URL}/api/users/${otherUserId}`, { headers: { 'Authorization': `Bearer ${token}` } });
            if (res.ok) targetUser = await res.json();
        }
    }

    const modBadge = (targetUser && targetUser.isOfficial) ? '<i class="fas fa-check-circle mod-badge"></i>' : '';
    const betaBadge = (targetUser && targetUser.isBetaTester) ? '<i class="fas fa-check-circle beta-badge" style="color: #9c27b0"></i>' : '';
    
    infoName.innerHTML = `${chat.name} ${modBadge}${betaBadge}`;
    document.getElementById('info-modal-title').innerText = (chat.type === 'group' || chat.type === 'channel') ? (chat.type === 'group' ? 'О группе' : 'О канале') : 'Профиль';
    infoAvatar.innerText = chat.avatar || chat.name[0];
    
    if (chat.type === 'private' && targetUser) {
        infoStatus.innerText = formatStatus(targetUser.lastSeen, targetUser.id);
    } else {
        infoStatus.innerText = chat.id === 'znakAI' ? t('ai') : (chat.type === 'bot' ? t('bot') : (chat.type === 'group' ? t('group') : 'Канал'));
    }
    
    let description = chat.description || 'Нет описания';
    if (targetUser && targetUser.username) {
        description = `<div class="username-link" onclick="navigator.clipboard.writeText('${targetUser.username}'); alert('Скопировано!')">${targetUser.username}</div><br>` + (targetUser.bio || 'Нет описания');
    }
    infoDesc.innerHTML = description;
    
    const stats = document.getElementById('group-stats');
    const userActions = document.getElementById('user-actions');
    const leaveBtn = document.getElementById('leave-group-btn');
    const chatAdminActions = document.getElementById('chat-admin-actions');
    
    if (chat.type === 'group' || chat.type === 'channel') {
        if (stats) stats.classList.remove('hidden');
        if (userActions) userActions.classList.add('hidden');
        if (leaveBtn) leaveBtn.classList.remove('hidden');
        document.getElementById('info-members-count').innerText = chat.members.length;
        
        // Show members list
        renderGroupMembers(chat);
        
        // Admin actions for owner
        if (chat.ownerId === currentUser.id) {
            if (chatAdminActions) {
                chatAdminActions.classList.remove('hidden');
                document.getElementById('edit-chat-btn').onclick = () => openEditChat(chat);
                document.getElementById('delete-chat-btn').onclick = () => openDeleteChat(chat);
            }
            const addMemberSection = document.getElementById('add-member-section');
            if (addMemberSection) {
                addMemberSection.classList.remove('hidden');
                document.getElementById('open-add-member-btn').onclick = () => openAddMember(chat);
            }
        } else {
            if (chatAdminActions) chatAdminActions.classList.add('hidden');
            const addMemberSection = document.getElementById('add-member-section');
            if (addMemberSection) addMemberSection.classList.add('hidden');
        }
    } else {
        if (stats) stats.classList.add('hidden');
        if (userActions) userActions.classList.remove('hidden');
        if (leaveBtn) leaveBtn.classList.add('hidden');
        if (chatAdminActions) chatAdminActions.classList.add('hidden');
        
        // Block button logic
        if (targetUser) {
            const blockBtn = document.getElementById('block-user-btn');
            const reportBtn = document.getElementById('report-user-btn');
            const isBlocked = currentUser.blockedUsers && currentUser.blockedUsers.includes(targetUser.id);
            
            if (blockBtn) {
                if (targetUser.id === 'znakAI' || targetUser.id === '1779451744698') {
                    blockBtn.classList.add('hidden');
                } else {
                    blockBtn.classList.remove('hidden');
                    blockBtn.innerText = isBlocked ? t('unblock') : t('block');
                    blockBtn.onclick = () => isBlocked ? unblockUser(targetUser.id) : blockUser(targetUser.id);
                }
            }

            if (reportBtn) {
                if (targetUser.id === 'znakAI' || targetUser.id === '1779451744698') {
                    reportBtn.classList.add('hidden');
                } else {
                    reportBtn.classList.remove('hidden');
                }
            }
        }
        
        const reportBtn = document.getElementById('report-user-btn');
        if (reportBtn && (!targetUser || (targetUser.id !== 'znakAI' && targetUser.id !== '1779451744698'))) {
            reportBtn.onclick = () => {
                document.getElementById('chat-info-modal').classList.add('hidden');
                document.getElementById('reported-message-preview').classList.add('hidden');
                document.getElementById('report-modal').classList.remove('hidden');
            };
        }
    }
    
    document.getElementById('chat-info-modal').classList.remove('hidden');
}
window.showChatInfo = showChatInfo;

function showSuccess(text) {
    const overlay = document.getElementById('success-overlay');
    const textEl = document.getElementById('success-text');
    if (overlay && textEl) {
        textEl.innerText = text;
        overlay.classList.remove('hidden');
        setTimeout(() => overlay.classList.add('hidden'), 2000);
    }
}

async function blockUser(targetId) {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API_URL}/api/users/block/${targetId}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
        const data = await res.json();
        currentUser.blockedUsers = data.blockedUsers;
        selectChat(activeChatId);
        document.getElementById('chat-info-modal').classList.add('hidden');
        showSuccess('Пользователь заблокирован');
    }
}

async function unblockUser(targetId) {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API_URL}/api/users/unblock/${targetId}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
        const data = await res.json();
        currentUser.blockedUsers = data.blockedUsers;
        selectChat(activeChatId);
        showSuccess('Пользователь разблокирован');
    }
}

let reportedTargetId = null;

async function sendReport() {
    console.log('sendReport function started');
    const reasonInput = document.getElementById('report-reason');
    if (!reasonInput) {
        console.error('report-reason element not found');
        return;
    }
    const reason = reasonInput.value.trim();
    if (!reason) return alert('Пожалуйста, опишите причину');
    
    const token = localStorage.getItem('token');
    const chat = chats.find(c => c.id === activeChatId);
    
    let targetId = reportedTargetId;
    console.log('Initial targetId:', targetId);
    
    // Fallback if no specific target is set (e.g. reporting from profile)
    if (!targetId && chat && (chat.type === 'private' || chat.type === 'bot')) {
        targetId = chat.members.find(m => m !== currentUser.id);
        console.log('Fallback targetId from chat members:', targetId);
    }

    if (!targetId) {
        console.error('No targetId found for report');
        return alert('Не удалось определить пользователя для жалобы. Попробуйте нажать на сообщение и выбрать "Пожаловаться".');
    }
    
    console.log('Sending report to server:', { targetId, reason });
    const res = await fetch(`${API_URL}/api/reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ targetId, reason })
    });
    
    if (res.ok) {
        console.log('Report sent successfully');
        document.getElementById('report-modal').classList.add('hidden');
        reasonInput.value = '';
        document.getElementById('reported-message-preview').classList.add('hidden');
        reportedTargetId = null;
        showSuccess('Спасибо за жалобу. Наши модераторы рассмотрят заявку при первом возможности');
    } else {
        console.error('Failed to send report:', res.status);
        alert('Ошибка при отправке жалобы');
    }
}

async function getMsgSenderId(msgId) {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API_URL}/api/messages/${activeChatId}`, { headers: { 'Authorization': `Bearer ${token}` } });
    if (res.ok) {
        const msgs = await res.json();
        const m = msgs.find(msg => msg.id === msgId);
        return m ? m.senderId : null;
    }
    return null;
}

// Admin Logic
async function loadAdminStats() {
    console.log('Loading admin stats...');
    const token = localStorage.getItem('token');
    const res = await fetch(`${API_URL}/api/admin/stats`, { headers: { 'Authorization': `Bearer ${token}` } });
    if (res.ok) {
        const stats = await res.json();
        console.log('Stats received:', stats);
        document.getElementById('admin-stats-grid').innerHTML = `
            <div class="stat-card"><h3>${stats.totalUsers}</h3><p>Пользователей</p></div>
            <div class="stat-card"><h3>${stats.totalChats}</h3><p>Чатов</p></div>
            <div class="stat-card"><h3>${stats.totalMessages}</h3><p>Сообщений</p></div>
            <div class="stat-card"><h3>${stats.pendingReports}</h3><p>Жалоб</p></div>
        `;

        // Render Chart
        const ctx = document.getElementById('admin-stats-chart');
        if (ctx && stats.chartData) {
            console.log('Rendering chart with data:', stats.chartData);
            if (adminChart) adminChart.destroy();
            
            const render = () => {
                if (typeof Chart === 'undefined') {
                    console.log('Waiting for Chart.js...');
                    setTimeout(render, 500);
                    return;
                }
                adminChart = new Chart(ctx, {
                    type: 'bar',
                    data: {
                        labels: stats.chartData.labels,
                        datasets: [
                            { 
                                label: 'Сообщения', 
                                data: stats.chartData.messages, 
                                backgroundColor: 'rgba(51, 144, 236, 0.7)',
                                borderColor: '#3390ec',
                                borderWidth: 1
                            },
                            { 
                                label: 'Регистрации', 
                                data: stats.chartData.registrations, 
                                backgroundColor: 'rgba(76, 175, 80, 0.7)',
                                borderColor: '#4caf50',
                                borderWidth: 1
                            },
                            { 
                                label: 'Новые чаты', 
                                data: stats.chartData.chatsCreated, 
                                backgroundColor: 'rgba(255, 152, 0, 0.7)',
                                borderColor: '#ff9800',
                                borderWidth: 1
                            }
                        ]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: { 
                            legend: { position: 'bottom' },
                            title: { display: true, text: 'Активность мессенджера' }
                        },
                        scales: { 
                            y: { 
                                beginAtZero: true, 
                                ticks: { stepSize: 1 } 
                            } 
                        }
                    }
                });
            };
            render();
        } else {
            console.error('Canvas element or chartData not found');
        }
    } else {
        console.error('Failed to fetch admin stats');
    }
}

async function loadAdminUsers() {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API_URL}/api/admin/users`, { headers: { 'Authorization': `Bearer ${token}` } });
    if (res.ok) {
        const users = await res.json();
        const tbody = document.querySelector('#admin-users-table tbody');
        tbody.innerHTML = users.map(u => {
            const statusText = formatStatus(u.lastSeen, u.id);
            
            return `
            <tr>
                <td>${u.name} ${u.surname || ''} ${u.isOfficial ? '<i class="fas fa-check-circle mod-badge"></i>' : ''}</td>
                <td>${u.username || '-'}</td>
                <td>${new Date(parseInt(u.id)).toLocaleDateString()}</td>
                <td>
                    <div style="display: flex; flex-direction: column; gap: 5px;">
                        <span style="font-size: 11px;">${statusText}</span>
                        <div style="display: flex; gap: 5px;">
                            ${u.id === '1779451744698' ? '' : (u.isBlockedByMod ? 
                                `<button onclick="window.adminDirectAction('${u.id}', 'unblock')" class="secondary-btn" style="padding: 2px 6px; width: auto; font-size: 10px;">Разбан</button>` : 
                                `<button onclick="window.adminDirectAction('${u.id}', 'block')" class="danger-btn" style="padding: 2px 6px; width: auto; font-size: 10px;">Бан</button>`)
                            }
                            <button onclick="window.toggleBeta('${u.id}', ${!u.isBetaTester})" class="secondary-btn" style="padding: 2px 6px; width: auto; font-size: 10px; color: ${u.isBetaTester ? '#9c27b0' : 'inherit'}">
                                ${u.isBetaTester ? 'Убрать Бету' : 'Дать Бету'}
                            </button>
                        </div>
                    </div>
                </td>
            </tr>`;
        }).join('');
    }
}
window.loadAdminUsers = loadAdminUsers;

async function adminDirectAction(userId, action) {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API_URL}/api/admin/users/${userId}/${action}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
        loadAdminUsers();
        showSuccess(action === 'block' ? 'Пользователь заблокирован' : 'Пользователь разблокирован');
    }
}
window.adminDirectAction = adminDirectAction;

async function toggleBeta(userId, value) {
    const token = localStorage.getItem('token');
    const usersRes = await fetch(`${API_URL}/api/admin/users`, { headers: { 'Authorization': `Bearer ${token}` } });
    const users = await usersRes.json();
    const user = users.find(u => u.id === userId);
    if (!user) return;
    
    const res = await fetch(`${API_URL}/api/admin/promote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ username: user.username, type: 'beta', value: value })
    });
    if (res.ok) {
        loadAdminUsers();
        showSuccess('Статус обновлен');
    }
}
window.toggleBeta = toggleBeta;

async function loadAdminReports() {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API_URL}/api/admin/reports`, { headers: { 'Authorization': `Bearer ${token}` } });
    if (res.ok) {
        const reports = await res.json();
        const tbody = document.querySelector('#admin-reports-table tbody');
        tbody.innerHTML = reports.map(r => `
            <tr>
                <td>${r.reporterName}</td>
                <td>${r.targetName} <button onclick="window.showUserProfile('${r.targetId}')" class="secondary-btn" style="width: auto; padding: 2px 6px; font-size: 10px;">Профиль</button></td>
                <td><small>${r.reportedMessage || 'No message'}</small></td>
                <td>${r.reason}</td>
                <td>
                    ${r.status === 'pending' ? `
                        <button onclick="window.adminAction('${r.id}', 'block')" class="danger-btn" style="width: auto; padding: 4px 8px;">Заблокировать</button>
                        <button onclick="window.adminAction('${r.id}', 'reject')" class="secondary-btn" style="width: auto; padding: 4px 8px;">Отклонить</button>
                    ` : `<span>${r.status}</span>`}
                </td>
            </tr>
        `).join('');
    }
}
window.loadAdminReports = loadAdminReports;

let editingChatId = null;

function openEditChat(chat) {
    editingChatId = chat.id;
    document.getElementById('edit-chat-name').value = chat.name;
    document.getElementById('edit-chat-desc').value = chat.description || '';
    document.getElementById('edit-chat-avatar').value = chat.avatar || '';
    document.getElementById('edit-chat-modal').classList.remove('hidden');
    document.getElementById('chat-info-modal').classList.add('hidden');
}

async function saveChatEdit() {
    if (!editingChatId) return;
    const name = document.getElementById('edit-chat-name').value;
    const description = document.getElementById('edit-chat-desc').value;
    const avatar = document.getElementById('edit-chat-avatar').value;
    
    const token = localStorage.getItem('token');
    const res = await fetch(`${API_URL}/api/chats/${editingChatId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ name, description, avatar })
    });
    
    if (res.ok) {
        const updatedChat = await res.json();
        const index = chats.findIndex(c => c.id === updatedChat.id);
        if (index !== -1) chats[index] = updatedChat;
        
        document.getElementById('edit-chat-modal').classList.add('hidden');
        renderChatList();
        selectChat(updatedChat.id);
        showSuccess('Чат обновлен');
    }
}

let deletingChatId = null;

function openDeleteChat(chat) {
    deletingChatId = chat.id;
    const title = document.getElementById('delete-chat-title');
    const warning = document.getElementById('delete-chat-warning');
    
    if (chat.type === 'channel') {
        title.innerText = 'Вы точно хотите удалить канал?';
        warning.innerText = 'Канал будет удален навсегда без отмены.';
    } else {
        title.innerText = 'Вы точно хотите удалить группу?';
        warning.innerText = 'Группа будет удалена навсегда без отмены.';
    }
    
    document.getElementById('delete-chat-modal').classList.remove('hidden');
    document.getElementById('chat-info-modal').classList.add('hidden');
}

async function confirmDeleteChat() {
    if (!deletingChatId) return;
    const token = localStorage.getItem('token');
    const res = await fetch(`${API_URL}/api/chats/${deletingChatId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (res.ok) {
        chats = chats.filter(c => c.id !== deletingChatId);
        activeChatId = null;
        elements.chatActive.classList.add('hidden');
        elements.noChatSelected.classList.remove('hidden');
        document.getElementById('delete-chat-modal').classList.add('hidden');
        renderChatList();
        showSuccess('Удалено');
    }
}

async function adminAction(reportId, action) {
    const token = localStorage.getItem('token');
    await fetch(`${API_URL}/api/admin/reports/${reportId}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ action })
    });
    loadAdminReports();
    loadAdminStats();
}
window.adminAction = adminAction;

async function promoteModerator() {
    const username = document.getElementById('admin-user-search').value.trim();
    if (!username) return;
    const token = localStorage.getItem('token');
    const res = await fetch(`${API_URL}/api/admin/promote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ username })
    });
    if (res.ok) {
        alert('Пользователь назначен модератором!');
        loadAdminUsers();
    } else {
        alert('Пользователь не найден');
    }
}

// Initialization and Event Listeners
function initAll() {
    getElements();
    
    // Auth and Account listeners
    const sendCodeBtn = document.getElementById('send-code-btn');
    if (sendCodeBtn) sendCodeBtn.onclick = sendCode;
    
    const verifyCodeBtn = document.getElementById('verify-code-btn');
    if (verifyCodeBtn) verifyCodeBtn.onclick = verifyCode;
    
    const registerBtn = document.getElementById('register-btn');
    if (registerBtn) registerBtn.onclick = register;
    
    const backToEmail = document.getElementById('back-to-email');
    if (backToEmail) backToEmail.onclick = () => {
        if (elements.codeStep) elements.codeStep.classList.add('hidden');
        if (elements.emailStep) elements.emailStep.classList.remove('hidden');
    };

    const addAccountBtn = document.getElementById('add-account-btn');
    if (addAccountBtn) {
        addAccountBtn.onclick = () => {
            if (elements.settingsModal) elements.settingsModal.classList.add('hidden'); 
            if (elements.authContainer) elements.authContainer.classList.remove('hidden');
            if (elements.emailStep) elements.emailStep.classList.remove('hidden');
            if (elements.codeStep) elements.codeStep.classList.add('hidden');
            if (elements.registerStep) elements.registerStep.classList.add('hidden');
            if (elements.cancelAuthBtn) elements.cancelAuthBtn.classList.remove('hidden');
            const emailInput = document.getElementById('email-input');
            if (emailInput) emailInput.value = '';
        };
    }

    // Main UI listeners
    if (elements.mainMenuBtn) {
        elements.mainMenuBtn.onclick = async (e) => {
            const token = localStorage.getItem('token');
            if (token) {
                const res = await fetch(`${API_URL}/api/user/me`, { headers: { 'Authorization': `Bearer ${token}` } });
                if (res.ok) {
                    currentUser = await res.json();
                    applyUserSettings(currentUser);
                }
            }
            
            if (!currentUser) return;
            const dName = document.getElementById('drawer-name');
            const dEmail = document.getElementById('drawer-email');
            const dAvatar = document.getElementById('drawer-avatar');
            const modBadge = currentUser.isOfficial ? '<i class="fas fa-check-circle mod-badge"></i>' : '';
            if (dName) dName.innerHTML = `${currentUser.name} ${currentUser.surname || ''} ${modBadge}`;
            if (dEmail) dEmail.innerText = currentUser.email;
            if (dAvatar) dAvatar.innerText = currentUser.avatar || (currentUser.name ? currentUser.name[0] : '?');
            if (elements.sideDrawer) elements.sideDrawer.classList.remove('hidden');
        };
    }

    if (elements.drawerOverlay) elements.drawerOverlay.onclick = () => {
        if (elements.sideDrawer) elements.sideDrawer.classList.add('hidden');
    };

    const drawerActions = {
        'drawer-profile': () => { if (elements.sideDrawer) elements.sideDrawer.classList.add('hidden'); const modal = document.getElementById('settings-modal'); if (modal) modal.classList.remove('hidden'); },
        'drawer-settings': () => { if (elements.sideDrawer) elements.sideDrawer.classList.add('hidden'); const modal = document.getElementById('settings-modal'); if (modal) modal.classList.remove('hidden'); },
        'drawer-new-group': () => { if (elements.sideDrawer) elements.sideDrawer.classList.add('hidden'); const modal = document.getElementById('create-group-modal'); if (modal) modal.classList.remove('hidden'); },
        'drawer-new-channel': () => { if (elements.sideDrawer) elements.sideDrawer.classList.add('hidden'); const modal = document.getElementById('create-channel-modal'); if (modal) modal.classList.remove('hidden'); },
        'drawer-admin': () => { 
            if (elements.sideDrawer) elements.sideDrawer.classList.add('hidden'); 
            const modal = document.getElementById('admin-modal'); 
            if (modal) modal.classList.remove('hidden');
            loadAdminStats();
        }
    };
    for (let id in drawerActions) {
        const el = document.getElementById(id);
        if (el) el.onclick = drawerActions[id];
    }

    const closeButtons = '.close-modal, .close-create-group, .close-create-channel, .close-info-modal, .close-delete-modal, .close-forward, .close-edit-modal, .close-report, .close-admin-modal, .close-edit-chat, .close-add-member';
    document.querySelectorAll(closeButtons).forEach(btn => {
        btn.onclick = () => {
            const modals = ['settings-modal', 'delete-modal', 'create-group-modal', 'create-channel-modal', 'chat-info-modal', 'forward-modal', 'edit-profile-modal', 'report-modal', 'admin-modal', 'edit-chat-modal', 'delete-chat-modal', 'add-member-modal'];
            modals.forEach(m => {
                const el = document.getElementById(m);
                if (el) el.classList.add('hidden');
            });
            if (btn.id === 'cancel-auth-btn') {
                if (accounts.length > 0 && !localStorage.getItem('token')) {
                    switchAccount(0);
                    return;
                }
                if (elements.authContainer) elements.authContainer.classList.add('hidden');
                if (elements.appContainer) elements.appContainer.classList.remove('hidden');
                btn.classList.add('hidden');
            }
            forwardFromMsg = null;
        };
    });

    // Chat header info click
    const chatHeader = document.querySelector('.chat-info');
    if (chatHeader) {
        chatHeader.onclick = () => {
            const chat = chats.find(c => c.id === activeChatId);
            if (chat) showChatInfo(chat);
        };
    }

    const saveChatEditBtn = document.getElementById('save-chat-edit-btn');
    if (saveChatEditBtn) saveChatEditBtn.onclick = saveChatEdit;
    
    const cancelDeleteChatBtn = document.getElementById('cancel-delete-chat-btn');
    if (cancelDeleteChatBtn) cancelDeleteChatBtn.onclick = () => document.getElementById('delete-chat-modal').classList.add('hidden');
    
    const confirmDeleteChatBtn = document.getElementById('confirm-delete-chat-btn');
    if (confirmDeleteChatBtn) confirmDeleteChatBtn.onclick = confirmDeleteChat;

    const sendReportBtn = document.getElementById('send-report-btn');
    if (sendReportBtn) sendReportBtn.onclick = sendReport;

    // Admin tab logic
    document.querySelectorAll('.admin-tab').forEach(tab => {
        tab.onclick = () => {
            document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const target = tab.getAttribute('data-admin-tab');
            document.querySelectorAll('.admin-tab-content').forEach(c => c.classList.add('hidden'));
            document.getElementById(`admin-${target}-tab`).classList.remove('hidden');
            if (target === 'stats') loadAdminStats();
            else if (target === 'users') loadAdminUsers();
            else if (target === 'reports') loadAdminReports();
        };
    });

    const promoteModBtn = document.getElementById('promote-mod-btn');
    if (promoteModBtn) promoteModBtn.onclick = promoteModerator;

    const leaveGroupBtn = document.getElementById('leave-group-btn');
    if (leaveGroupBtn) leaveGroupBtn.onclick = leaveGroup;

    if (elements.sendBtn) elements.sendBtn.onclick = () => sendMessage();
    if (elements.saveEditBtn) elements.saveEditBtn.onclick = () => sendMessage();
    
    if (elements.messageInput) {
        elements.messageInput.onkeypress = (e) => { if (e.key === 'Enter') sendMessage(); };
    }

    document.querySelectorAll('.nav-item').forEach(item => {
        item.onclick = () => {
            document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            currentTab = item.getAttribute('data-tab');
            renderChatList();
        };
    });

    if (elements.themeToggle) elements.themeToggle.onchange = updateSettings;
    if (elements.fontSizeSelect) elements.fontSizeSelect.onchange = updateSettings;
    if (elements.langSelect) elements.langSelect.onchange = updateSettings;

    const editProfileBtn = document.getElementById('edit-profile-btn');
    if (editProfileBtn) {
        editProfileBtn.onclick = () => {
            if (!currentUser) return;
            const eName = document.getElementById('edit-name');
            const eSurname = document.getElementById('edit-surname');
            const eBio = document.getElementById('edit-bio');
            if (eName) eName.value = currentUser.name || '';
            if (eSurname) eSurname.value = currentUser.surname || '';
            if (eBio) eBio.value = currentUser.bio || '';
            const modal = document.getElementById('edit-profile-modal');
            if (modal) modal.classList.remove('hidden');
        };
    }

    const saveProfileBtn = document.getElementById('save-profile-btn');
    if (saveProfileBtn) saveProfileBtn.onclick = saveProfile;
    
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) logoutBtn.onclick = logout;

    // Account Deletion
    const openDeleteAccBtn = document.getElementById('open-delete-account-btn');
    if (openDeleteAccBtn) openDeleteAccBtn.onclick = openDeleteAccount;
    
    const cancelDeleteAccBtn = document.getElementById('cancel-delete-account-btn');
    if (cancelDeleteAccBtn) cancelDeleteAccBtn.onclick = () => document.getElementById('delete-account-modal').classList.add('hidden');
    
    const confirmDeleteAccBtn = document.getElementById('confirm-delete-account-btn');
    if (confirmDeleteAccBtn) confirmDeleteAccBtn.onclick = confirmDeleteAccount;

    // Delete Message Modal listeners
    const deleteSelfBtn = document.getElementById('delete-self-btn');
    if (deleteSelfBtn) deleteSelfBtn.onclick = () => deleteMessage('self');
    const deleteAllBtn = document.getElementById('delete-all-btn');
    if (deleteAllBtn) deleteAllBtn.onclick = () => deleteMessage('all');

    // Selection Header listeners
    const cancelSelectionBtn = document.getElementById('cancel-selection-btn');
    if (cancelSelectionBtn) cancelSelectionBtn.onclick = cancelSelection;

    const forwardSelectedBtn = document.getElementById('forward-selected-btn');
    if (forwardSelectedBtn) forwardSelectedBtn.onclick = () => {
        if (selectedMsgIds.size > 0) alert(`Пересылка ${selectedMsgIds.size} сообщений пока не реализована`);
    };
    const deleteSelectedBtn = document.getElementById('delete-selected-btn');
    if (deleteSelectedBtn) deleteSelectedBtn.onclick = async () => {
        if (selectedMsgIds.size === 0) return;
        if (confirm(`Удалить ${selectedMsgIds.size} сообщений?`)) {
            const token = localStorage.getItem('token');
            for (let id of selectedMsgIds) {
                await fetch(`${API_URL}/api/messages/${id}?mode=self`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
            }
            cancelSelection();
            loadMessages();
        }
    };
    
    const backBtn = document.querySelector('.back-btn');
    if (backBtn) backBtn.onclick = () => {
        const sidebar = document.querySelector('.sidebar');
        if (sidebar) sidebar.classList.remove('collapsed');
    };

    document.querySelectorAll('.menu-item').forEach(item => {
        item.onclick = async () => {
            const action = item.getAttribute('data-action');
            if (action === 'copy' && contextMenuMsgId) {
                const msgEl = document.querySelector(`.message[data-id="${contextMenuMsgId}"] .message-text`);
                if (msgEl) navigator.clipboard.writeText(msgEl.innerText);
                return;
            }
            
            const token = localStorage.getItem('token');
            const res = await fetch(`${API_URL}/api/messages/${activeChatId}`, { headers: { 'Authorization': `Bearer ${token}` } });
            const msgs = await res.json();
            const msg = msgs.find(m => m.id === contextMenuMsgId);
            if (!msg) return;
            switch(action) {
                case 'reply': setupReply(msg); break;
                case 'edit': setupEdit(msg); break;
                case 'select': startSelection(contextMenuMsgId); break;
                case 'report':
                    reportedTargetId = msg.senderId;
                    document.getElementById('reported-text').innerText = msg.text || 'Файл';
                    document.getElementById('reported-message-preview').classList.remove('hidden');
                    document.getElementById('report-modal').classList.remove('hidden');
                    break;
                case 'delete': 
                    const delModal = document.getElementById('delete-modal');
                    if (delModal) delModal.classList.remove('hidden'); 
                    break;
                case 'pin': togglePin(contextMenuMsgId); break;
                case 'forward': showForwardList(msg); break;
            }
        };
    });

    const searchInput = document.getElementById('search-input');
    if (searchInput) searchInput.oninput = (e) => { searchQuery = e.target.value; renderChatList(); };
    
    const attachBtn = document.getElementById('attach-btn');
    if (attachBtn) attachBtn.onclick = () => {
        const fileInput = document.getElementById('file-input');
        if (fileInput) fileInput.click();
    };
    
    const fileInput = document.getElementById('file-input');
    if (fileInput) {
        fileInput.onchange = (e) => {
            const file = e.target.files[0]; if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => sendMessage({ name: file.name, data: ev.target.result });
            reader.readAsDataURL(file); e.target.value = '';
        };
    }

    const closePin = document.getElementById('close-pin');
    if (closePin) closePin.onclick = () => {
        const panel = document.getElementById('pin-panel');
        if (panel) panel.classList.add('hidden');
    };
    
    const closePreview = document.getElementById('close-preview');
    if (closePreview) closePreview.onclick = () => {
        const preview = document.getElementById('message-action-preview');
        if (preview) preview.classList.add('hidden');
        replyToMsg = null; forwardFromMsg = null; isEditing = false;
        if (elements.messageInput) elements.messageInput.value = '';
        if (elements.sendBtn) elements.sendBtn.classList.remove('hidden');
        if (elements.saveEditBtn) elements.saveEditBtn.classList.add('hidden');
    };

    const confirmCreateGroup = document.getElementById('confirm-create-group');
    if (confirmCreateGroup) {
        confirmCreateGroup.onclick = async () => {
            const nameInput = document.getElementById('group-name-input');
            const descInput = document.getElementById('group-desc-input');
            if (!nameInput || !nameInput.value) return alert('Введите название');
            const res = await fetch(`${API_URL}/api/chats`, { 
                method: 'POST', 
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` }, 
                body: JSON.stringify({ name: nameInput.value, type: 'group', description: descInput ? descInput.value : '' }) 
            });
            if (res.ok) { 
                const nc = await res.json(); 
                chats.push(nc); 
                renderChatList(); 
                const modal = document.getElementById('create-group-modal');
                if (modal) modal.classList.add('hidden'); 
                selectChat(nc.id); 
            }
        };
    }

    const confirmCreateChannel = document.getElementById('confirm-create-channel');
    if (confirmCreateChannel) {
        confirmCreateChannel.onclick = async () => {
            const nameInput = document.getElementById('channel-name-input');
            const descInput = document.getElementById('channel-desc-input');
            const typeSelect = document.getElementById('channel-type-select');
            if (!nameInput || !nameInput.value) return alert('Введите название');
            const res = await fetch(`${API_URL}/api/chats`, { 
                method: 'POST', 
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` }, 
                body: JSON.stringify({ 
                    name: nameInput.value, 
                    type: 'channel', 
                    description: descInput ? descInput.value : '', 
                    isPublic: typeSelect ? typeSelect.value === 'public' : true 
                }) 
            });
            if (res.ok) { 
                const nc = await res.json(); 
                chats.push(nc); 
                renderChatList(); 
                const modal = document.getElementById('create-channel-modal');
                if (modal) modal.classList.add('hidden'); 
                selectChat(nc.id); 
            }
        };
    }

    // Context menu dismiss
    document.addEventListener('click', () => {
        const ctx = document.getElementById('context-menu');
        if (ctx) ctx.classList.add('hidden');
    });
}

window.onload = async () => {
    initAll();
    const token = localStorage.getItem('token');
    requestNotificationPermission();
    if (token) {
        const res = await fetch(`${API_URL}/api/user/me`, { headers: { 'Authorization': `Bearer ${token}` } });
        if (res.ok) {
            currentUser = await res.json();
            elements.authContainer.classList.add('hidden');
            elements.appContainer.classList.remove('hidden');
            applyUserSettings(currentUser);
            loadChats();
        } else {
            localStorage.removeItem('token');
            if (accounts.length > 0) elements.cancelAuthBtn.classList.remove('hidden');
        }
    } else {
        if (accounts.length > 0) elements.cancelAuthBtn.classList.remove('hidden');
    }
};
