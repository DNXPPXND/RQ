const CONFIG = {
  SHEETS: {
    INVENTORY: "Inventory",
    REQUISITIONS: "Requisitions",
    SURVEYS: "Monthly_Survey",
    DEPARTMENTS: "Departments",
    STOCK_ADJUSTMENTS: "Stock_Adjustments"
  },
  HEADERS: {
    INVENTORY: [
      "item_id",
      "item_name",
      "category",
      "unit",
      "current_stock",
      "min_threshold"
    ],
    REQUISITIONS: [
      "requisition_no",
      "request_date",
      "department",
      "requester_name",
      "item_id",
      "item_name",
      "quantity",
      "remark",
      "created_at"
    ],
    SURVEYS: [
      "survey_id",
      "survey_month",
      "department",
      "item_name",
      "expected_qty",
      "reason",
      "created_at"
    ],
    DEPARTMENTS: [
      "dept_name",
      "dept_category"
    ],
    STOCK_ADJUSTMENTS: [
      "adjustment_no",
      "adjustment_date",
      "item_id",
      "item_name",
      "previous_stock",
      "new_stock",
      "reason",
      "admin"
    ]
  },
  ADMIN: {
    // PIN hash is saved in Script Properties by setAdminPin(); never put the PIN here.
    PIN_HASH_PROPERTY: "ADMIN_PIN_SHA256",
    FAILED_ATTEMPTS_CACHE_KEY: "ADMIN_PIN_FAILED_ATTEMPTS",
    MAX_FAILED_ATTEMPTS: 5,
    TOKEN_TTL_SECONDS: 900,
    LOCKOUT_SECONDS: 900
  }
};


function doGet(e) {
  try {
    const action = e && e.parameter && e.parameter.action
      ? e.parameter.action
      : "getData";

    if (action !== "getData") {
      return jsonResponse({
        success: false,
        message: "ไม่พบคำสั่งที่ร้องขอ"
      });
    }

    return jsonResponse({
      success: true,
      inventory: getSheetData_(CONFIG.SHEETS.INVENTORY),
      departments: getSheetData_(CONFIG.SHEETS.DEPARTMENTS),
      requisitions: getSheetData_(CONFIG.SHEETS.REQUISITIONS),
      surveys: getSheetData_(CONFIG.SHEETS.SURVEYS)
    });
  } catch (error) {
    console.error("GET error:", error);
    return jsonResponse({ success: false, message: error.message });
  }
}


function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      throw new Error("ไม่พบข้อมูลที่ส่งมาจากหน้าเว็บ");
    }

    const payload = JSON.parse(e.postData.contents);
    const action = String(payload.action || "").trim();
    let result;

    if (action === "adminLogin") {
      result = handleAdminLogin_(payload);
    } else if (action === "adminLogout") {
      result = handleAdminLogout_(payload);
    } else if (action === "requisition") {
      result = withScriptLock_(() => handleRequisition_(payload));
    } else if (action === "editRequisition") {
      result = withScriptLock_(() => handleRequisitionEdit_(payload));
    } else if (action === "deleteRequisition") {
      result = withScriptLock_(() => handleRequisitionDelete_(payload));
    } else if (action === "updateStock") {
      result = withScriptLock_(() => handleStockUpdate_(payload));
    } else if (action === "survey") {
      result = handleSurvey_(payload);
    } else if (action === "import_json") {
      result = withScriptLock_(() => handleImportInventory_(payload));
    } else {
      throw new Error("ไม่พบคำสั่ง: " + action);
    }

    return jsonResponse({
      success: true,
      message: result.message,
      data: result.data || null
    });
  } catch (error) {
    console.error("POST error:", error);
    return jsonResponse({ success: false, message: error.message });
  }
}


function withScriptLock_(callback) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return callback();
  } finally {
    lock.releaseLock();
  }
}


function getSpreadsheet_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) {
    throw new Error(
      "ไม่พบ Google Spreadsheet กรุณาผูก Apps Script กับ Google Sheets"
    );
  }
  return spreadsheet;
}


function getSheet_(sheetName, headers) {
  const spreadsheet = getSpreadsheet_();
  let sheet = spreadsheet.getSheetByName(sheetName);

  if (!sheet) {
    sheet = spreadsheet.insertSheet(sheetName);
  }

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
    sheet.setFrozenRows(1);
    return sheet;
  }

  const currentHeaders = sheet
    .getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1))
    .getDisplayValues()[0]
    .map(value => String(value).trim());

  headers.forEach(header => {
    if (!findHeaderIndex_(currentHeaders, header)) {
      const newColumn = sheet.getLastColumn() + 1;
      sheet.getRange(1, newColumn).setValue(header).setFontWeight("bold");
      currentHeaders.push(header);
    }
  });

  sheet.setFrozenRows(1);
  return sheet;
}


function normalizeHeader_(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s\-\/]+/g, "_");
}


