//! Durable message identity, canonical content, and conversation-owned acceptance.

pub mod bodies;
pub mod checklists;
pub mod content;
pub(crate) mod forwarding;
pub mod link_previews;
pub mod maintenance;
mod markup;
pub mod polls;

pub(crate) mod acceptance;
mod model;
pub(crate) mod service;

pub use forwarding::{ForwardBatch, ForwardItem, ForwardReceipt};
pub use model::{CanonicalMessage, Destination, SendMessage, SendReceipt};
pub use service::MessageService;

pub(crate) mod history;
pub use history::{HistoryPage, HistoryQuery};

pub(crate) mod search;
pub use search::{MessageKind, SearchPage, SearchQuery};

pub(crate) mod http;

pub(crate) mod commands;
pub(crate) mod projection;
pub(crate) mod read_time;
pub use commands::{CommandAction, CommandReceipt, MessageCommand};
pub use model::{ReactionView, ReplyInput, ReplyView};
pub use read_time::MessageReadTime;
