use hub_marketplace::handle::{normalise, validate};

#[test]
fn normalise_trims_and_lowercases() {
    assert_eq!(normalise("  OliverJ  "), "oliverj");
}

#[test]
fn a_good_handle_round_trips() {
    assert_eq!(validate("Oliver_J"), Ok("oliver_j".to_string()));
    assert_eq!(validate("a-b-c"), Ok("a-b-c".to_string()));
    assert_eq!(validate("abc"), Ok("abc".to_string()));
}

#[test]
fn too_short_and_too_long_are_rejected() {
    assert!(validate("ab").is_err());
    assert!(validate(&"a".repeat(25)).is_err());
    assert!(validate(&"a".repeat(24)).is_ok());
}

#[test]
fn illegal_characters_are_rejected() {
    for bad in ["has space", "dot.dot", "sla/sh", "emoji\u{1F600}", "at@sign", "plus+one"] {
        assert!(validate(bad).is_err(), "{bad} should be rejected");
    }
}

// Impersonation is the cheapest attack on a marketplace: a bundle by
// "official" reads as first-party.
#[test]
fn reserved_handles_are_rejected_case_insensitively() {
    assert!(validate("admin").is_err());
    assert!(validate("ADMIN").is_err());
    assert!(validate("Official").is_err());
    assert!(validate("2ndmonitor").is_err());
}

#[test]
fn a_reserved_word_as_a_substring_is_fine() {
    assert!(validate("admin-tools").is_ok(), "only the whole handle is reserved");
}

#[test]
fn an_empty_handle_is_rejected() {
    assert!(validate("").is_err());
    assert!(validate("   ").is_err());
}
