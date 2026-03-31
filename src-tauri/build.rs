use std::{fs, path::PathBuf};

const FALLBACK_ICON_PNG: &[u8] = &[
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48,
    0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00,
    0x00, 0x1F, 0x15, 0xC4, 0x89, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x44, 0x41, 0x54, 0x78,
    0x9C, 0x63, 0xF8, 0xCF, 0xC0, 0xF0, 0x1F, 0x00, 0x05, 0x00, 0x01, 0xFF, 0x89, 0x99,
    0x3D, 0x1D,
    0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
];

fn ensure_fallback_icon_png(icons_dir: &PathBuf) {
    let icon_path = icons_dir.join("icon.png");
    if icon_path.exists() {
        return;
    }

    fs::write(&icon_path, FALLBACK_ICON_PNG).expect("failed to write fallback PNG icon");
}

fn ensure_fallback_icon_ico(icons_dir: &PathBuf) {
    let icon_path = icons_dir.join("icon.ico");
    if icon_path.exists() {
        return;
    }

    let png_len = FALLBACK_ICON_PNG.len() as u32;
    let png_offset = 6u32 + 16u32;

    let mut ico = Vec::with_capacity((png_offset + png_len) as usize);
    // ICONDIR
    ico.extend_from_slice(&0u16.to_le_bytes()); // reserved
    ico.extend_from_slice(&1u16.to_le_bytes()); // icon type
    ico.extend_from_slice(&1u16.to_le_bytes()); // image count

    // ICONDIRENTRY
    ico.push(1); // width
    ico.push(1); // height
    ico.push(0); // color count
    ico.push(0); // reserved
    ico.extend_from_slice(&1u16.to_le_bytes()); // planes
    ico.extend_from_slice(&32u16.to_le_bytes()); // bpp
    ico.extend_from_slice(&png_len.to_le_bytes()); // bytes in resource
    ico.extend_from_slice(&png_offset.to_le_bytes()); // offset

    // image data as PNG
    ico.extend_from_slice(FALLBACK_ICON_PNG);

    fs::write(&icon_path, ico).expect("failed to write fallback ICO icon");
}

fn ensure_fallback_icons() {
    let manifest_dir = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let icons_dir = manifest_dir.join("icons");

    fs::create_dir_all(&icons_dir).expect("failed to create icons directory");
    ensure_fallback_icon_png(&icons_dir);
    ensure_fallback_icon_ico(&icons_dir);
}

fn main() {
    ensure_fallback_icons();
    tauri_build::build()
}
