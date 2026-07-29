//! Marketplace server for Second-Monitor Hub.
//! `cargo run` starts it locally; see server/README.md for deployment.

use hub_marketplace::{build_state, router, state::Config};

#[tokio::main]
async fn main() {
    let cfg = Config::from_env();
    std::fs::create_dir_all(&cfg.data_dir).expect("create data dir");
    let conn = rusqlite::Connection::open(cfg.data_dir.join("marketplace.db")).expect("open db");
    let seed = hub_marketplace::keys::load_or_generate(&cfg.data_dir);
    println!("index signing pubkey: {}", hub_marketplace::keys::pubkey_hex(&seed));
    let state = build_state(cfg.clone(), conn, seed);

    let addr = std::net::SocketAddr::from(([0, 0, 0, 0], cfg.port));
    println!("hub-marketplace listening on http://{addr}");
    let listener = tokio::net::TcpListener::bind(addr).await.expect("bind");
    axum::serve(listener, router(state)).await.expect("serve");
}
