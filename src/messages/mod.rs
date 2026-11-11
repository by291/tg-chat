//! Durable message identity, canonical content, and conversation-owned acceptance.

pub mod bodies;
pub mod content;
mod markup;
pub mod polls;

pub(crate) mod acceptance;
mod model;
pub(crate) mod service;

pub use model::{CanonicalMessage, Destination, SendMessage, SendReceipt};
pub use service::MessageService;

pub(crate) mod history;
pub use history::{HistoryPage, HistoryQuery};

pub(crate) mod http;

pub(crate) mod commands;
pub(crate) mod projection;
pub use commands::{CommandAction, CommandReceipt, MessageCommand};
pub use model::{ReactionView, ReplyInput, ReplyView};
