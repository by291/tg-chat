use scraper::{Html, Selector};

use super::{FetchError, Preview};

const MAX_SITE_NAME: usize = 100;
const MAX_TITLE: usize = 200;
const MAX_SUMMARY: usize = 500;

#[derive(Default)]
struct PageMetadata {
    open_graph: Preview,
    document: Preview,
}

/// Extracts the bounded display fields from one HTML document.
pub(super) fn extract(html: &[u8]) -> Result<Preview, FetchError> {
    let text = String::from_utf8_lossy(html);
    let document = Html::parse_document(&text);
    let selector = Selector::parse("head > meta[content], head > title")
        .expect("preview metadata selector is valid");
    let mut metadata = PageMetadata::default();

    for element in document.select(&selector) {
        let tag = element.value();
        if tag.name() == "title" {
            let text = element.text().collect::<String>();
            store_first(&mut metadata.document.title, &text, MAX_TITLE);
            continue;
        }

        let content = tag.attr("content").unwrap_or_default();
        let key = tag.attr("property").or_else(|| tag.attr("name"));
        store_meta(&mut metadata, key, content);
    }

    let preview = Preview {
        site_name: metadata.open_graph.site_name,
        title: prefer(metadata.open_graph.title, metadata.document.title),
        summary: prefer(metadata.open_graph.summary, metadata.document.summary),
    };

    if preview.title.is_empty() && preview.summary.is_empty() {
        return Err(FetchError::Unavailable);
    }

    Ok(preview)
}

fn store_meta(metadata: &mut PageMetadata, key: Option<&str>, content: &str) {
    match key {
        Some("og:site_name") => {
            store_first(&mut metadata.open_graph.site_name, content, MAX_SITE_NAME)
        }
        Some("og:title") => store_first(&mut metadata.open_graph.title, content, MAX_TITLE),
        Some("og:description") => {
            store_first(&mut metadata.open_graph.summary, content, MAX_SUMMARY)
        }
        Some("description") => store_first(&mut metadata.document.summary, content, MAX_SUMMARY),
        _ => {}
    }
}

fn prefer(primary: String, fallback: String) -> String {
    if primary.is_empty() {
        return fallback;
    }

    primary
}

fn store_first(field: &mut String, text: &str, maximum: usize) {
    if !field.is_empty() {
        return;
    }

    let mut pending_space = false;
    let mut remaining = maximum;

    for character in text.chars() {
        if character.is_whitespace() {
            pending_space = !field.is_empty();
            continue;
        }

        // Directional controls can disguise the text shown beside the ordinary clickable link.
        let is_directional_control = matches!(
            character,
            '\u{061c}' | '\u{200e}' | '\u{200f}' | '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}'
        );
        if character.is_control() || is_directional_control {
            continue;
        }

        let required = if pending_space {
            2
        } else {
            1
        };
        if remaining < required {
            break;
        }

        if pending_space {
            field.push(' ');
            pending_space = false;
        }

        field.push(character);
        remaining -= required;
    }
}
