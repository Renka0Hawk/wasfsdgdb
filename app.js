/* =====================================================
   หยวนเซิน 源心 — Restaurant Order App
   app.js — Application Logic
   ===================================================== */

'use strict';

// ── DATA STORE ──────────────────────────────────────

const STORAGE_KEY = 'yuanxin-pos-state-v1';

let defaultMenus = [
  { id:1, emoji:'🦆', name:'เป็ดปักกิ่ง', cn:'北京烤鸭',
    desc:'ผิวกรอบ เนื้อนุ่ม เสิร์ฟพร้อมแผ่นแป้งและซอสหมัก', price:680, cat:'อาหารหลัก' },
  { id:2, emoji:'🦐', name:'กุ้งซีอิ๊วอบเกลือ', cn:'盐焗虾',
    desc:'กุ้งสดตัวโต อบกับเกลือหิมาลายาและเครื่องเทศ', price:420, cat:'อาหารหลัก' },
  { id:3, emoji:'🐟', name:'ปลากะพงนึ่งซีอิ๊ว', cn:'清蒸石斑',
    desc:'ปลาสดนึ่งไฟอ่อน ราดน้ำมันร้อน ขิงและต้นหอม', price:520, cat:'อาหารหลัก' },
  { id:4, emoji:'🥟', name:'ติ่มซำรวม 5 อย่าง', cn:'点心拼盘',
    desc:'ฮะเก๋า ซิวม่าย ฉุ่นกวน ขนมผักกาด และขนมหัวไชเท้า', price:320, cat:'อาหารเรียกน้ำย่อย' },
  { id:5, emoji:'🍲', name:'ซุปเต้าหู้ไข่ปลา', cn:'鱼子豆腐汤',
    desc:'น้ำซุปใสกลมกล่อม เต้าหู้ไหม ไข่ปลา และผักโขม', price:180, cat:'ซุปและน้ำแกง' },
  { id:6, emoji:'🍜', name:'บะหมี่ไข่กุ้งล็อบสเตอร์', cn:'龙虾蛋面',
    desc:'บะหมี่ไข่รีดมือ ในน้ำซุปล็อบสเตอร์เข้มข้น', price:480, cat:'ข้าวและก๋วยเตี๋ยว' },
  { id:7, emoji:'🧁', name:'บัวลอยทรงเครื่อง', cn:'汤圆',
    desc:'บัวลอยแป้งข้าวเหนียว ไส้งาดำ ในน้ำขิงอุ่น', price:120, cat:'ของหวาน' },
  { id:8, emoji:'🫖', name:'ชาหวงจินกุ้ย', cn:'黄金桂茶',
    desc:'ชาอู่หลงพันธุ์หายาก กลิ่นดอกไม้ละมุน', price:160, cat:'เครื่องดื่ม' },
];

let menus = defaultMenus;
let cart = [];
let orders = [];
let orderCounter = 1;
let currentTable = 'โต๊ะ 1';
let currentOrderFilter = 'new';
let currentOrderTableFilter = 'all';
let menuIdCounter = 9;
let audioCtx = null;

// ── TABLE STATUS ─────────────────────────────────────
// Tracks, per physical dine-in table: whether it's occupied, the
// customer's name (optional), and how many people are seated there.
// Takeaway isn't a physical table so it's excluded from this tracking.
const DINE_IN_TABLES = ['โต๊ะ 1', 'โต๊ะ 2', 'โต๊ะ 3', 'โต๊ะ 4', 'โต๊ะ 5'];
let tables = {}; // { 'โต๊ะ 1': { occupied: false, name: '', pax: 0 }, ... }

function ensureTablesInit() {
  DINE_IN_TABLES.forEach(t => {
    if (!tables[t]) tables[t] = { occupied: false, name: '', pax: 0 };
  });
}

// ── PERSISTENCE ─────────────────────────────────────
// Everything used to live only in memory, so a page refresh, a crashed
// browser tab, or someone accidentally closing the app wiped out every
// order and menu edit. That's a serious problem for something meant to
// run a real restaurant, so state is now saved to localStorage after
// every change and restored on load.

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      menus, orders, orderCounter, menuIdCounter, currentTable, tables,
    }));
  } catch (e) { /* storage unavailable (private mode, quota, etc.) */ }
  syncToSheet(); // fire-and-forget push to Google Sheets; no-op if not configured
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const s = JSON.parse(raw);
    if (Array.isArray(s.menus)) menus = s.menus;
    if (Array.isArray(s.orders)) orders = s.orders;
    if (Number.isFinite(s.orderCounter)) orderCounter = s.orderCounter;
    if (Number.isFinite(s.menuIdCounter)) menuIdCounter = s.menuIdCounter;
    if (typeof s.currentTable === 'string') currentTable = s.currentTable;
    if (s.tables && typeof s.tables === 'object') tables = s.tables;
  } catch (e) { /* corrupted or unavailable storage — fall back to defaults */ }
}

// ── SAFETY ───────────────────────────────────────────
// User-entered text (menu names, cart notes, etc.) used to be dropped
// straight into innerHTML. Anyone typing something like <img onerror=...>
// into "เพิ่มเมนูใหม่" or the kitchen note would have it run as real HTML/JS.
// Everything rendered below now goes through this escaper first.

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// Service charge + VAT used to be calculated one way for the cart preview
// and a different (combined) way once the order was placed, so the total
// a customer saw before confirming could differ from the total on their
// receipt/kitchen ticket by a baht. Both places now share this function.
function calcTotals(subtotal) {
  const service = Math.round(subtotal * 0.10);
  const vat = Math.round(subtotal * 0.07);
  return { service, vat, total: subtotal + service + vat };
}