function findHeaderIndex_(headers, name) {
  const target = normalizeHeader_(name);
  const index = headers.findIndex(header =>
    normalizeHeader_(header) === target
  );
  return index === -1 ? 0 : index + 1;
}


function getSheetData_(sheetName) {
  const sheet = getSheet_(sheetName, getHeadersForSheet_(sheetName));
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  if (lastRow < 2 || lastColumn < 1) return [];

  const values = sheet.getRange(1, 1, lastRow, lastColumn).getValues();
  const keys = values[0].map(normalizeHeader_);

  return values.slice(1)
    .filter(row => row.some(value => value !== "" && value !== null))
    .map(row => {
      const record = {};
      keys.forEach((key, index) => {
        if (key) record[key] = serializeValue_(row[index]);
      });
      return record;
    });
}


function getHeadersForSheet_(sheetName) {
  switch (sheetName) {
    case CONFIG.SHEETS.INVENTORY:
      return CONFIG.HEADERS.INVENTORY;
    case CONFIG.SHEETS.REQUISITIONS:
      return CONFIG.HEADERS.REQUISITIONS;
    case CONFIG.SHEETS.SURVEYS:
      return CONFIG.HEADERS.SURVEYS;
    case CONFIG.SHEETS.DEPARTMENTS:
      return CONFIG.HEADERS.DEPARTMENTS;
    case CONFIG.SHEETS.STOCK_ADJUSTMENTS:
      return CONFIG.HEADERS.STOCK_ADJUSTMENTS;
    default:
      throw new Error("ไม่พบชื่อ Sheet: " + sheetName);
  }
}


function serializeValue_(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(
      value,
      Session.getScriptTimeZone(),
      "yyyy-MM-dd HH:mm:ss"
    );
  }
  return value;
}


function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}


function findColumn_(headers, aliases) {
  const normalized = headers.map(normalizeHeader_);
  for (const alias of aliases) {
    const index = normalized.indexOf(normalizeHeader_(alias));
    if (index !== -1) return index;
  }
  return -1;
}


function getValue_(obj, aliases) {
  const keys = Object.keys(obj || {});
  for (const alias of aliases) {
    const target = normalizeHeader_(alias);
    const key = keys.find(candidate =>
      normalizeHeader_(candidate) === target
    );
    if (key !== undefined && obj[key] !== "") return obj[key];
  }
  return "";
}


function sha256Base64_(value) {
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(value),
    Utilities.Charset.UTF_8
  );
  return Utilities.base64EncodeWebSafe(digest).replace(/=+$/g, "");
}


