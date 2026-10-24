use std::{ffi::OsStr, path::PathBuf};

const PROTOS: &str = "../proto";

fn main() {
    let mut stack = vec![PathBuf::from(PROTOS)];

    let mut sources = Vec::new();

    // Find all `.proto` files under `PROTOS` path.
    while let Some(path) = stack.pop() {
        let entries = std::fs::read_dir(&path)
            .unwrap_or_else(|e| panic!("could not read directory '{}': {}", path.display(), e));

        for entry in entries {
            let path = entry.unwrap().path();

            if path.is_dir() {
                stack.push(path);
                continue;
            }

            if path.is_file() && path.extension() == Some(OsStr::new("proto")) {
                sources.push(path);
            }
        }
    }

    for source in &sources {
        println!("cargo::rerun-if-changed={}", source.display());
    }

    // Compile all found proto source files.
    tonic_prost_build::configure()
        .compile_protos(&sources, &[PathBuf::from(PROTOS)])
        .unwrap();
}
