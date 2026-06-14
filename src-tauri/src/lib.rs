use serde::Deserialize;
use tauri_plugin_sql::{Migration, MigrationKind};

mod license;
mod updater;

fn default_copies() -> u32 {
    1
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativePrintPage {
    data_url: String,
    width_mm: f64,
    height_mm: f64,
    /// How many identical copies of this label to print (decoded once, drawn N times).
    #[serde(default = "default_copies")]
    copies: u32,
}

struct DecodedPrintPage {
    width_px: i32,
    height_px: i32,
    width_mm: f64,
    height_mm: f64,
    copies: u32,
    /// 1-bit-per-pixel, top-down, DWORD-aligned rows. Labels are black-on-white, so
    /// monochrome cuts the spooled bitmap ~32x vs 32-bit BGRA (which made batches huge).
    stride: usize,
    mono: Vec<u8>,
}

/// Returns the names of the printers installed on the system.
#[tauri::command]
fn list_printers() -> Vec<String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        use std::process::Command;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        match Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                "Get-CimInstance -ClassName Win32_Printer | Select-Object -ExpandProperty Name",
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
        {
            Ok(output) => String::from_utf8_lossy(&output.stdout)
                .lines()
                .map(|l| l.trim().to_string())
                .filter(|l| !l.is_empty())
                .collect(),
            Err(_) => Vec::new(),
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        use std::process::Command;
        match Command::new("lpstat").arg("-a").output() {
            Ok(output) => String::from_utf8_lossy(&output.stdout)
                .lines()
                .filter_map(|l| l.split_whitespace().next().map(|s| s.to_string()))
                .collect(),
            Err(_) => Vec::new(),
        }
    }
}

#[tauri::command]
async fn print_png_labels(
    pages: Vec<NativePrintPage>,
    printer: Option<String>,
) -> Result<String, String> {
    if pages.is_empty() {
        return Ok("Nenhuma pagina para imprimir.".to_string());
    }

    // Decoding the PNGs and driving GDI are blocking; running them on the main thread
    // freezes the whole UI. Offload to a blocking worker so the interface stays live.
    tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        #[cfg(target_os = "windows")]
        {
            print_png_labels_windows(pages, printer.unwrap_or_default())
        }

        #[cfg(not(target_os = "windows"))]
        {
            let _ = pages;
            let _ = printer;
            Err("Impressao sem preview ainda esta disponivel apenas no Windows.".to_string())
        }
    })
    .await
    .map_err(|e| format!("Falha na tarefa de impressao: {e}"))?
}

fn decode_png_data_url(data_url: &str) -> Result<Vec<u8>, String> {
    use base64::{engine::general_purpose, Engine as _};

    let (_, encoded) = data_url
        .split_once(',')
        .ok_or_else(|| "Imagem de impressao invalida.".to_string())?;

    general_purpose::STANDARD
        .decode(encoded)
        .map_err(|err| format!("Falha ao decodificar imagem de impressao: {err}"))
}

#[cfg(target_os = "windows")]
fn print_png_labels_windows(pages: Vec<NativePrintPage>, printer: String) -> Result<String, String> {
    let decoded_pages = pages
        .into_iter()
        .map(decode_print_page)
        .collect::<Result<Vec<_>, _>>()?;

    print_decoded_pages_windows(decoded_pages, printer)
}