// ── AUDIO ──────────────────────────────────────────

function playNotifySound() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.15, 0.3].forEach((t, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.frequency.value = [660, 880, 1100][i];
      osc.type = 'sine';
      gain.gain.setValueAtTime(0, audioCtx.currentTime + t);
      gain.gain.linearRampToValueAtTime(0.3, audioCtx.currentTime + t + 0.05);
      gain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + t + 0.3);
      osc.start(audioCtx.currentTime + t);
      osc.stop(audioCtx.currentTime + t + 0.35);
    });
  } catch (e) { /* audio unavailable */ }
}

// ── NAVIGATION ─────────────────────────────────────

function showPage(page, btn) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
  if (btn) btn.classList.add('active');

  if (page === 'cart')    renderCart();
  if (page === 'orders')  { renderTableStatus(); renderOrderTableFilter(); renderOrders(); }
  if (page === 'summary') renderSummary();
  if (page === 'menu')    renderMenu();
  if (page === 'manage') {
    const input = document.getElementById('discord-webhook-url');
    if (input) input.value = getDiscordWebhookUrl();
    const statusEl = document.getElementById('discord-status');
    if (statusEl) { statusEl.textContent = ''; statusEl.className = 'discord-status'; }

    const doneInput = document.getElementById('discord-webhook-done-url');
    if (doneInput) doneInput.value = getDiscordWebhookDoneUrl();
    const doneStatusEl = document.getElementById('discord-status-done');
    if (doneStatusEl) { doneStatusEl.textContent = ''; doneStatusEl.className = 'discord-status'; }

    const sheetsInput = document.getElementById('sheets-webapp-url');
    if (sheetsInput) sheetsInput.value = getSheetsUrl();
    const sheetsStatusEl = document.getElementById('sheets-status');
    if (sheetsStatusEl) { sheetsStatusEl.textContent = ''; sheetsStatusEl.className = 'discord-status'; }
  }

  // Hide cart float when leaving menu
  if (page !== 'menu') {
    document.getElementById('cart-float').classList.remove('show');
  } else {
    updateCartUI();
  }
}

// ── TABLE SELECTION ────────────────────────────────

function selectTable(el) {
  document.querySelectorAll('.table-chip').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
  currentTable = el.dataset.table;
  document.getElementById('cart-header-table').textContent = currentTable;
}

// ── TABLE STATUS PANEL ─────────────────────────────
// Shows, at a glance, which tables are free and which still have
// customers — plus who's there and how many people, so staff can see
// it without walking the floor. "เคลียร์โต๊ะ" resets a table back to
// free once the customers have left and paid.

function renderTableStatus() {
  ensureTablesInit();
  const grid = document.getElementById('table-status-grid');
  if (!grid) return;

  grid.style.display = 'grid';
  grid.style.gridTemplateColumns = 'repeat(2, 1fr)';
  grid.style.gap = '10px';

  grid.innerHTML = DINE_IN_TABLES.map(t => {
    const info = tables[t] || { occupied: false, name: '', pax: 0 };
    const pending = orders.filter(o => o.table === t && (o.status === 'new' || o.status === 'cooking')).length;
    const borderColor = info.occupied ? 'rgba(196,74,74,.4)' : 'rgba(94,158,110,.4)';
    const bgColor = info.occupied ? 'rgba(196,74,74,.08)' : 'rgba(94,158,110,.08)';

    return `
      <div style="border:1px solid ${borderColor};background:${bgColor};
                  border-radius:14px;padding:12px;display:flex;flex-direction:column;gap:6px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:6px">
          <b>${escapeHtml(t)}</b>
          <span class="status-badge ${info.occupied ? 'status-new' : 'status-done'}">
            ${info.occupied ? '🔴 มีลูกค้า' : '🟢 ว่าง'}
          </span>
        </div>
        ${info.occupied ? `
          <div style="font-size:13px;color:var(--ink-soft)">
            ${info.name ? escapeHtml(info.name) : 'ไม่ระบุชื่อ'} · ${info.pax > 0 ? info.pax + ' คน' : 'ไม่ระบุจำนวนคน'}
          </div>` : ''}
        ${pending > 0 ? `<div style="font-size:12px;color:var(--ink-soft)">📋 ออเดอร์ค้าง ${pending} รายการ</div>` : ''}
        <div style="display:flex;gap:6px;margin-top:4px">
          <button class="order-action" onclick="openTable('${t}')">${info.occupied ? '✏️ แก้ไขข้อมูล' : '🧾 เปิดโต๊ะ'}</button>
          ${info.occupied ? `<button class="order-action primary" onclick="clearTable('${t}')">🧹 เคลียร์โต๊ะ</button>` : ''}
        </div>
      </div>`;
  }).join('');
}

