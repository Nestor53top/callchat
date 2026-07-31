-- ============================================
-- VoiceHub — Supabase Setup SQL
-- Выполните этот скрипт в Supabase SQL Editor
-- ============================================

-- Таблица пользователей
CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT UNIQUE NOT NULL,
  nickname TEXT NOT NULL,
  color TEXT DEFAULT '#7c3aed',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_seen TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Индексы
CREATE INDEX IF NOT EXISTS idx_users_user_id ON users(user_id);
CREATE INDEX IF NOT EXISTS idx_users_nickname ON users(nickname);
CREATE INDEX IF NOT EXISTS idx_users_last_seen ON users(last_seen);

-- RLS (Row Level Security)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Полный доступ для анонимных пользователей (для начала)
CREATE POLICY "Allow all for anonymous" ON users
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Включаем Realtime для таблицы users
ALTER PUBLICATION supabase_realtime ADD TABLE users;

-- Функция автоматического обновления last_seen
CREATE OR REPLACE FUNCTION update_last_seen()
RETURNS TRIGGER AS $$
BEGIN
  NEW.last_seen = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Триггер для автоматического обновления last_seen
CREATE TRIGGER trigger_update_last_seen
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_last_seen();

-- Функция очистки неактивных пользователей (старше 1 минуты)
CREATE OR REPLACE FUNCTION cleanup_inactive_users()
RETURNS void AS $$
BEGIN
  DELETE FROM users WHERE last_seen < NOW() - INTERVAL '1 minute';
END;
$$ LANGUAGE plpgsql;
