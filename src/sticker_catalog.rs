//! Bundled sticker identities shared by message and account preference validation.

use std::{collections::HashSet, sync::LazyLock};

use serde::Deserialize;

#[derive(Deserialize)]
struct StickerPack {
    id: String,
    stickers: Vec<StickerAsset>,
}

#[derive(Deserialize)]
struct StickerAsset {
    id: String,
}

struct StickerCatalog {
    pack_ids: Vec<String>,
    sticker_ids: HashSet<String>,
}

static CATALOG: LazyLock<StickerCatalog> = LazyLock::new(|| {
    let packs: Vec<StickerPack> =
        serde_json::from_str(include_str!("../web/src/features/stickers/publicStickerPacks.json"))
            .expect("bundled sticker catalogue is valid");
    let mut catalog = StickerCatalog {
        pack_ids: Vec::with_capacity(packs.len()),
        sticker_ids: HashSet::new(),
    };
    for pack in packs {
        catalog.pack_ids.push(pack.id);
        for sticker in pack.stickers {
            catalog.sticker_ids.insert(sticker.id);
        }
    }

    catalog
});

/// Return the default order of packs shipped with the application.
pub(crate) fn pack_ids() -> &'static [String] {
    &CATALOG.pack_ids
}

/// Check whether a message references an available bundled sticker.
pub(crate) fn contains_sticker(sticker_id: &str) -> bool {
    CATALOG.sticker_ids.contains(sticker_id)
}
