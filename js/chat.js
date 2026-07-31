(function() {
  var userId = db.getSession();
  if (!userId) { window.location.href = 'index.html'; return; }

  if (!db.init()) {
    document.body.innerHTML = '<div style="padding:40px;color:#fff;text-align:center"><h1>Supabase не подключен</h1></div>';
    return;
  }

  var myUser = null;
  var micMuted = false;
  var spkMuted = false;
  var localStream = null;
  var peers = {};
  var audioEls = {};
  var muteExceptIds = [];
  var talkStart = null;
  var talkTime = 0;
  var talkInterval = null;
  var channel = null;
  var knownUsers = {};

  var iceConfig = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  };

  function notify(msg, type) {
    var el = document.getElementById('notification');
    el.textContent = msg;
    el.className = 'notification ' + (type || 'info');
    el.style.display = 'block';
    clearTimeout(el._t);
    el._t = setTimeout(function() { el.style.display = 'none'; }, 3000);
  }

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
      if (e.candidate) sendSignal(remoteId, { type: 'ice', candidate: e.candidate });
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
        sendSignal(remoteId, { type: 'offer', sdp: pc.localDescription });
      }).catch(function(e) { console.error('offer err', e); });
    }
  }

  function destroyPeer(uid) {
    if (peers[uid]) { peers[uid].close(); delete peers[uid]; }
    removeRemoteAudio(uid);
  }

  function handleSignal(from, data) {
    if (data.type === 'offer') {
      createPeer(from, false);
      var pc = peers[from];
      if (!pc) return;
      pc.setRemoteDescription(new RTCSessionDescription(data.sdp)).then(function() {
        return pc.createAnswer();
      }).then(function(answer) {
        return pc.setLocalDescription(answer);
      }).then(function() {
        sendSignal(from, { type: 'answer', sdp: pc.localDescription });
      }).catch(function(e) { console.error('answer err', e); });
    } else if (data.type === 'answer' && peers[from]) {
      peers[from].setRemoteDescription(new RTCSessionDescription(data.sdp)).catch(function(e) { console.error(e); });
    } else if (data.type === 'ice' && peers[from]) {
      peers[from].addIceCandidate(new RTCIceCandidate(data.candidate)).catch(function() {});
    }
  }

  // --- Supabase signaling ---
  function sendSignal(toUserId, data) {
    if (!channel) return;
    channel.send({
      type: 'broadcast',
      event: 'signal',
      payload: { from: userId, to: toUserId, data: data }
    });
  }

  function joinRoom() {
    channel = supa.channel('voice-lobby', {
      config: { presence: { key: userId } }
    });

    // presence sync
    channel.on('presence', { event: 'sync' }, function() {
      var state = channel.presenceState();
      var nowKnown = {};
      for (var key in state) {
        var presences = state[key];
        for (var i = 0; i < presences.length; i++) {
          var p = presences[i];
          nowKnown[p.uid] = p;
          if (!knownUsers[p.uid] && p.uid !== userId) {
            addUserToList({ id: p.uid, nickname: p.nickname, color: p.color }, false);
            createPeer(p.uid, true);
            notify(p.nickname + ' присоединился', 'info');
            startTalk();
          }
        }
      }
      // remove left
      for (var k in knownUsers) {
        if (k !== userId && !nowKnown[k]) {
          destroyPeer(k);
          removeUserFromList(k);
          notify(knownUsers[k].nickname + ' вышел', 'info');
          stopTalkIfNeeded();
        }
      }
      knownUsers = nowKnown;
    });

    channel.on('presence', { event: 'join' }, function(payload) {
      for (var i = 0; i < payload.newPresences.length; i++) {
        var p = payload.newPresences[i];
        if (p.uid !== userId && !knownUsers[p.uid]) {
          addUserToList({ id: p.uid, nickname: p.nickname, color: p.color }, false);
          createPeer(p.uid, true);
          notify(p.nickname + ' присоединился', 'info');
          startTalk();
        }
      }
    });

    channel.on('presence', { event: 'leave' }, function(payload) {
      for (var i = 0; i < payload.leftPresences.length; i++) {
        var p = payload.leftPresences[i];
        if (p.uid !== userId) {
          destroyPeer(p.uid);
          removeUserFromList(p.uid);
          if (knownUsers[p.uid]) notify(knownUsers[p.uid].nickname + ' вышел', 'info');
          delete knownUsers[p.uid];
          stopTalkIfNeeded();
        }
      }
    });

    // signaling
    channel.on('broadcast', { event: 'signal' }, function(payload) {
      var msg = payload.payload;
      if (msg.to === userId && msg.from !== userId) {
        handleSignal(msg.from, msg.data);
      }
    });

    channel.subscribe(function(status) {
      if (status === 'SUBSCRIBED') {
        channel.track({
          uid: userId,
          nickname: myUser.nickname,
          color: myUser.color,
          online_at: new Date().toISOString()
        });
      }
    });
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
    setMicIcon(userId, micMuted ? '🔇' : '🎤');
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
    var s = db.getStats(userId);
    document.getElementById('st-nick').textContent = myUser.nickname;
    document.getElementById('st-id').textContent = userId;
    document.getElementById('st-created').textContent = '—';
    document.getElementById('st-sessions').textContent = s.sessions || 1;
    document.getElementById('st-time').textContent = db.fmtTime(db.getTimeOnSite(userId));
    document.getElementById('st-talk').textContent = db.fmtTime(talkTime);
    document.getElementById('stats-modal').classList.remove('hidden');
  }

  function showUserStats(u) {
    document.getElementById('st-nick').textContent = u.nickname;
    document.getElementById('st-id').textContent = u.id;
    document.getElementById('st-created').textContent = '—';
    document.getElementById('st-sessions').textContent = '—';
    document.getElementById('st-time').textContent = '—';
    document.getElementById('st-talk').textContent = '—';
    document.getElementById('stats-modal').classList.remove('hidden');
  }

  document.getElementById('my-id').addEventListener('click', showStats);
  document.getElementById('stats-btn').addEventListener('click', showStats);

  setInterval(function() {
    if (!document.getElementById('stats-modal').classList.contains('hidden')) {
      document.getElementById('st-time').textContent = db.fmtTime(db.getTimeOnSite(userId));
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
    db.saveStats(userId, { totalTime: db.getTimeOnSite(userId), talkTime: talkTime });
    var keys = Object.keys(peers);
    for (var i = 0; i < keys.length; i++) peers[keys[i]].close();
    if (localStream) localStream.getTracks().forEach(function(t) { t.stop(); });
    if (channel) { channel.untrack(); supa.removeChannel(channel); }
    db.logout();
    window.location.href = 'index.html';
  });

  // --- init ---
  db.getUser(userId, function(err, u) {
    if (err || !u) { window.location.href = 'index.html'; return; }
    myUser = u;
    document.getElementById('app').classList.remove('hidden');
    document.getElementById('my-nickname').textContent = u.nickname;
    document.getElementById('my-id').textContent = userId;
    addUserToList(u, true);

    var stats = db.getStats(userId);
    if (!stats.loginTime) db.saveStats(userId, { loginTime: Date.now(), sessions: (stats.sessions || 0) + 1 });
    else db.saveStats(userId, { loginTime: Date.now(), sessions: (stats.sessions || 0) + 1 });

    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
        .then(function(stream) {
          localStream = stream;
          joinRoom();
        })
        .catch(function(err) {
          notify('Микрофон недоступен: ' + err.message, 'error');
          document.getElementById('call-status').innerHTML =
            '<div class="status-icon">🔇</div><h2>Микрофон недоступен</h2><p>Разрешите доступ к микрофону и обновите страницу</p>';
          joinRoom();
        });
    } else {
      notify('Микрофон недоступен (нужен HTTPS)', 'error');
      joinRoom();
    }
  });
})();