// Marks a table occupied and records/updates who's sitting there and
// how many people, via simple prompts (kept consistent with the
// confirm()/alert() style already used elsewhere in this app).
function openTable(t) {
  ensureTablesInit();
  const current = tables[t] || { occupied: false, name: '', pax: 0 };

  const name = prompt(`ชื่อลูกค้า (${t}) — เว้นว่างได้:`, current.name || '');
  if (name === null) return; // cancelled

  const paxStr = prompt(`จำนวนลูกค้า (${t}):`, current.pax > 0 ? String(current.pax) : '1');
  if (paxStr === null) return; // cancelled

  const pax = parseInt(paxStr, 10);
  tables[t] = {
    occupied: true,
    name: name.trim(),
    pax: Number.isFinite(pax) && pax > 0 ? pax : 0,
  };

  renderTableStatus();
  saveState();
}

// Resets a table back to free once customers have left.
function clearTable(t) {
  if (!confirm(`เคลียร์ ${t}? โต๊ะจะว่างสำหรับลูกค้าใหม่`)) return;
  tables[t] = { occupied: false, name: '', pax: 0 };
  renderTableStatus();
  saveState();
}

// ── ORDER TABLE FILTER ─────────────────────────────
// Lets staff view each table's orders separately instead of one long
// mixed list — useful once several tables have orders in flight.

function renderOrderTableFilter() {
  const wrap = document.getElementById('order-table-filter');
  if (!wrap) return;
  const options = ['all', ...DINE_IN_TABLES, 'Takeaway'];

  wrap.innerHTML = options.map(t => `
    <button class="table-chip ${currentOrderTableFilter === t ? 'selected' : ''}"
      onclick="filterOrdersByTable('${t}', this)">${t === 'all' ? 'ทั้งหมด' : escapeHtml(t)}</button>
  `).join('');
}

function filterOrdersByTable(t, btn) {
  currentOrderTableFilter = t;
  document.querySelectorAll('#order-table-filter .table-chip').forEach(c => c.classList.remove('selected'));
  if (btn) btn.classList.add('selected');
  renderOrders();
}

// ── MENU RENDERING ─────────────────────────────────

function renderMenu() {
  const cats = [...new Set(menus.map(m => m.cat))];
  let html = '';

  cats.forEach(cat => {
    const items = menus.filter(m => m.cat === cat);
    if (!items.length) return;

    html += `<div class="section-label">${escapeHtml(cat)}</div><div class="menu-grid">`;
    items.forEach(m => {
      html += `
        <div class="menu-item">
          <div class="menu-emoji">${escapeHtml(m.emoji)}</div>
          <div class="menu-info">
            <div class="menu-name">${escapeHtml(m.name)}</div>
            ${m.cn ? `<div class="menu-name-cn">${escapeHtml(m.cn)}</div>` : ''}
            <div class="menu-desc">${escapeHtml(m.desc)}</div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px;flex-shrink:0">
            <div class="menu-price">${m.price.toLocaleString()}<span> บาท</span></div>
            <button class="add-btn" onclick="addToCart(${m.id}, event)">+</button>
          </div>
        </div>`;
    });
    html += '</div>';
  });

  document.getElementById('menu-list').innerHTML = html;
}

// ── CART OPERATIONS ────────────────────────────────

function addToCart(id, event) {
  const menu = menus.find(m => m.id === id);
  if (!menu) return;

  const existing = cart.find(c => c.id === id);
  if (existing) {
    existing.qty++;
  } else {
    cart.push({ id, name: menu.name, price: menu.price, qty: 1, emoji: menu.emoji });
  }

  updateCartUI();

  // Pulse feedback
  if (event && event.target) {
    const btn = event.target;
    btn.style.transform = 'scale(1.4)';
    setTimeout(() => { btn.style.transform = ''; }, 160);
  }
}

// NOTE: cart contents are intentionally kept out of localStorage — an
// in-progress, unconfirmed order shouldn't reappear on a different table
// or after the app is reopened. Only placed orders/menus/settings persist.

function updateCartUI() {
  const total = cart.reduce((s, c) => s + c.price * c.qty, 0);
  const count = cart.reduce((s, c) => s + c.qty, 0);

  const badge = document.getElementById('cart-badge');
  if (count > 0) {
    badge.style.display = 'block';
    badge.textContent = count;
  } else {
    badge.style.display = 'none';
  }

  const floatEl = document.getElementById('cart-float');
  const onMenuPage = document.getElementById('page-menu').classList.contains('active');

  if (count > 0 && onMenuPage) {
    floatEl.classList.add('show');
    document.getElementById('cart-float-count').textContent = `${count} รายการ`;
    document.getElementById('cart-float-total').textContent = `฿${total.toLocaleString()}`;
  } else {
    floatEl.classList.remove('show');
  }
}

function renderCart() {
  const listEl = document.getElementById('cart-list');
  document.getElementById('cart-header-table').textContent = currentTable;

  if (cart.length === 0) {
    listEl.innerHTML = `
      <div class="empty">
        <span class="empty-icon">🛒</span>
        <p>ยังไม่มีรายการ<br>เลือกอาหารจากเมนูก่อนนะคะ</p>
      </div>`;
    document.getElementById('cart-summary-box').innerHTML = '';
    return;
  }

  let html = '';
  cart.forEach((item, i) => {
    html += `
      <div class="cart-item">
        <div class="cart-item-emoji">${escapeHtml(item.emoji)}</div>
        <div class="cart-item-info">
          <div class="cart-item-name">${escapeHtml(item.name)}</div>
          <div class="cart-item-price">฿${(item.price * item.qty).toLocaleString()}</div>
        </div>
        <div class="qty-ctrl">
          <button class="qty-btn" onclick="changeQty(${i}, -1)">−</button>
          <span class="qty-num">${item.qty}</span>
          <button class="qty-btn" onclick="changeQty(${i}, 1)">+</button>
        </div>
      </div>`;
  });
  listEl.innerHTML = html;

  const subtotal = cart.reduce((s, c) => s + c.price * c.qty, 0);
  const { service, vat, total } = calcTotals(subtotal);

  document.getElementById('cart-summary-box').innerHTML = `
    <div class="cart-row"><span>ยอดรวม</span><span>฿${subtotal.toLocaleString()}</span></div>
    <div class="cart-row"><span>ค่าบริการ 10%</span><span>฿${service.toLocaleString()}</span></div>
    <div class="cart-row"><span>VAT 7%</span><span>฿${vat.toLocaleString()}</span></div>
    <div class="cart-row total"><span>ยอดสุทธิ</span><span>฿${total.toLocaleString()}</span></div>`;
}