function constantTimeEquals_(first, second) {
  const left = String(first);
  const right = String(second);
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index++) {
    difference |= (left.charCodeAt(index) || 0) ^
      (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}


function handleAdminLogin_(payload) {
  return withScriptLock_(() => {
    const cache = CacheService.getScriptCache();
    const attempts = Number(
      cache.get(CONFIG.ADMIN.FAILED_ATTEMPTS_CACHE_KEY) || 0
    );

    if (attempts >= CONFIG.ADMIN.MAX_FAILED_ATTEMPTS) {
      throw new Error("ใส่รหัสผิดหลายครั้ง กรุณารอ 15 นาทีแล้วลองใหม่");
    }

    const configuredHash = PropertiesService
      .getScriptProperties()
      .getProperty(CONFIG.ADMIN.PIN_HASH_PROPERTY);
    if (!configuredHash) {
      throw new Error(
        "ยังไม่ได้ตั้งรหัสผู้ดูแล: เปิดโปรเจกต์ Apps Script ที่ Deploy Web App นี้ " +
        "เลือกฟังก์ชัน setAdminPin แล้วกด Run เพื่อตั้งรหัส"
      );
    }

    const pin = String(payload.pin || "");
    if (!constantTimeEquals_(sha256Base64_(pin), configuredHash)) {
      cache.put(
        CONFIG.ADMIN.FAILED_ATTEMPTS_CACHE_KEY,
        String(attempts + 1),
        CONFIG.ADMIN.LOCKOUT_SECONDS
      );
      throw new Error("รหัสผู้ดูแลไม่ถูกต้อง");
    }

    cache.remove(CONFIG.ADMIN.FAILED_ATTEMPTS_CACHE_KEY);
    const token = Utilities.getUuid() + "." + Utilities.getUuid();
    cache.put(
      "ADMIN_TOKEN_" + sha256Base64_(token),
      "valid",
      CONFIG.ADMIN.TOKEN_TTL_SECONDS
    );

    return {
      message: "ยืนยันสิทธิ์ผู้ดูแลสำเร็จ",
      data: { admin_token: token }
    };
  });
}


function handleAdminLogout_(payload) {
  const token = String(payload.admin_token || "");
  if (token) {
    CacheService.getScriptCache().remove(
      "ADMIN_TOKEN_" + sha256Base64_(token)
    );
  }
  return { message: "ออกจากโหมดผู้ดูแลแล้ว" };
}


function requireAdminToken_(payload) {
  const token = String(payload.admin_token || "");
  if (!token || !CacheService.getScriptCache().get(
    "ADMIN_TOKEN_" + sha256Base64_(token)
  )) {
    throw new Error("สิทธิ์ผู้ดูแลหมดอายุหรือไม่ถูกต้อง กรุณายืนยันรหัสอีกครั้ง");
  }
}


function handleRequisition_(payload) {
  const inventorySheet = getSheet_(
    CONFIG.SHEETS.INVENTORY,
    CONFIG.HEADERS.INVENTORY
  );
  const requisitionSheet = getSheet_(
    CONFIG.SHEETS.REQUISITIONS,
    CONFIG.HEADERS.REQUISITIONS
  );

  const itemId = String(getValue_(payload, ["item_id", "itemId"])).trim();
  const quantity = Number(getValue_(payload, ["quantity", "qty"]));
  const department = String(
    getValue_(payload, ["department", "dept_name"])
  ).trim();
  const requesterName = String(getValue_(
    payload,
    ["requester_name", "requester", "name"]
  )).trim();
  const remark = String(
    getValue_(payload, ["remark", "reason", "note"])
  ).trim();

  if (!itemId) throw new Error("กรุณาเลือกวัสดุที่ต้องการเบิก");
  if (!department) throw new Error("กรุณาเลือกแผนก");
  if (!requesterName) throw new Error("กรุณาระบุชื่อผู้เบิก");
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error("จำนวนที่เบิกต้องมากกว่า 0");
  }

  const lastRow = inventorySheet.getLastRow();
  if (lastRow < 2) throw new Error("ไม่มีข้อมูลวัสดุในคลัง");

  const headers = inventorySheet
    .getRange(1, 1, 1, inventorySheet.getLastColumn())
    .getDisplayValues()[0];
  const idIndex = findColumn_(headers, ["item_id", "itemId", "รหัสวัสดุ"]);
  const nameIndex = findColumn_(headers, ["item_name", "itemName", "ชื่อวัสดุ"]);
  const stockIndex = findColumn_(
    headers,
    ["current_stock", "currentStock", "stock", "คงเหลือ"]
  );
  if (idIndex < 0 || nameIndex < 0 || stockIndex < 0) {
    throw new Error(
      "Sheet Inventory ต้องมีคอลัมน์ item_id, item_name และ current_stock"
    );
  }

  const matches = inventorySheet
    .getRange(2, idIndex + 1, lastRow - 1, 1)
    .createTextFinder(itemId)
    .matchEntireCell(true)
    .matchCase(true)
    .findAll();
  if (!matches.length) throw new Error("ไม่พบวัสดุรหัส " + itemId);
  if (matches.length > 1) {
    throw new Error("พบรหัสวัสดุซ้ำ กรุณาแก้ข้อมูล Inventory ก่อนเบิก");
  }

  const rowNumber = matches[0].getRow();
  const firstColumn = Math.min(nameIndex, stockIndex);
  const lastColumn = Math.max(nameIndex, stockIndex);
  const itemValues = inventorySheet
    .getRange(rowNumber, firstColumn + 1, 1, lastColumn - firstColumn + 1)
    .getValues()[0];
  const itemName = String(itemValues[nameIndex - firstColumn]).trim();
  const currentStock = Number(itemValues[stockIndex - firstColumn]);

  if (!Number.isFinite(currentStock) || currentStock < 0) {
    throw new Error("ยอดคงเหลือของวัสดุนี้ไม่ถูกต้อง กรุณาตรวจสอบ Inventory");
  }
  if (quantity > currentStock) {
    throw new Error(
      "วัสดุไม่เพียงพอ: คงเหลือ " + currentStock +
      " แต่ต้องการเบิก " + quantity
    );
  }

  const newStock = currentStock - quantity;
  inventorySheet.getRange(rowNumber, stockIndex + 1).setValue(newStock);

  const now = new Date();
  const requisitionNo = createDocumentNo_("REQ");
  const requisitionHeaders = requisitionSheet
    .getRange(1, 1, 1, requisitionSheet.getLastColumn())
    .getDisplayValues()[0];
  appendRecord_(requisitionSheet, requisitionHeaders, {
    requisition_no: requisitionNo,
    request_date: Utilities.formatDate(
      now,
      Session.getScriptTimeZone(),
      "yyyy-MM-dd"
    ),
    department: department,
    requester_name: requesterName,
    item_id: itemId,
    item_name: itemName,
    quantity: quantity,
    remark: remark,
    created_at: now
  });

  return {
    message: "บันทึกใบเบิกและตัดสต็อกเรียบร้อยแล้ว",
    data: {
      requisition_no: requisitionNo,
      item_id: itemId,
      item_name: itemName,
      quantity: quantity,
      previous_stock: currentStock,
      current_stock: newStock,
      department: department,
      requester_name: requesterName
    }
  };
}


