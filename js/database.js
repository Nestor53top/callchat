var SUPABASE_URL = 'https://zerqyfvvafzfnglzszlr.supabase.co';
var SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InplcnF5ZnZ2YWZ6Zm5nbHpzemxyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU0NTQzMTAsImV4cCI6MjEwMTAzMDMxMH0.KXNjeThlDdGSAUhxhfNwsdY0VwAUCBImMjmXRc8X0ik';

var supa = null;

var db = {
  _genId: function() {
    var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    var id = '';
    for (var i = 0; i < 8; i++) id += chars.charAt(Math.floor(Math.random() * chars.length));
    return id;
  },

  _genColor: function() {
    var c = ['#7c3aed','#3b82f6','#22c55e','#f59e0b','#ef4444','#ec4899','#8b5cf6','#06b6d4'];
    return c[Math.floor(Math.random() * c.length)];
  },

  init: function() {
    if (typeof supabase !== 'undefined' && supabase.createClient) {
      supa = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    }
    return !!supa;
  },

  _hash: function(str) {
    var buf = new TextEncoder().encode(str);
    return crypto.subtle.digest('SHA-256', buf).then(function(hash) {
      return Array.from(new Uint8Array(hash)).map(function(b) { return b.toString(16).padStart(2,'0'); }).join('');
    });
  },

  register: function(nickname, password, cb) {
    if (!supa) return cb('Supabase не подключен');
    db._hash(password).then(function(hash) {
      supa.from('users').select('*').eq('nickname', nickname).then(function(r) {
        if (r.data && r.data.length > 0) return cb('Никнейм занят');
        var id = db._genId();
        supa.from('users').insert({
          user_id: id,
          nickname: nickname,
          password: hash,
          color: db._genColor()
        }).then(function(r2) {
          if (r2.error) return cb(r2.error.message);
          cb(null, { id: id, nickname: nickname, color: db._genColor() });
        });
      });
    });
  },

  login: function(nickname, password, cb) {
    if (!supa) return cb('Supabase не подключен');
    db._hash(password).then(function(hash) {
      supa.from('users').select('*').eq('nickname', nickname).eq('password', hash).then(function(r) {
        if (r.error) return cb(r.error.message);
        if (!r.data || r.data.length === 0) return cb('Неверный никнейм или пароль');
        var u = r.data[0];
        cb(null, { id: u.user_id, nickname: u.nickname, color: u.color });
      });
    });
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

  getUser: function(userId, cb) {
    if (!supa) return cb(null, null);
    supa.from('users').select('*').eq('user_id', userId).then(function(r) {
      if (!r.data || r.data.length === 0) return cb(null, null);
      var u = r.data[0];
      cb(null, { id: u.user_id, nickname: u.nickname, color: u.color });
    });
  },

  _stats: {},
  saveStats: function(userId, data) {
    var s = this._stats[userId] || {};
    var keys = Object.keys(data);
    for (var i = 0; i < keys.length; i++) s[keys[i]] = data[keys[i]];
    this._stats[userId] = s;
    try { localStorage.setItem('vh_stats_' + userId, JSON.stringify(s)); } catch(e) {}
  },
  getStats: function(userId) {
    if (this._stats[userId]) return this._stats[userId];
    try {
      var s = JSON.parse(localStorage.getItem('vh_stats_' + userId) || '{}');
      this._stats[userId] = s;
      return s;
    } catch(e) { return {}; }
  },
  getTimeOnSite: function(userId) {
    var s = this.getStats(userId);
    if (!s.loginTime) return 0;
    return (s.totalTime || 0) + (Date.now() - s.loginTime);
  },
  fmtTime: function(ms) {
    var sec = Math.floor(ms / 1000);
    var min = Math.floor(sec / 60);
    var hr = Math.floor(min / 60);
    if (hr > 0) return hr + 'ч ' + (min % 60) + 'м ' + (sec % 60) + 'с';
    return min + 'м ' + (sec % 60) + 'с';
  }
};