#[cfg(target_os = "windows")]
fn decode_print_page(page: NativePrintPage) -> Result<DecodedPrintPage, String> {
    use std::io::Cursor;

    let png_bytes = decode_png_data_url(&page.data_url)?;
    let mut decoder = png::Decoder::new(Cursor::new(png_bytes));
    decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
    let mut reader = decoder
        .read_info()
        .map_err(|err| format!("Falha ao ler PNG de impressao: {err}"))?;
    let mut buffer = vec![0; reader.output_buffer_size().ok_or("PNG de impressao invalido.")?];
    let info = reader
        .next_frame(&mut buffer)
        .map_err(|err| format!("Falha ao decodificar PNG de impressao: {err}"))?;
    let bytes = &buffer[..info.buffer_size()];

    let bgra: Vec<u8> = match info.color_type {
        png::ColorType::Rgb => bytes
            .chunks_exact(3)
            .flat_map(|p| [p[2], p[1], p[0], 255])
            .collect(),
        png::ColorType::Rgba => bytes
            .chunks_exact(4)
            .flat_map(|p| {
                let alpha = p[3] as u16;
                let blend = |channel: u8| -> u8 {
                    (((channel as u16 * alpha) + (255 * (255 - alpha))) / 255) as u8
                };
                [blend(p[2]), blend(p[1]), blend(p[0]), 255]
            })
            .collect(),
        png::ColorType::Grayscale => bytes
            .iter()
            .flat_map(|v| [*v, *v, *v, 255])
            .collect(),
        png::ColorType::GrayscaleAlpha => bytes
            .chunks_exact(2)
            .flat_map(|p| {
                let alpha = p[1] as u16;
                let v = (((p[0] as u16 * alpha) + (255 * (255 - alpha))) / 255) as u8;
                [v, v, v, 255]
            })
            .collect(),
        png::ColorType::Indexed => {
            return Err("PNG indexado nao suportado para impressao direta.".to_string())
        }
    };

    // Pack to 1bpp top-down. Bit = 1 (palette white) for light pixels, 0 (black) for
    // dark — luminance thresholded at mid-grey. Rows are DWORD-aligned per the DIB spec.
    let width = info.width as usize;
    let height = info.height as usize;
    let stride = ((width + 31) / 32) * 4;
    let mut mono = vec![0u8; stride * height];
    for y in 0..height {
        let row = y * stride;
        for x in 0..width {
            let i = (y * width + x) * 4;
            let lum = (bgra[i + 2] as u32 * 299 + bgra[i + 1] as u32 * 587 + bgra[i] as u32 * 114)
                / 1000;
            if lum >= 128 {
                mono[row + (x >> 3)] |= 0x80 >> (x & 7);
            }
        }
    }

    Ok(DecodedPrintPage {
        width_px: info.width as i32,
        height_px: info.height as i32,
        width_mm: page.width_mm,
        height_mm: page.height_mm,
        copies: page.copies.max(1),
        stride,
        mono,
    })
}

