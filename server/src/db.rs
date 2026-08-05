//! Schema + tiny helpers. One SQLite file (or :memory: in tests) behind a
//! Mutex — this serves one household, not the internet; simplicity wins.

use rusqlite::Connection;

/// `CREATE TABLE IF NOT EXISTS` is a no-op — not a schema update — against a
/// database where the table already exists (see `migrate_add_preview_column`
/// below for the column-on-an-existing-table case that bites). `ratings` does
/// not have that problem: the live deployment predates ratings entirely, so
/// there is no install anywhere with a `ratings` table already present.
/// `IF NOT EXISTS` therefore runs the full `CREATE TABLE` body on every
/// database this code has ever touched (fresh test DB or the live one) — a
/// migration guard would be solving a problem that cannot occur here.
pub fn init(conn: &Connection) {
    conn.execute_batch(
        r#"
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY,
            email TEXT UNIQUE NOT NULL,
            pass_hash TEXT NOT NULL,
            verified INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            display_name TEXT
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
            summary TEXT,
            description TEXT,
            category TEXT,
            tags TEXT NOT NULL DEFAULT '[]',
            icon TEXT,
            changelog TEXT,
            min_app_version TEXT,
            featured INTEGER NOT NULL DEFAULT 0,
            approved_at INTEGER,
            PRIMARY KEY (id, version)
        );
        CREATE TABLE IF NOT EXISTS ratings (
            bundle_id TEXT NOT NULL,      -- no version: a rating is of the
                                           -- bundle as a whole, not a release;
                                           -- re-publishing a new version must
                                           -- not reset the star count.
            user_id   INTEGER NOT NULL,
            stars     INTEGER NOT NULL,
            rated_at  INTEGER NOT NULL,
            PRIMARY KEY (bundle_id, user_id)
        );
        CREATE TABLE IF NOT EXISTS bundle_media (
            bundle_id TEXT NOT NULL,
            version   TEXT NOT NULL,
            idx       INTEGER NOT NULL,
            kind      TEXT NOT NULL,        -- 'still' | 'anim'
            mime      TEXT NOT NULL,        -- image/webp | image/png | image/gif
            bytes     BLOB NOT NULL,
            PRIMARY KEY (bundle_id, version, idx)
        );
        CREATE TABLE IF NOT EXISTS reviews (
            bundle_id  TEXT NOT NULL,      -- no version: same rule as `ratings`,
                                            -- a review is of the bundle, so
                                            -- re-publishing must not wipe it.
            user_id    INTEGER NOT NULL,
            body       TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            hidden     INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (bundle_id, user_id)
        );
        CREATE TABLE IF NOT EXISTS collections (
            slug  TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            blurb TEXT,
            sort  INTEGER NOT NULL DEFAULT 0
        );
        -- Every moderation action, with the PRIOR state needed to undo the
        -- ones that are not a simple flag flip. `actor_handle` is a snapshot
        -- rather than a join, so the log still names who acted after a
        -- rename or after the account is gone.
        -- The feedback loop: somebody followed you, replied to you,
        -- commented on your work, or a moderator acted on your account.
        -- actor_handle is snapshotted so the inbox still reads correctly
        -- after a rename.
        -- An invite proves a human vouched for you, which is the same thing
        -- email verification proves -- so an invited account is created
        -- already verified. Codes and email coexist: a code lets people in
        -- without a mail relay, and configuring SMTP later widens the door
        -- rather than replacing it.
        CREATE TABLE IF NOT EXISTS invites (
            code       TEXT PRIMARY KEY,
            created_by INTEGER,           -- NULL = the shared ADMIN_TOKEN
            created_at INTEGER NOT NULL,
            note       TEXT,              -- who it was meant for
            max_uses   INTEGER NOT NULL DEFAULT 1,
            uses       INTEGER NOT NULL DEFAULT 0,
            expires_at INTEGER,
            revoked    INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS notifications (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id      INTEGER NOT NULL,
            kind         TEXT NOT NULL,   -- follow|comment|reply|mention|moderation
            actor_handle TEXT,
            target_kind  TEXT,
            target_id    TEXT,
            body         TEXT,
            created_at   INTEGER NOT NULL,
            read_at      INTEGER
        );
        CREATE INDEX IF NOT EXISTS notifications_inbox
            ON notifications(user_id, id DESC);

        CREATE TABLE IF NOT EXISTS audit (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            actor_id     INTEGER,          -- NULL = the shared ADMIN_TOKEN
            actor_handle TEXT,
            action       TEXT NOT NULL,
            args         TEXT NOT NULL,    -- JSON
            prior        TEXT,             -- JSON; what it was before
            undoable     INTEGER NOT NULL DEFAULT 0,
            created_at   INTEGER NOT NULL,
            undone_at    INTEGER,
            undone_by    TEXT
        );
        CREATE INDEX IF NOT EXISTS audit_recent ON audit(id DESC);

        CREATE TABLE IF NOT EXISTS topics (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            author_id   INTEGER NOT NULL,
            title       TEXT NOT NULL,
            body        TEXT NOT NULL,
            -- Optional: a topic may hang off one bundle (its discussion
            -- thread) or stand alone in the general board.
            bundle_id   TEXT,
            hidden      INTEGER NOT NULL DEFAULT 0,
            created_at  INTEGER NOT NULL,
            -- Denormalised so the topic list can sort by activity without a
            -- correlated subquery over every reply.
            last_at     INTEGER NOT NULL,
            reply_count INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS topics_recent ON topics(last_at DESC);
        CREATE INDEX IF NOT EXISTS topics_bundle ON topics(bundle_id);

        CREATE TABLE IF NOT EXISTS topic_replies (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            topic_id   INTEGER NOT NULL,
            author_id  INTEGER NOT NULL,
            body       TEXT NOT NULL,
            hidden     INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS replies_topic ON topic_replies(topic_id, created_at);

        -- The shoutbox. Deliberately not a chat log: a small rolling window,
        -- trimmed on write, so it can never become an archive nobody can
        -- moderate.
        CREATE TABLE IF NOT EXISTS shouts (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            author_id  INTEGER NOT NULL,
            body       TEXT NOT NULL,
            hidden     INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS shouts_recent ON shouts(id DESC);

        CREATE TABLE IF NOT EXISTS comments (
            id         INTEGER PRIMARY KEY,
            bundle_id  TEXT NOT NULL,
            user_id    INTEGER NOT NULL,
            body       TEXT NOT NULL,      -- plain text, never markup
            created_at INTEGER NOT NULL,
            -- Soft moderation, like reviews: hiding abuse must not also
            -- destroy the evidence of it.
            hidden     INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS blocks (
            user_id    INTEGER NOT NULL,
            blocked_id INTEGER NOT NULL,
            created_at INTEGER NOT NULL,
            PRIMARY KEY (user_id, blocked_id)
        );
        CREATE TABLE IF NOT EXISTS reports (
            id          INTEGER PRIMARY KEY,
            target_kind TEXT NOT NULL,     -- comment|review|bundle|creator
            target_id   TEXT NOT NULL,
            reporter_id INTEGER NOT NULL,  -- never anonymous: someone filing
                                            -- hundreds is itself visible
            reason      TEXT NOT NULL,
            created_at  INTEGER NOT NULL,
            status      TEXT NOT NULL DEFAULT 'open'
        );
        CREATE TABLE IF NOT EXISTS follows (
            follower_id INTEGER NOT NULL,
            creator_id  INTEGER NOT NULL,
            created_at  INTEGER NOT NULL,
            -- Counts are public, the LIST is not: showing who follows whom is
            -- a harassment surface and a moderation job for something nothing
            -- in the product needs.
            PRIMARY KEY (follower_id, creator_id)
        );
        CREATE TABLE IF NOT EXISTS favourites (
            user_id    INTEGER NOT NULL,
            bundle_id  TEXT NOT NULL,   -- no version: same rule as ratings,
                                        -- a favourite is of the bundle
            created_at INTEGER NOT NULL,
            PRIMARY KEY (user_id, bundle_id)
        );
        CREATE TABLE IF NOT EXISTS collection_items (
            slug      TEXT NOT NULL,
            bundle_id TEXT NOT NULL,
            idx       INTEGER NOT NULL,
            PRIMARY KEY (slug, bundle_id)
        );
        "#,
    )
    .expect("schema init");

    migrate(conn);
}

/// `CREATE TABLE IF NOT EXISTS` above only runs the full `CREATE TABLE` body
/// against a database that has no such table yet. The live deployment already
/// has `bundles` and `users`, so adding a column to the literal `CREATE TABLE`
/// text above is a no-op there — the statement is skipped entirely because the
/// table already exists. Reaching an existing install requires an explicit
/// `ALTER TABLE`, guarded by checking `PRAGMA table_info` first so this is safe
/// (and a no-op) to call on every startup, including against a database that
/// already has the column.
///
/// Generalised from the original single-column `migrate_add_preview_column`
/// when Market v2 added nine more. Note SQLite's rule: `ALTER TABLE ADD COLUMN`
/// rejects `NOT NULL` without a `DEFAULT`, which is why `tags` and `featured`
/// carry one and every other new column is nullable.
fn ensure_column(conn: &Connection, table: &str, name: &str, decl: &str) {
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info({table})"))
        .expect("prepare table_info");
    let present = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .expect("query table_info")
        .filter_map(Result::ok)
        .any(|c| c == name);
    drop(stmt);
    if !present {
        conn.execute(&format!("ALTER TABLE {table} ADD COLUMN {name} {decl}"), [])
            .unwrap_or_else(|e| panic!("add column {table}.{name}: {e}"));
    }
}

fn migrate(conn: &Connection) {
    ensure_column(conn, "bundles", "preview", "BLOB");
    ensure_column(conn, "bundles", "summary", "TEXT");
    ensure_column(conn, "bundles", "description", "TEXT");
    ensure_column(conn, "bundles", "category", "TEXT");
    ensure_column(conn, "bundles", "tags", "TEXT NOT NULL DEFAULT '[]'");
    ensure_column(conn, "bundles", "icon", "TEXT");
    ensure_column(conn, "bundles", "changelog", "TEXT");
    ensure_column(conn, "bundles", "min_app_version", "TEXT");
    ensure_column(conn, "bundles", "featured", "INTEGER NOT NULL DEFAULT 0");
    ensure_column(conn, "bundles", "approved_at", "INTEGER");
    ensure_column(conn, "users", "display_name", "TEXT");
    ensure_column(conn, "users", "handle", "TEXT");
    ensure_column(conn, "users", "bio", "TEXT");
    ensure_column(conn, "users", "links", "TEXT NOT NULL DEFAULT '[]'");
    ensure_column(conn, "users", "avatar_seed", "TEXT");
    ensure_column(conn, "users", "suspended", "INTEGER NOT NULL DEFAULT 0");
    // 0.9.0 community round two: a profile accent (a colour cannot be
    // abusive the way an uploaded banner can) and admin-granted badges,
    // stored as a JSON array so granting a new kind needs no migration.
    ensure_column(conn, "users", "accent", "TEXT");
    ensure_column(conn, "users", "badges", "TEXT NOT NULL DEFAULT '[]'");
    // Profile picture bytes, PNG or JPEG, sniffed on the way in. In the
    // database rather than a directory: one file to back up, and no
    // filesystem path ever derived from user input.
    ensure_column(conn, "users", "avatar", "BLOB");
    // Moderation is a property of a PERSON now, not of one shared secret.
    // 'user' | 'moderator' | 'admin' -- see roles.rs.
    ensure_column(conn, "users", "role", "TEXT NOT NULL DEFAULT 'user'");
    // Set aside rather than deleted, which is the only reason removing a
    // picture is undoable at all (moderation.rs).
    ensure_column(conn, "users", "avatar_removed", "BLOB");
    // Uniqueness is the database's job, not a handler's: two concurrent
    // claims that both pass an application-level "is it taken?" check would
    // both succeed. The WHERE clause says out loud that unclaimed accounts
    // are the normal case — SQLite already treats NULLs as distinct in a
    // UNIQUE index, so this documents intent rather than changing behaviour.
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS users_handle_unique
         ON users(handle) WHERE handle IS NOT NULL",
        [],
    )
    .expect("create users_handle_unique");
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

    fn users_columns(conn: &Connection) -> Vec<String> {
        let mut stmt = conn.prepare("PRAGMA table_info(users)").unwrap();
        stmt.query_map([], |r| r.get::<_, String>(1))
            .unwrap()
            .filter_map(Result::ok)
            .collect()
    }

    #[test]
    fn migration_adds_the_identity_columns() {
        let conn = Connection::open_in_memory().unwrap();
        init(&conn);
        let cols = users_columns(&conn);
        for c in ["handle", "bio", "links", "avatar_seed", "suspended"] {
            assert!(cols.contains(&c.to_string()), "missing users.{c}");
        }
    }

    // Uniqueness must be the DATABASE's job: two concurrent claims that both
    // pass an application-level "is it taken?" check would otherwise both win.
    #[test]
    fn two_accounts_cannot_share_a_handle() {
        let conn = Connection::open_in_memory().unwrap();
        init(&conn);
        conn.execute(
            "INSERT INTO users (email, pass_hash, created_at, handle) VALUES ('a@x','h',0,'taken')",
            [],
        )
        .unwrap();
        let second = conn.execute(
            "INSERT INTO users (email, pass_hash, created_at, handle) VALUES ('b@x','h',0,'taken')",
            [],
        );
        assert!(second.is_err(), "the unique index must reject a duplicate handle");
    }

    // NULL handles are the pre-claim state and there will be many of them.
    #[test]
    fn many_accounts_may_have_no_handle_yet() {
        let conn = Connection::open_in_memory().unwrap();
        init(&conn);
        conn.execute("INSERT INTO users (email, pass_hash, created_at) VALUES ('a@x','h',0)", []).unwrap();
        conn.execute("INSERT INTO users (email, pass_hash, created_at) VALUES ('b@x','h',0)", []).unwrap();
    }

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

    #[test]
    fn fresh_database_gets_the_market_v2_tables() {
        let conn = Connection::open_in_memory().unwrap();
        init(&conn);
        for table in ["bundle_media", "reviews", "collections", "collection_items"] {
            let found: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
                    [table],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(found, 1, "missing table {table}");
        }
    }

    #[test]
    fn market_v2_tables_are_added_to_an_existing_database() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE bundles (id TEXT NOT NULL, version TEXT NOT NULL, kind TEXT NOT NULL,
                 name TEXT NOT NULL, author_id INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
                 permissions TEXT NOT NULL DEFAULT '[]', manifest TEXT NOT NULL, code TEXT,
                 sha256 TEXT, size INTEGER, zip BLOB, ai_report TEXT, review_note TEXT,
                 downloads INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL,
                 PRIMARY KEY (id, version));",
        )
        .unwrap();
        init(&conn);
        let found: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='bundle_media'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(found, 1, "CREATE TABLE IF NOT EXISTS must still create new tables");
    }

    #[test]
    fn one_review_per_user_per_bundle_is_enforced_by_the_primary_key() {
        let conn = Connection::open_in_memory().unwrap();
        init(&conn);
        conn.execute(
            "INSERT INTO reviews (bundle_id, user_id, body, created_at) VALUES ('a', 1, 'first', 0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO reviews (bundle_id, user_id, body, created_at)
             VALUES ('a', 1, 'second', 1)",
            [],
        )
        .unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM reviews", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1, "re-reviewing must replace, not stack");
        let body: String = conn
            .query_row("SELECT body FROM reviews", [], |r| r.get(0))
            .unwrap();
        assert_eq!(body, "second");
    }

    fn columns(conn: &Connection, table: &str) -> Vec<String> {
        let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})")).unwrap();
        stmt.query_map([], |r| r.get::<_, String>(1))
            .unwrap()
            .filter_map(Result::ok)
            .collect()
    }

    const NEW_BUNDLE_COLUMNS: &[&str] = &[
        "summary", "description", "category", "tags", "icon", "changelog", "min_app_version",
        "featured", "approved_at",
    ];

    #[test]
    fn fresh_database_gets_every_market_v2_column() {
        let conn = Connection::open_in_memory().unwrap();
        init(&conn);
        let cols = columns(&conn, "bundles");
        for want in NEW_BUNDLE_COLUMNS {
            assert!(cols.iter().any(|c| c == want), "bundles is missing {want}");
        }
        assert!(
            columns(&conn, "users").iter().any(|c| c == "display_name"),
            "users is missing display_name"
        );
    }

    #[test]
    fn live_shaped_database_gains_every_column_without_losing_rows() {
        let conn = Connection::open_in_memory().unwrap();
        // The live database's shape: `bundles` already exists WITH preview
        // (that migration shipped), so `CREATE TABLE IF NOT EXISTS` is a no-op
        // and only ALTER TABLE can reach it.
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
                preview BLOB,
                PRIMARY KEY (id, version)
            );
            CREATE TABLE users (
                id INTEGER PRIMARY KEY,
                email TEXT UNIQUE NOT NULL,
                pass_hash TEXT NOT NULL,
                verified INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL
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

        let cols = columns(&conn, "bundles");
        for want in NEW_BUNDLE_COLUMNS {
            assert!(cols.iter().any(|c| c == want), "migration missed {want}");
        }
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM bundles", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1, "existing rows must survive the migration");

        // `tags` has a NOT NULL default, so the pre-existing row must have been
        // backfilled with it rather than left NULL.
        let tags: String = conn
            .query_row("SELECT tags FROM bundles WHERE id = 'demo'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(tags, "[]");

        // Every startup re-runs init; adding an existing column must not error.
        init(&conn);
        init(&conn);
    }
}