function changeQty(i, delta) {
  cart[i].qty += delta;
  if (cart[i].qty <= 0) cart.splice(i, 1);
  updateCartUI();
  renderCart();
}

function placeOrder() {
  if (cart.length === 0) return;

  const subtotal = cart.reduce((s, c) => s + c.price * c.qty, 0);
  const { total } = calcTotals(subtotal);
  const now = new Date();

  const order = {
    id: orderCounter++,
    table: currentTable,
    items: [...cart],
    note: document.getElementById('cart-note-text').value.trim(),
    status: 'new',
    time: now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }),
    dateKey: toDateKey(now),
    total,
  };

  orders.unshift(order);
  cart = [];
  document.getElementById('cart-note-text').value = '';

  // Keep the table-status panel accurate even if staff forgot to
  // "เปิดโต๊ะ" manually before taking the order — placing an order for a
  // dine-in table marks it occupied (existing name/pax, if any, is kept).
  if (DINE_IN_TABLES.includes(currentTable)) {
    ensureTablesInit();
    tables[currentTable].occupied = true;
  }

  updateCartUI();
  updateOrdersBadge();
  triggerNotify(order);
  sendDiscordNotify(order);
  saveState();
  showPage('orders', document.getElementById('nav-orders'));
}

function toDateKey(d) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ── NOTIFICATION ───────────────────────────────────

function triggerNotify(order) {
  playNotifySound();
  document.getElementById('notify-msg').innerHTML =
    `<b>${order.table}</b> · ออเดอร์ #${order.id}<br>${order.items.length} รายการ · ฿${order.total.toLocaleString()}`;
  document.getElementById('notify-overlay').classList.add('show');

  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification('หยวนเซิน 源心 — ออเดอร์ใหม่!', {
      body: `${order.table} · ${order.items.map(i => i.name).join(', ')}`,
      icon: '',
    });
  }
}

function closeNotify() {
  document.getElementById('notify-overlay').classList.remove('show');
  filterOrders('new', document.querySelector('.order-tab'));
}

function testNotify() {
  triggerNotify({ id: 'TEST', table: 'โต๊ะ 1', items: [{ name: 'ทดสอบ' }], total: 0 });
}

// ── DISCORD NOTIFICATION ────────────────────────────
// New feature: when an order is confirmed, ping a Discord channel via an
// Incoming Webhook (configured in "จัดการร้าน" → แจ้งเตือน Discord).
// Discord webhook endpoints accept cross-origin POSTs, so this works
// straight from the browser with no backend needed.

const DISCORD_WEBHOOK_KEY = 'yuanxin-discord-webhook-url';

function getDiscordWebhookUrl() {
  try { return localStorage.getItem(DISCORD_WEBHOOK_KEY) || ''; }
  catch (e) { return ''; }
}

function saveDiscordWebhook() {
  const input = document.getElementById('discord-webhook-url');
  const val = input.value.trim();
  const statusEl = document.getElementById('discord-status');

  if (val && !/^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//.test(val)) {
    statusEl.textContent = '⚠️ ลิงก์ไม่ถูกต้อง ต้องขึ้นต้นด้วย https://discord.com/api/webhooks/...';
    statusEl.className = 'discord-status error';
    return;
  }

  try {
    if (val) localStorage.setItem(DISCORD_WEBHOOK_KEY, val);
    else localStorage.removeItem(DISCORD_WEBHOOK_KEY);
  } catch (e) {
    statusEl.textContent = '⚠️ บันทึกไม่สำเร็จ (พื้นที่จัดเก็บใช้งานไม่ได้)';
    statusEl.className = 'discord-status error';
    return;
  }

  statusEl.textContent = val ? '✅ บันทึกแล้ว ระบบจะแจ้งเตือน Discord ทุกออเดอร์ใหม่' : 'ปิดการแจ้งเตือน Discord แล้ว';
  statusEl.className = 'discord-status success';
}

async function testDiscordWebhook() {
  const statusEl = document.getElementById('discord-status');
  const url = document.getElementById('discord-webhook-url').value.trim() || getDiscordWebhookUrl();

  if (!url) {
    statusEl.textContent = '⚠️ กรุณาใส่และบันทึก Webhook URL ก่อนทดสอบ';
    statusEl.className = 'discord-status error';
    return;
  }

  statusEl.textContent = 'กำลังส่ง...';
  statusEl.className = 'discord-status';

  const ok = await sendDiscordNotify({
    id: 'TEST', table: 'โต๊ะทดสอบ', time: new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }),
    items: [{ name: 'ข้อความทดสอบระบบ', qty: 1, price: 0 }], total: 0, note: '',
  }, url);

  statusEl.textContent = ok ? '✅ ส่งสำเร็จ ลองเช็คช่อง Discord ของคุณ' : '⚠️ ส่งไม่สำเร็จ ตรวจสอบ URL และอินเทอร์เน็ต';
  statusEl.className = ok ? 'discord-status success' : 'discord-status error';
}