function handleRequisitionEdit_(payload) {
  const requisitionNo = String(payload.requisition_no || "").trim();
  const requestDate = String(payload.request_date || "").trim();
  const department = String(payload.department || "").trim();
  const requesterName = String(payload.requester_name || "").trim();
  const itemId = String(payload.item_id || "").trim();
  const quantity = Number(payload.quantity);
  const remark = String(payload.remark || "").trim();

  if (!requisitionNo) throw new Error("ไม่พบเลขที่ใบเบิก");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(requestDate)) {
    throw new Error("กรุณาระบุวันที่เบิกให้ถูกต้อง");
  }
  const dateParts = requestDate.split("-").map(Number);
  const parsedDate = new Date(Date.UTC(
    dateParts[0],
    dateParts[1] - 1,
    dateParts[2]
  ));
  if (
    parsedDate.getUTCFullYear() !== dateParts[0] ||
    parsedDate.getUTCMonth() !== dateParts[1] - 1 ||
    parsedDate.getUTCDate() !== dateParts[2]
  ) {
    throw new Error("วันที่เบิกไม่มีอยู่จริง");
  }
  if (!department) throw new Error("กรุณาเลือกหน่วยงาน");
  if (!requesterName || requesterName.length > 150) {
    throw new Error("กรุณาระบุชื่อผู้เบิกไม่เกิน 150 ตัวอักษร");
  }
  if (remark.length > 1000) throw new Error("หมายเหตุต้องไม่เกิน 1,000 ตัวอักษร");
  if (!itemId) throw new Error("กรุณาเลือกวัสดุ");
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error("จำนวนที่เบิกต้องมากกว่า 0");
  }

  const requisitionSheet = getSheet_(
    CONFIG.SHEETS.REQUISITIONS,
    CONFIG.HEADERS.REQUISITIONS
  );
  const requisitionHeaders = requisitionSheet
    .getRange(1, 1, 1, requisitionSheet.getLastColumn())
    .getDisplayValues()[0];
  const requisitionNoIndex = findColumn_(requisitionHeaders, ["requisition_no"]);
  const requestDateIndex = findColumn_(requisitionHeaders, ["request_date"]);
  const departmentIndex = findColumn_(requisitionHeaders, ["department"]);
  const requesterIndex = findColumn_(requisitionHeaders, ["requester_name"]);
  const itemIdIndex = findColumn_(requisitionHeaders, ["item_id"]);
  const itemNameIndex = findColumn_(requisitionHeaders, ["item_name"]);
  const quantityIndex = findColumn_(requisitionHeaders, ["quantity"]);
  const remarkIndex = findColumn_(requisitionHeaders, ["remark"]);
  const requiredIndexes = [
    requisitionNoIndex, requestDateIndex, departmentIndex, requesterIndex,
    itemIdIndex, itemNameIndex, quantityIndex, remarkIndex
  ];
  if (requiredIndexes.some(index => index < 0)) {
    throw new Error("Sheet Requisitions ขาดคอลัมน์ที่จำเป็นสำหรับแก้ไขรายการ");
  }

  const lastRequisitionRow = requisitionSheet.getLastRow();
  if (lastRequisitionRow < 2) throw new Error("ไม่พบรายการเบิกที่ต้องการแก้ไข");
  const requisitionValues = requisitionSheet
    .getRange(2, 1, lastRequisitionRow - 1, requisitionHeaders.length)
    .getValues();
  const matches = [];
  requisitionValues.forEach((row, index) => {
    if (String(row[requisitionNoIndex]).trim() === requisitionNo) {
      matches.push({ rowNumber: index + 2, values: row });
    }
  });
  if (!matches.length) throw new Error("ไม่พบรายการเบิกเลขที่ " + requisitionNo);
  if (matches.length > 1) throw new Error("พบเลขที่ใบเบิกซ้ำ กรุณาตรวจสอบ Sheet Requisitions");

  const record = matches[0];
  const oldItemId = String(record.values[itemIdIndex]).trim();
  const oldQuantity = Number(record.values[quantityIndex]);
  if (!oldItemId || !Number.isFinite(oldQuantity) || oldQuantity <= 0) {
    throw new Error("ข้อมูลวัสดุหรือจำนวนเดิมไม่ถูกต้อง จึงไม่สามารถปรับสต็อกได้");
  }

  const inventory = getInventoryRecord_(oldItemId);
  const newInventory = oldItemId === itemId ? inventory : getInventoryRecord_(itemId);
  const previousStocks = new Map([
    [inventory.rowNumber, inventory.currentStock]
  ]);
  if (newInventory.rowNumber !== inventory.rowNumber) {
    previousStocks.set(newInventory.rowNumber, newInventory.currentStock);
  }

  let oldItemStock = inventory.currentStock;
  let newItemStock = newInventory.currentStock;
  if (oldItemId === itemId) {
    newItemStock = inventory.currentStock + oldQuantity - quantity;
    if (newItemStock < 0) {
      throw new Error(
        "ยอดคงเหลือไม่พอสำหรับจำนวนใหม่: มี " +
        (inventory.currentStock + oldQuantity) + " แต่ต้องการ " + quantity
      );
    }
  } else {
    oldItemStock = inventory.currentStock + oldQuantity;
    if (quantity > newInventory.currentStock) {
      throw new Error(
        "วัสดุใหม่มีไม่เพียงพอ: คงเหลือ " +
        newInventory.currentStock + " แต่ต้องการ " + quantity
      );
    }
    newItemStock = newInventory.currentStock - quantity;
  }

  const updatedValues = record.values.slice();
  updatedValues[requestDateIndex] = requestDate;
  updatedValues[departmentIndex] = department;
  updatedValues[requesterIndex] = requesterName;
  updatedValues[itemIdIndex] = itemId;
  updatedValues[itemNameIndex] = newInventory.itemName;
  updatedValues[quantityIndex] = quantity;
  updatedValues[remarkIndex] = remark;

  try {
    if (oldItemId === itemId) {
      inventory.sheet
        .getRange(inventory.rowNumber, inventory.stockIndex + 1)
        .setValue(newItemStock);
    } else {
      inventory.sheet
        .getRange(inventory.rowNumber, inventory.stockIndex + 1)
        .setValue(oldItemStock);
      newInventory.sheet
        .getRange(newInventory.rowNumber, newInventory.stockIndex + 1)
        .setValue(newItemStock);
    }
    requisitionSheet
      .getRange(record.rowNumber, 1, 1, requisitionHeaders.length)
      .setValues([updatedValues]);
  } catch (error) {
    previousStocks.forEach((stock, rowNumber) => {
      const target = rowNumber === inventory.rowNumber ? inventory : newInventory;
      try {
        target.sheet.getRange(rowNumber, target.stockIndex + 1).setValue(stock);
      } catch (rollbackError) {
        console.error("Requisition edit stock rollback failed:", rollbackError);
      }
    });
    throw error;
  }

  return {
    message: "แก้ไขรายการเบิกและปรับยอดคงเหลือเรียบร้อยแล้ว",
    data: {
      requisition_no: requisitionNo,
      request_date: requestDate,
      department: department,
      requester_name: requesterName,
      item_id: itemId,
      item_name: newInventory.itemName,
      quantity: quantity,
      remark: remark,
      current_stock: newItemStock,
      previous_item_id: oldItemId,
      previous_item_stock: oldItemStock
    }
  };
}


