(function() {
  var user = db.getCurrentUser();
  if (!user) { window.location.href = 'index.html'; return; }

  var API = window.location.protocol + '//' + window.location.hostname + ':8081';

  document.getElementById('app').classList.remove('hidden');
  document.getElementById('my-nickname').textContent = user.nickname;
  document.getElementById('my-id').textContent = user.id;

  var micMuted = false;
  var spkMuted = false;
  var localStream = null;
  var peers = {};
  var audioEls = {};
  var muteExceptIds = [];
  var talkStart = null;
  var talkTime = 0;
  var talkInterval = null;

  var iceConfig = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  };

  // --- helpers ---
  function api(path, cb) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', API + path, true);
    xhr.onreadystatechange = function() {
      if (xhr.readyState === 4) {
        try { cb(null, JSON.parse(xhr.responseText)); }
        catch(e) { cb(e, null); }
      }
    };
    xhr.onerror = function() { cb(new Error('network'), null); };
    xhr.send();
  }

  function notify(msg, type) {
    var el = document.getElementById('notification');
    el.textContent = msg;
    el.className = 'notification ' + (type || 'info');
    el.style.display = 'block';
    clearTimeout(el._t);
    el._t = setTimeout(function() { el.style.display = 'none'; }, 3000);
  }

  // --- user list ---
  function addUserToList(u, isSelf) {
    if (document.getElementById('u-' + u.id)) return;
    var div = document.createElement('div');
    div.className = 'user-item' + (isSelf ? ' self' : '');
    div.id = 'u-' + u.id;
    div.innerHTML =
      '<div class="avatar" style="background:' + (u.color || '#7c3aed') + '">' + (u.nickname || '?').charAt(0).toUpperCase() + '</div>' +
      '<div class="user-details">' +
        '<div class="user-name">' + u.nickname + (isSelf ? ' (вы)' : '') + '</div>' +
        '<div class="user-id">' + u.id + '</div>' +
      '</div>' +
      '<div class="mic-status">🎤</div>';
    if (!isSelf) {
      div.style.cursor = 'pointer';
      div.addEventListener('click', function() { showUserStats(u); });
    }
    document.getElementById('user-list').appendChild(div);
    updateCount();
  }

  function removeUserFromList(uid) {
    var el = document.getElementById('u-' + uid);
    if (el) el.remove();
    updateCount();
  }

  function updateCount() {
    document.getElementById('online-count').textContent = document.getElementById('user-list').children.length;
  }

  function setMicIcon(uid, icon) {
    var el = document.getElementById('u-' + uid);
    if (el) el.querySelector('.mic-status').textContent = icon;
  }

  // add self
  addUserToList(user, true);

  // --- audio ---
  function addRemoteAudio(uid, stream) {
    if (audioEls[uid]) return;
    var audio = document.createElement('audio');
    audio.autoplay = true;
    audio.srcObject = stream;
    audio.dataset.peerId = uid;
    if (spkMuted) audio.muted = true;
    if (muteExceptIds.length > 0) audio.muted = muteExceptIds.indexOf(uid) === -1;
    document.getElementById('audio-container').appendChild(audio);
    audioEls[uid] = audio;
    setMicIcon(uid, '🟢');
  }

  function removeRemoteAudio(uid) {
    if (audioEls[uid]) { audioEls[uid].remove(); delete audioEls[uid]; }
    setMicIcon(uid, '🔴');
  }

  // --- WebRTC ---
  function createPeer(remoteId, initiator) {
    if (peers[remoteId]) peers[remoteId].close();
    var pc = new RTCPeerConnection(iceConfig);
    peers[remoteId] = pc;

    if (localStream) localStream.getTracks().forEach(function(t) { pc.addTrack(t, localStream); });

    pc.onicecandidate = function(e) {
      if (e.candidate) sendSignal(remoteId, JSON.stringify({ type: 'ice', candidate: e.candidate }));
    };
    pc.ontrack = function(e) {
      if (e.streams && e.streams[0]) addRemoteAudio(remoteId, e.streams[0]);
    };
    pc.onconnectionstatechange = function() {
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') destroyPeer(remoteId);
    };

    if (initiator) {
      pc.createOffer().then(function(offer) {
        return pc.setLocalDescription(offer);
      }).then(function() {
        sendSignal(remoteId, JSON.stringify({ type: 'offer', sdp: pc.localDescription }));
      }).catch(function(e) { console.error('offer err', e); });
    }
  }

  function destroyPeer(uid) {
    if (peers[uid]) { peers[uid].close(); delete peers[uid]; }
    removeRemoteAudio(uid);
  }

  function handleSignal(from, dataStr) {
    var data;
    try { data = JSON.parse(dataStr); } catch(e) { return; }

    if (data.type === 'offer') {
      createPeer(from, false);
      var pc = peers[from];
      if (!pc) return;
      pc.setRemoteDescription(new RTCSessionDescription(data.sdp)).then(function() {
        return pc.createAnswer();
      }).then(function(answer) {
        return pc.setLocalDescription(answer);
      }).then(function() {
        sendSignal(from, JSON.stringify({ type: 'answer', sdp: pc.localDescription }));
      }).catch(function(e) { console.error('answer err', e); });
    } else if (data.type === 'answer' && peers[from]) {
      peers[from].setRemoteDescription(new RTCSessionDescription(data.sdp)).catch(function(e) { console.error(e); });
    } else if (data.type === 'ice' && peers[from]) {
      peers[from].addIceCandidate(new RTCIceCandidate(data.candidate)).catch(function() {});
    }
  }

  // --- signaling via server ---
  function sendSignal(to, dataStr) {
    api('/api/signal/send?from=' + user.id + '&to=' + to + '&data=' + encodeURIComponent(dataStr), function() {});
  }

  function pollSignals() {
    api('/api/signal/poll?uid=' + user.id, function(err, res) {
      if (err || !res || !res.ok) return;
      for (var i = 0; i < res.signals.length; i++) {
        handleSignal(res.signals[i].from, res.signals[i].data);
      }
    });
  }

  // --- presence via server ---
  var knownUsers = {};

  function announcePresence() {
    api('/api/presence/announce?uid=' + user.id + '&nickname=' + encodeURIComponent(user.nickname) + '&color=' + encodeURIComponent(user.color), function(err, res) {
      if (err || !res || !res.ok) return;
      syncUsers(res.users);
    });
  }

  function pollPresence() {
    api('/api/presence/list', function(err, res) {
      if (err || !res || !res.ok) return;
      syncUsers(res.users);
    });
  }

  function syncUsers(usersList) {
    var nowKnown = {};
    for (var i = 0; i < usersList.length; i++) {
      var u = usersList[i];
      nowKnown[u.id] = u;
      if (!knownUsers[u.id] && u.id !== user.id) {
        addUserToList(u, false);
        createPeer(u.id, true);
        notify(u.nickname + ' присоединился', 'info');
        startTalk();
      }
    }
    // remove left
    var keys = Object.keys(knownUsers);
    for (var j = 0; j < keys.length; j++) {
      if (keys[j] !== user.id && !nowKnown[keys[j]]) {
        destroyPeer(keys[j]);
        removeUserFromList(keys[j]);
        notify(knownUsers[keys[j]].nickname + ' вышел', 'info');
        stopTalkIfNeeded();
      }
    }
    knownUsers = nowKnown;
  }

  // --- talk time ---
  function startTalk() {
    if (talkStart) return;
    talkStart = Date.now();
    talkInterval = setInterval(function() { talkTime += 1000; }, 1000);
  }

  function stopTalkIfNeeded() {
    var others = document.querySelectorAll('.user-item:not(.self)');
    if (others.length === 0 && talkStart) {
      clearInterval(talkInterval);
      talkInterval = null;
      talkStart = null;
    }
  }

  // --- mic ---
  document.getElementById('mute-mic-btn').addEventListener('click', function() {
    if (!localStream) return;
    micMuted = !micMuted;
    localStream.getAudioTracks().forEach(function(t) { t.enabled = !micMuted; });
    this.textContent = micMuted ? '🎤 Включить микрофон' : '🎤 Выкл. микрофон';
    this.classList.toggle('active', micMuted);
    setMicIcon(user.id, micMuted ? '🔇' : '🎤');
  });

  // --- speakers ---
  document.getElementById('mute-spk-btn').addEventListener('click', function() {
    spkMuted = !spkMuted;
    var keys = Object.keys(audioEls);
    for (var i = 0; i < keys.length; i++) {
      if (muteExceptIds.length > 0) audioEls[keys[i]].muted = muteExceptIds.indexOf(keys[i]) === -1;
      else audioEls[keys[i]].muted = spkMuted;
    }
    this.textContent = spkMuted ? '🔊 Включить звук' : '🔊 Выкл. звук';
    this.classList.toggle('active', spkMuted);
  });

  // --- mute except ---
  document.getElementById('mute-except-btn').addEventListener('click', function() {
    var list = document.getElementById('except-list');
    list.innerHTML = '';
    var items = document.querySelectorAll('.user-item:not(.self)');
    if (items.length === 0) list.innerHTML = '<p class="muted-text">Нет других пользователей</p>';
    for (var i = 0; i < items.length; i++) {
      var uid = items[i].id.replace('u-', '');
      var name = items[i].querySelector('.user-name').textContent;
      var checked = muteExceptIds.indexOf(uid) !== -1 ? 'checked' : '';
      var div = document.createElement('div');
      div.className = 'mute-except-item';
      div.innerHTML = '<input type="checkbox" id="exc-' + uid + '" ' + checked + '><label for="exc-' + uid + '">' + name + '</label>';
      list.appendChild(div);
    }
    document.getElementById('except-modal').classList.remove('hidden');
  });

  document.getElementById('apply-except').addEventListener('click', function() {
    muteExceptIds = [];
    var checks = document.querySelectorAll('#except-list input[type="checkbox"]');
    for (var i = 0; i < checks.length; i++) {
      if (checks[i].checked) muteExceptIds.push(checks[i].id.replace('exc-', ''));
    }
    var keys = Object.keys(audioEls);
    for (var j = 0; j < keys.length; j++) {
      if (muteExceptIds.length > 0) audioEls[keys[j]].muted = muteExceptIds.indexOf(keys[j]) === -1;
      else audioEls[keys[j]].muted = spkMuted;
    }
    document.getElementById('except-modal').classList.add('hidden');
    notify(muteExceptIds.length > 0 ? 'Мут всех кроме ' + muteExceptIds.length : 'Мут выключен', 'info');
  });

  // --- stats ---
  function showStats() {
    var s = db.getStats(user.id);
    document.getElementById('st-nick').textContent = user.nickname;
    document.getElementById('st-id').textContent = user.id;
    document.getElementById('st-created').textContent = new Date(user.createdAt).toLocaleDateString('ru-RU');
    document.getElementById('st-sessions').textContent = s ? s.sessions : 0;
    document.getElementById('st-time').textContent = db.fmtTime(db.getTimeOnSite(user.id));
    document.getElementById('st-talk').textContent = db.fmtTime(talkTime);
    document.getElementById('stats-modal').classList.remove('hidden');
  }

  function showUserStats(u) {
    document.getElementById('st-nick').textContent = u.nickname;
    document.getElementById('st-id').textContent = u.id;
    document.getElementById('st-created').textContent = u.createdAt ? new Date(u.createdAt).toLocaleDateString('ru-RU') : '—';
    document.getElementById('st-sessions').textContent = '—';
    document.getElementById('st-time').textContent = '—';
    document.getElementById('st-talk').textContent = '—';
    document.getElementById('stats-modal').classList.remove('hidden');
  }

  document.getElementById('my-id').addEventListener('click', showStats);
  document.getElementById('stats-btn').addEventListener('click', showStats);

  setInterval(function() {
    if (!document.getElementById('stats-modal').classList.contains('hidden')) {
      document.getElementById('st-time').textContent = db.fmtTime(db.getTimeOnSite(user.id));
      document.getElementById('st-talk').textContent = db.fmtTime(talkTime);
    }
  }, 1000);

  // --- modals ---
  var closeBtns = document.querySelectorAll('[data-close]');
  for (var i = 0; i < closeBtns.length; i++) {
    closeBtns[i].addEventListener('click', function() { this.closest('.modal').classList.add('hidden'); });
  }
  var modals = document.querySelectorAll('.modal');
  for (var j = 0; j < modals.length; j++) {
    modals[j].addEventListener('click', function(e) { if (e.target === this) this.classList.add('hidden'); });
  }

  // --- logout ---
  document.getElementById('logout-btn').addEventListener('click', function() {
    db.saveStats(user.id, { totalTime: db.getTimeOnSite(user.id), talkTime: talkTime });
    var keys = Object.keys(peers);
    for (var i = 0; i < keys.length; i++) peers[keys[i]].close();
    if (localStream) localStream.getTracks().forEach(function(t) { t.stop(); });
    api('/api/presence/leave?uid=' + user.id, function() {});
    db.logout();
    window.location.href = 'index.html';
  });

  // --- auth mode: server or localStorage ---
  function serverRegister(nick, pwd, cb) {
    api('/api/register?nickname=' + encodeURIComponent(nick) + '&password=' + encodeURIComponent(pwd), function(err, res) {
      if (err || !res) return cb('Сервер недоступен, регистрирую локально');
      cb(null, res);
    });
  }

  function serverLogin(nick, pwd, cb) {
    api('/api/login?nickname=' + encodeURIComponent(nick) + '&password=' + encodeURIComponent(pwd), function(err, res) {
      if (err || !res) return cb('Сервер недоступен');
      cb(null, res);
    });
  }

  // override db methods to use server first, then fallback
  var origRegister = db.register.bind(db);
  var origLogin = db.login.bind(db);

  db.register = function(nick, pwd) {
    var result = origRegister(nick, pwd);
    if (result.ok) {
      // also register on server
      serverRegister(nick, pwd, function() {});
    }
    return result;
  };

  db.login = function(nick, pwd) {
    // try server first
    var result = origLogin(nick, pwd);
    if (!result.ok) return result;
    serverLogin(nick, pwd, function() {});
    return result;
  };

  // --- init ---
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    notify('Микрофон недоступен (нужен HTTPS или localhost)', 'error');
    document.getElementById('call-status').innerHTML =
      '<div class="status-icon">🔇</div><h2>Микрофон недоступен</h2><p>Откройте через HTTPS или localhost</p>';
    announcePresence();
    pollPresence();
    pollSignals();
    setInterval(function() { pollPresence(); pollSignals(); }, 2000);
  } else {
  navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
    .then(function(stream) {
      localStream = stream;
      announcePresence();
      pollPresence();
      pollSignals();
      setInterval(function() {
        pollPresence();
        pollSignals();
      }, 2000);
    })
    .catch(function(err) {
      notify('Микрофон недоступен: ' + err.message, 'error');
      document.getElementById('call-status').innerHTML =
        '<div class="status-icon">🔇</div><h2>Микрофон недоступен</h2><p>Разрешите доступ к микрофону и обновите страницу</p>';
      // still work without mic - just no audio
      announcePresence();
      pollPresence();
      pollSignals();
      setInterval(function() { pollPresence(); pollSignals(); }, 2000);
    });
  }
})();