async function sendDiscordNotify(order, overrideUrl) {
  const url = overrideUrl || getDiscordWebhookUrl();
  if (!url) return false;

  const itemLines = order.items
    .map(i => `• ${escapeHtml(i.name)} × ${i.qty ?? 1}${i.price ? `  —  ฿${(i.price * (i.qty ?? 1)).toLocaleString()}` : ''}`)
    .join('\n');

  const fields = [
    { name: 'โต๊ะ', value: String(order.table), inline: true },
    { name: 'เวลา', value: String(order.time || ''), inline: true },
    { name: 'ยอดสุทธิ', value: `฿${Number(order.total || 0).toLocaleString()}`, inline: true },
    { name: 'รายการ', value: itemLines || '-', inline: false },
  ];
  if (order.note) fields.push({ name: '📝 หมายเหตุ', value: String(order.note), inline: false });

  const payload = {
    username: 'หยวนเซิน 源心',
    embeds: [{
      title: `🔔 ออเดอร์ใหม่ #${order.id}`,
      color: 0xC8A84B,
      fields,
      timestamp: new Date().toISOString(),
    }],
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch (e) {
    return false; // offline / blocked / bad URL — never let this break order flow
  }
}

// ── DISCORD NOTIFICATION (ORDER COMPLETED) ──────────
// Separate webhook that fires when staff mark an order "เสร็จแล้ว" (done)
// in the ออเดอร์ tab — kept independent from the "new order" webhook
// above so the two can point at the same channel or different ones.

const DISCORD_WEBHOOK_DONE_KEY = 'yuanxin-discord-webhook-done-url';

function getDiscordWebhookDoneUrl() {
  try { return localStorage.getItem(DISCORD_WEBHOOK_DONE_KEY) || ''; }
  catch (e) { return ''; }
}

function saveDiscordWebhookDone() {
  const input = document.getElementById('discord-webhook-done-url');
  const val = input.value.trim();
  const statusEl = document.getElementById('discord-status-done');

  if (val && !/^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//.test(val)) {
    statusEl.textContent = '⚠️ ลิงก์ไม่ถูกต้อง ต้องขึ้นต้นด้วย https://discord.com/api/webhooks/...';
    statusEl.className = 'discord-status error';
    return;
  }

  try {
    if (val) localStorage.setItem(DISCORD_WEBHOOK_DONE_KEY, val);
    else localStorage.removeItem(DISCORD_WEBHOOK_DONE_KEY);
  } catch (e) {
    statusEl.textContent = '⚠️ บันทึกไม่สำเร็จ (พื้นที่จัดเก็บใช้งานไม่ได้)';
    statusEl.className = 'discord-status error';
    return;
  }

  statusEl.textContent = val ? '✅ บันทึกแล้ว ระบบจะแจ้งเตือน Discord ทุกครั้งที่ออเดอร์เสร็จสิ้น' : 'ปิดการแจ้งเตือนนี้แล้ว';
  statusEl.className = 'discord-status success';
}

async function testDiscordWebhookDone() {
  const statusEl = document.getElementById('discord-status-done');
  const url = document.getElementById('discord-webhook-done-url').value.trim() || getDiscordWebhookDoneUrl();

  if (!url) {
    statusEl.textContent = '⚠️ กรุณาใส่และบันทึก Webhook URL ก่อนทดสอบ';
    statusEl.className = 'discord-status error';
    return;
  }

  statusEl.textContent = 'กำลังส่ง...';
  statusEl.className = 'discord-status';

  const ok = await sendDiscordNotifyDone({
    id: 'TEST', table: 'โต๊ะทดสอบ', time: new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }),
    items: [{ name: 'ข้อความทดสอบระบบ', qty: 1, price: 0 }], total: 0, note: '',
  }, url);

  statusEl.textContent = ok ? '✅ ส่งสำเร็จ ลองเช็คช่อง Discord ของคุณ' : '⚠️ ส่งไม่สำเร็จ ตรวจสอบ URL และอินเทอร์เน็ต';
  statusEl.className = ok ? 'discord-status success' : 'discord-status error';
}

