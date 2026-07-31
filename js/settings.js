(function() {
  var userId = db.getSession();
  if (!userId) { window.location.href = 'index.html'; return; }
  if (!db.init()) { return; }

  var currentMic = localStorage.getItem('vh_mic') || '';
  var currentSpk = localStorage.getItem('vh_spk') || '';
  var noiseEnabled = localStorage.getItem('vh_noise') !== 'false';
  var echoEnabled = localStorage.getItem('vh_echo') !== 'false';
  var agcEnabled = localStorage.getItem('vh_agc') !== 'false';

  document.getElementById('noise-toggle').checked = noiseEnabled;
  document.getElementById('echo-toggle').checked = echoEnabled;
  document.getElementById('agc-toggle').checked = agcEnabled;

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

  // --- custom select logic ---
  function setupSelect(triggerId, dropdownId, textId, items, selectedId, onSelect) {
    var trigger = document.getElementById(triggerId);
    var dropdown = document.getElementById(dropdownId);
    var textEl = document.getElementById(textId);
    var isOpen = false;

    var selected = items.find(function(d) { return d.id === selectedId; });
    textEl.textContent = selected ? selected.label : items.length > 0 ? items[0].label : 'Нет устройств';

    trigger.addEventListener('click', function(e) {
      e.stopPropagation();
      // close other dropdowns
      document.querySelectorAll('.select-dropdown').forEach(function(d) { d.classList.remove('open'); });
      document.querySelectorAll('.select-trigger').forEach(function(t) { t.classList.remove('open'); });
      isOpen = !isOpen;
      dropdown.classList.toggle('open', isOpen);
      trigger.classList.toggle('open', isOpen);
    });

    dropdown.innerHTML = '';
    items.forEach(function(device) {
      var opt = document.createElement('div');
      opt.className = 'select-option' + (device.id === selectedId ? ' selected' : '');
      opt.textContent = device.label;
      opt.dataset.id = device.id;
      opt.addEventListener('click', function(e) {
        e.stopPropagation();
        textEl.textContent = device.label;
        dropdown.querySelectorAll('.select-option').forEach(function(o) { o.classList.remove('selected'); });
        opt.classList.add('selected');
        dropdown.classList.remove('open');
        trigger.classList.remove('open');
        isOpen = false;
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
  }

  document.addEventListener('click', function() {
    document.querySelectorAll('.select-dropdown').forEach(function(d) { d.classList.remove('open'); });
    document.querySelectorAll('.select-trigger').forEach(function(t) { t.classList.remove('open'); });
  });

  // --- enumerate devices ---
  var micStream = null;
  var analyser = null;
  var animFrame = null;

  function enumerateDevices() {
    navigator.mediaDevices.enumerateDevices().then(function(devices) {
      var mics = devices.filter(function(d) { return d.kind === 'audioinput'; }).map(function(d, i) {
        return { id: d.deviceId, label: d.label || ('Микрофон ' + (i + 1)) };
      });
      var speakers = devices.filter(function(d) { return d.kind === 'audiooutput'; }).map(function(d, i) {
        return { id: d.deviceId, label: d.label || ('Динамик ' + (i + 1)) };
      });

      if (mics.length === 0) mics.push({ id: 'default', label: 'Микрофон по умолчанию' });
      if (speakers.length === 0) speakers.push({ id: 'default', label: 'Динамики по умолчанию' });

      var selectedMic = currentMic || mics[0].id;
      var selectedSpk = currentSpk || speakers[0].id;

      setupSelect('mic-trigger', 'mic-dropdown', 'mic-text', mics, selectedMic, function(id) {
        currentMic = id;
        localStorage.setItem('vh_mic', id);
        startMicTest(id);
        notify('Микрофон изменён', 'info');
      });

      setupSelect('spk-trigger', 'spk-dropdown', 'spk-text', speakers, selectedSpk, function(id) {
        currentSpk = id;
        localStorage.setItem('vh_spk', id);
        notify('Наушники изменены', 'info');
      });

      startMicTest(selectedMic);
    }).catch(function(err) {
      console.error('enumerateDevices err', err);
    });
  }

  // --- mic test with visualizer ---
  function startMicTest(deviceId) {
    if (micStream) {
      micStream.getTracks().forEach(function(t) { t.stop(); });
      micStream = null;
    }
    if (animFrame) cancelAnimationFrame(animFrame);

    var constraints = { audio: true };
    if (deviceId && deviceId !== 'default') {
      constraints.audio = { deviceId: { exact: deviceId } };
    }

    navigator.mediaDevices.getUserMedia(constraints).then(function(stream) {
      micStream = stream;
      var ctx = new (window.AudioContext || window.webkitAudioContext)();
      var src = ctx.createMediaStreamSource(stream);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);

      var bar = document.getElementById('mic-bar');
      var levelText = document.getElementById('mic-level-text');
      var data = new Uint8Array(analyser.frequencyBinCount);

      function draw() {
        analyser.getByteFrequencyData(data);
        var avg = 0;
        for (var i = 0; i < data.length; i++) avg += data[i];
        avg = avg / data.length;
        var pct = Math.min(100, (avg / 128) * 100);
        bar.style.width = pct + '%';

        if (pct < 5) levelText.textContent = 'Тихо...';
        else if (pct < 30) levelText.textContent = 'Нормально';
        else if (pct < 70) levelText.textContent = 'Громко';
        else levelText.textContent = 'Очень громко!';

        animFrame = requestAnimationFrame(draw);
      }
      draw();
    }).catch(function(err) {
      document.getElementById('mic-level-text').textContent = 'Ошибка: ' + err.message;
    });
  }

  // --- toggles ---
  document.getElementById('noise-toggle').addEventListener('change', function() {
    localStorage.setItem('vh_noise', this.checked);
    notify(this.checked ? 'Подавление шума включено' : 'Подавление шума выключено', 'info');
  });

  document.getElementById('echo-toggle').addEventListener('change', function() {
    localStorage.setItem('vh_echo', this.checked);
    notify(this.checked ? 'Эхоподавление включено' : 'Эхоподавление выключено', 'info');
  });

  document.getElementById('agc-toggle').addEventListener('change', function() {
    localStorage.setItem('vh_agc', this.checked);
    notify(this.checked ? 'Автодогонка громкости включена' : 'Автодогонка громкости выключена', 'info');
  });

  // --- logout ---
  document.getElementById('logout-btn').addEventListener('click', function() {
    db.logout();
    window.location.href = 'index.html';
  });

  // --- init ---
  enumerateDevices();
})();
