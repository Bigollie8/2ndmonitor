use hub_marketplace::email::{email_mode, reset_body, verify_body, EmailMode};

#[test]
fn a_configured_relay_sends_mail() {
    assert_eq!(email_mode(Some("smtp://relay:25"), false), EmailMode::Smtp);
}

// The whole point of this phase. Before it, an unset SMTP_URL silently
// returned the verification token in the API response, which lets anyone
// self-verify unlimited accounts -- and email verification is the only
// sybil control in the 0.9.0 design.
#[test]
fn no_relay_and_no_explicit_dev_flag_refuses_rather_than_leaking_the_token() {
    assert_eq!(email_mode(None, false), EmailMode::Refuse);
}

#[test]
fn dev_mode_must_be_asked_for_explicitly() {
    assert_eq!(email_mode(None, true), EmailMode::DevReturnToken);
}

// A relay beats the dev flag: if mail can really be sent, send it. Otherwise
// a stray DEV_EMAIL=1 left in a unit file would silently reopen the hole.
#[test]
fn a_relay_wins_over_the_dev_flag() {
    assert_eq!(email_mode(Some("smtp://relay:25"), true), EmailMode::Smtp);
}

#[test]
fn an_empty_relay_url_is_not_a_relay() {
    assert_eq!(email_mode(Some(""), false), EmailMode::Refuse);
    assert_eq!(email_mode(Some("   "), true), EmailMode::DevReturnToken);
}

#[test]
fn the_verify_link_is_absolute_and_carries_the_token() {
    let (subject, body) = verify_body("https://market.test", "abc123");
    assert!(subject.to_lowercase().contains("verify"));
    assert!(body.contains("https://market.test/auth/verify?token=abc123"));
}

#[test]
fn the_reset_link_is_absolute_and_carries_the_token() {
    let (_subject, body) = reset_body("https://market.test", "tok999");
    assert!(body.contains("https://market.test/auth/reset?token=tok999"));
}

// A trailing slash in PUBLIC_BASE_URL must not produce a double slash: some
// mail clients and proxies treat "//auth" as a different path.
#[test]
fn a_trailing_slash_in_the_base_url_does_not_double_up() {
    let (_s, body) = verify_body("https://market.test/", "t");
    assert!(!body.contains("//auth"));
}
