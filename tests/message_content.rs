use scraper::{Html, Selector};
use serde::Deserialize;
use tg_chat::features::messages::content::{CustomEmoji, MessageContent, validate_content};

const EMOJI_ID: &str = "5249007745805328497";

#[derive(Deserialize)]
struct Fixture {
    name: String,
    input: MessageContent,
    expected_selectors: Vec<String>,
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
        let expected = &fixture.input;
        let canonical = validate_content(fixture.input.clone()).expect(&fixture.name);
        assert_eq!(canonical.text, expected.text, "{}", fixture.name);
        assert_eq!(canonical.custom_emoji, expected.custom_emoji, "{}", fixture.name);
        assert_eq!(validate_content(canonical.clone()).unwrap(), canonical);
        assert_canonical_markup(&fixture, &canonical);
    }
}

fn assert_canonical_markup(fixture: &Fixture, canonical: &MessageContent) {
    let name = &fixture.name;
    if fixture.input.rich_text.is_none() {
        assert!(canonical.rich_text.is_none(), "{name}");
        return;
    }

    let html = canonical.rich_text.as_ref().expect(name);
    let document = Html::parse_fragment(html);
    for selector in &fixture.expected_selectors {
        let query = Selector::parse(selector).unwrap();
        assert!(document.select(&query).next().is_some(), "{name}: missing {selector}");
    }
    let executable = Selector::parse("script, img, [onclick], [onerror], [style]").unwrap();
    assert!(document.select(&executable).next().is_none(), "{name}");
    assert!(!html.contains("javascript:"), "{name}");
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