async function sendDiscordNotifyDone(order, overrideUrl) {
  const url = overrideUrl || getDiscordWebhookDoneUrl();
  if (!url) return false;

  const itemLines = order.items
    .map(i => `• ${escapeHtml(i.name)} × ${i.qty ?? 1}${i.price ? `  —  ฿${(i.price * (i.qty ?? 1)).toLocaleString()}` : ''}`)
    .join('\n');

  const fields = [
    { name: 'โต๊ะ', value: String(order.table), inline: true },
    { name: 'เวลา', value: String(order.time || ''), inline: true },
    { name: 'ยอดสุทธิ', value: `฿${Number(order.total || 0).toLocaleString()}`, inline: true },
    { name: 'รายการ', value: itemLines || '-', inline: false },
  ];
  if (order.note) fields.push({ name: '📝 หมายเหตุ', value: String(order.note), inline: false });

  const payload = {
    username: 'หยวนเซิน 源心',
    embeds: [{
      title: `✅ ออเดอร์เสร็จสิ้น #${order.id}`,
      color: 0x4CAF50,
      fields,
      timestamp: new Date().toISOString(),
    }],
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch (e) {
    return false; // offline / blocked / bad URL — never let this break order flow
  }
}

// ── GOOGLE SHEETS DATABASE ───────────────────────────
// New feature: a Google Sheet (fronted by a tiny Google Apps Script Web
// App, since Sheets has no public HTTP API of its own) acts as a real
// database — menus + orders get pushed there on every saveState() call,
// giving durable, human-readable storage/reporting outside the browser,
// and a way to keep multiple devices (e.g. two order tablets) in sync.
// localStorage stays as the offline cache/fallback; the sheet is only
// used when the owner configures a Web App URL in "จัดการร้าน".

const SHEETS_URL_KEY = 'yuanxin-sheets-webapp-url';

function getSheetsUrl() {
  try { return localStorage.getItem(SHEETS_URL_KEY) || ''; }
  catch (e) { return ''; }
}

function saveSheetsUrl() {
  const input = document.getElementById('sheets-webapp-url');
  const val = input.value.trim();
  const statusEl = document.getElementById('sheets-status');

  if (val && !/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(val)) {
    statusEl.textContent = '⚠️ ลิงก์ไม่ถูกต้อง ต้องเป็น URL จากการ Deploy Web App (ลงท้ายด้วย /exec)';
    statusEl.className = 'discord-status error';
    return;
  }

  try {
    if (val) localStorage.setItem(SHEETS_URL_KEY, val);
    else localStorage.removeItem(SHEETS_URL_KEY);
  } catch (e) {
    statusEl.textContent = '⚠️ บันทึกไม่สำเร็จ (พื้นที่จัดเก็บใช้งานไม่ได้)';
    statusEl.className = 'discord-status error';
    return;
  }

  statusEl.textContent = val ? '✅ บันทึกแล้ว กำลังซิงก์ข้อมูลปัจจุบันขึ้น Sheet...' : 'ปิดการซิงก์ Google Sheet แล้ว';
  statusEl.className = 'discord-status success';
  if (val) {
    syncToSheet().then(ok => {
      statusEl.textContent = ok
        ? '✅ ซิงก์ข้อมูลขึ้น Google Sheet เรียบร้อยแล้ว'
        : '⚠️ บันทึก URL แล้ว แต่ซิงก์ครั้งแรกยังไม่สำเร็จ ลองกด "ทดสอบเชื่อมต่อ"';
      statusEl.className = ok ? 'discord-status success' : 'discord-status error';
    });
  }
}

async function testSheetsConnection() {
  const statusEl = document.getElementById('sheets-status');
  const url = document.getElementById('sheets-webapp-url').value.trim() || getSheetsUrl();

  if (!url) {
    statusEl.textContent = '⚠️ กรุณาใส่และบันทึก Web App URL ก่อนทดสอบ';
    statusEl.className = 'discord-status error';
    return;
  }

  statusEl.textContent = 'กำลังทดสอบการเชื่อมต่อ...';
  statusEl.className = 'discord-status';

  try {
    const res = await fetch(url + '?action=load');
    const data = await res.json();
    statusEl.textContent = data.ok
      ? `✅ เชื่อมต่อสำเร็จ (พบ ${data.data.menus.length} เมนู, ${data.data.orders.length} ออเดอร์ใน Sheet)`
      : '⚠️ เชื่อมต่อได้ แต่ Sheet ตอบกลับผิดพลาด ตรวจสอบว่าวางโค้ด Code.gs ถูกต้อง';
    statusEl.className = data.ok ? 'discord-status success' : 'discord-status error';
  } catch (e) {
    statusEl.textContent = '⚠️ เชื่อมต่อไม่สำเร็จ ตรวจสอบ URL และการตั้งค่า Deploy (Who has access ต้องเป็น "Anyone")';
    statusEl.className = 'discord-status error';
  }
}

// Fire-and-forget push of the full current state (menus + orders +
// counters) to the sheet. Uses text/plain as the content type instead of
// application/json purely so the browser treats it as a "simple request" —
// Apps Script Web Apps don't handle CORS preflight (OPTIONS) requests, so
// a header that triggers a preflight would make every sync silently fail.
async function syncToSheet() {
  const url = getSheetsUrl();
  if (!url) return false;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ menus, orders, orderCounter, menuIdCounter, tables }),
    });
    return res.ok;
  } catch (e) {
    return false; // offline / blocked / bad URL — never let this break order flow
  }
}

// Pull the latest state from the sheet and overwrite local state (and the
// localStorage cache) with it. Used on startup, and from the manual
// "ดึงข้อมูลล่าสุด" button, so multiple devices converge on what's in the
// sheet rather than each device's own local copy.
async function pullFromSheet() {
  const url = getSheetsUrl();
  if (!url) return false;
  try {
    const res = await fetch(url + '?action=load');
    const data = await res.json();
    if (!data.ok) return false;
    const s = data.data;
    if (Array.isArray(s.menus) && s.menus.length) menus = s.menus;
    if (Array.isArray(s.orders))                  orders = s.orders;
    if (Number.isFinite(s.orderCounter))           orderCounter = s.orderCounter;
    if (Number.isFinite(s.menuIdCounter))          menuIdCounter = s.menuIdCounter;
    if (s.tables && typeof s.tables === 'object')  tables = s.tables;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        menus, orders, orderCounter, menuIdCounter, currentTable, tables,
      }));
    } catch (e) { /* storage unavailable */ }
    return true;
  } catch (e) {
    return false;
  }
}