function handleRequisitionDelete_(payload) {
  requireAdminToken_(payload);
  const requisitionNo = String(payload.requisition_no || "").trim();
  if (!requisitionNo) throw new Error("ไม่พบเลขที่ใบเบิก");

  const requisitionSheet = getSheet_(
    CONFIG.SHEETS.REQUISITIONS,
    CONFIG.HEADERS.REQUISITIONS
  );
  const headers = requisitionSheet
    .getRange(1, 1, 1, requisitionSheet.getLastColumn())
    .getDisplayValues()[0];
  const requisitionNoIndex = findColumn_(headers, ["requisition_no"]);
  const itemIdIndex = findColumn_(headers, ["item_id"]);
  const quantityIndex = findColumn_(headers, ["quantity"]);
  if (requisitionNoIndex < 0 || itemIdIndex < 0 || quantityIndex < 0) {
    throw new Error("Sheet Requisitions ขาดคอลัมน์ที่จำเป็นสำหรับลบรายการ");
  }

  const lastRow = requisitionSheet.getLastRow();
  if (lastRow < 2) throw new Error("ไม่พบรายการเบิกที่ต้องการลบ");
  const values = requisitionSheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  const matches = [];
  values.forEach((row, index) => {
    if (String(row[requisitionNoIndex]).trim() === requisitionNo) {
      matches.push({ rowNumber: index + 2, values: row });
    }
  });
  if (!matches.length) throw new Error("ไม่พบรายการเบิกเลขที่ " + requisitionNo);
  if (matches.length > 1) throw new Error("พบเลขที่ใบเบิกซ้ำ กรุณาตรวจสอบ Sheet Requisitions");

  const record = matches[0];
  const itemId = String(record.values[itemIdIndex]).trim();
  const quantity = Number(record.values[quantityIndex]);
  if (!itemId || !Number.isFinite(quantity) || quantity <= 0) {
    throw new Error("ข้อมูลวัสดุหรือจำนวนเดิมไม่ถูกต้อง จึงไม่สามารถคืนสต็อกได้");
  }
  const inventory = getInventoryRecord_(itemId);
  const newStock = inventory.currentStock + quantity;

  try {
    inventory.sheet
      .getRange(inventory.rowNumber, inventory.stockIndex + 1)
      .setValue(newStock);
    requisitionSheet.deleteRow(record.rowNumber);
  } catch (error) {
    try {
      inventory.sheet
        .getRange(inventory.rowNumber, inventory.stockIndex + 1)
        .setValue(inventory.currentStock);
    } catch (rollbackError) {
      console.error("Requisition delete stock rollback failed:", rollbackError);
    }
    throw error;
  }

  return {
    message: "ลบรายการเบิกและคืนวัสดุเข้าคลังเรียบร้อยแล้ว",
    data: {
      requisition_no: requisitionNo,
      item_id: itemId,
      quantity: quantity,
      current_stock: newStock
    }
  };
}