#[cfg(target_os = "windows")]
fn print_decoded_pages_windows(
    pages: Vec<DecodedPrintPage>,
    printer: String,
) -> Result<String, String> {
    use std::mem::size_of;
    use std::ptr::null;
    use windows_sys::Win32::Graphics::Gdi::{
        CreateDCW, DeleteDC, GetDeviceCaps, SetStretchBltMode, StretchDIBits, BLACKONWHITE, HDC,
        BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HORZRES, LOGPIXELSX, LOGPIXELSY,
        PHYSICALHEIGHT, PHYSICALOFFSETX, PHYSICALOFFSETY, PHYSICALWIDTH, RGBQUAD, SRCCOPY, VERTRES,
    };

    #[repr(C)]
    struct DocInfoW {
        cb_size: i32,
        doc_name: *const u16,
        output: *const u16,
        datatype: *const u16,
        fw_type: u32,
    }

    #[link(name = "gdi32")]
    unsafe extern "system" {
        fn StartDocW(hdc: HDC, doc_info: *const DocInfoW) -> i32;
        fn EndDoc(hdc: HDC) -> i32;
        fn AbortDoc(hdc: HDC) -> i32;
        fn StartPage(hdc: HDC) -> i32;
        fn EndPage(hdc: HDC) -> i32;
    }

    let page_count: usize = pages.iter().map(|p| p.copies.max(1) as usize).sum();
    let printer_name = if printer.trim().is_empty() {
        get_default_printer_name()?
    } else {
        printer.trim().to_string()
    };

    let driver = to_wide("WINSPOOL");
    let printer_w = to_wide(&printer_name);
    let doc_name = to_wide("Etiquetas");

    unsafe {
        let hdc = CreateDCW(driver.as_ptr(), printer_w.as_ptr(), null(), null());
        if hdc.is_null() {
            return Err(format!(
                "Falha ao abrir impressora '{}': {}",
                printer_name,
                std::io::Error::last_os_error()
            ));
        }

        let doc_info = DocInfoW {
            cb_size: size_of::<DocInfoW>() as i32,
            doc_name: doc_name.as_ptr(),
            output: null(),
            datatype: null(),
            fw_type: 0,
        };

        let job_id = StartDocW(hdc, &doc_info);
        if job_id <= 0 {
            let err = std::io::Error::last_os_error();
            DeleteDC(hdc);
            return Err(format!("Falha ao iniciar job de impressao: {err}"));
        }

        let result = (|| -> Result<(), String> {
            let dpi_x = GetDeviceCaps(hdc, LOGPIXELSX as i32);
            let dpi_y = GetDeviceCaps(hdc, LOGPIXELSY as i32);
            let printable_w = GetDeviceCaps(hdc, HORZRES as i32);
            let printable_h = GetDeviceCaps(hdc, VERTRES as i32);
            let physical_w = GetDeviceCaps(hdc, PHYSICALWIDTH as i32);
            let physical_h = GetDeviceCaps(hdc, PHYSICALHEIGHT as i32);
            let offset_x = GetDeviceCaps(hdc, PHYSICALOFFSETX as i32);
            let offset_y = GetDeviceCaps(hdc, PHYSICALOFFSETY as i32);
            if dpi_x <= 0 || dpi_y <= 0 {
                return Err("Falha ao ler DPI da impressora.".to_string());
            }

            // Shrinking a 1bpp label: AND the scanlines so black (barcodes/text) is
            // preserved instead of being dropped between source rows.
            SetStretchBltMode(hdc, BLACKONWHITE as i32);

            for page in &pages {
                // A 1bpp DIB needs a 2-entry colour table after the header, so back the
                // BITMAPINFO with a byte buffer big enough for header + 2 RGBQUADs.
                let header_size = size_of::<BITMAPINFOHEADER>();
                let mut bmi_buf = vec![0u8; header_size + 2 * size_of::<RGBQUAD>()];
                let header = BITMAPINFOHEADER {
                    biSize: header_size as u32,
                    biWidth: page.width_px,
                    biHeight: -page.height_px,
                    biPlanes: 1,
                    biBitCount: 1,
                    biCompression: BI_RGB,
                    biSizeImage: (page.stride * page.height_px as usize) as u32,
                    biXPelsPerMeter: 0,
                    biYPelsPerMeter: 0,
                    biClrUsed: 2,
                    biClrImportant: 2,
                };
                std::ptr::copy_nonoverlapping(
                    &header as *const _ as *const u8,
                    bmi_buf.as_mut_ptr(),
                    header_size,
                );
                // Palette: index 0 = black, index 1 = white (matches the packed bits).
                let palette = bmi_buf.as_mut_ptr().add(header_size) as *mut RGBQUAD;
                *palette = RGBQUAD { rgbBlue: 0, rgbGreen: 0, rgbRed: 0, rgbReserved: 0 };
                *palette.add(1) = RGBQUAD {
                    rgbBlue: 255,
                    rgbGreen: 255,
                    rgbRed: 255,
                    rgbReserved: 0,
                };
                let bmi = bmi_buf.as_ptr() as *const BITMAPINFO;

                let dest_w = mm_to_device_px(page.width_mm, dpi_x);
                let dest_h = mm_to_device_px(page.height_mm, dpi_y);
                let dest_x = centered_device_pos(dest_w, printable_w, physical_w, offset_x);
                let dest_y = centered_device_pos(dest_h, printable_h, physical_h, offset_y);

                // Decoded once above; emit one printer page per requested copy.
                for _ in 0..page.copies.max(1) {
                    if StartPage(hdc) <= 0 {
                        return Err(format!(
                            "Falha ao iniciar pagina de impressao: {}",
                            std::io::Error::last_os_error()
                        ));
                    }

                    let copied = StretchDIBits(
                        hdc,
                        dest_x,
                        dest_y,
                        dest_w,
                        dest_h,
                        0,
                        0,
                        page.width_px,
                        page.height_px,
                        page.mono.as_ptr() as *const _,
                        bmi,
                        DIB_RGB_COLORS,
                        SRCCOPY,
                    );

                    if copied == 0 {
                        return Err(format!(
                            "Falha ao desenhar etiqueta na pagina: {}",
                            std::io::Error::last_os_error()
                        ));
                    }

                    if EndPage(hdc) <= 0 {
                        return Err(format!(
                            "Falha ao finalizar pagina de impressao: {}",
                            std::io::Error::last_os_error()
                        ));
                    }
                }
            }

            Ok(())
        })();

        let message = match result {
            Ok(()) => {
                if EndDoc(hdc) <= 0 {
                    let err = std::io::Error::last_os_error();
                    DeleteDC(hdc);
                    return Err(format!("Falha ao enviar job para spooler: {err}"));
                }
                format!(
                    "Job #{job_id} enviado para {} ({} pagina(s)).",
                    printer_name, page_count
                )
            }
            Err(err) => {
                AbortDoc(hdc);
                DeleteDC(hdc);
                return Err(err);
            }
        };

        DeleteDC(hdc);
        Ok(message)
    }
}

