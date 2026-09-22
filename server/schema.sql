CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, start_date TEXT NOT NULL,
  end_date TEXT NOT NULL, daily_capacity INTEGER NOT NULL CHECK (daily_capacity > 0),
  deposit_per_guest INTEGER NOT NULL CHECK (deposit_per_guest > 0)
);
CREATE TABLE IF NOT EXISTS event_days (
  visit_date TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id)
);
CREATE TABLE IF NOT EXISTS zones (
  id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id),
  name TEXT NOT NULL, capacity INTEGER NOT NULL, sort_order INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS seating_units (
  id TEXT PRIMARY KEY, zone_id TEXT NOT NULL REFERENCES zones(id),
  name TEXT NOT NULL, capacity INTEGER NOT NULL CHECK (capacity > 0), sort_order INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS reservations (
  id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, token_hash TEXT NOT NULL,
  event_id TEXT NOT NULL REFERENCES events(id), visit_date TEXT NOT NULL REFERENCES event_days(visit_date),
  guest_count INTEGER NOT NULL CHECK (guest_count BETWEEN 1 AND 65),
  customer_name TEXT, phone TEXT, note TEXT,
  status TEXT NOT NULL CHECK (status IN ('HOLD','PENDING_PAYMENT','PENDING_VERIFICATION','CONFIRMED','MENU_SELECTED','CHECKED_IN','DONE','EXPIRED','CANCELLED')),
  deposit_amount INTEGER NOT NULL, unique_code INTEGER NOT NULL,
  expires_at TEXT, created_at TEXT NOT NULL, confirmed_at TEXT
);
CREATE INDEX IF NOT EXISTS reservations_date_status ON reservations(visit_date, status);
CREATE TABLE IF NOT EXISTS reservation_seats (
  reservation_id TEXT NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  unit_id TEXT NOT NULL REFERENCES seating_units(id),
  guest_count INTEGER NOT NULL CHECK (guest_count > 0), PRIMARY KEY (reservation_id, unit_id)
);
CREATE TABLE IF NOT EXISTS admin_users (
  id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT PRIMARY KEY, admin_id TEXT NOT NULL REFERENCES admin_users(id), expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS login_attempts (
  attempt_key TEXT PRIMARY KEY, failures INTEGER NOT NULL, expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  token_hash TEXT PRIMARY KEY, admin_id TEXT NOT NULL REFERENCES admin_users(id),
  expires_at TEXT NOT NULL, used_at TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS password_reset_tokens_admin ON password_reset_tokens(admin_id, expires_at);
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY, reservation_id TEXT NOT NULL REFERENCES reservations(id), amount INTEGER NOT NULL,
  proof_name TEXT NOT NULL, proof_type TEXT NOT NULL, proof_base64 TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING','VERIFIED','REJECTED')),
  uploaded_at TEXT NOT NULL, verified_by TEXT REFERENCES admin_users(id), verified_at TEXT
);
CREATE INDEX IF NOT EXISTS payments_reservation ON payments(reservation_id);
CREATE TABLE IF NOT EXISTS menu_products (
  id TEXT PRIMARY KEY, external_id TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  category TEXT NOT NULL, price INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1,
  synced_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reservation_menu_items (
  id TEXT PRIMARY KEY, reservation_id TEXT NOT NULL REFERENCES reservations(id),
  product_id TEXT NOT NULL REFERENCES menu_products(id), quantity INTEGER NOT NULL CHECK (quantity > 0), note TEXT
);
CREATE TABLE IF NOT EXISTS pos_drafts (
  reservation_id TEXT PRIMARY KEY REFERENCES reservations(id), external_reference TEXT NOT NULL UNIQUE,
  draft_id TEXT, status TEXT NOT NULL, last_error TEXT, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY, admin_id TEXT REFERENCES admin_users(id),
  reservation_id TEXT REFERENCES reservations(id), action TEXT NOT NULL, created_at TEXT NOT NULL
);
