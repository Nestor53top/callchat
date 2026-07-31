var db = {
  _users: null,
  _stats: null,

  _loadUsers: function() {
    try { return JSON.parse(localStorage.getItem('vh_users') || '{}'); }
    catch(e) { return {}; }
  },

  _saveUsers: function(users) {
    localStorage.setItem('vh_users', JSON.stringify(users));
  },

  _loadStats: function() {
    try { return JSON.parse(localStorage.getItem('vh_stats') || '{}'); }
    catch(e) { return {}; }
  },

  _saveStats: function(stats) {
    localStorage.setItem('vh_stats', JSON.stringify(stats));
  },

  _genId: function() {
    var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    var id = '';
    for (var i = 0; i < 8; i++) {
      id += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return id;
  },

  _genColor: function() {
    var colors = ['#7c3aed','#3b82f6','#22c55e','#f59e0b','#ef4444','#ec4899','#8b5cf6','#06b6d4','#f97316','#14b8a6'];
    return colors[Math.floor(Math.random() * colors.length)];
  },

  register: function(nickname, password) {
    var users = this._loadUsers();
    var keys = Object.keys(users);
    for (var i = 0; i < keys.length; i++) {
      if (users[keys[i]].nickname.toLowerCase() === nickname.toLowerCase()) {
        return { ok: false, error: 'Этот никнейм уже занят' };
      }
    }
    var id = this._genId();
    var user = {
      id: id,
      nickname: nickname,
      password: password,
      color: this._genColor(),
      createdAt: Date.now(),
      lastSeen: Date.now()
    };
    users[id] = user;
    this._saveUsers(users);
    this._initStats(id);
    return { ok: true, user: user };
  },

  login: function(nickname, password) {
    var users = this._loadUsers();
    var keys = Object.keys(users);
    for (var i = 0; i < keys.length; i++) {
      var u = users[keys[i]];
      if (u.nickname.toLowerCase() === nickname.toLowerCase()) {
        if (u.password !== password) {
          return { ok: false, error: 'Неверный пароль' };
        }
        u.lastSeen = Date.now();
        users[u.id] = u;
        this._saveUsers(users);
        return { ok: true, user: u };
      }
    }
    return { ok: false, error: 'Пользователь не найден' };
  },

  loginSession: function(userId) {
    localStorage.setItem('vh_session', userId);
  },

  getSession: function() {
    return localStorage.getItem('vh_session');
  },

  logout: function() {
    localStorage.removeItem('vh_session');
  },

  getCurrentUser: function() {
    var sid = this.getSession();
    if (!sid) return null;
    var users = this._loadUsers();
    return users[sid] || null;
  },

  getUser: function(userId) {
    var users = this._loadUsers();
    return users[userId] || null;
  },

  _initStats: function(userId) {
    var stats = this._loadStats();
    if (!stats[userId]) {
      stats[userId] = { totalTime: 0, talkTime: 0, sessions: 0, loginTime: Date.now() };
    }
    stats[userId].loginTime = Date.now();
    stats[userId].sessions++;
    this._saveStats(stats);
  },

  getStats: function(userId) {
    var stats = this._loadStats();
    return stats[userId] || null;
  },

  saveStats: function(userId, data) {
    var stats = this._loadStats();
    if (!stats[userId]) stats[userId] = {};
    var keys = Object.keys(data);
    for (var i = 0; i < keys.length; i++) {
      stats[userId][keys[i]] = data[keys[i]];
    }
    this._saveStats(stats);
  },

  getTimeOnSite: function(userId) {
    var s = this.getStats(userId);
    if (!s || !s.loginTime) return 0;
    return s.totalTime + (Date.now() - s.loginTime);
  },

  fmtTime: function(ms) {
    var sec = Math.floor(ms / 1000);
    var min = Math.floor(sec / 60);
    var hr = Math.floor(min / 60);
    var m = min % 60;
    var s = sec % 60;
    if (hr > 0) return hr + 'ч ' + m + 'м ' + s + 'с';
    return m + 'м ' + s + 'с';
  }
};
