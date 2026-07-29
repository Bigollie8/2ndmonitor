//! Schema + tiny helpers. One SQLite file (or :memory: in tests) behind a
//! Mutex — this serves one household, not the internet; simplicity wins.

use rusqlite::Connection;

pub fn init(conn: &Connection) {
    conn.execute_batch(
        r#"
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY,
            email TEXT UNIQUE NOT NULL,
            pass_hash TEXT NOT NULL,
            verified INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS tokens (
            token TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            kind TEXT NOT NULL,           -- 'session' | 'verify' | 'reset'
            expires_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS bundles (
            id TEXT NOT NULL,
            version TEXT NOT NULL,
            kind TEXT NOT NULL,           -- 'preset' | 'visualizer' | 'tile'
            name TEXT NOT NULL,
            author_id INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',  -- 'pending'|'approved'|'rejected'
            permissions TEXT NOT NULL DEFAULT '[]',  -- JSON array of "net:.."/"tauri:.."
            manifest TEXT NOT NULL,
            code TEXT,
            sha256 TEXT,
            size INTEGER,
            zip BLOB,
            ai_report TEXT,
            review_note TEXT,
            downloads INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            PRIMARY KEY (id, version)
        );
        "#,
    )
    .expect("schema init");
}

pub fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
}

pub fn rand_token() -> String {
    use rand::RngCore;
    let mut b = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut b);
    hex::encode(b)
}
