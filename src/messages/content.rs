use std::{collections::HashMap, sync::LazyLock};

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::accounts::AccountError;

use super::markup::canonical_markup;

pub(super) static POLICY: LazyLock<ContentPolicy> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../../contracts/message-policy.json"))
        .expect("bundled message policy is valid")
});
static EMOJI: LazyLock<HashMap<String, String>> = LazyLock::new(|| {
    let packs: Vec<EmojiPack> =
        serde_json::from_str(include_str!("../../web/src/features/emoji/publicEmojiPacks.json"))
            .expect("bundled emoji catalogue is valid");
    let mut entries = HashMap::new();
    for pack in packs {
        for emoji in pack.emojis {
            entries.insert(emoji.id, emoji.emoji);
        }
    }

    entries
});

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CustomEmoji {
    pub document_id: String,
    pub offset: u32,
    pub length: u32,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct MessageContent {
    pub schema_version: u16,
    pub text: String,
    pub rich_text: Option<String>,
    pub custom_emoji: Vec<CustomEmoji>,
}

#[derive(Deserialize)]
pub(super) struct ContentPolicy {
    pub schema_version: u16,
    pub max_text_units: usize,
    pub max_html_bytes: usize,
    pub max_depth: usize,
    pub max_nodes: usize,
    pub max_emoji: usize,
    pub max_table_size: usize,
    pub max_cell_span: usize,
    pub max_formula_units: usize,
    pub tags: Vec<String>,
    pub attributes: Vec<String>,
    pub blocks: Vec<String>,
}

#[derive(Deserialize)]
struct EmojiPack {
    emojis: Vec<EmojiAsset>,
}

#[derive(Deserialize)]
struct EmojiAsset {
    id: String,
    emoji: String,
}

/// Restrict transported custom emoji to the deployed, provenance-tracked catalogue.
pub(super) fn known_emoji(document_id: &str) -> bool {
    EMOJI.contains_key(document_id)
}

fn validate_emoji(content: &MessageContent) -> Result<(), AccountError> {
    if content.custom_emoji.len() > POLICY.max_emoji {
        return Err(AccountError::Validation("too many custom emoji"));
    }
    let text_units: Vec<u16> = content.text.encode_utf16().collect();
    let mut previous_end = 0;
    for entity in &content.custom_emoji {
        let start = entity.offset as usize;
        let end = start.checked_add(entity.length as usize);
        let Some(end) = end.filter(|end| *end <= text_units.len()) else {
            return Err(AccountError::Validation("invalid custom emoji range"));
        };
        if start < previous_end || start >= end {
            return Err(AccountError::Validation("overlapping or empty custom emoji range"));
        }
        let fallback = String::from_utf16(&text_units[start..end])
            .map_err(|_| AccountError::Validation("custom emoji splits a UTF-16 character"))?;
        if EMOJI.get(&entity.document_id) != Some(&fallback) {
            return Err(AccountError::Validation("custom emoji does not match its bundled asset"));
        }
        previous_end = end;
    }

    Ok(())
}

enum TextRequirement {
    Required,
    OptionalCaption,
}

/// Sanitize a text message and reject empty or inconsistent content.
pub fn validate_content(content: MessageContent) -> Result<MessageContent, AccountError> {
    validate_text_content(content, TextRequirement::Required)
}

/// Sanitize a caption, allowing empty text because a file supplies the message body.
pub(crate) fn validate_caption(content: MessageContent) -> Result<MessageContent, AccountError> {
    validate_text_content(content, TextRequirement::OptionalCaption)
}

fn validate_text_content(
    mut content: MessageContent,
    requirement: TextRequirement,
) -> Result<MessageContent, AccountError> {
    if content.schema_version != POLICY.schema_version {
        return Err(AccountError::Validation("unsupported message content version"));
    }
    let text_units = content.text.encode_utf16().count();
    if text_units > POLICY.max_text_units || content.text.contains('\0') {
        return Err(AccountError::Validation("message text exceeds the supported bounds"));
    }

    if let Some(html) = &content.rich_text {
        let canonical = canonical_markup(html)?;
        if content.text != canonical.text || content.custom_emoji != canonical.custom_emoji {
            return Err(AccountError::Validation("message text or emoji do not match its markup"));
        }
        content.rich_text = Some(canonical.html);
    }
    let is_missing_required_text =
        matches!(requirement, TextRequirement::Required) && content.text.trim().is_empty();
    if is_missing_required_text {
        return Err(AccountError::Validation("message text must not be empty"));
    }
    validate_emoji(&content)?;

    Ok(content)
}
