-- Older read cursors cannot establish when the peer first read an individual message.
ALTER TABLE messages ADD COLUMN first_read_at timestamptz;
