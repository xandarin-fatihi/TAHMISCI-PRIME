"use strict";

function retiredExcelImportHandler(_req, res) {
  res.status(410).json({
    ok: false,
    code: "EXCEL_IMPORT_ENDPOINT_RETIRED",
    message: "Bu eski Excel aktarım yolu kullanımdan kaldırıldı. Lütfen Yönetici panelindeki Excel Veri Merkezi'ni kullanın.",
    replacement: "/api/admin/data-imports"
  });
}

module.exports = { retiredExcelImportHandler };
