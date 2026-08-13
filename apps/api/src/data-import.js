"use strict";

const crypto = require("crypto");
const { analyzePricingWorkbook, applyPricingImportPlan } = require("./pricing-excel");
const { migratePricingSystem, normalizeProductPricing } = require("./pricing");
const { isValidProductCode, normalizeProductCode } = require("./store/product-code-registry");
const {
  normalizeMenuState,
  normalizeRecipeState,
  normalizeStockState,
  reconcileRecipeCatalog
} = require("./store/migrations");

const WORKBOOKS = ["menu", "pricing", "recipe", "stock"];
const AMBIGUOUS = Symbol("ambiguous-data-import-match");
const PRODUCT_CODE_HEADERS = ["ürün kodu", "urun kodu", "product code", "productcode", "sku"];

function analyzeDataImport(data, inputs, context = {}) {
  const now = context.now || new Date().toISOString();
  const analysisId = context.analysisId || `data-import-analysis-${crypto.randomUUID()}`;
  const workbooks = inputs && inputs.workbooks || {};
  const files = inputs && inputs.files || {};
  const staged = {
    menuState: normalizeMenuState(clone(data.menuState || {})),
    pricing: clone(data.pricing || {}),
    recipeState: normalizeRecipeState(clone(data.recipeState || {})),
    recipeCatalog: clone(data.recipeCatalog || []),
    recipeLinkReview: clone(data.recipeLinkReview || []),
    stockState: normalizeStockState(clone(data.stockState || {})),
    mappings: normalizeMappings(data.dataImportMappings),
    referenceRewrites: { menuProducts: {}, stockProducts: {}, menuCategories: {}, stockCategories: {} }
  };
  const report = baseReport();
  const archiveBaseline = scopedArchiveBaseline(data, workbooks);
  const changes = [];
  const issues = [];
  const scopes = [];
  const sharedContext = { now, analysisId, report, changes, issues };
  const selectedDomains = selectedImportDomains(workbooks);

  // Legacy katalog kusurları yalnız içe aktarılan domain içinde kanonikleştirilir.
  // Böylece örneğin stok aktarımı menüdeki eski bir mükerrer kayda bağımlı olmaz.
  consolidateExistingCatalog(staged, sharedContext, selectedDomains);

  if (workbooks.menu) {
    scopes.push("menu");
    analyzeMenuWorkbook(workbooks.menu, staged, { now, analysisId, report, changes, issues });
  }

  if (workbooks.pricing) {
    scopes.push("pricing");
    analyzePricing(workbooks.pricing, staged, { now, analysisId, report, changes, issues });
  }

  if (workbooks.recipe) {
    scopes.push("recipes");
    analyzeRecipeWorkbook(workbooks.recipe, staged, { now, analysisId, report, changes, issues });
  }

  if (workbooks.stock) {
    scopes.push("stock");
    analyzeStockWorkbook(workbooks.stock, staged, { now, analysisId, report, changes, issues });
  }

  if (workbooks.recipe) {
    staged.recipeCatalog = reconcileRecipeCatalog(staged.recipeState, staged.recipeCatalog);
    hydrateRecipeCatalogCodes(staged);
    // Reçete bağımsız bir domaindir. Analiz sırasında menü bağlantılarını yeniden
    // kurmak menuState'i yan etkili biçimde değiştirdiği için burada yapılmaz.
    staged.recipeLinkReview = [];
  }

  report.missingPrices = Math.max(report.missingPrices, countProductsWithoutPrice(staged.menuState));
  report.manualInactive = report.manualInactivePreserved;
  report.stockReviewRows = report.manualStockReview;

  report.fileCount = scopes.length;
  report.changeCount = changes.length;
  report.warningCount = issues.filter((item) => item.severity === "warning").length;
  report.errorCount = issues.filter((item) => item.severity !== "warning").length;
  report.archiveBaseline = archiveBaseline;
  report.archiveRatio = archiveBaseline > 0 ? Number((report.archived / archiveBaseline).toFixed(4)) : 0;
  report.requiresArchiveConfirmation = report.archived > 0 && report.archiveRatio >= 0.35;
  const domains = buildDomainReadiness(data, workbooks, scopes, changes, issues);
  report.canApply = Object.values(domains).some((domain) => domain.canApply);

  const importScopes = normalizeFingerprintScopes(scopes);
  return {
    analysisId,
    expectedRevision: importRevision(data),
    fingerprintVersion: 2,
    expectedFingerprint: catalogFingerprint(data, importScopes),
    expectedProductCodeFingerprint: productCodeFingerprint(data, importScopes),
    files: WORKBOOKS.filter((key) => files[key]).map((key) => ({
      workbook: key,
      filename: files[key].filename,
      hash: files[key].hash,
      size: files[key].size
    })),
    scopes: importScopes,
    domains,
    expectedDomainRevisions: domainRevisionSnapshot(data, Object.keys(domains).filter((domain) => domains[domain].selected)),
    expectedDomainFingerprints: domainFingerprintSnapshot(data, Object.keys(domains).filter((domain) => domains[domain].selected)),
    expectedDomainProductCodeFingerprints: domainProductCodeFingerprintSnapshot(data, Object.keys(domains).filter((domain) => domains[domain].selected)),
    report,
    changes: changes.slice(0, 10000),
    issues: issues.slice(0, 5000),
    plan: {
      menuState: staged.menuState,
      pricing: staged.pricing,
      recipeState: staged.recipeState,
      recipeCatalog: staged.recipeCatalog,
      recipeLinkReview: staged.recipeLinkReview,
      stockState: staged.stockState,
      mappings: staged.mappings,
      referenceRewrites: staged.referenceRewrites
    }
  };
}

function analyzeMenuWorkbook(workbook, staged, ctx) {
  const rows = workbookRows(workbook, "menu", ctx);
  const menu = staged.menuState;
  const categoryByName = groupedIndex(menu.categories, (item) => normalizeSourceName(item.name));
  const seenProducts = new Set();
  const seenCategories = new Set();
  const workbookKeys = new Set();

  for (const source of rows) {
    const productName = cell(source.row, ["ürün adı", "urun adi", "ürün", "urun", "product", "product name"]);
    if (isPlaceholderName(productName) || (!productName && isBlankTemplateRow(source.row))) continue;
    const codeInfo = readProductCode(source, ctx, "menu");
    if (codeInfo.invalid) continue;
    const productCode = codeInfo.code;
    if (!productName) {
      addIssue(ctx, "menu", source, "missing_product_name", "Ürün adı boş.");
      continue;
    }
    const categoryName = String(source.sheet || "").trim();
    const sheetKey = normalizeSourceName(categoryName);
    const productKey = normalizeSourceName(productName);
    const sourceKey = productCode ? `code\u0000${productCode}` : `${sheetKey}\u0000${productKey}`;
    if (workbookKeys.has(sourceKey)) {
      addIssue(ctx, "menu", source, productCode ? "duplicate_product_code" : "ambiguous_duplicate", productCode
        ? `“${productCode}” Ürün Kodu menü Excel'i içinde birden fazla kez bulundu.`
        : "Aynı kategori ve ürün Excel içinde birden fazla kez bulundu.");
      continue;
    }
    workbookKeys.add(sourceKey);

    let category = resolveImportCandidate({
      candidates: categoryByName.get(sheetKey),
      importKey: sourceImportKey("menu", source.sheet, categoryName),
      mappings: staged.mappings.menu,
      kind: "category",
      sheetKey,
      nameKey: sheetKey,
      ctx,
      workbook: "menu",
      source,
      message: "Kategori adı birden fazla mevcut kayıtla eşleşiyor."
    });
    if (category === AMBIGUOUS) continue;
    if (!category) {
      category = {
        id: generatedId("category"), name: categoryName, active: true, order: menu.categories.length,
        iconKey: "coffee", icon: "fa-mug-hot", products: [],
        ...sourceMetadata("menu", source.sheet, categoryName, ctx.now, ctx.analysisId, "excel_new")
      };
      menu.categories.push(category);
      pushIndex(categoryByName, sheetKey, category);
      ctx.report.newCategories += 1;
      addChange(ctx, "menu", categoryName, "", "kategori", null, categoryName, "create", "active", "excel");
    } else {
      category = menu.categories.find((item) => item.id === category.id);
      if (category.sourcePresent === false) {
        category.sourcePresent = true;
        if (category.statusSource === "excel_removed") {
          category.active = true;
          category.statusSource = "excel_returned";
          ctx.report.autoReactivated += 1;
        } else if (category.statusSource === "manual") {
          category.active = category.manualActive !== undefined ? category.manualActive !== false : category.active !== false;
        }
      }
      Object.assign(category, sourceMetadata("menu", source.sheet, categoryName, ctx.now, ctx.analysisId, category.statusSource || "excel_existing"));
      if (category.statusSource === "manual") {
        category.manualActive = category.active !== false;
      }
    }
    seenCategories.add(category.id);
    upsertMapping(staged.mappings.menu, "category", category.id, source.sheet, categoryName, ctx.now, ctx.analysisId);

    const productCandidates = (category.products || []).filter((item) => normalizeSourceName(item.name) === productKey);
    const allProducts = menu.categories.flatMap((item) => item.products || []);
    const externalId = productCode || String(cell(source.row, ["externalid", "external id", "importkey", "import key"]) || "").trim();
    let product;
    if (productCode) {
      const codeMatches = allProducts.filter((item) => normalizeProductCode(item.productCode) === productCode);
      if (codeMatches.length > 1) {
        addIssue(ctx, "menu", source, "duplicate_product_code", `“${productCode}” Ürün Kodu birden fazla kalıcı menü ürününe bağlı.`);
        continue;
      }
      product = codeMatches[0] || null;
      if (!product) {
        const migrationCandidates = productCandidates.filter((item) => !normalizeProductCode(item.productCode));
        if (migrationCandidates.length === 1) {
          product = migrationCandidates[0];
          product.nameHistory = uniqueStrings([...(product.nameHistory || []), product.name]);
        } else if (migrationCandidates.length > 1) {
          addIssue(ctx, "menu", source, "ambiguous_code_migration", `“${productCode}” kodu için birden fazla kodsuz eski ürün bulundu.`);
          continue;
        } else if (productCandidates.some((item) => normalizeProductCode(item.productCode) && normalizeProductCode(item.productCode) !== productCode)) {
          addIssue(ctx, "menu", source, "same_name_different_code", `“${productName}” adı farklı bir Ürün Kodu ile de kullanılıyor; “${productCode}” ayrı ürün olarak korunacak.`, "warning");
        }
      }
    } else {
      product = resolveImportCandidate({
        candidates: productCandidates,
        allItems: allProducts,
        externalId,
        importKey: sourceImportKey("menu", source.sheet, productName),
        mappings: staged.mappings.menu,
        kind: "product",
        sheetKey,
        nameKey: productKey,
        ctx,
        workbook: "menu",
        source,
        message: "Ürün adı birden fazla mevcut kayıtla eşleşiyor."
      });
    }
    if (product === AMBIGUOUS) continue;
    if (product && productCode && !category.products.includes(product)) {
      const previousCategory = menu.categories.find((item) => (item.products || []).includes(product));
      if (previousCategory) previousCategory.products = previousCategory.products.filter((item) => item !== product);
      category.products.push(product);
      addChange(ctx, "menu", categoryName, productName, "kategori", previousCategory && previousCategory.name || "", categoryName, "move", "unchanged", "excel", productCode);
    }
    const details = {
      calories: String(cell(source.row, ["ürün kalorisi", "urun kalorisi", "kalori", "calories"]) || "").trim(),
      allergens: String(cell(source.row, ["ürün alerjeni", "urun alerjeni", "alerjen", "allergens"]) || "").trim(),
      ingredients: String(cell(source.row, ["ürün içeriği", "urun icerigi", "içerik", "icerik", "ingredients"]) || "").trim()
    };

    if (!product) {
      product = {
        id: generatedId("product"), name: String(productName).trim(), active: true, order: category.products.length,
        desc: "", stock: "active", image: "", imageUrl: "", pricing: { typeId: "standard", values: {} },
        manualContent: details.ingredients, details,
        ...(externalId ? { externalId } : {}),
        ...(productCode ? { productCode } : {}),
        ...sourceMetadata("menu", source.sheet, productName, ctx.now, ctx.analysisId, "excel_new")
      };
      category.products.push(product);
      ctx.report.newProducts += 1;
      addChange(ctx, "menu", categoryName, product.name, "ürün", null, product.name, "create", "active", "excel", productCode);
    } else {
      const previous = { name: product.name, details: product.details || {}, manualContent: product.manualContent || "" };
      const returned = product.sourcePresent === false;
      if (productCode && normalizeSourceName(previous.name) !== productKey) {
        product.nameHistory = uniqueStrings([...(product.nameHistory || []), previous.name]);
      }
      product.name = String(productName).trim();
      if (productCode) {
        product.productCode = productCode;
        product.externalId = productCode;
      }
      product.details = details;
      product.manualContent = details.ingredients;
      product.sourcePresent = true;
      if (returned) {
        ctx.report.rediscovered += 1;
        if (product.statusSource === "excel_removed") {
          product.active = true;
          product.statusSource = "excel_returned";
          ctx.report.autoReactivated += 1;
        } else if (product.statusSource === "manual") {
          product.active = product.manualActive !== undefined ? product.manualActive !== false : product.active !== false;
        }
      }
      Object.assign(product, sourceMetadata("menu", source.sheet, productName, ctx.now, ctx.analysisId, product.statusSource || "excel_existing"));
      if (product.statusSource === "manual") {
        product.statusSource = "manual";
        product.manualActive = product.active !== false;
        if (!product.active) ctx.report.manualInactivePreserved += 1;
      }
      const fields = [["name", previous.name, product.name], ["calories", previous.details.calories || "", details.calories], ["allergens", previous.details.allergens || "", details.allergens], ["ingredients", previous.manualContent, details.ingredients]];
      const changedFields = fields.filter(([, oldValue, newValue]) => String(oldValue) !== String(newValue));
      if (changedFields.length) {
        ctx.report.updatedProducts += 1;
        changedFields.forEach(([field, oldValue, newValue]) => addChange(ctx, "menu", categoryName, product.name, field, oldValue, newValue, "update", product.active ? "unchanged-active" : "unchanged-passive", product.statusSource === "manual" ? "manager" : "excel", productCode));
      } else ctx.report.unchanged += 1;
    }
    seenProducts.add(product.id);
    upsertMapping(staged.mappings.menu, "product", product.id, source.sheet, productName, ctx.now, ctx.analysisId, productCode);
  }

  for (const category of menu.categories) {
    for (const product of category.products || []) {
      if (seenProducts.has(product.id) || product.sourceType === "manual") continue;
      if (product.sourcePresent !== false || product.active !== false || product.statusSource !== "excel_removed") {
        const manuallyOwned = product.statusSource === "manual";
        if (manuallyOwned && product.sourcePresent !== false) product.manualActive = product.active !== false;
        product.sourcePresent = false;
        product.active = manuallyOwned ? product.manualActive !== false : false;
        product.statusSource = manuallyOwned ? "manual" : "excel_removed";
        product.lastImportedAt = ctx.now;
        product.lastImportOperationId = ctx.analysisId;
        ctx.report.removed += 1;
        ctx.report.archived += 1;
        addChange(ctx, "menu", category.name, product.name, "sourcePresent", true, false, "archive", manuallyOwned ? "manager-status-preserved" : "deactivate", manuallyOwned ? "manager" : "excel", product.productCode);
      }
    }
    if (!seenCategories.has(category.id) && category.sourceType !== "manual"
      && (category.sourceWorkbook === "menu" || category.sourceType === "legacy" || category.sourceType === "excel")) {
      const manuallyOwned = category.statusSource === "manual";
      if (manuallyOwned && category.sourcePresent !== false) category.manualActive = category.active !== false;
      category.sourcePresent = false;
      category.active = manuallyOwned ? category.manualActive !== false : false;
      category.statusSource = manuallyOwned ? "manual" : "excel_removed";
    }
  }
  const migrated = migratePricingSystem(staged.pricing, menu);
  staged.menuState = migrated.menuState;
  staged.pricing = migrated.pricing;
}

