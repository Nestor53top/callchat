(function() {
  var userId = db.getSession();
  if (!userId) { window.location.href = 'index.html'; return; }
  if (!db.init()) { return; }

  var currentMic = localStorage.getItem('vh_mic') || '';
  var currentSpk = localStorage.getItem('vh_spk') || '';

  db.getUser(userId, function(err, u) {
    if (err || !u) { window.location.href = 'index.html'; return; }
    document.getElementById('set-nick').textContent = u.nickname;
    document.getElementById('set-id').textContent = u.id;
  });

  function notify(msg, type) {
    var el = document.getElementById('notification');
    el.textContent = msg;
    el.className = 'notification ' + (type || 'info');
    el.style.display = 'block';
    clearTimeout(el._t);
    el._t = setTimeout(function() { el.style.display = 'none'; }, 3000);
  }

  function buildSelect(triggerId, dropdownId, textId, items, selectedId, onSelect) {
    var trigger = document.getElementById(triggerId);
    var dropdown = document.getElementById(dropdownId);
    var textEl = document.getElementById(textId);
    var selected = null;
    for (var i = 0; i < items.length; i++) {
      if (items[i].id === selectedId) { selected = items[i]; break; }
    }
    if (!selected && items.length > 0) selected = items[0];
    textEl.textContent = selected ? selected.label : 'Нет устройств';
    dropdown.innerHTML = '';
    items.forEach(function(device) {
      var opt = document.createElement('div');
      opt.className = 'select-option' + (device.id === selectedId ? ' selected' : '');
      opt.textContent = device.label;
      opt.addEventListener('mousedown', function(e) {
        e.preventDefault();
        e.stopPropagation();
        textEl.textContent = device.label;
        var allOpts = dropdown.querySelectorAll('.select-option');
        for (var j = 0; j < allOpts.length; j++) allOpts[j].classList.remove('selected');
        opt.classList.add('selected');
        trigger.classList.remove('open');
        dropdown.classList.remove('open');
        onSelect(device.id);
      });
      dropdown.appendChild(opt);
    });
    if (items.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'select-option disabled';
      empty.textContent = 'Устройства не найдены';
      dropdown.appendChild(empty);
    }
    trigger.addEventListener('click', function(e) {
      e.stopPropagation();
      closeAllSelects();
      trigger.classList.add('open');
      dropdown.classList.add('open');
    });
  }

  function closeAllSelects() {
    document.querySelectorAll('.select-dropdown').forEach(function(d) { d.classList.remove('open'); });
    document.querySelectorAll('.select-trigger').forEach(function(t) { t.classList.remove('open'); });
  }
  document.addEventListener('click', function(e) {
    if (!e.target.closest('.custom-select')) closeAllSelects();
  });

  var micStream = null;
  var animFrame = null;

  function startMicTest(deviceId) {
    if (micStream) { micStream.getTracks().forEach(function(t) { t.stop(); }); micStream = null; }
    if (animFrame) cancelAnimationFrame(animFrame);
    var constraints = { audio: true };
    if (deviceId && deviceId !== 'default') constraints.audio = { deviceId: { exact: deviceId } };
    navigator.mediaDevices.getUserMedia(constraints).then(function(stream) {
      micStream = stream;
      var ctx = new (window.AudioContext || window.webkitAudioContext)();
      var src = ctx.createMediaStreamSource(stream);
      var analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      var bar = document.getElementById('mic-bar');
      var levelText = document.getElementById('mic-level-text');
      var data = new Uint8Array(analyser.frequencyBinCount);
      function draw() {
        analyser.getByteFrequencyData(data);
        var avg = 0;
        for (var i = 0; i < data.length; i++) avg += data[i];
        avg /= data.length;
        var pct = Math.min(100, Math.max(2, (avg / 128) * 100));
        bar.style.width = pct + '%';
        if (pct < 5) levelText.textContent = 'Тихо...';
        else if (pct < 25) levelText.textContent = 'Нормально';
        else if (pct < 60) levelText.textContent = 'Громко';
        else levelText.textContent = 'Очень громко!';
        animFrame = requestAnimationFrame(draw);
      }
      draw();
    }).catch(function(err) {
      document.getElementById('mic-level-text').textContent = 'Ошибка: ' + err.message;
    });
  }

  function enumerateDevices() {
    navigator.mediaDevices.enumerateDevices().then(function(devices) {
      var mics = [], speakers = [];
      for (var i = 0; i < devices.length; i++) {
        var d = devices[i];
        if (d.kind === 'audioinput') mics.push({ id: d.deviceId, label: d.label || ('Микрофон ' + (mics.length + 1)) });
        else if (d.kind === 'audiooutput') speakers.push({ id: d.deviceId, label: d.label || ('Динамик ' + (speakers.length + 1)) });
      }
      if (mics.length === 0) mics.push({ id: 'default', label: 'Микрофон по умолчанию' });
      if (speakers.length === 0) speakers.push({ id: 'default', label: 'Динамики по умолчанию' });
      var selMic = currentMic || mics[0].id;
      var selSpk = currentSpk || speakers[0].id;
      buildSelect('mic-trigger', 'mic-dropdown', 'mic-text', mics, selMic, function(id) {
        currentMic = id;
        localStorage.setItem('vh_mic', id);
        startMicTest(id);
        notify('Микрофон сохранён', 'info');
      });
      buildSelect('spk-trigger', 'spk-dropdown', 'spk-text', speakers, selSpk, function(id) {
        currentSpk = id;
        localStorage.setItem('vh_spk', id);
        notify('Наушники сохранены', 'info');
      });
      startMicTest(selMic);
    });
  }

  document.getElementById('logout-btn').addEventListener('click', function() {
    db.logout();
    window.location.href = 'index.html';
  });

  enumerateDevices();
})();
