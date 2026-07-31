(function() {
  var nicknameInput = document.getElementById('nickname');
  var passwordInput = document.getElementById('password');
  var confirmInput = document.getElementById('confirm-password');
  var authBtn = document.getElementById('auth-btn');
  var authToggle = document.getElementById('auth-toggle');
  var errorEl = document.getElementById('auth-error');
  var confirmGroup = document.getElementById('confirm-group');

  var isRegister = false;
  var API = window.location.protocol + '//' + window.location.hostname + ':8081';

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

  authBtn.addEventListener('click', function() {
    errorEl.textContent = '';
    var nick = nicknameInput.value.trim();
    var pwd = passwordInput.value;

    if (!nick || nick.length < 2) { errorEl.textContent = 'Никнейм минимум 2 символа'; return; }
    if (!pwd || pwd.length < 4) { errorEl.textContent = 'Пароль минимум 4 символа'; return; }

    if (isRegister) {
      var confirm = confirmInput.value;
      if (pwd !== confirm) { errorEl.textContent = 'Пароли не совпадают'; return; }

      // try server first
      api('/api/register?nickname=' + encodeURIComponent(nick) + '&password=' + encodeURIComponent(pwd), function(err, res) {
        if (!err && res && res.ok) {
          db.loginSession(res.user.id);
          // also save locally
          var localResult = db.register(nick, pwd);
          window.location.href = 'chat.html';
        } else {
          // fallback to local
          var localResult = db.register(nick, pwd);
          if (localResult.ok) {
            db.loginSession(localResult.user.id);
            window.location.href = 'chat.html';
          } else {
            errorEl.textContent = (res && res.error) || localResult.error || 'Ошибка';
          }
        }
      });
    } else {
      api('/api/login?nickname=' + encodeURIComponent(nick) + '&password=' + encodeURIComponent(pwd), function(err, res) {
        if (!err && res && res.ok) {
          db.loginSession(res.user.id);
          window.location.href = 'chat.html';
        } else {
          var localResult = db.login(nick, pwd);
          if (localResult.ok) {
            db.loginSession(localResult.user.id);
            window.location.href = 'chat.html';
          } else {
            errorEl.textContent = (res && res.error) || localResult.error || 'Ошибка';
          }
        }
      });
    }
  });

  authToggle.addEventListener('click', function(e) {
    e.preventDefault();
    isRegister = !isRegister;
    errorEl.textContent = '';
    if (isRegister) {
      authBtn.textContent = 'Создать аккаунт';
      authToggle.textContent = 'Войти';
      confirmGroup.classList.remove('hidden');
    } else {
      authBtn.textContent = 'Войти';
      authToggle.textContent = 'Создать';
      confirmGroup.classList.add('hidden');
    }
  });

  if (db.getSession()) window.location.href = 'chat.html';
})();