// Re-renders whatever's currently on screen after a background pull, so
// the manage page's manual refresh and the startup sync share one path.
function refreshViewsAfterSync() {
  renderMenu();
  updateOrdersBadge();
  const activePage = document.querySelector('.page.active');
  if (activePage && activePage.id === 'page-orders')  { renderTableStatus(); renderOrderTableFilter(); renderOrders(); }
  if (activePage && activePage.id === 'page-summary') renderSummary();
}

async function pullFromSheetManual() {
  const statusEl = document.getElementById('sheets-status');
  const url = document.getElementById('sheets-webapp-url').value.trim() || getSheetsUrl();

  if (!url) {
    statusEl.textContent = '⚠️ กรุณาใส่และบันทึก Web App URL ก่อน';
    statusEl.className = 'discord-status error';
    return;
  }

  statusEl.textContent = 'กำลังดึงข้อมูลล่าสุดจาก Sheet...';
  statusEl.className = 'discord-status';

  const ok = await pullFromSheet();
  if (ok) refreshViewsAfterSync();

  statusEl.textContent = ok
    ? '✅ ดึงข้อมูลล่าสุดเรียบร้อยแล้ว'
    : '⚠️ ดึงข้อมูลไม่สำเร็จ ตรวจสอบ URL และอินเทอร์เน็ต';
  statusEl.className = ok ? 'discord-status success' : 'discord-status error';
}

// ── ORDERS ─────────────────────────────────────────

const statusLabel = { new: 'รอรับ', cooking: 'กำลังทำ', done: 'เสร็จแล้ว', cancelled: 'ยกเลิก' };
const statusClass = { new: 'status-new', cooking: 'status-cooking', done: 'status-done', cancelled: 'status-cancelled' };

function updateOrdersBadge() {
  const newCount = orders.filter(o => o.status === 'new').length;
  const badge = document.getElementById('orders-badge');
  if (newCount > 0) {
    badge.style.display = 'block';
    badge.textContent = newCount;
  } else {
    badge.style.display = 'none';
  }
}