function analyzePricing(workbook, staged, ctx) {
  if (workbookHasProductCodeHeader(workbook)) {
    analyzeCodePricingWorkbook(workbook, staged, ctx);
    return;
  }
  const analysis = analyzePricingWorkbook(workbook, staged.menuState, staged.pricing, { blankPolicy: "preserve" });
  for (const issue of analysis.issues || []) {
    ctx.issues.push({ ...issue, workbook: "pricing", severity: "error" });
  }
  ctx.report.readSheets += Number(analysis.report.sheetCount || 0);
  ctx.report.readRows += Number(analysis.report.rowCount || 0);
  ctx.report.missingPrices += Number(analysis.report.unmatchedProducts || 0);
  ctx.report.unmatchedPricing += Number(analysis.report.unmatchedProducts || 0);
  ctx.report.mixedPricingFamilies += Number(analysis.report.mixedPricingRows || 0);
  (analysis.changes || []).forEach((item) => {
    ctx.changes.push({
      workbook: "pricing", category: item.categoryName || "", product: item.productName || "",
      field: item.optionLabel || item.optionId || "fiyat", oldValue: item.oldPrice, newValue: item.newPrice,
      operation: "update", activeEffect: "unchanged", statusOwner: "manager"
    });
  });
  if ((analysis.issues || []).length === 0 && analysis.plan && analysis.plan.productUpdates.length) {
    const applied = applyPricingImportPlan({ menuState: staged.menuState, pricing: staged.pricing }, analysis.plan);
    staged.menuState = applied.menuState;
    staged.pricing = applied.pricing;
    ctx.report.updatedPrices += applied.changedRows.length;
  }
}

function analyzeCodePricingWorkbook(workbook, staged, ctx) {
  const rows = workbookRows(workbook, "pricing", ctx);
  const products = (staged.menuState.categories || []).flatMap((category) => (category.products || []).map((product) => ({ category, product })));
  const byCode = groupedIndex(products, (item) => normalizeProductCode(item.product.productCode));
  const seenCodes = new Set();
  staged.pricing = staged.pricing && typeof staged.pricing === "object" ? staged.pricing : { schemaVersion: 1, types: [] };
  if (!Array.isArray(staged.pricing.types)) staged.pricing.types = [];

  for (const source of rows) {
    const codeInfo = readProductCode(source, ctx, "pricing");
    if (!codeInfo.coded) {
      addIssue(ctx, "pricing", source, "invalid_product_code", "Kodlu fiyat çalışma kitabındaki her katalog sayfasında Ürün Kodu sütunu bulunmalıdır.");
      continue;
    }
    if (codeInfo.invalid) continue;
    const productCode = codeInfo.code;
    if (seenCodes.has(productCode)) {
      addIssue(ctx, "pricing", source, "duplicate_product_code", `“${productCode}” Ürün Kodu fiyat Excel'i içinde birden fazla kez bulundu.`);
      continue;
    }
    seenCodes.add(productCode);
    const matches = byCode.get(productCode) || [];
    if (matches.length !== 1) {
      addIssue(ctx, "pricing", source, matches.length ? "duplicate_product_code" : "orphan_product_code", matches.length
        ? `“${productCode}” Ürün Kodu birden fazla menü ürününe bağlı.`
        : `“${productCode}” Ürün Kodu menü kataloğunda bulunamadı.`);
      continue;
    }
    const { category, product } = matches[0];
    const rowName = String(cell(source.row, ["ürün adı", "urun adi", "ürün", "urun", "product", "product name"]) || "").trim();
    if (rowName && normalizeSourceName(rowName) !== normalizeSourceName(product.name)) {
      addIssue(ctx, "pricing", source, "product_name_alias", `“${productCode}” kodu menüde “${product.name}” adına bağlı; fiyat satırındaki “${rowName}” adı alias olarak değerlendirildi.`, "warning");
    }

    const entries = [];
    const recognizedOptions = [];
    for (const [header, rawValue] of Object.entries(source.row || {})) {
      const option = pricingOptionFromHeader(header, staged.pricing);
      if (!option) continue;
      const empty = rawValue === "" || rawValue === null || rawValue === undefined;
      recognizedOptions.push({ ...option, empty });
      if (empty) continue;
      if (rawValue === "__TAHMISCI_XLSX_FORMULA_VALUE_MISSING__") {
        addIssue(ctx, "pricing", source, "invalid_price_value", `“${header}” formül hücresinin hesaplanmış sayısal değeri bulunamadı.`);
        continue;
      }
      const numeric = parseImportedPrice(rawValue);
      if (numeric === null || numeric < 0) {
        addIssue(ctx, "pricing", source, "invalid_price", `“${header}” fiyatı geçerli, negatif olmayan bir sayı olmalıdır.`);
        continue;
      }
      entries.push({ ...option, price: numeric });
    }

    const current = normalizeProductPricing(product.pricing);
    const families = current.families.map((family) => ({ ...family, values: clone(family.values || {}) }));
    let changed = false;
    for (const familyName of [...new Set(entries.map((entry) => entry.family))]) {
      const familyEntries = entries.filter((entry) => entry.family === familyName);
      const type = ensurePricingFamilyType(staged.pricing, familyName, familyEntries);
      let family = families.find((item) => item.typeId === type.id);
      if (!family) {
        family = { typeId: type.id, values: {} };
        families.push(family);
        changed = true;
      }
      for (const entry of familyEntries) {
        const previousValue = family.values[entry.optionId] || {};
        const previous = previousValue.price;
        const manualStatus = previousValue.statusSource === "manual";
        family.values[entry.optionId] = {
          ...previousValue,
          price: entry.price,
          active: manualStatus ? previousValue.active !== false : true,
          sourceType: "excel",
          sourceWorkbook: "pricing",
          sourcePresent: true,
          statusSource: manualStatus ? "manual" : (previousValue.sourcePresent === false ? "excel_returned" : "excel_existing"),
          lastImportedAt: ctx.now,
          lastImportOperationId: ctx.analysisId
        };
        if (Number(previous) !== entry.price) {
          changed = true;
          ctx.report.updatedPrices += 1;
          addChange(ctx, "pricing", category.name, product.name, entry.label, previous === undefined ? null : previous, entry.price, "update", "unchanged", manualStatus ? "manager" : "excel", productCode);
        } else if (!manualStatus && (previousValue.active === false || previousValue.sourcePresent === false)) {
          changed = true;
          ctx.report.rediscovered += 1;
          ctx.report.autoReactivated += 1;
          addChange(ctx, "pricing", category.name, product.name, entry.label, "arşiv", entry.price, "reactivate", "activate", "excel", productCode);
        }
      }
    }

    for (const option of recognizedOptions.filter((item) => item.empty)) {
      const family = families.find((item) => item.typeId === option.family);
      const previousValue = family && family.values && family.values[option.optionId];
      if (!previousValue || previousValue.sourceType !== "excel" || previousValue.sourceWorkbook !== "pricing"
        || previousValue.sourcePresent === false || previousValue.statusSource === "manual") continue;
      family.values[option.optionId] = {
        ...previousValue,
        active: false,
        sourcePresent: false,
        statusSource: "excel_removed",
        lastImportedAt: ctx.now,
        lastImportOperationId: ctx.analysisId
      };
      changed = true;
      ctx.report.removed += 1;
      ctx.report.archived += 1;
      addChange(ctx, "pricing", category.name, product.name, option.label, previousValue.price, null, "archive", "deactivate", "excel", productCode);
    }

    const primary = families[0] || { typeId: "standard", values: {} };
    product.pricing = normalizeProductPricing({ typeId: primary.typeId, values: primary.values, families });
    if (!changed) ctx.report.unchanged += 1;
  }

  for (const { category, product } of products) {
    const productCode = normalizeProductCode(product.productCode);
    if (!productCode || seenCodes.has(productCode)) continue;
    const pricing = normalizeProductPricing(product.pricing);
    let changed = false;
    for (const family of pricing.families || []) {
      for (const [optionId, previousValue] of Object.entries(family.values || {})) {
        if (!previousValue || previousValue.sourceType !== "excel" || previousValue.sourceWorkbook !== "pricing"
          || previousValue.sourcePresent === false || previousValue.statusSource === "manual") continue;
        family.values[optionId] = {
          ...previousValue,
          active: false,
          sourcePresent: false,
          statusSource: "excel_removed",
          lastImportedAt: ctx.now,
          lastImportOperationId: ctx.analysisId
        };
        const option = (staged.pricing.types || []).find((type) => type.id === family.typeId)?.options?.find((item) => item.id === optionId);
        changed = true;
        ctx.report.removed += 1;
        ctx.report.archived += 1;
        addChange(ctx, "pricing", category.name, product.name, option && option.label || optionId, previousValue.price, null, "archive", "deactivate", "excel", productCode);
      }
    }
    if (changed) {
      const primary = pricing.families[0] || { typeId: pricing.typeId, values: pricing.values };
      product.pricing = normalizeProductPricing({ ...pricing, typeId: primary.typeId, values: primary.values, families: pricing.families });
    }
  }

  const migrated = migratePricingSystem(staged.pricing, staged.menuState);
  staged.pricing = migrated.pricing;
  staged.menuState = migrated.menuState;
}

