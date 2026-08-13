/**
 * หยวนเซิน 源心 — ฐานข้อมูล Google Sheets (Apps Script backend)
 * -------------------------------------------------------------------
 * วิธีติดตั้ง: ดูขั้นตอนในแอป → "จัดการร้าน" → ฐานข้อมูล Google Sheets →
 * "วิธีสร้างฐานข้อมูล Google Sheets"
 *
 * เมื่อ Deploy เป็น Web App แล้ว โค้ดนี้จะสร้างชีตต่อไปนี้ให้อัตโนมัติ:
 *   - Menus       : id, emoji, name, cn, desc, price, cat
 *   - Orders      : id, table, time, dateKey, status, note, total
 *   - OrderItems  : orderId, name, emoji, qty, price
 *   - Config      : key, value   (orderCounter, menuIdCounter, updatedAt)
 *
 * ทุกครั้งที่แอปบันทึกข้อมูล (POST) ชีตเหล่านี้จะถูกล้างแล้วเขียนใหม่ทั้งหมด
 * ให้ตรงกับข้อมูลปัจจุบันในแอป — เหมาะสำหรับร้านอาหารขนาดเล็ก/กลาง ถ้าออเดอร์
 * สะสมเยอะมาก แนะนำให้กด "ล้างออเดอร์เสร็จแล้ว" ในแอปเป็นระยะเพื่อให้ซิงก์เร็วอยู่เสมอ
 */

function doGet(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var action = (e.parameter && e.parameter.action) || 'load';
  if (action !== 'load') {
    return json_({ ok: false, error: 'unknown action' });
  }
  return json_({ ok: true, data: readState_(ss) });
}

function doPost(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'bad json' });
  }
  writeState_(ss, body);
  return json_({ ok: true });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function sheet_(ss, name, headers) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  sh.clearContents();
  sh.appendRow(headers);
  return sh;
}

function writeState_(ss, s) {
  var menus  = Array.isArray(s.menus)  ? s.menus  : [];
  var orders = Array.isArray(s.orders) ? s.orders : [];

  var menuSheet = sheet_(ss, 'Menus', ['id', 'emoji', 'name', 'cn', 'desc', 'price', 'cat']);
  if (menus.length) {
    menuSheet.getRange(2, 1, menus.length, 7).setValues(menus.map(function (m) {
      return [m.id, m.emoji, m.name, m.cn || '', m.desc || '', m.price, m.cat];
    }));
  }

  var orderSheet = sheet_(ss, 'Orders', ['id', 'table', 'time', 'dateKey', 'status', 'note', 'total']);
  if (orders.length) {
    orderSheet.getRange(2, 1, orders.length, 7).setValues(orders.map(function (o) {
      return [o.id, o.table, o.time, o.dateKey || '', o.status, o.note || '', o.total];
    }));
  }

  var itemRows = [];
  orders.forEach(function (o) {
    (o.items || []).forEach(function (i) {
      itemRows.push([o.id, i.name, i.emoji || '', i.qty, i.price]);
    });
  });
  var itemSheet = sheet_(ss, 'OrderItems', ['orderId', 'name', 'emoji', 'qty', 'price']);
  if (itemRows.length) {
    itemSheet.getRange(2, 1, itemRows.length, 5).setValues(itemRows);
  }

  var cfgSheet = sheet_(ss, 'Config', ['key', 'value']);
  cfgSheet.getRange(2, 1, 3, 2).setValues([
    ['orderCounter', s.orderCounter || 1],
    ['menuIdCounter', s.menuIdCounter || 1],
    ['updatedAt', new Date().toISOString()],
  ]);
}

function readState_(ss) {
  var menuSheet  = ss.getSheetByName('Menus');
  var orderSheet = ss.getSheetByName('Orders');
  var itemSheet  = ss.getSheetByName('OrderItems');
  var cfgSheet   = ss.getSheetByName('Config');

  var menus = [];
  if (menuSheet && menuSheet.getLastRow() > 1) {
    menuSheet.getRange(2, 1, menuSheet.getLastRow() - 1, 7).getValues().forEach(function (r) {
      menus.push({ id: r[0], emoji: r[1], name: r[2], cn: r[3], desc: r[4], price: r[5], cat: r[6] });
    });
  }

  var itemsByOrder = {};
  if (itemSheet && itemSheet.getLastRow() > 1) {
    itemSheet.getRange(2, 1, itemSheet.getLastRow() - 1, 5).getValues().forEach(function (r) {
      var oid = r[0];
      if (!itemsByOrder[oid]) itemsByOrder[oid] = [];
      itemsByOrder[oid].push({ name: r[1], emoji: r[2], qty: r[3], price: r[4] });
    });
  }

  var orders = [];
  if (orderSheet && orderSheet.getLastRow() > 1) {
    orderSheet.getRange(2, 1, orderSheet.getLastRow() - 1, 7).getValues().forEach(function (r) {
      orders.push({
        id: r[0], table: r[1], time: r[2], dateKey: r[3], status: r[4], note: r[5], total: r[6],
        items: itemsByOrder[r[0]] || [],
      });
    });
  }

  var orderCounter = 1, menuIdCounter = 1;
  if (cfgSheet && cfgSheet.getLastRow() > 1) {
    cfgSheet.getRange(2, 1, cfgSheet.getLastRow() - 1, 2).getValues().forEach(function (r) {
      if (r[0] === 'orderCounter')  orderCounter  = Number(r[1]) || 1;
      if (r[0] === 'menuIdCounter') menuIdCounter = Number(r[1]) || 1;
    });
  }

  return { menus: menus, orders: orders, orderCounter: orderCounter, menuIdCounter: menuIdCounter };
}