function getInventoryRecord_(itemId) {
  const sheet = getSheet_(
    CONFIG.SHEETS.INVENTORY,
    CONFIG.HEADERS.INVENTORY
  );
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) throw new Error("ไม่มีข้อมูลวัสดุในคลัง");

  const headers = sheet
    .getRange(1, 1, 1, sheet.getLastColumn())
    .getDisplayValues()[0];
  const idIndex = findColumn_(headers, ["item_id", "itemId", "รหัสวัสดุ"]);
  const nameIndex = findColumn_(headers, ["item_name", "itemName", "ชื่อวัสดุ"]);
  const stockIndex = findColumn_(
    headers,
    ["current_stock", "currentStock", "stock", "คงเหลือ"]
  );
  if (idIndex < 0 || nameIndex < 0 || stockIndex < 0) {
    throw new Error("Inventory ต้องมีคอลัมน์ item_id, item_name และ current_stock");
  }

  const matches = sheet
    .getRange(2, idIndex + 1, lastRow - 1, 1)
    .createTextFinder(itemId)
    .matchEntireCell(true)
    .matchCase(true)
    .findAll();
  if (!matches.length) throw new Error("ไม่พบวัสดุรหัส " + itemId);
  if (matches.length > 1) throw new Error("พบรหัสวัสดุซ้ำ กรุณาแก้ข้อมูล Inventory ก่อน");

  const rowNumber = matches[0].getRow();
  const currentStock = Number(sheet.getRange(rowNumber, stockIndex + 1).getValue());
  if (!Number.isFinite(currentStock) || currentStock < 0) {
    throw new Error("ยอดคงเหลือของวัสดุรหัส " + itemId + " ไม่ถูกต้อง");
  }
  return {
    sheet: sheet,
    rowNumber: rowNumber,
    itemId: itemId,
    itemName: String(sheet.getRange(rowNumber, nameIndex + 1).getDisplayValue()).trim(),
    currentStock: currentStock,
    stockIndex: stockIndex
  };
}


function handleStockUpdate_(payload) {
  requireAdminToken_(payload);

  const itemId = String(payload.item_id || "").trim();
  const newStock = Number(payload.current_stock);
  const reason = String(payload.reason || "").trim();
  if (!itemId) throw new Error("ไม่พบรหัสวัสดุ");
  if (!Number.isFinite(newStock) || newStock < 0) {
    throw new Error("ยอดคงเหลือต้องเป็น 0 หรือมากกว่า");
  }
  if (!reason || reason.length > 300) {
    throw new Error("กรุณาระบุเหตุผลในการปรับยอดไม่เกิน 300 ตัวอักษร");
  }

  const inventorySheet = getSheet_(
    CONFIG.SHEETS.INVENTORY,
    CONFIG.HEADERS.INVENTORY
  );
  const lastRow = inventorySheet.getLastRow();
  if (lastRow < 2) throw new Error("ไม่มีข้อมูลวัสดุในคลัง");

  const headers = inventorySheet
    .getRange(1, 1, 1, inventorySheet.getLastColumn())
    .getDisplayValues()[0];
  const idIndex = findColumn_(headers, ["item_id", "itemId", "รหัสวัสดุ"]);
  const nameIndex = findColumn_(headers, ["item_name", "itemName", "ชื่อวัสดุ"]);
  const stockIndex = findColumn_(
    headers,
    ["current_stock", "currentStock", "stock", "คงเหลือ"]
  );
  if (idIndex < 0 || nameIndex < 0 || stockIndex < 0) {
    throw new Error(
      "Sheet Inventory ต้องมีคอลัมน์ item_id, item_name และ current_stock"
    );
  }

  const matches = inventorySheet
    .getRange(2, idIndex + 1, lastRow - 1, 1)
    .createTextFinder(itemId)
    .matchEntireCell(true)
    .matchCase(true)
    .findAll();
  if (!matches.length) throw new Error("ไม่พบวัสดุรหัส " + itemId);
  if (matches.length > 1) throw new Error("พบรหัสวัสดุซ้ำใน Inventory");

  const rowNumber = matches[0].getRow();
  const previousStock = Number(
    inventorySheet.getRange(rowNumber, stockIndex + 1).getValue()
  );
  if (!Number.isFinite(previousStock) || previousStock < 0) {
    throw new Error("ยอดคงเหลือเดิมไม่ถูกต้อง กรุณาตรวจสอบ Inventory");
  }
  const itemName = String(
    inventorySheet.getRange(rowNumber, nameIndex + 1).getDisplayValue()
  ).trim();

  inventorySheet.getRange(rowNumber, stockIndex + 1).setValue(newStock);

  let auditWarning = "";
  try {
    const auditSheet = getSheet_(
      CONFIG.SHEETS.STOCK_ADJUSTMENTS,
      CONFIG.HEADERS.STOCK_ADJUSTMENTS
    );
    const auditHeaders = auditSheet
      .getRange(1, 1, 1, auditSheet.getLastColumn())
      .getDisplayValues()[0];
    const now = new Date();
    appendRecord_(auditSheet, auditHeaders, {
      adjustment_no: createDocumentNo_("ADJ"),
      adjustment_date: now,
      item_id: itemId,
      item_name: itemName,
      previous_stock: previousStock,
      new_stock: newStock,
      reason: reason,
      admin: "Admin PIN"
    });
  } catch (error) {
    console.error("Stock adjustment audit write failed:", error);
    auditWarning = " ปรับยอดแล้ว แต่บันทึกประวัติการปรับยอดไม่สำเร็จ";
  }

  return {
    message: "ปรับยอดคงเหลือเรียบร้อยแล้ว" + auditWarning,
    data: {
      item_id: itemId,
      item_name: itemName,
      previous_stock: previousStock,
      current_stock: newStock,
      reason: reason,
      audit_warning: auditWarning || null
    }
  };
}


