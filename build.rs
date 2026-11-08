fn main() {
    // New migration files must invalidate SQLx's embedded catalogue, even without Rust edits.
    println!("cargo:rerun-if-changed=migrations");
}
