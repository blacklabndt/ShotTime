// Windows: embed the WeldScope icon and version information in the .exe.
fn main() {
    println!("cargo:rerun-if-changed=assets/app.ico");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        let mut res = winresource::WindowsResource::new();
        if std::env::var("HOST").map_or(false, |h| !h.contains("windows")) {
            res.set_toolkit_path("/usr/bin").set_windres_path("x86_64-w64-mingw32-windres").set_ar_path("x86_64-w64-mingw32-ar");
        }
        res.set_icon("assets/app.ico")
            .set("ProductName", "WeldScope")
            .set("FileDescription", "WeldScope - DICONDE image editor")
            .set("CompanyName", "WeldScope")
            .set("LegalCopyright", "WeldScope. OpenJPEG: BSD 2-clause, see THIRD-PARTY-NOTICES.txt");
        if let Err(e) = res.compile() { println!("cargo:warning=icon resource not embedded: {e}"); }
    }
}