function handleSurvey_(payload) {
  const sheet = getSheet_(
    CONFIG.SHEETS.SURVEYS,
    CONFIG.HEADERS.SURVEYS
  );
  const department = String(
    getValue_(payload, ["department", "dept_name"])
  ).trim();
  const itemName = String(
    getValue_(payload, ["item_name", "itemName"])
  ).trim();
  const expectedQty = Number(getValue_(
    payload,
    ["expected_qty", "expectedQty", "quantity", "qty"]
  ));
  const reason = String(
    getValue_(payload, ["reason", "remark", "note"])
  ).trim();
  const requestedMonth = String(payload.survey_month || "").trim();

  if (!department) throw new Error("กรุณาเลือกแผนก");
  if (!itemName) throw new Error("กรุณาระบุชื่อวัสดุ");
  if (!Number.isFinite(expectedQty) || expectedQty < 0) {
    throw new Error("จำนวนวัสดุที่ต้องการต้องเป็น 0 หรือมากกว่า");
  }

  const now = new Date();
  const day = Number(Utilities.formatDate(
    now,
    Session.getScriptTimeZone(),
    "d"
  ));
  if (day < 1 || day > 10) {
    throw new Error("ระบบสำรวจวัสดุเปิดให้บันทึกเฉพาะวันที่ 1-10 ของเดือน");
  }

  const surveyMonth = Utilities.formatDate(
    now,
    Session.getScriptTimeZone(),
    "yyyy-MM"
  );
  if (requestedMonth && requestedMonth !== surveyMonth) {
    throw new Error("เลือกสำรวจได้เฉพาะเดือนปัจจุบัน");
  }

  const record = {
    survey_id: createDocumentNo_("SURVEY"),
    survey_month: surveyMonth,
    department: department,
    item_name: itemName,
    expected_qty: expectedQty,
    reason: reason,
    created_at: now
  };
  const headers = sheet
    .getRange(1, 1, 1, sheet.getLastColumn())
    .getDisplayValues()[0];
  appendRecord_(sheet, headers, record);
  return { message: "บันทึกแบบสำรวจวัสดุเรียบร้อยแล้ว", data: record };
}


