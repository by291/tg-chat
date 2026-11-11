//! Private media ownership and durable upload reservations.

pub(crate) mod avatars;
mod cleanup;
mod downloads;
pub(crate) mod http;
mod jobs;
mod model;
mod processing;
pub(crate) mod references;
mod settings;
mod storage;
mod transfer;
mod uploads;

pub use avatars::SetAvatar;
pub use cleanup::MediaCleanup;
pub use downloads::{
    AvatarDownload, AvatarOwner, DownloadReference, MessageDownload, SignedDownload,
};
pub use jobs::{MediaWorker, MediaWorkerSettings};
pub use model::{
    MediaFileView, MediaVariant, ReserveUpload, SignedUpload, TransferMode, TransferPlan,
    TransferRequest, UploadPurpose, UploadState, UploadStatus,
};
pub use settings::{MediaLimits, MediaStorageSettings};
pub use transfer::UploadService;
pub use uploads::UploadReservations;

pub use references::{AttachmentInput, AttachmentView};
