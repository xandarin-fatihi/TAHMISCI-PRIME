"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { parseSheetRows } = require("../src/simple-xlsx");

test("kendinden kapanan boş hücre sonraki Ürün Kodu hücresini yutmaz", () => {
  const xml = `
    <x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <x:sheetData>
        <x:row r="1">
          <x:c r="A1" t="str"><x:v>Ürün Adı</x:v></x:c>
          <x:c r="B1" t="str"><x:v>Standart</x:v></x:c>
          <x:c r="C1" t="str"><x:v>Ürün Kodu</x:v></x:c>
        </x:row>
        <x:row r="2">
          <x:c r="A2" t="str"><x:v>Latte</x:v></x:c>
          <x:c r="B2" s="25" />
          <x:c r="C2" t="str"><x:v>SIC-LAT-001</x:v></x:c>
        </x:row>
      </x:sheetData>
    </x:worksheet>`;

  const rows = parseSheetRows(xml, []);
  assert.deepEqual(rows.headers, ["Ürün Adı", "Standart", "Ürün Kodu"]);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    "Ürün Adı": "Latte",
    Standart: "",
    "Ürün Kodu": "SIC-LAT-001"
  });
});