function handleImportInventory_(payload) {
  requireAdminToken_(payload);

  const rows = payload.data || payload.inventory;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("ข้อมูลนำเข้าต้องเป็น Array ที่มีรายการ");
  }

  const sheet = getSheet_(
    CONFIG.SHEETS.INVENTORY,
    CONFIG.HEADERS.INVENTORY
  );
  const headers = sheet
    .getRange(1, 1, 1, sheet.getLastColumn())
    .getDisplayValues()[0];
  const idIndex = findColumn_(headers, ["item_id", "itemId", "รหัสวัสดุ"]);
  const nameIndex = findColumn_(headers, ["item_name", "itemName", "ชื่อวัสดุ"]);
  const categoryIndex = findColumn_(headers, ["category", "หมวดหมู่"]);
  const unitIndex = findColumn_(headers, ["unit", "หน่วย"]);
  const stockIndex = findColumn_(
    headers,
    ["current_stock", "currentStock", "stock", "คงเหลือ"]
  );
  const thresholdIndex = findColumn_(
    headers,
    ["min_threshold", "minThreshold", "ขั้นต่ำ"]
  );
  if (idIndex < 0 || nameIndex < 0 || stockIndex < 0) {
    throw new Error(
      "Inventory ต้องมีคอลัมน์ item_id, item_name และ current_stock"
    );
  }

  const output = rows.map((item, index) => {
    const id = getValue_(item, ["item_id", "itemId", "รหัสวัสดุ"]);
    const name = getValue_(item, ["item_name", "itemName", "ชื่อวัสดุ"]);
    const stock = Number(getValue_(
      item,
      ["current_stock", "currentStock", "stock", "คงเหลือ"]
    ));
    if (!String(id).trim() || !String(name).trim()) {
      throw new Error("รายการที่ " + (index + 1) + " ไม่มีรหัสหรือชื่อวัสดุ");
    }
    if (!Number.isFinite(stock) || stock < 0) {
      throw new Error("ยอดคงเหลือของรายการที่ " + (index + 1) + " ไม่ถูกต้อง");
    }

    const row = new Array(headers.length).fill("");
    row[idIndex] = id;
    row[nameIndex] = name;
    row[stockIndex] = stock;
    if (categoryIndex >= 0) {
      row[categoryIndex] = getValue_(item, ["category", "หมวดหมู่"]);
    }
    if (unitIndex >= 0) {
      row[unitIndex] = getValue_(item, ["unit", "หน่วย"]);
    }
    if (thresholdIndex >= 0) {
      const threshold = getValue_(item, [
        "min_threshold",
        "minThreshold",
        "ขั้นต่ำ"
      ]);
      row[thresholdIndex] = threshold === "" ? 0 : Number(threshold);
    }
    return row;
  });

  const oldLastRow = sheet.getLastRow();
  if (oldLastRow > 1) {
    sheet.getRange(2, 1, oldLastRow - 1, headers.length).clearContent();
  }
  sheet.getRange(2, 1, output.length, headers.length).setValues(output);
  return {
    message: "นำเข้าข้อมูล Inventory เรียบร้อยแล้ว",
    data: { imported: output.length }
  };
}


function appendRecord_(sheet, headers, record) {
  const row = headers.map(header => {
    const key = normalizeHeader_(header);
    return Object.prototype.hasOwnProperty.call(record, key)
      ? record[key]
      : "";
  });
  sheet.appendRow(row);
}


function createDocumentNo_(prefix) {
  const timestamp = Utilities.formatDate(
    new Date(),
    Session.getScriptTimeZone(),
    "yyyyMMdd-HHmmss"
  );
  const random = Math.floor(Math.random() * 900 + 100);
  return prefix + "-" + timestamp + "-" + random;
}


/**
 * ตั้งหรือเปลี่ยนรหัสผู้ดูแล:
 * 1. เปิดโปรเจกต์ Apps Script เดียวกับ Web App ที่หน้าเว็บเรียกใช้
 * 2. เลือก setAdminPin จากรายการฟังก์ชัน แล้วกด Run
 * 3. อนุญาตสิทธิ์และกรอกรหัสในหน้าต่างที่เปิดขึ้น
 * ระบบเก็บเฉพาะค่าแฮชใน Script Properties ไม่ต้องใส่รหัสในโค้ด
 */
function setAdminPin() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.prompt(
    "ตั้งรหัสผู้ดูแล",
    "กรอกรหัสอย่างน้อย 8 ตัวอักษร (แนะนำ 12 ตัวขึ้นไป) ระบบจะเก็บเฉพาะค่าแฮช",
    ui.ButtonSet.OK_CANCEL
  );
  if (response.getSelectedButton() !== ui.Button.OK) return;

  const pin = response.getResponseText();
  if (pin.length < 8) {
    ui.alert("รหัสต้องมีอย่างน้อย 8 ตัวอักษร");
    return;
  }

  PropertiesService.getScriptProperties().setProperty(
    CONFIG.ADMIN.PIN_HASH_PROPERTY,
    sha256Base64_(pin)
  );
  CacheService.getScriptCache().remove(
    CONFIG.ADMIN.FAILED_ATTEMPTS_CACHE_KEY
  );
  ui.alert("ตั้งรหัสผู้ดูแลแล้ว กรุณาปิด/เปิดหน้าเว็บใหม่ก่อนทดสอบ");
}


function testConnection() {
  const result = {
    spreadsheet: getSpreadsheet_().getName(),
    inventoryCount: getSheetData_(CONFIG.SHEETS.INVENTORY).length,
    departmentCount: getSheetData_(CONFIG.SHEETS.DEPARTMENTS).length,
    requisitionCount: getSheetData_(CONFIG.SHEETS.REQUISITIONS).length,
    surveyCount: getSheetData_(CONFIG.SHEETS.SURVEYS).length
  };
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}