function workbookHasProductCodeHeader(workbook) {
  for (const sheet of workbook && workbook.SheetNames || []) {
    const rows = workbook.Sheets && workbook.Sheets[sheet];
    const headers = Array.isArray(rows && rows.headers) ? rows.headers : [];
    if (headers.some((header) => PRODUCT_CODE_HEADERS.map(normalizeSourceName).includes(normalizeSourceName(header)))) return true;
  }
  return false;
}

function pricingOptionFromHeader(header, pricing) {
  const normalized = normalizeSourceName(header);
  const fixed = {
    k: { family: "size", optionId: "small", label: "Küçük", unit: "" },
    kucuk: { family: "size", optionId: "small", label: "Küçük", unit: "" },
    o: { family: "size", optionId: "medium", label: "Orta", unit: "" },
    orta: { family: "size", optionId: "medium", label: "Orta", unit: "" },
    b: { family: "size", optionId: "large", label: "Büyük", unit: "" },
    buyuk: { family: "size", optionId: "large", label: "Büyük", unit: "" },
    single: { family: "shot", optionId: "single", label: "Single", unit: "" },
    double: { family: "shot", optionId: "double", label: "Double", unit: "" },
    standart: { family: "standard", optionId: "standard", label: "Standart", unit: "" },
    standard: { family: "standard", optionId: "standard", label: "Standart", unit: "" }
  };
  if (fixed[normalized]) return fixed[normalized];
  const weight = normalized.match(/^(\d+(?:[.,]\d+)?)\s*(gr|g|kg)$/);
  if (weight) {
    const grams = Number(weight[1].replace(",", ".")) * (weight[2] === "kg" ? 1000 : 1);
    if (Number.isFinite(grams) && grams > 0) {
      return { family: "weight", optionId: `${String(grams).replace(".", "-")}-gr`, label: `${grams} GR`, unit: "gr", value: grams };
    }
  }
  for (const type of pricing && Array.isArray(pricing.types) ? pricing.types : []) {
    for (const option of Array.isArray(type.options) ? type.options : []) {
      if (normalizeSourceName(option.id) === normalized || normalizeSourceName(option.label) === normalized) {
        return { family: type.id, optionId: option.id, label: option.label, unit: option.unit || "", ...(option.value !== undefined ? { value: option.value } : {}) };
      }
    }
  }
  return null;
}

