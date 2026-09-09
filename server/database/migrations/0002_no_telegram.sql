-- Telegram and every outward notification path are gone: the Dnevnik and the
-- in-app attention list are the only channels, so nothing needs a chat id.
-- Plain DROP COLUMN is safe here — no index, trigger, view or foreign key
-- mentions the column (`users_email_uq` is on `email` alone).
ALTER TABLE `users` DROP COLUMN `telegram_chat_id`;
