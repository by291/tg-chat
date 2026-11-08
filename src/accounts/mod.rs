//! Account identity and authoritative session ownership.

mod credentials;
mod extractors;
pub mod http;
mod model;
pub mod operator;
mod rate_limit;
mod service;
mod sessions;
mod settings;
pub mod transport;

pub use model::{
    AccountError, Actor, Login, PasswordChange, PrivateProfile, Registration, RevokeSession,
    SessionGrant, SessionView,
};
pub use service::AccountService;
pub use settings::AccountSettings;
