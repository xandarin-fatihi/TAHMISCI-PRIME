"use strict";

// Kataloglar yalnızca Excel Veri Merkezi tarafından kalıcı store'a yazılır.
// Bu geriye uyumlu işlevler hiçbir dosya veya gömülü katalog okumaz.
async function seedStoreIfEmpty(store, projectRoot) {
  void store;
  void projectRoot;
  return { seeded: false, menu: false, recipes: false };
}

async function loadDefaults(projectRoot) {
  void projectRoot;
  return { menuState: emptyMenuState(), recipeState: {} };
}

function legacyMenuToState(menu) {
  void menu;
  return emptyMenuState();
}

function emptyMenuState() {
  return { settings: {}, categories: [] };
}

module.exports = { emptyMenuState, legacyMenuToState, loadDefaults, seedStoreIfEmpty };
