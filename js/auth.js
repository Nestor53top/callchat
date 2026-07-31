(function() {
  if (!db.init()) {
    document.getElementById('auth-error').textContent = 'Не удалось подключиться к Supabase';
    return;
  }

  var nicknameInput = document.getElementById('nickname');
  var passwordInput = document.getElementById('password');
  var confirmInput = document.getElementById('confirm-password');
  var authBtn = document.getElementById('auth-btn');
  var authToggle = document.getElementById('auth-toggle');
  var errorEl = document.getElementById('auth-error');
  var confirmGroup = document.getElementById('confirm-group');

  var isRegister = false;

  authBtn.addEventListener('click', function() {
    errorEl.textContent = '';
    var nick = nicknameInput.value.trim();
    var pwd = passwordInput.value;

    if (!nick || nick.length < 2) { errorEl.textContent = 'Никнейм минимум 2 символа'; return; }
    if (!pwd || pwd.length < 4) { errorEl.textContent = 'Пароль минимум 4 символа'; return; }

    authBtn.disabled = true;
    authBtn.textContent = 'Загрузка...';

    if (isRegister) {
      if (pwd !== confirmInput.value) {
        errorEl.textContent = 'Пароли не совпадают';
        authBtn.disabled = false;
        authBtn.textContent = 'Создать аккаунт';
        return;
      }
      db.register(nick, pwd, function(err, user) {
        authBtn.disabled = false;
        authBtn.textContent = 'Создать аккаунт';
        if (err) { errorEl.textContent = err; return; }
        db.loginSession(user.id);
        window.location.href = 'chat.html';
      });
    } else {
      db.login(nick, pwd, function(err, user) {
        authBtn.disabled = false;
        authBtn.textContent = 'Войти';
        if (err) { errorEl.textContent = err; return; }
        db.loginSession(user.id);
        window.location.href = 'chat.html';
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
