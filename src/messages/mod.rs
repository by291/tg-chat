//! Durable message identity, canonical content, and conversation-owned acceptance.

pub mod content;
mod markup;

mod acceptance;
mod model;
pub(crate) mod service;

pub use model::{CanonicalMessage, Destination, SendMessage, SendReceipt};
pub use service::MessageService;
