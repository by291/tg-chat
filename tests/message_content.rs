use serde::Deserialize;
use tg_chat::messages::content::{CustomEmoji, MessageContent, validate_content};

const EMOJI_ID: &str = "5249007745805328497";

#[derive(Deserialize)]
struct Fixture {
    name: String,
    input: MessageContent,
}

fn plain(text: &str) -> MessageContent {
    MessageContent {
        schema_version: 1,
        text: text.to_owned(),
        rich_text: None,
        custom_emoji: Vec::new(),
    }
}

#[test]
fn shared_semantic_fixtures_keep_canonical_text_and_utf16_ranges() {
    let fixtures: Vec<Fixture> =
        serde_json::from_str(include_str!("../contracts/message-content.json")).unwrap();
    for fixture in fixtures {
        let expected = fixture.input.clone();
        let canonical = validate_content(fixture.input).expect(&fixture.name);
        assert_eq!(canonical.text, expected.text, "{}", fixture.name);
        assert_eq!(canonical.custom_emoji, expected.custom_emoji, "{}", fixture.name);
        assert_eq!(validate_content(canonical.clone()).unwrap(), canonical);
        if let Some(html) = canonical.rich_text {
            assert!(!html.contains("onclick"));
            assert!(!html.contains("javascript:"));
            assert!(!html.contains("<script"));
            assert!(!html.contains("<img"));
            assert!(!html.contains("style="));
        }
    }
}

#[test]
fn invalid_versions_text_and_emoji_alignment_are_rejected() {
    let mut unsupported = plain("Message");
    unsupported.schema_version = 2;
    assert!(validate_content(unsupported).is_err());
    assert!(validate_content(plain("   ")).is_err());
    assert!(validate_content(plain(&"🌍".repeat(2049))).is_err());

    let mut mismatched = plain("Different");
    mismatched.rich_text = Some("<p>Canonical</p>".to_owned());
    assert!(validate_content(mismatched).is_err());
    let mut split_surrogate = plain("😂");
    split_surrogate.custom_emoji.push(CustomEmoji {
        document_id: EMOJI_ID.to_owned(),
        offset: 1,
        length: 1,
    });
    assert!(validate_content(split_surrogate).is_err());
    let mut unknown_asset = plain("😂");
    unknown_asset.custom_emoji.push(CustomEmoji {
        document_id: "unknown".to_owned(),
        offset: 0,
        length: 2,
    });
    assert!(validate_content(unknown_asset).is_err());

    let mut misleading_formula = plain("Different source");
    misleading_formula.rich_text =
        Some("<span data-math=\"x^2\">Different source</span>".to_owned());
    assert!(validate_content(misleading_formula).is_err());
}

#[test]
fn rich_content_work_is_bounded_before_acceptance() {
    let mut nested = plain("Nested");
    nested.rich_text = Some(format!("{}Nested{}", "<span>".repeat(33), "</span>".repeat(33)));
    assert!(validate_content(nested).is_err());
    let mut oversized = plain("Message");
    oversized.rich_text = Some(" ".repeat(65_537));
    assert!(validate_content(oversized).is_err());
    let mut large_table = plain("Cell");
    large_table.rich_text = Some(format!("<table><tr>{}</tr></table>", "<td>Cell</td>".repeat(21)));
    assert!(validate_content(large_table).is_err());
    let mut formula = plain("x");
    formula.rich_text = Some(format!("<span data-math=\"{}\">x</span>", "x".repeat(2049)));
    assert!(validate_content(formula).is_err());
}
