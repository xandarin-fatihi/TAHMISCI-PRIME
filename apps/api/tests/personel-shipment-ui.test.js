"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../../..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

function section(source, startToken, endToken) {
  const start = source.indexOf(startToken);
  const end = source.indexOf(endToken, start + startToken.length);
  assert.notEqual(start, -1, `${startToken} bulunamadı`);
  assert.notEqual(end, -1, `${endToken} bulunamadı`);
  return source.slice(start, end);
}

test("personel çıkışı yalnız erişilebilir profil menüsünden gerçek endpoint ile yapılır", () => {
  const html = read("apps/personel/index.html");
  const shell = read("apps/personel/personel.js");

  assert.equal((html.match(/data-profile-action="logout"/g) || []).length, 1);
  assert.doesNotMatch(html, /id="personelLogout"|class="[^"]*logout-button/);
  assert.match(html, /id="sidebarUser"[^>]+aria-haspopup="menu"[^>]+aria-expanded="false"/);
  assert.match(html, /id="profilePopover" role="menu" hidden/);
  assert.match(html, /data-profile-action="logout">Çıkış yap</);
  assert.doesNotMatch(shell, /els\.personelLogout/);
  assert.match(shell, /fetch\("\/api\/recipe\/logout", \{ method: "POST", credentials: "include" \}\)/);
  assert.match(shell, /handleProfileMenuKeydown/);
  assert.match(shell, /closeProfilePopover\(\{ restoreFocus: true \}\)/);
});

test("sevkiyat başarı cevabı yerel listeye anında eklenir, sepet temizlenir ve ağır yenileme beklenmez", () => {
  const workforce = read("apps/personel/workforce.js");
  const submit = section(workforce, "  async function executeShipmentSubmit()", "\n  function upsertShipment(");

  assert.match(submit, /upsertShipment\(result && result\.shipment\)/);
  assert.match(submit, /state\.cart = \[\]/);
  assert.match(submit, /state\.shipmentRequestId = ""/);
  assert.match(submit, /showMessage\("shipment", "Sevkiyat bildiriminiz yönetici onayına gönderildi\."/);
  assert.match(submit, /refreshShipmentInBackground\(\)/);
  assert.doesNotMatch(submit, /await refreshWorkforceData\(/);
  assert.match(workforce, /Idempotency-Key/);
  assert.match(workforce, /runImmediateOperation\("shipment-notify"/);
  assert.match(workforce, /loadWorkforceData\("shipment", \{ force: true \}\)/);
});

test("sevkiyat hatasında sepet ve idempotency anahtarı korunur", () => {
  const workforce = read("apps/personel/workforce.js");
  const submit = section(workforce, "  async function executeShipmentSubmit()", "\n  function upsertShipment(");
  const catchBlock = submit.slice(submit.indexOf("    } catch (error)"));

  assert.doesNotMatch(catchBlock, /state\.cart\s*=\s*\[\]/);
  assert.doesNotMatch(catchBlock, /state\.shipmentRequestId\s*=\s*""/);
  assert.match(catchBlock, /showMutationError\("shipment", error\)/);
  assert.match(catchBlock, /throw error/);
});
