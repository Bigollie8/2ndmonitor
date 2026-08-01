//! ed25519 index signing. The seed lives at SERVER_DATA_DIR/signing.key
//! (hex, 32 bytes) and is generated on first run — BACK IT UP: the app pins
//! the public key, so a lost seed means every install must re-pin.

use ed25519_dalek::{Signer, SigningKey, Verifier, VerifyingKey};

pub fn load_or_generate(data_dir: &std::path::Path) -> [u8; 32] {
    let path = data_dir.join("signing.key");
    if let Ok(text) = std::fs::read_to_string(&path) {
        if let Ok(bytes) = hex::decode(text.trim()) {
            if let Ok(seed) = <[u8; 32]>::try_from(bytes.as_slice()) {
                return seed;
            }
        }
        panic!("{} exists but is not 32 hex bytes — refusing to overwrite", path.display());
    }
    use rand::RngCore;
    let mut seed = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut seed);
    std::fs::create_dir_all(data_dir).expect("create data dir");
    std::fs::write(&path, hex::encode(seed)).expect("write signing.key");
    seed
}

pub fn pubkey_hex(seed: &[u8; 32]) -> String {
    hex::encode(SigningKey::from_bytes(seed).verifying_key().to_bytes())
}

pub fn sign_hex(seed: &[u8; 32], message: &[u8]) -> String {
    hex::encode(SigningKey::from_bytes(seed).sign(message).to_bytes())
}

/// Mirrored by the app's Rust side before trusting an index.
pub fn verify_index(bundles_json: &str, sig_hex: &str, pubkey_hex: &str) -> bool {
    let Ok(pk_bytes) = hex::decode(pubkey_hex) else { return false };
    let Ok(pk_arr) = <[u8; 32]>::try_from(pk_bytes.as_slice()) else { return false };
    let Ok(pk) = VerifyingKey::from_bytes(&pk_arr) else { return false };
    let Ok(sig_bytes) = hex::decode(sig_hex) else { return false };
    let Ok(sig_arr) = <[u8; 64]>::try_from(sig_bytes.as_slice()) else { return false };
    pk.verify(bundles_json.as_bytes(), &ed25519_dalek::Signature::from_bytes(&sig_arr)).is_ok()
}