function filterOrders(filter, btn) {
  currentOrderFilter = filter;
  document.querySelectorAll('.order-tab').forEach(t => t.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderOrders();
}

function renderOrders() {
  const now = new Date();
  document.getElementById('order-date-label').textContent =
    now.toLocaleDateString('th-TH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  let filtered = currentOrderFilter === 'all'
    ? orders
    : orders.filter(o => o.status === currentOrderFilter);

  if (currentOrderTableFilter && currentOrderTableFilter !== 'all') {
    filtered = filtered.filter(o => o.table === currentOrderTableFilter);
  }

  if (filtered.length === 0) {
    document.getElementById('order-list').innerHTML = `
      <div class="empty">
        <span class="empty-icon">📋</span>
        <p>ไม่มีออเดอร์ในหมวดนี้</p>
      </div>`;
    return;
  }

  let html = '';
  filtered.forEach(o => {
    html += `
      <div class="order-card">
        <div class="order-card-head">
          <div>
            <span class="order-num">ออเดอร์ #${o.id}</span>
            <span class="table-tag"> · ${o.table}</span>
            <div class="order-time">${o.time}</div>
          </div>
          <span class="status-badge ${statusClass[o.status]}">${statusLabel[o.status]}</span>
        </div>
        <div class="order-card-body">
          ${o.items.map(i => `
            <div class="order-line">
              ${escapeHtml(i.emoji)} ${escapeHtml(i.name)}
              <span style="color:var(--ink-soft)">× ${i.qty}</span>
              <span class="line-right">฿${(i.price * i.qty).toLocaleString()}</span>
            </div>`).join('')}
          <div class="order-total">ยอดสุทธิ ฿${o.total.toLocaleString()}</div>
          ${o.note ? `<div class="order-note">📝 ${escapeHtml(o.note)}</div>` : ''}
        </div>
        <div class="order-card-foot">
          ${o.status === 'new' ? `
            <button class="order-action" onclick="setOrderStatus(${o.id},'cancelled')">ยกเลิก</button>
            <button class="order-action primary" onclick="setOrderStatus(${o.id},'cooking')">รับออเดอร์ →</button>` : ''}
          ${o.status === 'cooking' ? `
            <button class="order-action primary" onclick="setOrderStatus(${o.id},'done')">เสร็จแล้ว ✓</button>` : ''}
          ${(o.status === 'done' || o.status === 'cancelled') ? `
            <span style="font-size:12px;color:var(--ink-soft);padding:4px 0">— ปิดออเดอร์แล้ว —</span>` : ''}
        </div>
      </div>`;
  });

  document.getElementById('order-list').innerHTML = html;
}

function setOrderStatus(id, status) {
  const order = orders.find(o => o.id === id);
  if (order) order.status = status;
  updateOrdersBadge();
  renderOrders();
  renderTableStatus();
  renderSummary();
  saveState();
  if (order && status === 'done') sendDiscordNotifyDone(order);
}

// ── SUMMARY ────────────────────────────────────────

function renderSummary() {
  // Orders now persist across reloads, so "today" has to mean today's
  // date, not just "everything currently in memory" like before.
  const todayKey = toDateKey(new Date());
  const done = orders.filter(o => o.status === 'done' && (o.dateKey ? o.dateKey === todayKey : true));
  const totalRev = done.reduce((s, o) => s + o.total, 0);
  const totalOrders = done.length;
  const avg = totalOrders ? Math.round(totalRev / totalOrders) : 0;

  const itemCount = {};
  done.forEach(o => o.items.forEach(i => {
    itemCount[i.name] = (itemCount[i.name] || 0) + i.qty;
  }));
  const topItems = Object.entries(itemCount).sort((a, b) => b[1] - a[1]).slice(0, 5);

  document.getElementById('summary-content').innerHTML = `
    <div class="summary-card">
      <h3>ภาพรวมวันนี้</h3>
      <div class="stat-row">
        <div class="stat-box">
          <div class="stat-val">฿${totalRev.toLocaleString()}</div>
          <div class="stat-lbl">ยอดขายรวม</div>
        </div>
        <div class="stat-box">
          <div class="stat-val">${totalOrders}</div>
          <div class="stat-lbl">จำนวนออเดอร์</div>
        </div>
        <div class="stat-box">
          <div class="stat-val">฿${avg.toLocaleString()}</div>
          <div class="stat-lbl">เฉลี่ยต่อออเดอร์</div>
        </div>
        <div class="stat-box">
          <div class="stat-val">${orders.filter(o => o.status === 'new').length}</div>
          <div class="stat-lbl">รอรับ</div>
        </div>
      </div>
    </div>
    <div class="summary-card">
      <h3>เมนูขายดี</h3>
      ${topItems.length === 0
        ? '<p style="font-size:13px;color:var(--ink-soft);padding:6px 0">ยังไม่มีข้อมูล</p>'
        : topItems.map(([name, qty], i) => `
            <div class="top-item-row">
              <span>${['🥇','🥈','🥉','4.','5.'][i]} ${name}</span>
              <span class="top-item-num">${qty} จาน</span>
            </div>`).join('')}
    </div>`;
}

// ── MANAGE ─────────────────────────────────────────

function showAddMenu() {
  document.getElementById('add-menu-modal').classList.add('show');
}

function closeAddMenu() {
  document.getElementById('add-menu-modal').classList.remove('show');
}

function saveMenu() {
  const name  = document.getElementById('f-name').value.trim();
  const price = parseFloat(document.getElementById('f-price').value);
  if (!name || !Number.isFinite(price) || price <= 0) {
    alert('กรุณาใส่ชื่อเมนูและราคาที่ถูกต้อง (มากกว่า 0)');
    return;
  }

  menus.push({
    id:    menuIdCounter++,
    emoji: document.getElementById('f-emoji').value.trim() || '🍽️',
    name,
    cn:    document.getElementById('f-cn').value.trim(),
    desc:  document.getElementById('f-desc').value.trim(),
    price,
    cat:   document.getElementById('f-cat').value,
  });

  closeAddMenu();
  renderMenu();
  saveState();
  ['f-name', 'f-cn', 'f-desc', 'f-price'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('f-emoji').value = '🍜';
}

function showEditMenuList() {
  const panel = document.getElementById('edit-menu-panel');
  let html = `<div class="edit-panel">
    <div class="edit-panel-label">แตะ 🗑️ เพื่อลบเมนู</div>`;

  menus.forEach(m => {
    html += `
      <div class="edit-menu-row">
        <span style="font-size:22px">${escapeHtml(m.emoji)}</span>
        <div class="edit-menu-row-info">
          <div class="edit-menu-row-name">${escapeHtml(m.name)}</div>
          <div class="edit-menu-row-price">฿${m.price.toLocaleString()}</div>
        </div>
        <button class="delete-btn" onclick="deleteMenu(${m.id})">🗑️</button>
      </div>`;
  });

  html += '</div>';
  panel.innerHTML = html;
  panel.scrollIntoView({ behavior: 'smooth' });
}

function deleteMenu(id) {
  if (!confirm('ลบเมนูนี้?')) return;
  menus = menus.filter(m => m.id !== id);
  renderMenu();
  showEditMenuList();
  saveState();
}

function clearDoneOrders() {
  if (!confirm('ล้างออเดอร์ที่เสร็จแล้วทั้งหมด?')) return;
  orders = orders.filter(o => o.status !== 'done' && o.status !== 'cancelled');
  renderSummary();
  saveState();
  alert('ล้างเรียบร้อยแล้ว');
}

// ── INIT ───────────────────────────────────────────

loadState();
ensureTablesInit();

// Request notification permission after 2s
if ('Notification' in window && Notification.permission === 'default') {
  setTimeout(() => Notification.requestPermission(), 2000);
}

renderMenu();
updateOrdersBadge();

// If a Google Sheet is configured, pull the latest data in the background.
// The app already rendered from the local cache above, so this doesn't
// block startup — it just refreshes the view once the sheet responds,
// which is what keeps two devices (e.g. two order tablets) converging on
// the same data instead of drifting apart.
if (getSheetsUrl()) {
  pullFromSheet().then(ok => { if (ok) refreshViewsAfterSync(); });
}

// Register the service worker so the app keeps working (menu, cart, and
// already-loaded orders) even without a signal — matches the "ใช้งานได้แม้
// ไม่มีอินเทอร์เน็ต" (works offline) claim on the จัดการร้าน page, which
// previously wasn't actually true since there was no service worker or
// manifest at all. Only takes effect when served over http(s), not file://.
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
