//! Ingestion service — dev skeleton.
//!
//! Will ingest course material (PDFs, images, ...) into an S3-compatible object
//! store and enqueue OCR jobs for workers in Postgres.
fn main() {
    println!("ingestion: course-material OCR pipeline (dev skeleton)");

    let mut missing = Vec::new();
    for var in ["DATABASE_URL", "S3_ENDPOINT", "S3_BUCKET"] {
        match std::env::var(var) {
            Ok(value) => println!("  {var} = {value}"),
            Err(_) => {
                println!("  {var} = <unset>");
                missing.push(var);
            }
        }
    }

    if !missing.is_empty() {
        println!("hint: run via `nix run .#dev` or enter `nix develop` first");
    }
}