#[cfg(target_os = "windows")]
fn get_default_printer_name() -> Result<String, String> {
    use std::ptr::null_mut;
    use windows_sys::Win32::Graphics::Printing::GetDefaultPrinterW;

    unsafe {
        let mut needed = 0u32;
        GetDefaultPrinterW(null_mut(), &mut needed);
        if needed == 0 {
            return Err("Nenhuma impressora padrao encontrada.".to_string());
        }

        let mut buffer = vec![0u16; needed as usize];
        if GetDefaultPrinterW(buffer.as_mut_ptr(), &mut needed) == 0 {
            return Err(format!(
                "Falha ao ler impressora padrao: {}",
                std::io::Error::last_os_error()
            ));
        }

        Ok(String::from_utf16_lossy(
            &buffer[..buffer.iter().position(|c| *c == 0).unwrap_or(buffer.len())],
        ))
    }
}

#[cfg(target_os = "windows")]
fn to_wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(target_os = "windows")]
fn mm_to_device_px(mm: f64, dpi: i32) -> i32 {
    ((mm / 25.4) * dpi as f64).round().max(1.0) as i32
}

#[cfg(target_os = "windows")]
fn centered_device_pos(content: i32, printable: i32, physical: i32, offset: i32) -> i32 {
    if physical > 0 && offset >= 0 {
        let centered_on_paper = ((physical - content) / 2) - offset;
        centered_on_paper.clamp(0, printable.saturating_sub(content).max(0))
    } else {
        ((printable - content) / 2).max(0)
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
        Migration {
            version: 1,
            description: "create_templates_and_labels",
            sql: "
            CREATE TABLE IF NOT EXISTS templates (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                width_mm REAL NOT NULL,
                height_mm REAL NOT NULL,
                design TEXT NOT NULL DEFAULT '[]',
                shared_values TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS labels (
                id TEXT PRIMARY KEY,
                template_id TEXT NOT NULL,
                name TEXT NOT NULL,
                \"values\" TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_labels_template ON labels(template_id);
        ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "create_products_and_template_product_field",
            sql: "
            CREATE TABLE IF NOT EXISTS products (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            ALTER TABLE templates ADD COLUMN product_field TEXT;
        ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "add_product_code",
            sql: "ALTER TABLE products ADD COLUMN code TEXT;",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "split_product_code_into_barcode_and_qrcode",
            sql: "
            ALTER TABLE products ADD COLUMN barcode TEXT;
            ALTER TABLE products ADD COLUMN qrcode TEXT;
            UPDATE products SET barcode = code WHERE barcode IS NULL AND code IS NOT NULL;
        ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "create_clients",
            sql: "
            CREATE TABLE IF NOT EXISTS clients (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                print_enabled INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(name);
        ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "create_print_history",
            sql: "
            CREATE TABLE IF NOT EXISTS print_history (
                id TEXT PRIMARY KEY,
                printed_at TEXT NOT NULL,
                quantity INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_print_history_date ON print_history(printed_at);
        ",
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:etiquetas.db", migrations)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            list_printers,
            print_png_labels,
            license::license_status,
            license::activate_license,
            license::apply_license_pass,
            license::stored_activation_code,
            updater::check_update,
            updater::run_update
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
