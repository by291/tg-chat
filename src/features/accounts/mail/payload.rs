use aes_gcm::{
    Aes256Gcm, KeyInit, Nonce,
    aead::{Aead, Payload},
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::features::accounts::AccountError;

const NONCE_BYTES: usize = 12;

#[derive(Deserialize, Serialize)]
pub struct OutgoingMail {
    pub recipient: String,
    pub subject: String,
    pub body: String,
}

pub(crate) struct EncryptedMail {
    pub ciphertext: Vec<u8>,
    pub nonce: [u8; NONCE_BYTES],
}

#[derive(Clone)]
pub(crate) struct MailCipher(Aes256Gcm);

impl MailCipher {
    /// Hold the configured AES key without exposing it through Debug or serialization.
    pub(crate) fn new(key: &[u8; 32]) -> Result<Self, AccountError> {
        let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| AccountError::Unavailable)?;

        Ok(Self(cipher))
    }

    /// Encrypt mail intent with a fresh nonce and bind it to the immutable job identity.
    pub(crate) fn encrypt(
        &self,
        id: Uuid,
        mail: &OutgoingMail,
    ) -> Result<EncryptedMail, AccountError> {
        let mut nonce = [0; NONCE_BYTES];
        getrandom::fill(&mut nonce).map_err(|_| AccountError::Unavailable)?;
        let plaintext = serde_json::to_vec(mail).map_err(|_| AccountError::Unavailable)?;
        let payload = Payload {
            msg: &plaintext,
            aad: id.as_bytes(),
        };
        let ciphertext =
            self.0.encrypt(&Nonce::from(nonce), payload).map_err(|_| AccountError::Unavailable)?;

        Ok(EncryptedMail {
            ciphertext,
            nonce,
        })
    }

    /// Reject modified ciphertext, wrong keys, and payloads copied from a different job.
    pub(crate) fn decrypt(
        &self,
        id: Uuid,
        mail: EncryptedMail,
    ) -> Result<OutgoingMail, AccountError> {
        let payload = Payload {
            msg: &mail.ciphertext,
            aad: id.as_bytes(),
        };
        let plaintext = self
            .0
            .decrypt(&Nonce::from(mail.nonce), payload)
            .map_err(|_| AccountError::Unavailable)?;

        serde_json::from_slice(&plaintext).map_err(|_| AccountError::Unavailable)
    }
}
