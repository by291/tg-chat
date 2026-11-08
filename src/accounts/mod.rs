//! Account identity and authoritative session ownership.

mod credentials;
pub(crate) mod extractors;
pub mod http;
mod model;
pub mod operator;
pub mod profile;
mod rate_limit;
mod service;
pub(crate) mod sessions;
mod settings;
pub mod transport;

pub use model::{
    AccountError, Actor, Login, PasswordChange, PrivateProfile, Registration, RevokeSession,
    SessionGrant, SessionView,
};
pub use service::AccountService;
pub use settings::AccountSettings;
