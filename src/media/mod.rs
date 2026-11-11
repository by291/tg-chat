//! Private media ownership and durable upload reservations.

pub(crate) mod http;
mod jobs;
mod model;
mod processing;
mod settings;
mod storage;
mod transfer;
mod uploads;

pub use jobs::{MediaWorker, MediaWorkerSettings};
pub use model::{
    MediaFileView, MediaVariant, ReserveUpload, SignedUpload, TransferMode, TransferPlan,
    TransferRequest, UploadPurpose, UploadState, UploadStatus,
};
pub use settings::{MediaLimits, MediaStorageSettings};
pub use transfer::UploadService;
pub use uploads::UploadReservations;
