use std::{borrow::Cow, collections::HashSet};

use ammonia::{Builder, UrlRelative};
use scraper::{ElementRef, Html, Node};

use crate::accounts::AccountError;

use super::content::{CustomEmoji, POLICY, known_emoji};

const MAX_DATE_TIMESTAMP: f64 = 8_640_000_000_000_000.0;

pub(super) struct CanonicalMarkup {
    pub html: String,
    pub text: String,
    pub custom_emoji: Vec<CustomEmoji>,
}

fn has_tag(tags: &[String], name: &str) -> bool {
    tags.iter().any(|tag| tag == name)
}

fn safe_url(value: &str) -> bool {
    if value.starts_with('#') || (value.starts_with('/') && !value.starts_with("//")) {
        return true;
    }
    let Ok(url) = url::Url::parse(value) else {
        return false;
    };

    matches!(url.scheme(), "http" | "https" | "mailto" | "tel" | "tg")
}

fn safe_attribute(tag: &str, name: &str, value: &str) -> bool {
    let is_boolean = matches!(value, "true" | "false");
    match name {
        "href" => tag == "a" && safe_url(value),
        "data-custom-emoji" => tag == "span" && known_emoji(value),
        "data-spoiler" => tag == "span" && value == "true",
        "data-math" => tag == "span" && !value.is_empty(),
        "data-math-display" => tag == "span" && matches!(value, "inline" | "block"),
        "data-message-date" => {
            let timestamp = value.parse::<f64>();
            matches!(tag, "span" | "time")
                && timestamp.is_ok_and(|time| time.is_finite() && time.abs() <= MAX_DATE_TIMESTAMP)
        }
        "datetime" => tag == "time" && chrono::DateTime::parse_from_rfc3339(value).is_ok(),
        "data-collapsed" => tag == "blockquote" && is_boolean,
        "data-code-language" => {
            let is_language = !value.is_empty()
                && value.chars().all(|character| {
                    character.is_ascii_alphanumeric() || "_+#.-".contains(character)
                });
            matches!(tag, "pre" | "code") && is_language
        }
        "data-list-type" => tag == "ul" && value == "check",
        "data-checked" | "aria-checked" => tag == "li" && is_boolean,
        "start" => tag == "ol" && value.parse::<i64>().is_ok(),
        "value" => tag == "li" && value.parse::<i64>().is_ok(),
        "colspan" | "rowspan" => {
            matches!(tag, "td" | "th")
                && value
                    .parse::<usize>()
                    .is_ok_and(|span| (1..=POLICY.max_cell_span).contains(&span))
        }
        _ => false,
    }
}

fn check_element_bounds(element: ElementRef<'_>) -> Result<(), AccountError> {
    let name = element.value().name();
    let limit = match name {
        "tr" => Some(("td", "th")),
        "table" => Some(("tr", "tr")),
        _ => None,
    };
    if let Some((first, second)) = limit {
        let count = element.descendants().filter_map(ElementRef::wrap).filter(|child| {
            let tag = child.value().name();
            tag == first || tag == second
        });
        if count.count() > POLICY.max_table_size {
            return Err(AccountError::Validation("message table exceeds supported dimensions"));
        }
    }
    let is_formula_too_long = element
        .attr("data-math")
        .is_some_and(|formula| formula.encode_utf16().count() > POLICY.max_formula_units);
    if is_formula_too_long {
        return Err(AccountError::Validation("formula input is too long"));
    }

    Ok(())
}

fn check_markup_bounds(html: &str) -> Result<(), AccountError> {
    if html.len() > POLICY.max_html_bytes {
        return Err(AccountError::Validation("message markup is too large"));
    }
    let parsed = Html::parse_fragment(html);
    let root = parsed.root_element();
    for (index, node) in root.descendants().enumerate() {
        if index >= POLICY.max_nodes || node.ancestors().count() > POLICY.max_depth {
            return Err(AccountError::Validation("message markup is too complex"));
        }
        if let Some(element) = ElementRef::wrap(node) {
            check_element_bounds(element)?;
        }
    }

    Ok(())
}

fn sanitize(html: &str) -> String {
    let tags: HashSet<&str> = POLICY.tags.iter().map(String::as_str).collect();
    let attributes: HashSet<&str> = POLICY.attributes.iter().map(String::as_str).collect();
    let mut sanitizer = Builder::default();
    sanitizer.tags(tags).generic_attributes(attributes).tag_attributes(Default::default());
    sanitizer.link_rel(None).url_relative(UrlRelative::PassThrough);
    sanitizer.add_url_schemes(["tg"]);
    sanitizer.attribute_filter(|tag, name, value| {
        if safe_attribute(tag, name, value) {
            return Some(Cow::Borrowed(value));
        }
        None
    });

    sanitizer.clean(html).to_string()
}

fn append_boundary(text: &mut String) {
    if !text.is_empty() && !text.ends_with('\n') && !text.ends_with('\t') {
        text.push('\n');
    }
}

fn collect_children(element: ElementRef<'_>, content: &mut CanonicalMarkup) {
    // The renderer uses the formula attribute, so search text must describe that same source.
    if let Some(formula) = element.attr("data-math") {
        content.text.push_str(formula);
        return;
    }
    for child in element.children() {
        if let Node::Text(text) = child.value() {
            content.text.push_str(text);
        } else if let Some(child) = ElementRef::wrap(child) {
            collect_text(child, content);
        }
    }
}

fn collect_text(element: ElementRef<'_>, content: &mut CanonicalMarkup) {
    let name = element.value().name();
    let is_block = has_tag(&POLICY.blocks, name);
    if is_block {
        append_boundary(&mut content.text);
    }
    if name == "br" {
        content.text.push('\n');
    }
    let start = content.text.encode_utf16().count();
    collect_children(element, content);
    if let Some(document_id) = element.attr("data-custom-emoji") {
        let length = content.text.encode_utf16().count() - start;
        content.custom_emoji.push(CustomEmoji {
            document_id: document_id.to_owned(),
            offset: start as u32,
            length: length as u32,
        });
    }
    if matches!(name, "td" | "th") {
        // Lexical wraps cell contents in paragraphs; the cell owns its final separator.
        while content.text.ends_with('\n') {
            content.text.pop();
        }
        content.text.push('\t');
    }
    if name == "tr" {
        while content.text.ends_with('\t') {
            content.text.pop();
        }
    }
    if is_block {
        append_boundary(&mut content.text);
    }
}

/// Produce bounded sanitized HTML and its deterministic text/entity projection.
pub(super) fn canonical_markup(html: &str) -> Result<CanonicalMarkup, AccountError> {
    check_markup_bounds(html)?;
    let html = sanitize(html);
    let parsed = Html::parse_fragment(&html);
    let mut canonical = CanonicalMarkup {
        html,
        text: String::new(),
        custom_emoji: Vec::new(),
    };
    collect_text(parsed.root_element(), &mut canonical);
    while canonical.text.ends_with('\n') {
        canonical.text.pop();
    }

    Ok(canonical)
}
