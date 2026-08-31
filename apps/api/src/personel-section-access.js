"use strict";

const PERSONEL_SECTION_KEYS = Object.freeze(["recipe", "stock", "tasks", "shipment", "shift"]);

function normalizePersonelSectionAccess(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return PERSONEL_SECTION_KEYS.reduce((result, key) => {
    result[key] = source[key] !== false;
    return result;
  }, {});
}

function hasPersonelSectionAccess(user, section) {
  const key = String(section || "").trim();
  return PERSONEL_SECTION_KEYS.includes(key)
    && normalizePersonelSectionAccess(user && user.personelSectionAccess)[key] !== false;
}

module.exports = { PERSONEL_SECTION_KEYS, hasPersonelSectionAccess, normalizePersonelSectionAccess };
