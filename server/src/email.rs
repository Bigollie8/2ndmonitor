//! Outbound account email: verification and password reset.
//!
//! The DECISION (which of three things should happen to this message) is a
//! pure function, table-tested. The EFFECT (talking to a relay) is injected,
//! the same way `ReviewFn` injects the AI reviewer — so every branch is
//! testable without a mail server.
//!
//! Before 0.9.0 an unset `SMTP_URL` silently returned the verification token
//! in the API response. That was a deliberate contract for a friends-scale
//! service, and it is exactly wrong once strangers can register: it lets
//! anyone self-verify unlimited accounts, and email verification is the only
//! sybil control the design has. So "no relay" now REFUSES by default, and
//! returning tokens has to be asked for by name.

use crate::state::Config;

/// What should happen to an outbound account email.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EmailMode {
    /// A relay is configured: send it.
    Smtp,
    /// Explicitly-requested local development: return the token to the caller
    /// so a human can paste it. NEVER reachable without opting in.
    DevReturnToken,
    /// No relay and no opt-in: fail the request rather than hand out a token.
    Refuse,
}

/// `smtp_url` is `Config::smtp_url`, `dev_email` is `Config::dev_email`.
///
/// A configured relay always wins, so a `DEV_EMAIL=1` left behind in a unit
/// file cannot silently reopen the self-verification hole on a box that can
/// actually send mail.
pub fn email_mode(smtp_url: Option<&str>, dev_email: bool) -> EmailMode {
    let has_relay = smtp_url.map(|s| !s.trim().is_empty()).unwrap_or(false);
    if has_relay {
        EmailMode::Smtp
    } else if dev_email {
        EmailMode::DevReturnToken
    } else {
        EmailMode::Refuse
    }
}

fn base(base_url: &str) -> &str {
    base_url.trim_end_matches('/')
}

/// (subject, plain-text body) for the verification mail.
pub fn verify_body(base_url: &str, token: &str) -> (String, String) {
    let link = format!("{}/auth/verify?token={}", base(base_url), token);
    (
        "Verify your 2ndMonitor marketplace account".to_string(),
        format!(
            "Welcome to the 2ndMonitor marketplace.\n\n\
             Confirm this address to finish creating your account:\n\n{link}\n\n\
             The link is valid for 24 hours. If you did not sign up, ignore \
             this message and no account will be created.\n"
        ),
    )
}

/// (subject, plain-text body) for the password reset mail.
pub fn reset_body(base_url: &str, token: &str) -> (String, String) {
    let link = format!("{}/auth/reset?token={}", base(base_url), token);
    (
        "Reset your 2ndMonitor marketplace password".to_string(),
        format!(
            "A password reset was requested for this address.\n\n{link}\n\n\
             The link is valid for 24 hours. If you did not request this, \
             ignore this message -- your password has not changed.\n"
        ),
    )
}

/// Blocking SMTP send. Called from a `spawn_blocking` context by the handler,
/// the same shape every other blocking call in this workspace uses.
///
/// Plain text only, deliberately: an HTML body would need escaping of
/// user-controlled content and buys nothing for two transactional messages.
pub fn send(cfg: &Config, to: &str, subject: &str, body: &str) -> Result<(), String> {
    use lettre::message::header::ContentType;
    use lettre::transport::smtp::authentication::Credentials;
    use lettre::{Message, SmtpTransport, Transport};

    let url = cfg.smtp_url.as_deref().unwrap_or_default();
    let parsed = url::Url::parse(url).map_err(|e| format!("SMTP_URL is not a URL: {e}"))?;

    let message = Message::builder()
        .from(cfg.smtp_from.parse().map_err(|e| format!("SMTP_FROM invalid: {e}"))?)
        .to(to.parse().map_err(|e| format!("recipient invalid: {e}"))?)
        .subject(subject)
        .header(ContentType::TEXT_PLAIN)
        .body(body.to_string())
        .map_err(|e| format!("could not build message: {e}"))?;

    let host = parsed.host_str().ok_or("SMTP_URL has no host")?;
    let mut transport = if parsed.scheme() == "smtps" {
        SmtpTransport::relay(host).map_err(|e| format!("relay: {e}"))?
    } else {
        SmtpTransport::starttls_relay(host).map_err(|e| format!("relay: {e}"))?
    };
    if let Some(port) = parsed.port() {
        transport = transport.port(port);
    }
    if !parsed.username().is_empty() {
        transport = transport.credentials(Credentials::new(
            parsed.username().to_string(),
            parsed.password().unwrap_or_default().to_string(),
        ));
    }

    transport
        .build()
        .send(&message)
        .map(|_| ())
        .map_err(|e| format!("send failed: {e}"))
}
