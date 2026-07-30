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
            preview BLOB,
            PRIMARY KEY (id, version)
        );
        "#,
    )
    .expect("schema init");

    migrate_add_preview_column(conn);
}

/// `CREATE TABLE IF NOT EXISTS` above only runs the full `CREATE TABLE` body
/// against a database that has no `bundles` table yet. The live deployment
/// already has one, with 15 published bundles, so adding `preview` to the
/// literal `CREATE TABLE` text above is a no-op there — the statement is
/// skipped entirely because the table already exists. Reaching an existing
/// install requires an explicit `ALTER TABLE`, guarded by checking
/// `PRAGMA table_info` first so this is safe (and a no-op) to call on every
/// startup, including against a database that already has the column.
fn migrate_add_preview_column(conn: &Connection) {
    let mut stmt = conn
        .prepare("PRAGMA table_info(bundles)")
        .expect("prepare table_info");
    let has_preview = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .expect("query table_info")
        .filter_map(Result::ok)
        .any(|name| name == "preview");
    drop(stmt);
    if !has_preview {
        conn.execute("ALTER TABLE bundles ADD COLUMN preview BLOB", [])
            .expect("add preview column");
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    fn bundles_columns(conn: &Connection) -> Vec<String> {
        let mut stmt = conn.prepare("PRAGMA table_info(bundles)").unwrap();
        stmt.query_map([], |r| r.get::<_, String>(1))
            .unwrap()
            .filter_map(Result::ok)
            .collect()
    }

    #[test]
    fn fresh_database_gets_preview_column_from_create_statement() {
        let conn = Connection::open_in_memory().unwrap();
        init(&conn);
        assert!(bundles_columns(&conn).iter().any(|c| c == "preview"));
    }

    #[test]
    fn existing_database_without_preview_column_gains_it_without_losing_rows() {
        let conn = Connection::open_in_memory().unwrap();
        // Simulate a pre-migration deployment: `bundles` already exists, so
        // `CREATE TABLE IF NOT EXISTS` in `init` is a guaranteed no-op here —
        // this is exactly the shape of the live database before this change.
        conn.execute_batch(
            r#"
            CREATE TABLE bundles (
                id TEXT NOT NULL,
                version TEXT NOT NULL,
                kind TEXT NOT NULL,
                name TEXT NOT NULL,
                author_id INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                permissions TEXT NOT NULL DEFAULT '[]',
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
        .unwrap();
        conn.execute(
            "INSERT INTO bundles (id, version, kind, name, author_id, manifest, created_at)
             VALUES ('demo', '1.0', 'preset', 'Demo', 1, '{}', 0)",
            [],
        )
        .unwrap();

        init(&conn);
        assert!(
            bundles_columns(&conn).iter().any(|c| c == "preview"),
            "migration must add the preview column to a pre-existing bundles table"
        );
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM bundles", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1, "existing rows must survive the migration");

        // Re-running init (as happens on every server startup) must not
        // error out trying to add a column that is already there.
        init(&conn);
        init(&conn);
    }
}
