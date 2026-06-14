fn main() {
    // tauri.conf.json reads the app version from package.json ("version": "../package.json").
    // Cargo doesn't know that indirect file feeds the Windows version resource, so without
    // this it won't re-run the build script on a version bump and the exe metadata goes stale.
    println!("cargo:rerun-if-changed=../package.json");
    tauri_build::build()
}
