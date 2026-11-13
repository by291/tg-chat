//! Validate typed send content and project the public fields retained with each message.

use serde::{Deserialize, Serialize};
use sqlx::PgConnection;
use utoipa::ToSchema;
use uuid::Uuid;

use super::{checklists, polls, service::AcceptanceError};
use crate::features::{accounts::AccountError, contacts, sticker_catalog};

const MAX_CONTACT_NAME_LENGTH: usize = 80;
const MAX_CONTACT_PHONE_LENGTH: usize = 40;

#[derive(Clone, Deserialize, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum MessageBodyInput {
    Poll(polls::PollInput),
    Checklist(checklists::ChecklistInput),
    Sticker {
        sticker_id: String,
    },
    Contact {
        display_name: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        account_id: Option<Uuid>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        phone: Option<String>,
    },
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(crate) enum StoredMessageBody {
    Poll,
    Checklist,
    PollSnapshot {
        question: String,
        options: Vec<polls::PollOptionInput>,
    },
    ChecklistSnapshot {
        title: String,
        tasks: Vec<super::forwarding::ChecklistSnapshotTask>,
    },
    Sticker {
        sticker_id: String,
    },
    Contact {
        display_name: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        account_id: Option<Uuid>,
        #[serde(skip_serializing_if = "Option::is_none")]
        phone: Option<String>,
    },
}

#[derive(Clone, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum MessageBodyView {
    Poll(polls::PollView),
    Checklist(checklists::ChecklistView),
    PollSnapshot {
        question: String,
        options: Vec<polls::PollOptionInput>,
    },
    ChecklistSnapshot {
        title: String,
        tasks: Vec<super::forwarding::ChecklistSnapshotTask>,
    },
    Sticker {
        sticker_id: String,
    },
    Contact {
        display_name: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        account_id: Option<Uuid>,
        #[serde(skip_serializing_if = "Option::is_none")]
        phone: Option<String>,
    },
}

fn validate_contact_field(field: &str, max_length: usize) -> bool {
    !field.is_empty() && field.chars().count() <= max_length && !field.chars().any(char::is_control)
}

/// Normalize typed content before deriving its durable request fingerprint.
pub(crate) fn normalize(body: MessageBodyInput) -> Result<MessageBodyInput, AccountError> {
    match body {
        MessageBodyInput::Poll(mut poll) => {
            polls::normalize(&mut poll)?;
            Ok(MessageBodyInput::Poll(poll))
        }
        MessageBodyInput::Checklist(mut checklist) => {
            checklists::normalize(&mut checklist)?;
            Ok(MessageBodyInput::Checklist(checklist))
        }
        MessageBodyInput::Sticker {
            sticker_id,
        } => Ok(MessageBodyInput::Sticker {
            sticker_id,
        }),
        MessageBodyInput::Contact {
            display_name,
            account_id,
            phone,
        } => {
            let display_name = display_name.trim().to_owned();
            if !validate_contact_field(&display_name, MAX_CONTACT_NAME_LENGTH) {
                return Err(AccountError::Validation("invalid contact name"));
            }

            let phone = phone.map(|phone| phone.trim().to_owned());
            let phone = phone.filter(|phone| !phone.is_empty());
            let is_invalid_phone = phone
                .as_deref()
                .is_some_and(|phone| !validate_contact_field(phone, MAX_CONTACT_PHONE_LENGTH));
            if is_invalid_phone {
                return Err(AccountError::Validation("invalid contact phone"));
            }

            Ok(MessageBodyInput::Contact {
                display_name,
                account_id,
                phone,
            })
        }
    }
}

/// Authorize account links when accepting a new message and retain only explicitly shared fields.
pub(crate) async fn store(
    connection: &mut PgConnection,
    user_id: Uuid,
    body: &MessageBodyInput,
) -> Result<StoredMessageBody, AcceptanceError> {
    match body {
        MessageBodyInput::Poll(_) => Ok(StoredMessageBody::Poll),
        MessageBodyInput::Checklist(_) => Ok(StoredMessageBody::Checklist),
        MessageBodyInput::Sticker {
            sticker_id,
        } => {
            // Old accepted sticker identities remain replayable after catalogue changes.
            if !sticker_catalog::contains_sticker(sticker_id) {
                return Err(AccountError::Validation("unknown bundled sticker").into());
            }

            Ok(StoredMessageBody::Sticker {
                sticker_id: sticker_id.clone(),
            })
        }
        MessageBodyInput::Contact {
            display_name,
            account_id,
            phone,
        } => {
            if let Some(account_id) = account_id {
                contacts::directory::visible_profile(connection, user_id, *account_id)
                    .await?
                    .ok_or(AccountError::NotFound)?;
            }

            Ok(StoredMessageBody::Contact {
                display_name: display_name.clone(),
                account_id: *account_id,
                phone: phone.clone(),
            })
        }
    }
}

/// Project a retained body without exposing any storage-only fields.
pub(crate) async fn project(
    connection: &mut PgConnection,
    reader: polls::PollReader<'_>,
    body: StoredMessageBody,
) -> Result<MessageBodyView, AccountError> {
    let view = match body {
        StoredMessageBody::Poll => MessageBodyView::Poll(polls::view(connection, reader).await?),
        StoredMessageBody::Checklist => {
            let reader = checklists::ChecklistReader {
                message: reader.message,
                user_id: reader.user_id,
            };
            MessageBodyView::Checklist(checklists::view(connection, reader).await?)
        }
        StoredMessageBody::PollSnapshot {
            question,
            options,
        } => MessageBodyView::PollSnapshot {
            question,
            options,
        },
        StoredMessageBody::ChecklistSnapshot {
            title,
            tasks,
        } => MessageBodyView::ChecklistSnapshot {
            title,
            tasks,
        },
        StoredMessageBody::Sticker {
            sticker_id,
        } => MessageBodyView::Sticker {
            sticker_id,
        },
        StoredMessageBody::Contact {
            display_name,
            account_id,
            phone,
        } => MessageBodyView::Contact {
            display_name,
            account_id,
            phone,
        },
    };

    Ok(view)
}