function parseImportedPrice(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  let text = String(value ?? "").normalize("NFKC").trim();
  if (!text) return null;
  text = text.replace(/(?:₺|\bTRY\b|\bTL\b)/gi, "").replace(/\s+/g, "");
  if (/^-?\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(text)) {
    text = text.replace(/\./g, "").replace(",", ".");
  } else if (text.includes(",") && text.includes(".")) {
    const decimal = Math.max(text.lastIndexOf(","), text.lastIndexOf("."));
    const integer = text.slice(0, decimal).replace(/[.,]/g, "");
    const fraction = text.slice(decimal + 1).replace(/[.,]/g, "");
    text = `${integer}.${fraction}`;
  } else {
    text = text.replace(",", ".");
  }
  if (!/^-?\d+(?:\.\d+)?$/.test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function ensurePricingFamilyType(pricing, familyName, entries) {
  const typeId = familyName;
  let type = pricing.types.find((item) => item.id === typeId);
  if (!type) {
    type = {
      id: typeId,
      name: familyName === "weight" ? "Gramaj" : familyName,
      active: true,
      order: pricing.types.length,
      options: []
    };
    pricing.types.push(type);
  }
  if (!Array.isArray(type.options)) type.options = [];
  for (const entry of entries) {
    if (type.options.some((option) => option.id === entry.optionId)) continue;
    type.options.push({
      id: entry.optionId,
      label: entry.label,
      unit: entry.unit || "",
      ...(entry.value !== undefined ? { value: entry.value } : {}),
      order: type.options.length,
      active: true
    });
  }
  return type;
}

function analyzeRecipeWorkbook(workbook, staged, ctx) {
  const rows = workbookRows(workbook, "recipe", ctx, (sheet) => normalizeSourceName(sheet) !== "tumu");
  const state = staged.recipeState;
  const seen = new Set();
  const keys = new Map();
  for (const source of rows) {
    const rawCategory = cell(source.row, ["kategori", "category"]) || source.sheet;
    const category = recipeGroupName(rawCategory);
    const rawProduct = String(cell(source.row, ["ürün adı", "urun adi", "ürün", "urun", "product"]) || "").trim();
    const rawSize = String(cell(source.row, ["ölçü", "olcu", "size"]) || "Standart").trim();
    const inferred = inferRecipeVariant(rawProduct, rawSize);
    const product = inferred.product;
    const size = inferred.size;
    if (isPlaceholderName(product) || (!product && isBlankTemplateRow(source.row))) continue;
    const codeInfo = readProductCode(source, ctx, "recipe");
    if (codeInfo.invalid) continue;
    const productCode = codeInfo.code;
    if (!product) { addIssue(ctx, "recipe", source, "missing_product_name", "Reçete ürün adı boş."); continue; }
    const key = productCode
      ? `${productCode}\u0000${normalizeSourceName(size)}`
      : `${normalizeSourceName(category)}\u0000${normalizeSourceName(product)}\u0000${normalizeSourceName(size)}`;
    const recipeSignature = stableJson({
      content: String(cell(source.row, ["içerik (ölçüsüz)", "icerik (olcusuz)", "içerik", "icerik", "content"]) || "").trim(),
      preparation: String(cell(source.row, ["hazırlanış (ölçüler dahil)", "hazirlanis (olculer dahil)", "hazırlanış", "hazirlanis", "preparation"]) || "").trim()
    });
    if (keys.has(key)) {
      const identical = keys.get(key) === recipeSignature;
      addIssue(ctx, "recipe", source, productCode && !identical ? "duplicate_recipe_measure" : identical ? "duplicate_recipe_measure_identical" : "ambiguous_duplicate", identical
        ? `“${productCode || product}” ve “${size}” ölçüsünün aynı reçetesi tekrarlandı; ikinci satır yok sayıldı.`
        : productCode
          ? `“${productCode}” kodu ve “${size}” ölçüsü farklı içerikle birden fazla kez bulundu.`
          : "Aynı reçete ve ölçü birden fazla kez bulundu.", identical ? "warning" : "error");
      continue;
    }
    keys.set(key, recipeSignature);
    if (!state[category]) { state[category] = {}; ctx.report.newCategories += 1; }
    if (!state[category][product]) { state[category][product] = {}; ctx.report.newRecipes += 1; }
    const codedPrevious = productCode ? findRecipeItemByCodeAndSize(state, productCode, size) : null;
    const previous = codedPrevious ? codedPrevious.item : state[category][product][size];
    if (codedPrevious && (codedPrevious.category !== category || codedPrevious.product !== product || codedPrevious.size !== size)) {
      delete state[codedPrevious.category][codedPrevious.product][codedPrevious.size];
      if (!Object.keys(state[codedPrevious.category][codedPrevious.product]).length) delete state[codedPrevious.category][codedPrevious.product];
      if (!Object.keys(state[codedPrevious.category]).length) delete state[codedPrevious.category];
    }
    const content = String(cell(source.row, ["içerik (ölçüsüz)", "icerik (olcusuz)", "içerik", "icerik", "content"]) || "").trim();
    const preparation = String(cell(source.row, ["hazırlanış (ölçüler dahil)", "hazirlanis (olculer dahil)", "hazırlanış", "hazirlanis", "preparation"]) || "").trim();
    const item = previous && typeof previous === "object" ? previous : {};
    const oldContent = String(item.content || "");
    const oldPreparation = String(item.preparation || "");
    const returned = item.sourcePresent === false;
    const itemId = item.id || generatedId("recipe-item");
    const statusSource = item.statusSource === "manual" ? "manual" : (returned && item.statusSource === "excel_removed" ? "excel_returned" : (item.statusSource || "excel_new"));
    const manualActive = statusSource === "manual"
      ? (item.manualActive !== undefined ? item.manualActive !== false : item.active !== false)
      : true;
    if (!state[category]) state[category] = {};
    if (!state[category][product]) state[category][product] = {};
    state[category][product][size] = {
      ...item, id: itemId, content, preparation, note: String(item.note || ""), order: Number(item.order || 0),
      active: manualActive,
      ...(productCode ? { productCode } : {}),
      ...sourceMetadata("recipe", rawCategory, `${product}\u0000${size}`, ctx.now, ctx.analysisId, statusSource)
    };
    if (statusSource === "manual") {
      state[category][product][size].statusSource = "manual";
      state[category][product][size].manualActive = manualActive;
      if (!manualActive) ctx.report.manualInactivePreserved += 1;
    }
    seen.add(itemId);
    upsertMapping(staged.mappings.recipe, "recipe", itemId, rawCategory, `${product}\u0000${size}`, ctx.now, ctx.analysisId, productCode);
    if (!previous) addChange(ctx, "recipe", category, product, size, null, "reçete", "create", "active", "excel", productCode);
    else if (oldContent !== content || oldPreparation !== preparation) {
      ctx.report.updatedRecipes += 1;
      if (oldContent !== content) addChange(ctx, "recipe", category, product, `${size} / içerik`, oldContent, content, "update", "unchanged", statusSource === "manual" ? "manager" : "excel", productCode);
      if (oldPreparation !== preparation) addChange(ctx, "recipe", category, product, `${size} / hazırlanış`, oldPreparation, preparation, "update", "unchanged", statusSource === "manual" ? "manager" : "excel", productCode);
    } else ctx.report.unchanged += 1;
    if (returned) { ctx.report.rediscovered += 1; if (statusSource === "excel_returned") ctx.report.autoReactivated += 1; }
  }
  for (const [category, products] of Object.entries(state)) {
    for (const [product, sizes] of Object.entries(products || {})) {
      for (const [size, itemValue] of Object.entries(sizes || {})) {
        if (!itemValue || typeof itemValue !== "object" || seen.has(itemValue.id) || itemValue.sourceType === "manual") continue;
        if (itemValue.sourceWorkbook !== "recipe" && itemValue.sourceType !== "legacy") continue;
        const manuallyOwned = itemValue.statusSource === "manual";
        if (manuallyOwned && itemValue.sourcePresent !== false) itemValue.manualActive = itemValue.active !== false;
        itemValue.sourcePresent = false;
        itemValue.active = manuallyOwned ? itemValue.manualActive !== false : false;
        itemValue.statusSource = manuallyOwned ? "manual" : "excel_removed";
        itemValue.lastImportedAt = ctx.now;
        itemValue.lastImportOperationId = ctx.analysisId;
        ctx.report.removed += 1;
        ctx.report.archived += 1;
        addChange(ctx, "recipe", category, product, size, true, false, "archive", manuallyOwned ? "manager-status-preserved" : "deactivate", manuallyOwned ? "manager" : "excel", itemValue.productCode);
      }
    }
  }
  staged.recipeState = normalizeRecipeState(state);
}

function analyzeStockWorkbook(workbook, staged, ctx) {
  const rows = workbookRows(workbook, "stock", ctx);
  const state = staged.stockState;
  const categoryIndex = groupedIndex(state.categories, (item) => normalizeSourceName(item.name));
  const seen = new Set();
  const seenCategories = new Set();
  const keys = new Set();
  for (const source of rows) {
    const name = String(cell(source.row, ["ürün adı", "urun adi", "ürün", "urun", "product"]) || "").trim();
    if (isPlaceholderName(name) || (!name && isBlankTemplateRow(source.row))) continue;
    const codeInfo = readProductCode(source, ctx, "stock", { stock: true });
    if (codeInfo.invalid) continue;
    const productCode = codeInfo.code;
    if (!name) { addIssue(ctx, "stock", source, "missing_product_name", "Stok ürün adı boş."); continue; }
    const sheetKey = normalizeSourceName(source.sheet);
    const nameKey = normalizeSourceName(name);
    const key = productCode ? `code\u0000${productCode}` : `${sheetKey}\u0000${nameKey}`;
    if (keys.has(key)) { addIssue(ctx, "stock", source, productCode ? "duplicate_product_code" : "ambiguous_duplicate", productCode
      ? `“${productCode}” Stok Ürün Kodu Excel içinde birden fazla kez bulundu.`
      : "Aynı stok ürünü birden fazla kez bulundu."); continue; }
    keys.add(key);
    let category = resolveImportCandidate({
      candidates: categoryIndex.get(sheetKey),
      importKey: sourceImportKey("stock", source.sheet, source.sheet),
      mappings: staged.mappings.stock,
      kind: "stock-category",
      sheetKey,
      nameKey: sheetKey,
      ctx,
      workbook: "stock",
      source,
      message: "Stok kategorisi belirsiz."
    });
    if (category === AMBIGUOUS) continue;
    if (!category) {
      category = { id: generatedId("stock-category"), name: source.sheet, active: true, order: state.categories.length, ...sourceMetadata("stock", source.sheet, source.sheet, ctx.now, ctx.analysisId, "excel_new") };
      state.categories.push(category); pushIndex(categoryIndex, sheetKey, category); ctx.report.newCategories += 1;
      addChange(ctx, "stock", source.sheet, "", "kategori", null, source.sheet, "create", "active", "excel");
    } else {
      const returnedCategory = category.sourcePresent === false;
      if (returnedCategory && category.statusSource === "excel_removed") {
        category.active = true;
        category.statusSource = "excel_returned";
        ctx.report.autoReactivated += 1;
      } else if (returnedCategory && category.statusSource === "manual") {
        category.active = category.manualActive !== undefined ? category.manualActive !== false : category.active !== false;
      }
      Object.assign(category, sourceMetadata("stock", source.sheet, source.sheet, ctx.now, ctx.analysisId, category.statusSource || "excel_existing"));
      if (category.statusSource === "manual") category.manualActive = category.active !== false;
    }
    seenCategories.add(category.id);
    upsertMapping(staged.mappings.stock, "stock-category", category.id, source.sheet, source.sheet, ctx.now, ctx.analysisId);
    const quantityText = String(cell(source.row, ["ürün adedi", "urun adedi", "adet", "miktar", "quantity"]) || "").trim();
    const quantity = parseSingleQuantity(quantityText);
    if (!quantity.ok) {
      ctx.report.manualStockReview += 1;
      ctx.issues.push({ workbook: "stock", sheet: source.sheet, row: source.rowNumber, productCode, code: "manual_unit_review", severity: "warning", message: `“${quantityText}” tek miktar ve birime güvenle ayrılamadı.` });
      const existingInvalid = productCode
        ? state.products.find((item) => normalizeProductCode(item.productCode) === productCode)
        : state.products.find((item) => item.categoryId === category.id && normalizeSourceName(item.productName) === nameKey);
      if (existingInvalid) seen.add(existingInvalid.id);
      continue;
    }
    const thresholdRaw = String(cell(source.row, ["sipariş eşiği", "siparis esigi", "eşik", "esik", "order threshold"]) || "").trim();
    const thresholdUnspecified = !thresholdRaw || /^[-–—]$/.test(thresholdRaw);
    const parsedThreshold = thresholdUnspecified ? null : numericPrefix(thresholdRaw);
    if (!thresholdUnspecified && (parsedThreshold === null || parsedThreshold < 0)) { addIssue(ctx, "stock", source, "invalid_threshold", "Sipariş eşiği geçersiz."); continue; }
    const candidates = state.products.filter((item) => item.categoryId === category.id && normalizeSourceName(item.productName) === nameKey);
    const externalId = productCode || String(cell(source.row, ["externalid", "external id", "importkey", "import key"]) || "").trim();
    let product;
    if (productCode) {
      const codeMatches = state.products.filter((item) => normalizeProductCode(item.productCode) === productCode);
      if (codeMatches.length > 1) {
        addIssue(ctx, "stock", source, "duplicate_product_code", `“${productCode}” kodu birden fazla kalıcı stok ürününe bağlı.`);
        continue;
      }
      product = codeMatches[0] || null;
      if (!product) {
        const migrationCandidates = candidates.filter((item) => !normalizeProductCode(item.productCode));
        if (migrationCandidates.length === 1) product = migrationCandidates[0];
        else if (migrationCandidates.length > 1) {
          addIssue(ctx, "stock", source, "ambiguous_code_migration", `“${productCode}” kodu için birden fazla kodsuz eski stok ürünü bulundu.`);
          continue;
        } else if (candidates.some((item) => normalizeProductCode(item.productCode) && normalizeProductCode(item.productCode) !== productCode)) {
          addIssue(ctx, "stock", source, "same_name_different_code", `“${name}” adı farklı bir Stok Ürün Kodu ile de kullanılıyor; “${productCode}” ayrı ürün olarak korunacak.`, "warning");
        }
      }
    } else {
      product = resolveImportCandidate({
        candidates,
        allItems: state.products,
        externalId,
        importKey: sourceImportKey("stock", source.sheet, name),
        mappings: staged.mappings.stock,
        kind: "stock-product",
        sheetKey,
        nameKey,
        ctx,
        workbook: "stock",
        source,
        message: "Stok ürünü eşleşmesi belirsiz."
      });
    }
    if (product === AMBIGUOUS) continue;
    const threshold = thresholdUnspecified ? Number(product && product.orderThreshold || 0) : parsedThreshold;
    if (!product) {
      product = {
        id: generatedId("stock-product"), categoryId: category.id, category: category.name, productName: name, name,
        unit: quantity.unit, stockQuantity: quantity.value, stockQuantityText: quantityText, orderThreshold: threshold,
        orderThresholdText: thresholdRaw, criticalThreshold: 0, active: true, order: state.products.length, updatedAt: ctx.now,
        ...(externalId ? { externalId } : {}),
        ...(productCode ? { productCode } : {}),
        ...sourceMetadata("stock", source.sheet, name, ctx.now, ctx.analysisId, "excel_new")
      };
      state.products.push(product); ctx.report.newStockProducts += 1;
      addChange(ctx, "stock", category.name, name, "ürün", null, `${quantity.value} ${quantity.unit}`, "create", "active", "excel", productCode);
    } else {
      const oldQuantity = Number(product.stockQuantity || 0);
      const oldThreshold = Number(product.orderThreshold || 0);
      const returned = product.sourcePresent === false;
      Object.assign(product, {
        categoryId: category.id, category: category.name, productName: name, name, unit: quantity.unit,
        stockQuantity: quantity.value, stockQuantityText: quantityText, orderThreshold: threshold,
        orderThresholdText: thresholdRaw, sourcePresent: true, updatedAt: ctx.now,
        ...(productCode ? { productCode, externalId: productCode } : {})
      }, sourceMetadata("stock", source.sheet, name, ctx.now, ctx.analysisId, product.statusSource || "excel_existing"));
      if (product.statusSource === "manual") {
        product.statusSource = "manual";
        product.active = product.manualActive !== undefined ? product.manualActive !== false : product.active !== false;
        product.manualActive = product.active !== false;
        if (!product.active) ctx.report.manualInactivePreserved += 1;
      }
      if (returned && product.statusSource === "excel_removed") { product.active = true; product.statusSource = "excel_returned"; ctx.report.autoReactivated += 1; }
      if (oldQuantity !== quantity.value) {
        ctx.report.updatedStockProducts += 1;
        addChange(ctx, "stock", category.name, name, "stok", oldQuantity, quantity.value, "update", "unchanged", "excel", productCode);
        state.movements.unshift({ id: generatedId("stock-import"), productId: product.id, productName: name, type: "import", quantity: Math.abs(quantity.value - oldQuantity), unit: quantity.unit, reason: "Excel katalog aktarımı", note: `${oldQuantity} → ${quantity.value}`, actor: "Yönetici", createdAt: ctx.now });
      }
      if (oldThreshold !== threshold) addChange(ctx, "stock", category.name, name, "sipariş eşiği", oldThreshold, threshold, "update", "unchanged", "excel", productCode);
      if (oldQuantity === quantity.value && oldThreshold === threshold) ctx.report.unchanged += 1;
      if (returned) ctx.report.rediscovered += 1;
    }
    seen.add(product.id);
    upsertMapping(staged.mappings.stock, "stock-product", product.id, source.sheet, name, ctx.now, ctx.analysisId, productCode);
  }
  for (const product of state.products) {
    if (seen.has(product.id) || product.sourceType === "manual") continue;
    if (product.sourceWorkbook !== "stock" && product.sourceType !== "legacy") continue;
    const manuallyOwned = product.statusSource === "manual";
    if (manuallyOwned && product.sourcePresent !== false) product.manualActive = product.active !== false;
    product.sourcePresent = false; product.active = manuallyOwned ? product.manualActive !== false : false; product.statusSource = manuallyOwned ? "manual" : "excel_removed";
    product.lastImportedAt = ctx.now; product.lastImportOperationId = ctx.analysisId;
    ctx.report.removed += 1; ctx.report.archived += 1;
    addChange(ctx, "stock", product.category, product.productName, "sourcePresent", true, false, "archive", manuallyOwned ? "manager-status-preserved" : "deactivate", manuallyOwned ? "manager" : "excel", product.productCode);
  }
  for (const category of state.categories) {
    if (seenCategories.has(category.id) || category.sourceType === "manual") continue;
    if (category.sourceWorkbook !== "stock" && category.sourceType !== "legacy") continue;
    const manuallyOwned = category.statusSource === "manual";
    if (manuallyOwned && category.sourcePresent !== false) category.manualActive = category.active !== false;
    category.sourcePresent = false;
    category.active = manuallyOwned ? category.manualActive !== false : false;
    category.statusSource = manuallyOwned ? "manual" : "excel_removed";
    category.lastImportedAt = ctx.now;
    category.lastImportOperationId = ctx.analysisId;
  }
  state.movements = state.movements.slice(0, 1000);
  staged.stockState = normalizeStockState(state);
}

function consolidateExistingCatalog(staged, ctx) {
  const domains = arguments.length > 2 && arguments[2] instanceof Set ? arguments[2] : new Set();
  if (domains.has("catalog")) consolidateMenuCatalog(staged, ctx);
  if (domains.has("stock")) consolidateStockCatalog(staged, ctx);
  rewriteMappingEntityIds(staged.mappings, staged.referenceRewrites);
}

function consolidateMenuCatalog(staged, ctx) {
  const categories = Array.isArray(staged.menuState.categories) ? staged.menuState.categories : [];
  const groupedCategories = groupedIndex(categories, (item) => normalizeSourceName(item.name));
  const nextCategories = [];

  for (const records of groupedCategories.values()) {
    const canonical = chooseCanonical(records, staged.mappings.menu, ["category"]);
    const duplicates = records.filter((item) => item !== canonical);
    const mergedProducts = [];
    for (const category of records) {
      if (category !== canonical) {
        staged.referenceRewrites.menuCategories[String(category.id)] = String(canonical.id);
        canonical.aliasIds = uniqueStrings([...(canonical.aliasIds || []), category.id, ...(category.aliasIds || [])]).filter((id) => id !== String(canonical.id));
        ctx.report.mergedDuplicates += 1;
        addChange(ctx, "menu", canonical.name, "", "mükerrer kategori", category.id, canonical.id, "merge", "unchanged", "system");
      }
      for (const product of category.products || []) mergedProducts.push(product);
    }
    canonical.products = mergedProducts;
    mergeOwnership(canonical, records);
    nextCategories.push(canonical);
  }

  staged.menuState.categories = nextCategories;
  const canonicalProductsByCode = new Map();
  for (const category of staged.menuState.categories) {
    const groups = groupedIndex(category.products || [], (item) => normalizeProductCode(item.productCode)
      ? `code\u0000${normalizeProductCode(item.productCode)}`
      : `name\u0000${normalizeSourceName(item.name)}`);
    const nextProducts = [];
    for (const records of groups.values()) {
      const canonical = chooseCanonical(records, staged.mappings.menu, ["product"]);
      const duplicates = records.filter((item) => item !== canonical);
      const productCode = normalizeProductCode(canonical.productCode);
      const crossCategory = productCode ? canonicalProductsByCode.get(productCode) : null;
      if (crossCategory && crossCategory.product !== canonical) {
        mergeMenuProduct(crossCategory.product, canonical);
        staged.referenceRewrites.menuProducts[String(canonical.id)] = String(crossCategory.product.id);
        crossCategory.product.aliasIds = uniqueStrings([...(crossCategory.product.aliasIds || []), canonical.id, ...(canonical.aliasIds || [])]).filter((id) => id !== String(crossCategory.product.id));
        for (const duplicate of duplicates) {
          mergeMenuProduct(crossCategory.product, duplicate);
          staged.referenceRewrites.menuProducts[String(duplicate.id)] = String(crossCategory.product.id);
        }
        ctx.report.mergedDuplicates += records.length;
        addChange(ctx, "menu", crossCategory.category.name, crossCategory.product.name, "mükerrer ürün kodu", canonical.id, crossCategory.product.id, "merge", "unchanged", "system", productCode);
        continue;
      }
      for (const duplicate of duplicates) {
        mergeMenuProduct(canonical, duplicate);
        if (String(duplicate.id) !== String(canonical.id)) staged.referenceRewrites.menuProducts[String(duplicate.id)] = String(canonical.id);
        canonical.aliasIds = uniqueStrings([...(canonical.aliasIds || []), duplicate.id, ...(duplicate.aliasIds || [])]).filter((id) => id !== String(canonical.id));
        ctx.report.mergedDuplicates += 1;
        addChange(ctx, "menu", category.name, canonical.name, "mükerrer ürün", duplicate.id, canonical.id, "merge", "unchanged", "system");
      }
      nextProducts.push(canonical);
      if (productCode) canonicalProductsByCode.set(productCode, { category, product: canonical });
    }
    category.products = nextProducts;
  }
}

function consolidateStockCatalog(staged, ctx) {
  const state = staged.stockState;
  const categoryGroups = groupedIndex(state.categories || [], (item) => normalizeSourceName(item.name));
  const categories = [];
  for (const records of categoryGroups.values()) {
    const canonical = chooseCanonical(records, staged.mappings.stock, ["stock-category"]);
    for (const duplicate of records.filter((item) => item !== canonical)) {
      staged.referenceRewrites.stockCategories[String(duplicate.id)] = String(canonical.id);
      canonical.aliasIds = uniqueStrings([...(canonical.aliasIds || []), duplicate.id, ...(duplicate.aliasIds || [])]).filter((id) => id !== String(canonical.id));
      ctx.report.mergedDuplicates += 1;
      addChange(ctx, "stock", canonical.name, "", "mükerrer kategori", duplicate.id, canonical.id, "merge", "unchanged", "system");
    }
    mergeOwnership(canonical, records);
    categories.push(canonical);
  }
  state.categories = categories;
  for (const product of state.products || []) {
    const replacement = staged.referenceRewrites.stockCategories[String(product.categoryId)];
    if (replacement) product.categoryId = replacement;
    const category = state.categories.find((item) => String(item.id) === String(product.categoryId));
    if (category) product.category = category.name;
  }

  const productGroups = groupedIndex(state.products || [], (item) => normalizeProductCode(item.productCode)
    ? `code\u0000${normalizeProductCode(item.productCode)}`
    : `name\u0000${String(item.categoryId)}\u0000${normalizeSourceName(item.productName || item.name)}`);
  const products = [];
  for (const records of productGroups.values()) {
    const canonical = chooseCanonical(records, staged.mappings.stock, ["stock-product"]);
    const duplicates = records.filter((item) => item !== canonical);
    for (const duplicate of duplicates) {
      mergeStockProduct(canonical, duplicate);
      if (String(duplicate.id) !== String(canonical.id)) staged.referenceRewrites.stockProducts[String(duplicate.id)] = String(canonical.id);
      canonical.aliasIds = uniqueStrings([...(canonical.aliasIds || []), duplicate.id, ...(duplicate.aliasIds || [])]).filter((id) => id !== String(canonical.id));
      ctx.report.mergedDuplicates += 1;
      addChange(ctx, "stock", canonical.category, canonical.productName || canonical.name, "mükerrer ürün", duplicate.id, canonical.id, "merge", "unchanged", "system");
    }
    products.push(canonical);
  }
  state.products = products;
  for (const movement of state.movements || []) {
    const replacement = staged.referenceRewrites.stockProducts[String(movement.productId)];
    if (replacement) movement.productId = replacement;
  }
}

function chooseCanonical(records, mappings, kinds) {
  const candidates = Array.isArray(records) ? records : [];
  const mappedIds = new Set((mappings || []).filter((item) => kinds.includes(item.kind)).map((item) => String(item.entityId || "")).filter(Boolean));
  return candidates.slice().sort((first, second) => {
    const firstMapped = mappedIds.has(String(first.id)) ? 1 : 0;
    const secondMapped = mappedIds.has(String(second.id)) ? 1 : 0;
    if (firstMapped !== secondMapped) return secondMapped - firstMapped;
    const firstPresent = first.sourcePresent === false ? 0 : 1;
    const secondPresent = second.sourcePresent === false ? 0 : 1;
    if (firstPresent !== secondPresent) return secondPresent - firstPresent;
    const firstManual = first.statusSource === "manual" ? 1 : 0;
    const secondManual = second.statusSource === "manual" ? 1 : 0;
    if (firstManual !== secondManual) return secondManual - firstManual;
    const orderDifference = Number(first.order || 0) - Number(second.order || 0);
    return orderDifference || String(first.id || "").localeCompare(String(second.id || ""));
  })[0];
}

function canMergeMenuProducts(first, second) {
  if (!compatibleValue(first.recipeId, second.recipeId)) return false;
  if (!compatibleValue(first.manualContent, second.manualContent)) return false;
  for (const key of ["calories", "allergens", "ingredients"]) {
    if (!compatibleValue(first.details && first.details[key], second.details && second.details[key])) return false;
  }
  const firstPricing = first.pricing || {};
  const secondPricing = second.pricing || {};
  if (!compatibleValue(firstPricing.typeId, secondPricing.typeId)) return false;
  const optionIds = new Set([...Object.keys(firstPricing.values || {}), ...Object.keys(secondPricing.values || {})]);
  for (const optionId of optionIds) {
    const left = firstPricing.values && firstPricing.values[optionId];
    const right = secondPricing.values && secondPricing.values[optionId];
    if (left && right && stableJson(left) !== stableJson(right)) return false;
  }
  return true;
}

function mergeMenuProduct(target, source) {
  target.order = Math.min(Number(target.order || 0), Number(source.order || 0));
  for (const field of ["desc", "image", "imageUrl", "manualContent", "recipeId", "recipeSize"]) if (!target[field] && source[field]) target[field] = source[field];
  target.details = { ...(source.details || {}), ...(target.details || {}) };
  const targetPricing = target.pricing || {};
  const sourcePricing = source.pricing || {};
  target.pricing = {
    typeId: targetPricing.typeId || sourcePricing.typeId || "standard",
    values: { ...(sourcePricing.values || {}), ...(targetPricing.values || {}) }
  };
  mergeOwnership(target, [target, source]);
}

function canMergeStockProducts(first, second) {
  return normalizeSourceName(first.unit || "adet") === normalizeSourceName(second.unit || "adet")
    && Number(first.stockQuantity || 0) === Number(second.stockQuantity || 0)
    && Number(first.orderThreshold || 0) === Number(second.orderThreshold || 0);
}

function mergeStockProduct(target, source) {
  target.order = Math.min(Number(target.order || 0), Number(source.order || 0));
  for (const field of ["image", "imageUrl", "supplierId", "packageInfo"]) if (!target[field] && source[field]) target[field] = source[field];
  mergeOwnership(target, [target, source]);
}

function mergeOwnership(target, records) {
  const manual = (records || []).find((item) => item.statusSource === "manual");
  if (manual) {
    target.statusSource = "manual";
    target.manualActive = manual.manualActive !== undefined ? manual.manualActive !== false : manual.active !== false;
    target.active = target.manualActive;
  } else {
    target.active = (records || []).some((item) => item.active !== false && item.sourcePresent !== false);
    target.sourcePresent = (records || []).some((item) => item.sourcePresent !== false);
  }
}

function compatibleValue(first, second) {
  if (first === undefined || first === null || first === "" || second === undefined || second === null || second === "") return true;
  return normalizeSourceName(first) === normalizeSourceName(second);
}

function rewriteMappingEntityIds(mappings, rewrites) {
  const replacements = { ...rewrites.menuCategories, ...rewrites.menuProducts, ...rewrites.stockCategories, ...rewrites.stockProducts };
  for (const entries of Object.values(mappings || {})) {
    for (const mapping of entries || []) if (replacements[String(mapping.entityId)]) mapping.entityId = replacements[String(mapping.entityId)];
  }
}

function findRecipeItemByCodeAndSize(state, productCode, size) {
  const code = normalizeProductCode(productCode);
  const sizeKey = normalizeSourceName(size);
  const matches = [];
  for (const [category, products] of Object.entries(state || {})) {
    for (const [product, sizes] of Object.entries(products || {})) {
      for (const [storedSize, item] of Object.entries(sizes || {})) {
        if (item && typeof item === "object" && normalizeProductCode(item.productCode) === code && normalizeSourceName(storedSize) === sizeKey) {
          matches.push({ category, product, size: storedSize, item });
        }
      }
    }
  }
  return matches.length === 1 ? matches[0] : null;
}

function inferRecipeVariant(productName, sizeName) {
  const product = String(productName || "").trim();
  const size = String(sizeName || "Standart").trim() || "Standart";
  if (normalizeSourceName(size) !== "standart") return { product, size };
  const match = product.match(/\s+(single|double)\s*$/i);
  if (!match) return { product, size };
  return { product: product.slice(0, match.index).trim(), size: match[1][0].toUpperCase() + match[1].slice(1).toLowerCase() };
}

function hydrateRecipeCatalogCodes(staged) {
  for (const record of staged.recipeCatalog || []) {
    const sizes = staged.recipeState && staged.recipeState[record.category] && staged.recipeState[record.category][record.product] || {};
    const codes = uniqueStrings(Object.values(sizes).map((item) => item && typeof item === "object" ? normalizeProductCode(item.productCode) : ""));
    if (codes.length === 1) record.productCode = codes[0];
  }
}

function linkRecipesToCanonicalProducts(staged, ctx, options = {}) {
  const products = (staged.menuState.categories || []).flatMap((category) => (category.products || []).map((product) => ({ category, product })));
  const byName = groupedIndex(products, (item) => normalizeSourceName(item.product.name));
  const byCode = groupedIndex(products, (item) => normalizeProductCode(item.product.productCode));
  for (const record of staged.recipeCatalog || []) {
    const sizes = staged.recipeState && staged.recipeState[record.category] && staged.recipeState[record.category][record.product] || {};
    const active = Object.values(sizes).some((item) => !item || typeof item !== "object" || (item.active !== false && item.sourcePresent !== false));
    if (!active) continue;
    let candidates = record.productCode ? byCode.get(normalizeProductCode(record.productCode)) || [] : byName.get(normalizeSourceName(record.product)) || [];
    if (record.menuProductId) {
      const linked = products.find((item) => String(item.product.id) === String(record.menuProductId));
      if (linked) candidates = [linked];
    }
    const existingLinks = candidates.filter((item) => String(item.product.recipeId || "") === String(record.id));
    if (existingLinks.length) {
      record.menuProductIds = uniqueStrings(existingLinks.map((item) => item.product.id));
      record.menuProductId = record.menuProductIds[0];
      for (const linked of existingLinks) {
        linked.product.contentMode = "recipe";
        linked.product.recipeLinkStatus = "linked";
      }
      continue;
    }
    candidates = filterRecipeCandidatesByTemperature(candidates, sizes, record);
    if (candidates.length !== 1) {
      if (options.strict) {
        addIssue(
          ctx,
          "recipe",
          { sheet: record.category, rowNumber: 0, productCode: record.productCode },
          candidates.length ? "ambiguous_recipe_product" : "unlinked_recipe_product",
          candidates.length
            ? `“${record.product}” reçetesi birden fazla menü ürünüyle eşleşiyor.`
            : `“${record.product}” reçetesinin menü kataloğunda kanonik ürün karşılığı bulunamadı.`,
          candidates.length ? "error" : "warning"
        );
      }
      continue;
    }
    const { product } = candidates[0];
    record.menuProductId = product.id;
    record.menuProductIds = [product.id];
    product.recipeId = record.id;
    product.contentMode = "recipe";
    product.recipeLinkStatus = "linked";
    if (!product.recipeSize || !sizes[product.recipeSize]) product.recipeSize = Object.keys(sizes)[0] || "";
  }
}

function filterRecipeCandidatesByTemperature(candidates, sizes, record) {
  if (candidates.length <= 1) return candidates;
  const sourceSheets = Object.values(sizes || {})
    .filter((item) => item && typeof item === "object")
    .map((item) => item.sourceSheet)
    .filter(Boolean);
  const hint = normalizeSourceName(sourceSheets.join(" ") || record.category || "");
  const wantsHot = /(^| )sicak( |$)/.test(hint);
  const wantsCold = /(^| )soguk( |$)/.test(hint);
  if (!wantsHot && !wantsCold) return candidates;
  const filtered = candidates.filter(({ category }) => {
    const categoryName = normalizeSourceName(category && category.name);
    return wantsHot ? /(^| )sicak( |$)/.test(categoryName) : /(^| )soguk( |$)/.test(categoryName);
  });
  return filtered.length ? filtered : candidates;
}

function uniqueStrings(values) {
  return [...new Set((values || []).map((item) => String(item || "")).filter(Boolean))];
}

function workbookRows(workbook, kind, ctx, sheetFilter = () => true) {
  const result = [];
  const names = Array.isArray(workbook && workbook.SheetNames) ? workbook.SheetNames : [];
  let schemaSheetCount = 0;
  for (const sheet of names) {
    if (!sheetFilter(sheet)) continue;
    const rows = Array.isArray(workbook.Sheets && workbook.Sheets[sheet]) ? workbook.Sheets[sheet] : [];
    ctx.report.readSheets += 1;
    const headers = Array.isArray(rows.headers) ? rows.headers.map(normalizeSourceName) : [];
    const hasProductHeader = headers.some((header) => ["urun adi", "urun", "product", "product name"].includes(header));
    const hasProductCodeHeader = headers.some((header) => PRODUCT_CODE_HEADERS.map(normalizeSourceName).includes(header));
    if (!hasProductHeader) {
      ctx.issues.push({
        workbook: kind,
        sheet: String(sheet).trim(),
        row: 1,
        code: "ignored_non_catalog_sheet",
        severity: "warning",
        message: "Beklenen Ürün Adı başlığı bulunmadığı için açıklama/özet sayfası işleme alınmadı."
      });
      continue;
    }
    schemaSheetCount += 1;
    rows.forEach((row, index) => {
      ctx.report.readRows += 1;
      result.push({ kind, sheet: String(sheet).trim(), row, rowNumber: index + 2, headers, hasProductCodeHeader });
    });
  }
  if (!schemaSheetCount) {
    addIssue(ctx, kind, { sheet: "", rowNumber: 1 }, "missing_catalog_schema", "Çalışma kitabında beklenen Ürün Adı başlıklı bir katalog sayfası bulunamadı.");
  }
  return result;
}

function cell(row, aliases) {
  const wanted = new Set(aliases.map(normalizeSourceName));
  for (const [key, value] of Object.entries(row || {})) if (wanted.has(normalizeSourceName(key))) return value;
  return "";
}

function parseSingleQuantity(value) {
  const text = String(value || "").trim();
  if (!text || /[+\/]/.test(text)) return { ok: false };
  const match = text.match(/^([0-9]+(?:[.,][0-9]+)?)\s*([\p{L}]+)?$/u);
  if (!match) return { ok: false };
  const number = Number(match[1].replace(",", "."));
  if (!Number.isFinite(number) || number < 0) return { ok: false };
  return { ok: true, value: number, unit: String(match[2] || "adet").toLocaleLowerCase("tr-TR") };
}

function isPlaceholderName(value) {
  return /^[-–—]+$/.test(String(value || "").trim());
}

function isBlankTemplateRow(row) {
  return Object.values(row && typeof row === "object" ? row : {}).every((value) => {
    const text = String(value ?? "").trim();
    return !text || isPlaceholderName(text);
  });
}

function numericPrefix(value) {
  const match = String(value || "").trim().match(/^([0-9]+(?:[.,][0-9]+)?)/);
  if (!match) return null;
  const number = Number(match[1].replace(",", "."));
  return Number.isFinite(number) ? number : null;
}

function sourceMetadata(workbook, sheet, name, now, operationId, statusSource) {
  return {
    sourceType: "excel",
    sourceWorkbook: workbook,
    sourceSheet: String(sheet || ""),
    sourceNormalizedName: normalizeSourceName(name),
    importKey: sourceImportKey(workbook, sheet, name),
    sourcePresent: true,
    statusSource,
    lastImportedAt: now,
    lastImportOperationId: operationId
  };
}

function readProductCode(source, ctx, workbook, options = {}) {
  if (!source.hasProductCodeHeader) return { coded: false, code: "" };
  const rawCode = cell(source.row, PRODUCT_CODE_HEADERS);
  const code = normalizeProductCode(rawCode);
  source.productCode = code;
  if (!isValidProductCode(rawCode, { stock: options.stock === true })) {
    addIssue(
      ctx,
      workbook,
      source,
      "invalid_product_code",
      options.stock
        ? "Stok Ürün Kodu STK- ile başlayan, en az üç bölümlü güvenli bir kod olmalıdır."
        : "Ürün Kodu en az üç bölümlü, harf/rakam ve kısa çizgiden oluşan güvenli bir kod olmalıdır."
    );
    return { coded: true, code: "", invalid: true };
  }
  return { coded: true, code };
}

function sourceImportKey(workbook, sheet, name) {
  return `${String(workbook || "")}:${normalizeSourceName(sheet)}:${normalizeSourceName(name)}`;
}

function normalizeSourceName(value) {
  return String(value || "")
    .toLocaleLowerCase("tr-TR").replace(/ı/g, "i").normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function recipeGroupName(value) {
  const text = String(value || "").trim();
  const normalized = normalizeSourceName(text);
  if (normalized.includes("tahmisci") && normalized.includes("special")) {
    if (normalized.includes("sicak")) return "Tahmisçi Sıcak Specialler";
    if (normalized.includes("soguk")) return "Tahmisçi Soğuk Specialler";
    return "Tahmisçi Specialler";
  }
  return text;
}

function normalizeMappings(value) {
  const source = value && typeof value === "object" ? value : {};
  return Object.fromEntries(WORKBOOKS.map((key) => [key, Array.isArray(source[key]) ? clone(source[key]) : []]));
}

function mappingEntity(items, kind, sheetKey, nameKey) {
  const matches = (items || []).filter((item) => (!item.kind || item.kind === kind) && item.sheetNormalizedName === sheetKey && item.sourceNormalizedName === nameKey);
  return matches.length === 1 ? matches[0].entityId : "";
}

function resolveImportCandidate(options) {
  const {
    candidates = [], allItems = candidates, externalId = "", importKey = "", mappings = [],
    kind, sheetKey, nameKey, ctx, workbook, source, message
  } = options || {};
  const pool = Array.isArray(allItems) ? allItems : [];
  const byExternalId = externalId
    ? pool.filter((item) => [item && item.externalId, item && item.importKey]
      .some((value) => String(value || "") === externalId))
    : [];
  if (byExternalId.length === 1) return byExternalId[0];
  if (byExternalId.length > 1) {
    addIssue(ctx, workbook, source, "ambiguous_external_id", `${message} Kalıcı dış kimlik birden fazla kayda bağlı.`);
    return AMBIGUOUS;
  }

  const byImportKey = importKey ? pool.filter((item) => String(item && item.importKey || "") === importKey) : [];
  if (byImportKey.length === 1) return byImportKey[0];
  if (byImportKey.length > 1) {
    addIssue(ctx, workbook, source, "ambiguous_import_key", `${message} Kalıcı import anahtarı birden fazla kayda bağlı.`);
    return AMBIGUOUS;
  }

  const normalized = uniqueCandidate(candidates, ctx, workbook, source, message);
  if (normalized) return normalized;

  const mappedIds = [...new Set((mappings || [])
    .filter((item) => (!item.kind || item.kind === kind) && item.sheetNormalizedName === sheetKey && item.sourceNormalizedName === nameKey)
    .map((item) => String(item.entityId || ""))
    .filter(Boolean))];
  if (mappedIds.length === 1) {
    const mapped = pool.find((item) => String(item && item.id || "") === mappedIds[0]);
    if (mapped) return mapped;
    const aliases = pool.filter((item) => Array.isArray(item && item.aliasIds)
      && item.aliasIds.some((aliasId) => String(aliasId) === mappedIds[0]));
    if (aliases.length === 1) return aliases[0];
    if (aliases.length > 1) {
      addIssue(ctx, workbook, source, "ambiguous_alias", `${message} Eski kayıt kimliği birden fazla kanonik kayda bağlı.`);
      return AMBIGUOUS;
    }
    addIssue(ctx, workbook, source, "stale_mapping", "Kayıtlı kaynak eşlemesi artık katalogda bulunamıyor.");
    return AMBIGUOUS;
  }
  if (mappedIds.length > 1) {
    addIssue(ctx, workbook, source, "ambiguous_mapping", `${message} Önceki import eşlemesi birden fazla kayda bağlı.`);
    return AMBIGUOUS;
  }
  return null;
}

function upsertMapping(items, kind, entityId, sheet, name, now, operationId, productCode = "") {
  const next = {
    kind,
    entityId,
    sourceSheet: String(sheet),
    sheetNormalizedName: normalizeSourceName(sheet),
    sourceNormalizedName: normalizeSourceName(name),
    importKey: sourceImportKey(kind, sheet, name),
    externalId: normalizeProductCode(productCode),
    productCode: normalizeProductCode(productCode),
    aliasIds: [],
    lastImportedAt: now,
    lastImportOperationId: operationId
  };
  const index = items.findIndex((item) => item.entityId === entityId && (!item.kind || item.kind === kind));
  if (index >= 0) items[index] = next; else items.push(next);
}

function groupedIndex(items, keyFn) {
  const result = new Map();
  for (const item of items || []) pushIndex(result, keyFn(item), item);
  return result;
}

function pushIndex(index, key, item) {
  if (!index.has(key)) index.set(key, []);
  index.get(key).push(item);
}

function uniqueCandidate(items, ctx, workbook, source, message) {
  const candidates = Array.isArray(items) ? items : [];
  if (candidates.length > 1) {
    addIssue(ctx, workbook, source, "ambiguous_match", message);
    return AMBIGUOUS;
  }
  return candidates.length === 1 ? candidates[0] : null;
}

function addIssue(ctx, workbook, source, code, message, severity = "error") {
  ctx.issues.push({ workbook, sheet: source.sheet, row: source.rowNumber, productCode: normalizeProductCode(source.productCode), code, severity, message });
  ctx.report.invalidRows += 1;
  if (code.includes("ambiguous")) ctx.report.ambiguousMatches += 1;
  if (code === "invalid_product_code") ctx.report.invalidProductCodes += 1;
  if (code === "duplicate_product_code" || code === "duplicate_recipe_measure") ctx.report.duplicateProductCodes += 1;
  if (code === "orphan_product_code") ctx.report.orphanProductCodes += 1;
  if (code === "duplicate_recipe_measure") ctx.report.duplicateRecipeMeasures += 1;
}

function addChange(ctx, workbook, category, product, field, oldValue, newValue, operation, activeEffect, statusOwner, productCode = "") {
  ctx.changes.push({ workbook, category, product, productCode: normalizeProductCode(productCode), field, oldValue, newValue, operation, activeEffect, statusOwner });
}

function baseReport() {
  return {
    fileCount: 0, readSheets: 0, readRows: 0, newCategories: 0, newProducts: 0,
    updatedProducts: 0, unchanged: 0, removed: 0, archived: 0, rediscovered: 0,
    autoReactivated: 0, manualInactivePreserved: 0, invalidRows: 0, ambiguousMatches: 0,
    missingPrices: 0, unmatchedPricing: 0, mixedPricingFamilies: 0, updatedPrices: 0,
    newRecipes: 0, updatedRecipes: 0, unlinkedRecipes: 0,
    newStockProducts: 0, updatedStockProducts: 0, manualStockReview: 0, mergedDuplicates: 0,
    invalidProductCodes: 0, duplicateProductCodes: 0, orphanProductCodes: 0, duplicateRecipeMeasures: 0,
    warningCount: 0, errorCount: 0, changeCount: 0, archiveBaseline: 0,
    archiveRatio: 0, requiresArchiveConfirmation: false, canApply: false
  };
}

function scopedArchiveBaseline(data, workbooks) {
  let total = 0;
  if (workbooks && workbooks.menu) {
    total += (data?.menuState?.categories || []).reduce((count, category) => count + (category.products || [])
      .filter((product) => product && product.sourcePresent !== false).length, 0);
  }
  if (workbooks && workbooks.recipe) {
    for (const products of Object.values(data?.recipeState || {})) {
      for (const sizes of Object.values(products || {})) {
        total += Object.values(sizes || {}).filter((item) => item && typeof item === "object" && item.sourcePresent !== false).length;
      }
    }
  }
  if (workbooks && workbooks.stock) {
    total += (data?.stockState?.products || []).filter((product) => product && product.sourcePresent !== false).length;
  }
  if (workbooks && workbooks.pricing) {
    for (const category of data?.menuState?.categories || []) {
      for (const product of category.products || []) {
        const pricing = normalizeProductPricing(product && product.pricing);
        for (const family of pricing.families || []) {
          total += Object.values(family.values || {}).filter((option) => option && option.active !== false && option.sourcePresent !== false).length;
        }
      }
    }
  }
  return total;
}

function countUnlinkedRecipes(menuState, catalog) {
  const linked = new Set((menuState.categories || []).flatMap((category) => (category.products || []).map((product) => product.recipeId).filter(Boolean)));
  return (catalog || []).filter((item) => !(item.menuProductId || (item.menuProductIds || []).length) || !linked.has(item.id)).length;
}

function countProductsWithoutPrice(menuState) {
  let count = 0;
  for (const category of menuState && menuState.categories || []) {
    for (const product of category.products || []) {
      if (product.active === false || product.sourcePresent === false) continue;
      const values = normalizeProductPricing(product.pricing).families
        .flatMap((family) => Object.values(family.values || {}));
      const hasPrice = values.some((record) => {
        const value = record && typeof record === "object" ? record : { price: record, active: true };
        return value.active !== false && value.price !== null && value.price !== "" && Number.isFinite(Number(value.price));
      });
      if (!hasPrice) count += 1;
    }
  }
  return count;
}

const IMPORT_DOMAINS = ["catalog", "recipes", "stock"];

function selectedImportDomains(workbooks) {
  const selected = new Set();
  if (workbooks && (workbooks.menu || workbooks.pricing)) selected.add("catalog");
  if (workbooks && workbooks.recipe) selected.add("recipes");
  if (workbooks && workbooks.stock) selected.add("stock");
  return selected;
}

function normalizeImportDomains(domains, fallbackScopes = []) {
  const source = Array.isArray(domains) && domains.length ? domains : scopesToDomains(fallbackScopes);
  const requested = new Set(source.map((domain) => String(domain || "").trim().toLowerCase()));
  return IMPORT_DOMAINS.filter((domain) => requested.has(domain));
}

function scopesToDomains(scopes) {
  const selected = new Set(normalizeFingerprintScopes(scopes));
  const domains = [];
  if (selected.has("menu") || selected.has("pricing")) domains.push("catalog");
  if (selected.has("recipes")) domains.push("recipes");
  if (selected.has("stock")) domains.push("stock");
  return domains;
}

function domainsToScopes(domains, availableScopes = []) {
  const available = new Set(normalizeFingerprintScopes(availableScopes));
  const scopes = [];
  for (const domain of normalizeImportDomains(domains)) {
    if (domain === "catalog") {
      if (available.has("menu")) scopes.push("menu");
      if (available.has("pricing")) scopes.push("pricing");
    } else if (domain === "recipes" && available.has("recipes")) scopes.push("recipes");
    else if (domain === "stock" && available.has("stock")) scopes.push("stock");
  }
  return normalizeFingerprintScopes(scopes);
}

function buildDomainReadiness(data, workbooks, scopes, changes, issues) {
  const selected = selectedImportDomains(workbooks);
  const scopeSets = {
    catalog: new Set(["menu", "pricing"]),
    recipes: new Set(["recipe", "recipes"]),
    stock: new Set(["stock"])
  };
  const result = {};
  for (const domain of IMPORT_DOMAINS) {
    const domainIssues = issues.filter((issue) => scopeSets[domain].has(String(issue.workbook || "")));
    const domainChanges = changes.filter((change) => scopeSets[domain].has(String(change.workbook || "")));
    const blockingIssues = domainIssues.filter((issue) => issue.severity !== "warning");
    result[domain] = {
      selected: selected.has(domain),
      changeCount: domainChanges.length,
      warningCount: domainIssues.filter((issue) => issue.severity === "warning").length,
      errorCount: blockingIssues.length,
      canApply: selected.has(domain) && blockingIssues.length === 0 && domainChanges.length > 0,
      blockingIssues: blockingIssues.slice(0, 100)
    };
  }
  return result;
}

function domainRevisionSnapshot(data, domains) {
  const revisions = data && data.revisions || {};
  const result = {};
  for (const domain of normalizeImportDomains(domains)) result[domain] = Math.max(0, Number(revisions[`dataImport${domain[0].toUpperCase()}${domain.slice(1)}`] || 0));
  return result;
}

function domainFingerprintSnapshot(data, domains) {
  const result = {};
  for (const domain of normalizeImportDomains(domains)) result[domain] = catalogFingerprint(data, domain === "catalog" ? ["menu", "pricing"] : [domain]);
  return result;
}

function domainProductCodeFingerprintSnapshot(data, domains) {
  const result = {};
  for (const domain of normalizeImportDomains(domains)) result[domain] = productCodeFingerprint(data, domain === "catalog" ? ["menu", "pricing"] : [domain]);
  return result;
}

function domainCatalogSnapshot(data, domains) {
  const selected = new Set(normalizeImportDomains(domains));
  const snapshot = { domains: [...selected] };
  if (selected.has("catalog")) Object.assign(snapshot, clone({
    menuState: data.menuState, pricing: data.pricing,
    menuUpdatedAt: data.menuUpdatedAt, pricingUpdatedAt: data.pricingUpdatedAt,
    siteState: data.siteState, siteRevisions: data.siteRevisions
  }));
  if (selected.has("recipes")) Object.assign(snapshot, clone({
    recipeState: data.recipeState, recipeCatalog: data.recipeCatalog,
    recipeLinkReview: data.recipeLinkReview, recipeUpdatedAt: data.recipeUpdatedAt
  }));
  if (selected.has("stock")) Object.assign(snapshot, clone({
    stockState: data.stockState, stockUpdatedAt: data.stockUpdatedAt,
    workforceShipments: data.workforceShipments
  }));
  snapshot.dataImportMappings = {};
  const mappings = data.dataImportMappings || {};
  if (selected.has("catalog")) { snapshot.dataImportMappings.menu = clone(mappings.menu || []); snapshot.dataImportMappings.pricing = clone(mappings.pricing || []); }
  if (selected.has("recipes")) snapshot.dataImportMappings.recipe = clone(mappings.recipe || []);
  if (selected.has("stock")) snapshot.dataImportMappings.stock = clone(mappings.stock || []);
  const registryScopes = new Set(selected.has("catalog") ? ["menu"] : []);
  if (selected.has("recipes")) registryScopes.add("recipe");
  if (selected.has("stock")) registryScopes.add("stock");
  const registry = data.productCodeRegistry || {};
  snapshot.productCodeRegistry = {
    schemaVersion: registry.schemaVersion || 1,
    entries: clone((registry.entries || []).filter((entry) => registryScopes.has(entry.scope))),
    conflicts: clone((registry.conflicts || []).filter((entry) => registryScopes.has(entry.scope)))
  };
  return snapshot;
}

function restoreDomainCatalogSnapshot(data, snapshot, domains) {
  const selected = new Set(normalizeImportDomains(domains, snapshot && snapshot.domains));
  const copy = (key) => { if (Object.prototype.hasOwnProperty.call(snapshot || {}, key)) data[key] = clone(snapshot[key]); };
  if (selected.has("catalog")) ["menuState", "pricing", "menuUpdatedAt", "pricingUpdatedAt", "siteState", "siteRevisions"].forEach(copy);
  if (selected.has("recipes")) ["recipeState", "recipeCatalog", "recipeLinkReview", "recipeUpdatedAt"].forEach(copy);
  if (selected.has("stock")) ["stockState", "stockUpdatedAt", "workforceShipments"].forEach(copy);
  const targetMappings = data.dataImportMappings || (data.dataImportMappings = { menu: [], pricing: [], recipe: [], stock: [] });
  const savedMappings = snapshot && snapshot.dataImportMappings || {};
  if (selected.has("catalog")) { targetMappings.menu = clone(savedMappings.menu || []); targetMappings.pricing = clone(savedMappings.pricing || []); }
  if (selected.has("recipes")) targetMappings.recipe = clone(savedMappings.recipe || []);
  if (selected.has("stock")) targetMappings.stock = clone(savedMappings.stock || []);
  restoreRegistryDomains(data, snapshot && snapshot.productCodeRegistry, selected);
  return data;
}

function restoreRegistryDomains(data, savedRegistry, selectedDomains) {
  const registryScopes = new Set(selectedDomains.has("catalog") ? ["menu"] : []);
  if (selectedDomains.has("recipes")) registryScopes.add("recipe");
  if (selectedDomains.has("stock")) registryScopes.add("stock");
  const current = data.productCodeRegistry || { schemaVersion: 1, entries: [], conflicts: [] };
  const saved = savedRegistry || { entries: [], conflicts: [] };
  data.productCodeRegistry = {
    schemaVersion: Math.max(Number(current.schemaVersion || 1), Number(saved.schemaVersion || 1)),
    entries: clone((current.entries || []).filter((entry) => !registryScopes.has(entry.scope))).concat(clone(saved.entries || [])),
    conflicts: clone((current.conflicts || []).filter((entry) => !registryScopes.has(entry.scope))).concat(clone(saved.conflicts || []))
  };
}

function importRevision(data) { return Math.max(0, Number(data && data.revisions && data.revisions.dataImport || 0)); }

function catalogSnapshot(data) {
  return clone({
    menuState: data.menuState, pricing: data.pricing, recipeState: data.recipeState,
    recipeCatalog: data.recipeCatalog, recipeLinkReview: data.recipeLinkReview,
    stockState: data.stockState, dataImportMappings: data.dataImportMappings,
    productCodeRegistry: data.productCodeRegistry,
    siteState: data.siteState, siteRevisions: data.siteRevisions,
    workforceShipments: data.workforceShipments,
    menuUpdatedAt: data.menuUpdatedAt, pricingUpdatedAt: data.pricingUpdatedAt,
    recipeUpdatedAt: data.recipeUpdatedAt, stockUpdatedAt: data.stockUpdatedAt
  });
}

function restoreCatalogSnapshot(data, snapshot) {
  for (const [key, value] of Object.entries(snapshot || {})) data[key] = clone(value);
  return data;
}

function catalogFingerprint(data, scopes) {
  return hashFingerprintValue(catalogScopeSnapshot(data, scopes));
}

function legacyCatalogFingerprint(data) {
  // v1 analiz/geçmiş kayıtları registry snapshot'ından önce üretilmişti. Eski
  // draft ve undo kayıtlarının güvenli biçimde çalışabilmesi için v1 kapsamını
  // burada aynen koru; yeni işlemler daima scope-aware v2 kullanır.
  return hashFingerprintValue({
    menuState: data.menuState,
    pricing: data.pricing,
    recipeState: data.recipeState,
    recipeCatalog: data.recipeCatalog,
    recipeLinkReview: data.recipeLinkReview,
    stockState: data.stockState,
    dataImportMappings: data.dataImportMappings,
    siteState: data.siteState,
    siteRevisions: data.siteRevisions,
    workforceShipments: data.workforceShipments,
    menuUpdatedAt: data.menuUpdatedAt,
    pricingUpdatedAt: data.pricingUpdatedAt,
    recipeUpdatedAt: data.recipeUpdatedAt,
    stockUpdatedAt: data.stockUpdatedAt
  });
}

function catalogScopeSnapshot(data, scopes) {
  const selected = normalizeFingerprintScopes(scopes);
  const snapshot = { fingerprintVersion: 2, scopes: selected };
  if (selected.includes("menu")) snapshot.menu = menuFingerprintProjection(data);
  if (selected.includes("pricing")) snapshot.pricing = pricingFingerprintProjection(data);
  if (selected.includes("recipes")) snapshot.recipes = recipeFingerprintProjection(data);
  if (selected.includes("stock")) snapshot.stock = stockFingerprintProjection(data);
  return normalizeFingerprintValue(snapshot);
}

function productCodeFingerprint(data, scopes) {
  const selected = normalizeFingerprintScopes(scopes);
  const requiredRegistryScopes = new Set();
  if (selected.includes("menu") || selected.includes("pricing")) requiredRegistryScopes.add("menu");
  if (selected.includes("recipes")) requiredRegistryScopes.add("recipe");
  if (selected.includes("stock")) requiredRegistryScopes.add("stock");
  const snapshot = { fingerprintVersion: 2, scopes: selected };

  if (requiredRegistryScopes.has("menu")) snapshot.menu = menuProductCodes(data);
  if (requiredRegistryScopes.has("recipe")) snapshot.recipes = recipeProductCodes(data);
  if (requiredRegistryScopes.has("stock")) snapshot.stock = stockProductCodes(data);

  const registry = data && data.productCodeRegistry && typeof data.productCodeRegistry === "object"
    ? data.productCodeRegistry
    : {};
  snapshot.registry = {
    schemaVersion: finiteFingerprintNumber(registry.schemaVersion, 1),
    entries: stableSort((Array.isArray(registry.entries) ? registry.entries : [])
      .filter((entry) => requiredRegistryScopes.has(String(entry && entry.scope || "")))
      .map(registryEntryFingerprintProjection), registryEntrySortKey),
    conflicts: stableSort((Array.isArray(registry.conflicts) ? registry.conflicts : [])
      .filter((entry) => requiredRegistryScopes.has(String(entry && entry.scope || "")))
      .map((entry) => withoutTransientFingerprintFields(entry)), registryConflictSortKey)
  };
  return hashFingerprintValue(normalizeFingerprintValue(snapshot));
}

function normalizeFingerprintScopes(scopes) {
  const source = Array.isArray(scopes) && scopes.length ? scopes : ["menu", "pricing", "recipes", "stock"];
  const requested = new Set(source.map((scope) => scope === "recipe" ? "recipes" : String(scope || "").trim()));
  return ["menu", "pricing", "recipes", "stock"].filter((scope) => requested.has(scope));
}

function menuFingerprintProjection(data) {
  const categories = stableSort((data && data.menuState && data.menuState.categories || []).map((category) => {
    const projected = withoutTransientFingerprintFields(category, new Set(["products"]));
    projected.products = stableSort((category.products || []).map((product) =>
      withoutTransientFingerprintFields(product, new Set(["pricing", "price", "prices", "variants", "priceMode"]))
    ), menuProductSortKey);
    return projected;
  }), menuCategorySortKey);
  return {
    categories,
    mappings: fingerprintMappings(data, "menu")
  };
}

function pricingFingerprintProjection(data) {
  const products = [];
  for (const category of data && data.menuState && data.menuState.categories || []) {
    for (const product of category.products || []) {
      products.push({
        categoryId: String(category.id || ""),
        categoryName: String(category.name || ""),
        id: String(product.id || ""),
        productCode: normalizeProductCode(product.productCode),
        active: product.active !== false,
        sourcePresent: product.sourcePresent !== false,
        pricing: productPricingFingerprintProjection(product.pricing || {})
      });
    }
  }
  return {
    pricing: pricingCatalogFingerprintProjection(data && data.pricing || {}),
    products: stableSort(products, menuProductSortKey),
    mappings: fingerprintMappings(data, "pricing")
  };
}

function recipeFingerprintProjection(data) {
  return {
    recipeState: withoutTransientFingerprintFields(data && data.recipeState || {}),
    recipeCatalog: stableSort((data && data.recipeCatalog || []).map((item) =>
      withoutTransientFingerprintFields(item, new Set([
        "menuProductId", "menuProductIds", "menuCategoryId", "menuCategoryIds"
      ]))
    ), recipeCatalogSortKey),
    mappings: fingerprintMappings(data, "recipe")
  };
}

function stockFingerprintProjection(data) {
  const stock = data && data.stockState && typeof data.stockState === "object" ? data.stockState : {};
  return {
    schemaVersion: finiteFingerprintNumber(stock.schemaVersion, 1),
    categories: stableSort((stock.categories || []).map((category) =>
      withoutTransientFingerprintFields(category)
    ), stockCategorySortKey),
    products: stableSort((stock.products || []).map((product) =>
      withoutTransientFingerprintFields(product)
    ), stockProductSortKey),
    mappings: fingerprintMappings(data, "stock")
  };
}

function fingerprintMappings(data, scope) {
  const entries = data && data.dataImportMappings && data.dataImportMappings[scope] || [];
  return stableSort(entries.map((entry) => withoutTransientFingerprintFields(entry)), mappingSortKey);
}

function pricingCatalogFingerprintProjection(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const projected = withoutTransientFingerprintFields(source, new Set(["types"]));
  projected.types = stableSort((Array.isArray(source.types) ? source.types : []).map((type) => {
    const next = withoutTransientFingerprintFields(type, new Set(["options"]));
    next.options = stableSort((Array.isArray(type.options) ? type.options : []).map((option) =>
      withoutTransientFingerprintFields(option)
    ), pricingOptionSortKey);
    return next;
  }), pricingTypeSortKey);
  return projected;
}

function productPricingFingerprintProjection(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const projected = withoutTransientFingerprintFields(source, new Set(["families"]));
  projected.families = stableSort((Array.isArray(source.families) ? source.families : []).map((family) =>
    withoutTransientFingerprintFields(family)
  ), pricingFamilySortKey);
  return projected;
}

function registryEntryFingerprintProjection(entry) {
  return normalizeFingerprintValue({
    scope: String(entry && entry.scope || ""),
    entityId: String(entry && entry.entityId || ""),
    productCode: normalizeProductCode(entry && entry.productCode),
    aliases: normalizedCodeList(entry && entry.aliases),
    normalizedName: String(entry && entry.normalizedName || ""),
    normalizedCategory: String(entry && entry.normalizedCategory || ""),
    sourcePresent: entry && entry.sourcePresent !== false,
    archived: entry && entry.archived === true,
    active: entry && entry.active !== false
  });
}

function menuProductCodes(data) {
  return stableSort((data && data.menuState && data.menuState.categories || []).flatMap((category) =>
    (category.products || []).map((product) => ({
      categoryId: String(category.id || ""),
      id: String(product.id || ""),
      productCode: normalizeProductCode(product.productCode),
      aliases: normalizedCodeList(product.productCodeAliases),
      sourcePresent: product.sourcePresent !== false,
      active: product.active !== false
    }))
  ), menuProductSortKey);
}

function recipeProductCodes(data) {
  const recipes = [];
  for (const [category, products] of Object.entries(data && data.recipeState || {})) {
    for (const [product, sizes] of Object.entries(products || {})) {
      for (const [measure, item] of Object.entries(sizes || {})) if (item && typeof item === "object") recipes.push({
        category,
        product,
        measure,
        id: String(item.id || ""),
        productCode: normalizeProductCode(item.productCode),
        aliases: normalizedCodeList(item.productCodeAliases),
        sourcePresent: item.sourcePresent !== false,
        active: item.active !== false
      });
    }
  }
  return stableSort(recipes, recipeCodeSortKey);
}

function stockProductCodes(data) {
  return stableSort((data && data.stockState && data.stockState.products || []).map((product) => ({
    id: String(product.id || ""),
    productCode: normalizeProductCode(product.productCode),
    aliases: normalizedCodeList(product.productCodeAliases),
    sourcePresent: product.sourcePresent !== false,
    active: product.active !== false
  })), stockProductSortKey);
}

function withoutTransientFingerprintFields(value, extraExcluded = new Set()) {
  const excluded = new Set([
    "lastImportedAt", "lastImportOperationId", "updatedAt", "createdAt",
    "firstSeenAt", "lastSeenAt", "publishedAt", "approvedAt", "stockAppliedAt",
    ...extraExcluded
  ]);
  return projectFingerprintValue(value, excluded);
}

function projectFingerprintValue(value, excluded) {
  if (value === undefined) return null;
  if (value === null || typeof value !== "object") return normalizeFingerprintValue(value);
  if (Array.isArray(value)) return value.map((entry) => projectFingerprintValue(entry, excluded));
  const projected = {};
  for (const key of Object.keys(value).sort()) {
    if (!excluded.has(key)) projected[key] = projectFingerprintValue(value[key], excluded);
  }
  return projected;
}

function normalizeFingerprintValue(value) {
  if (value === undefined) return null;
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? (Object.is(value, -0) ? 0 : value) : null;
  if (Array.isArray(value)) return value.map(normalizeFingerprintValue);
  if (typeof value !== "object") return String(value);
  const normalized = {};
  for (const key of Object.keys(value).sort()) normalized[key] = normalizeFingerprintValue(value[key]);
  return normalized;
}

function stableSort(items, keyFn) {
  return [...(Array.isArray(items) ? items : [])].sort((first, second) => {
    const firstKey = String(keyFn(first));
    const secondKey = String(keyFn(second));
    return firstKey < secondKey ? -1 : (firstKey > secondKey ? 1 : 0);
  });
}

function menuCategorySortKey(item) { return `${finiteFingerprintNumber(item && item.order, 0)}\u0000${item && item.id || ""}\u0000${item && item.name || ""}`; }
function menuProductSortKey(item) { return `${item && item.categoryId || ""}\u0000${finiteFingerprintNumber(item && item.order, 0)}\u0000${normalizeProductCode(item && item.productCode)}\u0000${item && item.id || ""}`; }
function recipeCatalogSortKey(item) { return `${item && item.id || ""}\u0000${item && item.category || ""}\u0000${item && item.product || ""}`; }
function recipeCodeSortKey(item) { return `${normalizeProductCode(item && item.productCode)}\u0000${item && item.category || ""}\u0000${item && item.product || ""}\u0000${item && item.measure || ""}\u0000${item && item.id || ""}`; }
function stockCategorySortKey(item) { return `${finiteFingerprintNumber(item && item.order, 0)}\u0000${item && item.id || ""}\u0000${item && item.name || ""}`; }
function stockProductSortKey(item) { return `${item && item.categoryId || ""}\u0000${normalizeProductCode(item && item.productCode)}\u0000${item && item.id || ""}`; }
function mappingSortKey(item) { return `${item && item.kind || ""}\u0000${normalizeProductCode(item && item.productCode)}\u0000${item && item.entityId || ""}\u0000${item && item.importKey || ""}`; }
function pricingTypeSortKey(item) { return `${finiteFingerprintNumber(item && item.order, 0)}\u0000${item && item.id || ""}`; }
function pricingOptionSortKey(item) { return `${finiteFingerprintNumber(item && item.order, 0)}\u0000${item && item.id || ""}`; }
function pricingFamilySortKey(item) { return String(item && item.typeId || ""); }
function registryEntrySortKey(item) { return `${item && item.scope || ""}\u0000${normalizeProductCode(item && item.productCode)}\u0000${item && item.entityId || ""}`; }
function registryConflictSortKey(item) { return `${item && item.scope || ""}\u0000${normalizeProductCode(item && item.productCode)}\u0000${item && item.type || ""}\u0000${item && item.canonicalEntityId || ""}\u0000${item && item.conflictingEntityId || ""}`; }
function genericEntitySortKey(item) { return `${item && item.id || ""}\u0000${item && item.category || ""}\u0000${item && item.product || ""}\u0000${stableJson(item)}`; }
function normalizedCodeList(value) { return [...new Set((Array.isArray(value) ? value : []).map(normalizeProductCode).filter(Boolean))].sort(); }
function finiteFingerprintNumber(value, fallback) { const number = Number(value); return Number.isFinite(number) ? number : fallback; }
function hashFingerprintValue(value) {
  return crypto.createHash("sha256").update(stableJson(normalizeFingerprintValue(value))).digest("hex");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function generatedId(prefix) { return `${prefix}-${crypto.randomUUID()}`; }
function clone(value) { return value === undefined ? undefined : structuredClone(value); }

module.exports = {
  WORKBOOKS,
  analyzeDataImport,
  catalogFingerprint,
  catalogScopeSnapshot,
  catalogSnapshot,
  importRevision,
  legacyCatalogFingerprint,
  normalizeFingerprintScopes,
  normalizeImportDomains,
  domainsToScopes,
  scopesToDomains,
  domainRevisionSnapshot,
  domainFingerprintSnapshot,
  domainProductCodeFingerprintSnapshot,
  domainCatalogSnapshot,
  restoreDomainCatalogSnapshot,
  normalizeSourceName,
  productCodeFingerprint,
  restoreCatalogSnapshot
};
