/* ==========================================================================
   web-sitesi-ornek-sablon — Staff / Kitchen Panel
   ========================================================================== */

const board = document.getElementById("board");
const emptyState = document.getElementById("emptyState");
const orderCount = document.getElementById("orderCount");
const filters = document.querySelectorAll(".filter");
const soundToggle = document.getElementById("soundToggle");

// Ödeme modalı elementleri
const paymentModal = document.getElementById("paymentModal");
const paymentModalBackdrop = document.getElementById("paymentModalBackdrop");
const paymentModalTable = document.getElementById("paymentModalTable");
const paymentModalTotal = document.getElementById("paymentModalTotal");
const paymentModalCancel = document.getElementById("paymentModalCancel");
const paymentModalConfirm = document.getElementById("paymentModalConfirm");

// Ürün Değiştirme Modalı Elementleri
const exchangeModal = document.getElementById("exchangeModal");
const exchangeModalBackdrop = document.getElementById("exchangeModalBackdrop");
const exchangeModalClose = document.getElementById("exchangeModalClose");
const exchangeModalCancel = document.getElementById("exchangeModalCancel");
const exchangeModalConfirm = document.getElementById("exchangeModalConfirm");
const exchangeModalTitle = document.getElementById("exchangeModalTitle");
const exchangeModalSub = document.getElementById("exchangeModalSub");
const exchangeSearchInput = document.getElementById("exchangeSearchInput");
const exchangeCategories = document.getElementById("exchangeCategories");
const exchangeProductList = document.getElementById("exchangeProductList");
const exchangeSetPrepCheckbox = document.getElementById("exchangeSetPrepCheckbox");

// Ürün İptal Modalı Elementleri
const cancelItemModal = document.getElementById("cancelItemModal");
const cancelItemModalBackdrop = document.getElementById("cancelItemModalBackdrop");
const cancelItemModalCancel = document.getElementById("cancelItemModalCancel");
const cancelItemModalConfirm = document.getElementById("cancelItemModalConfirm");
const cancelItemModalDesc = document.getElementById("cancelItemModalDesc");
const cancelQtyChoice = document.getElementById("cancelQtyChoice");
const cancelOneQtyBtn = document.getElementById("cancelOneQtyBtn");
const cancelAllQtyBtn = document.getElementById("cancelAllQtyBtn");

// Masayı İptal Etme Modalı Elementleri
const cancelOrderModal = document.getElementById("cancelOrderModal");
const cancelOrderModalBackdrop = document.getElementById("cancelOrderModalBackdrop");
const cancelOrderModalCancel = document.getElementById("cancelOrderModalCancel");
const cancelOrderModalConfirm = document.getElementById("cancelOrderModalConfirm");
const cancelOrderModalDesc = document.getElementById("cancelOrderModalDesc");

let currentFilter = "all";
let orders = [];
let menuProducts = [];
let menuCategories = [];
let soundEnabled = false;
let audioCtx = null;
let seenOrderIds = null;
let seenRequestIds = new Set();
const FLASH_DURATION_MS = 5400;
const flashUntil = new Map();

// Aktif modal durumları
let pendingCloseOrderId = null;
let activeExchangeOrderId = null;
let activeExchangeItemIndex = null;
let selectedReplacementProduct = null;
let activeExchangeCat = "all";

let activeCancelOrderId = null;
let activeCancelItemIndex = null;
let activeCancelQtyMode = "one"; // "one" veya "all"

let activeCancelWholeOrderId = null;

/* --------------------------------------------------------------------------
   Ses bildirimi
   -------------------------------------------------------------------------- */
soundToggle.addEventListener("click", () => {
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    soundEnabled = true;
    soundToggle.classList.add("is-enabled");
  } catch {
    soundEnabled = false;
  }
});

function playAlertTone() {
  if (!soundEnabled || !audioCtx) return;
  audioCtx.resume();
  [880, 1046.5].forEach((freq, i) => {
    const oscillator = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.2, audioCtx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.25);
    oscillator.connect(gain).connect(audioCtx.destination);
    const start = audioCtx.currentTime + i * 0.18;
    oscillator.start(start);
    oscillator.stop(start + 0.25);
  });
}

/* --------------------------------------------------------------------------
   Sabit etiket ve aksiyon haritaları
   -------------------------------------------------------------------------- */
const STATUS_LABEL = {
  new: "Yeni",
  preparing: "Hazırlanıyor",
  ready: "Hazır",
  delivered: "Teslim Edildi",
};

const NEXT_ACTION = {
  new: { status: "preparing", label: "Hazırla" },
  preparing: { status: "ready", label: "Hazır" },
  ready: { status: "delivered", label: "Teslim" },
};

/* --------------------------------------------------------------------------
   Filtre butonları
   -------------------------------------------------------------------------- */
filters.forEach((btn) => {
  btn.addEventListener("click", () => {
    currentFilter = btn.dataset.filter;
    filters.forEach((f) => f.classList.remove("is-active"));
    btn.classList.add("is-active");
    render();
  });
});

/* --------------------------------------------------------------------------
   API: Menüyü çek
   -------------------------------------------------------------------------- */
async function fetchMenu() {
  try {
    const res = await fetch("/api/menu");
    if (!res.ok) return;
    const data = await res.json();
    if (data && Array.isArray(data.products)) {
      menuProducts = data.products.filter((p) => p.active !== false);
    }
    if (data && Array.isArray(data.categories)) {
      menuCategories = data.categories;
    }
  } catch (e) {
    // ignore menu fetch error
  }
}

/* --------------------------------------------------------------------------
   API: Siparişleri çek
   -------------------------------------------------------------------------- */
async function fetchOrders() {
  try {
    const res = await fetch("/api/orders");
    if (!res.ok) throw new Error("okunamadı");
    orders = await res.json();

    const currentIds = new Set(orders.map((o) => o.id));

    if (seenOrderIds === null) {
      seenOrderIds = currentIds;
    } else {
      const newIds = [...currentIds].filter((id) => !seenOrderIds.has(id));
      if (newIds.length) {
        playAlertTone();
        newIds.forEach((id) => flashUntil.set(id, Date.now() + FLASH_DURATION_MS));
      }
      newIds.forEach((id) => seenOrderIds.add(id));
    }

    // Yeni müşteri iptal/değişim talebi geldi mi kontrolü
    orders.forEach((o) => {
      if (Array.isArray(o.customerRequests)) {
        o.customerRequests.forEach((req) => {
          if (!req.resolved && !seenRequestIds.has(req.id)) {
            seenRequestIds.add(req.id);
            playAlertTone();
            flashUntil.set(o.id, Date.now() + FLASH_DURATION_MS);
          }
        });
      }
    });

    render();
  } catch {
    emptyState.textContent = "Sunucuya bağlanılamadı.";
    emptyState.hidden = false;
  }
}

/* --------------------------------------------------------------------------
   Yardımcı: Sipariş toplam tutarını hesapla
   -------------------------------------------------------------------------- */
function calcOrderTotal(order) {
  return (order.items || []).reduce((sum, item) => {
    return sum + (Number(item.price) || 0) * (Number(item.qty) || 1);
  }, 0);
}

/* --------------------------------------------------------------------------
   Render: Sipariş kartlarını oluştur
   -------------------------------------------------------------------------- */
function render() {
  const visible =
    currentFilter === "all"
      ? orders
      : orders.filter((o) => o.status === currentFilter);

  orderCount.textContent = `${orders.length} aktif`;

  board.querySelectorAll(".order").forEach((el) => el.remove());

  if (!visible.length) {
    emptyState.hidden = false;
    emptyState.textContent = "Henüz sipariş yok.";
    return;
  }

  emptyState.hidden = true;

  visible.forEach((order) => {
    const card = document.createElement("article");
    card.className = `order is-${order.status}`;
    card.dataset.id = order.id;

    // Aktif müşteri talepleri (İptal / Değişim)
    const activeRequests = (order.customerRequests || []).filter((r) => !r.resolved);
    const requestsHtml = activeRequests
      .map((req) => {
        const isCancel = req.type === "cancel";
        return `
        <div class="order-request-banner" data-request-id="${req.id}">
          <div class="order-request-banner__top">
            <span class="order-request-banner__title">
              ${isCancel ? "❌ Müşteri İptal Talebi" : "🔄 Müşteri Değişim Talebi"}
            </span>
            <span class="order__time">${formatTime(req.createdAt)}</span>
          </div>
          <p class="order-request-banner__text">
            <strong>${escapeHtml(req.itemName)}</strong> ${isCancel ? "ürününü iptal/iade etmek istiyor." : (req.targetItem ? `ürünü <strong>${escapeHtml(req.targetItem)}</strong> ile değiştirmek istiyor.` : "ürünü değiştirmek istiyor.")}
            ${req.note ? `<br/><em style="font-size:0.8rem; color:var(--cream-dim);">Not: "${escapeHtml(req.note)}"</em>` : ""}
          </p>
          <div class="order-request-banner__actions">
            <button type="button" class="btn-request-action btn-request-action--apply" data-action="apply-request" data-order-id="${order.id}" data-request-id="${req.id}" data-item-name="${escapeHtml(req.itemName)}" data-type="${req.type}">
              ${isCancel ? "İptal İşlemini Aç" : "Değişim İşlemini Aç"}
            </button>
            <button type="button" class="btn-request-action btn-request-action--dismiss" data-action="dismiss-request" data-order-id="${order.id}" data-request-id="${req.id}">
              ✓ Çözüldü / Kapat
            </button>
          </div>
        </div>`;
      })
      .join("");

    const itemsHtml = (order.items || [])
      .map((item, idx) => {
        const itemLineTotal = (Number(item.price) || 0) * (Number(item.qty) || 1);
        return `
        <li class="${item.isNew ? "is-new-item" : ""}">
          <div class="order-item-left">
            <span class="order-item-title">
              ${escapeHtml(item.name)}
              ${item.isNew ? `<span class="order-item-badge-new">YENİ</span>` : ""}
            </span>
            ${item.exchangedFrom ? `<span class="order-item-sub">(${escapeHtml(item.exchangedFrom)} yerine)</span>` : ""}
          </div>
          <div class="order-item-right">
            <span class="order-item-price">${itemLineTotal} ₺</span>
            <span class="order__qty">×${item.qty}</span>
            <div class="order-item-actions">
              <button type="button" class="item-action-btn item-action-btn--exchange" data-action="open-exchange" data-order-id="${order.id}" data-item-index="${idx}" title="Bu Ürünü Değiştir">
                🔄 Değiştir
              </button>
              <button type="button" class="item-action-btn item-action-btn--cancel" data-action="open-cancel-item" data-order-id="${order.id}" data-item-index="${idx}" title="Bu Ürünü İptal/İade Et">
                ❌ İade/İptal
              </button>
            </div>
          </div>
        </li>`;
      })
      .join("");

    const next = NEXT_ACTION[order.status];
    const time = formatTime(order.createdAt);
    const total = calcOrderTotal(order);

    card.innerHTML = `
      <div class="order__top">
        <h2 class="order__table">
          Masa ${escapeHtml(order.table)}
          ${order.hasNewItems ? `<span class="order-badge-has-new">Yeni Sipariş</span>` : ""}
        </h2>
        <span class="order__time">${time}</span>
      </div>
      <span class="order__status">${STATUS_LABEL[order.status] || order.status}</span>
      
      ${requestsHtml}

      <ul class="order__items">${itemsHtml}</ul>
      ${order.note ? `<p class="order__note">${escapeHtml(order.note)}</p>` : ""}
      <div class="order__total">
        <span class="order__total-label">Toplam Tutar</span>
        <span class="order__total-amount">${total} ₺</span>
      </div>
      <div class="order__actions">
        ${next ? `<button type="button" class="is-primary" data-status="${next.status}">${next.label}</button>` : ""}
        ${order.status === "delivered" ? `<button type="button" data-status="preparing" title="Değişim sonrası mutfak için tekrar hazırlığa al">⏳ Tekrar Hazırla</button>` : ""}
        <button type="button" data-action="open-cancel-order" class="btn-order-cancel-all" title="Masa siparişini tamamen iptal et">İptal Et</button>
        <button type="button" data-action="close-with-payment" class="${order.status === 'delivered' ? 'is-primary' : ''}">Kapat (Ödeme)</button>
      </div>
    `;

    const flashExpiry = flashUntil.get(order.id);
    if (flashExpiry) {
      if (flashExpiry > Date.now()) {
        card.classList.add("is-flash");
      } else {
        flashUntil.delete(order.id);
      }
    }

    board.appendChild(card);
  });
}

/* --------------------------------------------------------------------------
   Board tıklama olayları
   -------------------------------------------------------------------------- */
board.addEventListener("click", async (e) => {
  // Durum değiştirme butonları: Hazırla / Hazır / Teslim / Tekrar Hazırla
  const statusBtn = e.target.closest("button[data-status]");
  if (statusBtn) {
    const card = statusBtn.closest(".order");
    const id = card?.dataset.id;
    const status = statusBtn.dataset.status;
    if (!id) return;

    statusBtn.disabled = true;
    try {
      const res = await fetch(`/api/orders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("güncellenemedi");
      await fetchOrders();
    } catch {
      statusBtn.disabled = false;
    }
    return;
  }

  // Müşteri talebini çözüldü olarak işaretle
  const dismissBtn = e.target.closest('[data-action="dismiss-request"]');
  if (dismissBtn) {
    const orderId = dismissBtn.dataset.orderId;
    const requestId = dismissBtn.dataset.requestId;
    try {
      await fetch(`/api/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resolve-request", requestId }),
      });
      await fetchOrders();
    } catch {}
    return;
  }

  // Müşteri talebini uygula
  const applyBtn = e.target.closest('[data-action="apply-request"]');
  if (applyBtn) {
    const orderId = applyBtn.dataset.orderId;
    const itemName = applyBtn.dataset.itemName;
    const reqType = applyBtn.dataset.type;

    const order = orders.find((o) => o.id === orderId);
    if (!order) return;

    const itemIdx = (order.items || []).findIndex((i) => i.name === itemName);
    if (itemIdx === -1) return;

    if (reqType === "cancel") {
      openCancelItemModal(orderId, itemIdx);
    } else {
      openExchangeModal(orderId, itemIdx);
    }
    return;
  }

  // Ürün Değiştirme Modalını Aç
  const exchangeBtn = e.target.closest('[data-action="open-exchange"]');
  if (exchangeBtn) {
    const orderId = exchangeBtn.dataset.orderId;
    const itemIndex = Number(exchangeBtn.dataset.itemIndex);
    openExchangeModal(orderId, itemIndex);
    return;
  }

  // Ürün İptal Modalını Aç
  const cancelItemBtn = e.target.closest('[data-action="open-cancel-item"]');
  if (cancelItemBtn) {
    const orderId = cancelItemBtn.dataset.orderId;
    const itemIndex = Number(cancelItemBtn.dataset.itemIndex);
    openCancelItemModal(orderId, itemIndex);
    return;
  }

  // Tüm Masayı İptal Et Modalını Aç
  const cancelOrderBtn = e.target.closest('[data-action="open-cancel-order"]');
  if (cancelOrderBtn) {
    const card = cancelOrderBtn.closest(".order");
    const id = card?.dataset.id;
    if (!id) return;
    openCancelOrderModal(id);
    return;
  }

  // Kapat butonu → ödeme onayı modalını aç
  const closeBtn = e.target.closest('[data-action="close-with-payment"]');
  if (closeBtn) {
    const card = closeBtn.closest(".order");
    const id = card?.dataset.id;
    if (!id) return;

    const order = orders.find((o) => o.id === id);
    if (!order) return;

    const total = calcOrderTotal(order);
    pendingCloseOrderId = id;

    paymentModalTable.textContent = `Masa ${order.table}`;
    paymentModalTotal.textContent = `${total} ₺`;
    paymentModal.hidden = false;
  }
});

/* --------------------------------------------------------------------------
   Ürün Değiştirme Modalı Mantığı
   -------------------------------------------------------------------------- */
function openExchangeModal(orderId, itemIndex) {
  const order = orders.find((o) => o.id === orderId);
  if (!order || !order.items[itemIndex]) return;

  activeExchangeOrderId = orderId;
  activeExchangeItemIndex = itemIndex;
  selectedReplacementProduct = null;
  activeExchangeCat = "all";
  exchangeSearchInput.value = "";
  exchangeModalConfirm.disabled = true;

  const currentItem = order.items[itemIndex];
  exchangeModalSub.textContent = `Masa ${order.table} • Değiştirilecek: ${currentItem.name} (${currentItem.price} ₺) ×${currentItem.qty}`;

  renderExchangeCategories();
  renderExchangeProducts();
  exchangeModal.hidden = false;
}

function closeExchangeModal() {
  exchangeModal.hidden = true;
  activeExchangeOrderId = null;
  activeExchangeItemIndex = null;
  selectedReplacementProduct = null;
}

function renderExchangeCategories() {
  const cats = [{ id: "all", name: "Tümü" }, ...(menuCategories || [])];
  exchangeCategories.innerHTML = cats
    .map(
      (c) => `<button type="button" class="exchange-cat-pill ${activeExchangeCat === c.id ? "is-active" : ""}" data-cat="${c.id}">${escapeHtml(c.name)}</button>`
    )
    .join("");
}

exchangeCategories.addEventListener("click", (e) => {
  const btn = e.target.closest(".exchange-cat-pill");
  if (!btn) return;
  activeExchangeCat = btn.dataset.cat;
  renderExchangeCategories();
  renderExchangeProducts();
});

exchangeSearchInput.addEventListener("input", () => {
  renderExchangeProducts();
});

function renderExchangeProducts() {
  const order = orders.find((o) => o.id === activeExchangeOrderId);
  const currentPrice = order && order.items[activeExchangeItemIndex] ? order.items[activeExchangeItemIndex].price : 0;
  const q = exchangeSearchInput.value.trim().toLowerCase();

  let list = menuProducts.slice();
  if (activeExchangeCat !== "all") {
    list = list.filter((p) => p.category === activeExchangeCat);
  }
  if (q) {
    list = list.filter((p) => (p.name && p.name.toLowerCase().includes(q)) || (p.desc && p.desc.toLowerCase().includes(q)));
  }

  if (!list.length) {
    exchangeProductList.innerHTML = `<p style="padding:1rem; text-align:center; color:var(--cream-dim); font-size:0.85rem;">Eşleşen ürün bulunamadı.</p>`;
    return;
  }

  exchangeProductList.innerHTML = list
    .map((p) => {
      const isSel = selectedReplacementProduct && selectedReplacementProduct.name === p.name;
      const diff = p.price - currentPrice;
      let diffHtml = "";
      if (diff > 0) {
        diffHtml = `<span class="exchange-item-diff diff--plus">+${diff} ₺</span>`;
      } else if (diff < 0) {
        diffHtml = `<span class="exchange-item-diff diff--minus">${diff} ₺</span>`;
      } else {
        diffHtml = `<span class="exchange-item-diff diff--equal">Aynı Fiyat</span>`;
      }

      return `
      <div class="exchange-item-row ${isSel ? "is-selected" : ""}" data-pname="${escapeHtml(p.name)}" data-pprice="${p.price}">
        <div>
          <div class="exchange-item-name">${escapeHtml(p.name)}</div>
          ${p.desc ? `<div class="exchange-item-desc">${escapeHtml(p.desc)}</div>` : ""}
        </div>
        <div class="exchange-item-meta">
          <span class="exchange-item-price">${p.price} ₺</span>
          ${diffHtml}
        </div>
      </div>`;
    })
    .join("");
}

exchangeProductList.addEventListener("click", (e) => {
  const row = e.target.closest(".exchange-item-row");
  if (!row) return;

  const name = row.dataset.pname;
  const price = Number(row.dataset.pprice) || 0;
  selectedReplacementProduct = { name, price };

  exchangeProductList.querySelectorAll(".exchange-item-row").forEach((r) => r.classList.remove("is-selected"));
  row.classList.add("is-selected");

  exchangeModalConfirm.disabled = false;
  exchangeModalConfirm.textContent = `Değişimi Onayla (${name})`;
});

exchangeModalConfirm.addEventListener("click", async () => {
  if (!activeExchangeOrderId || activeExchangeItemIndex === null || !selectedReplacementProduct) return;

  exchangeModalConfirm.disabled = true;
  exchangeModalConfirm.textContent = "Güncelleniyor...";

  const setStatus = exchangeSetPrepCheckbox.checked ? "preparing" : null;

  try {
    const res = await fetch(`/api/orders/${activeExchangeOrderId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "exchange-item",
        itemIndex: activeExchangeItemIndex,
        newItem: selectedReplacementProduct,
        setStatus,
      }),
    });
    if (!res.ok) throw new Error("Değişim yapılamadı.");
    closeExchangeModal();
    await fetchOrders();
  } catch (err) {
    alert(err.message || "Hata oluştu.");
  } finally {
    exchangeModalConfirm.disabled = false;
    exchangeModalConfirm.textContent = "Değişimi Tamamla";
  }
});

exchangeModalClose.addEventListener("click", closeExchangeModal);
exchangeModalCancel.addEventListener("click", closeExchangeModal);
exchangeModalBackdrop.addEventListener("click", closeExchangeModal);

/* --------------------------------------------------------------------------
   Ürün İptal / İade Modalı Mantığı
   -------------------------------------------------------------------------- */
function openCancelItemModal(orderId, itemIndex) {
  const order = orders.find((o) => o.id === orderId);
  if (!order || !order.items[itemIndex]) return;

  activeCancelOrderId = orderId;
  activeCancelItemIndex = itemIndex;
  activeCancelQtyMode = "one";

  const currentItem = order.items[itemIndex];
  cancelItemModalDesc.innerHTML = `<strong>Masa ${order.table}</strong> adisyonundaki <strong>${escapeHtml(currentItem.name)}</strong> (${currentItem.price} ₺) ürününü iptal / iade etmek istiyor musunuz?`;

  if (currentItem.qty > 1) {
    cancelQtyChoice.hidden = false;
    cancelOneQtyBtn.textContent = `1 Adet İptal Et (Kalan: ${currentItem.qty - 1})`;
    cancelAllQtyBtn.textContent = `Tümünü İptal Et (${currentItem.qty} Adet)`;
    cancelOneQtyBtn.classList.add("is-active");
    cancelAllQtyBtn.classList.remove("is-active");
  } else {
    cancelQtyChoice.hidden = true;
  }

  cancelItemModal.hidden = false;
}

function closeCancelItemModal() {
  cancelItemModal.hidden = true;
  activeCancelOrderId = null;
  activeCancelItemIndex = null;
}

cancelOneQtyBtn.addEventListener("click", () => {
  activeCancelQtyMode = "one";
  cancelOneQtyBtn.classList.add("is-active");
  cancelAllQtyBtn.classList.remove("is-active");
});

cancelAllQtyBtn.addEventListener("click", () => {
  activeCancelQtyMode = "all";
  cancelAllQtyBtn.classList.add("is-active");
  cancelOneQtyBtn.classList.remove("is-active");
});

cancelItemModalConfirm.addEventListener("click", async () => {
  if (!activeCancelOrderId || activeCancelItemIndex === null) return;

  const order = orders.find((o) => o.id === activeCancelOrderId);
  const currentItem = order?.items[activeCancelItemIndex];
  const cancelQty = activeCancelQtyMode === "one" && currentItem?.qty > 1 ? 1 : (currentItem?.qty || 1);

  cancelItemModalConfirm.disabled = true;
  cancelItemModalConfirm.textContent = "İptal Ediliyor...";

  try {
    const res = await fetch(`/api/orders/${activeCancelOrderId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "cancel-item",
        itemIndex: activeCancelItemIndex,
        cancelQty,
      }),
    });
    if (!res.ok) throw new Error("İptal işlemi başarısız.");
    closeCancelItemModal();
    await fetchOrders();
  } catch (err) {
    alert(err.message || "Hata oluştu.");
  } finally {
    cancelItemModalConfirm.disabled = false;
    cancelItemModalConfirm.textContent = "✓ İptali Onayla";
  }
});

cancelItemModalCancel.addEventListener("click", closeCancelItemModal);
cancelItemModalBackdrop.addEventListener("click", closeCancelItemModal);

/* --------------------------------------------------------------------------
   Masayı İptal Etme Modalı Mantığı
   -------------------------------------------------------------------------- */
function openCancelOrderModal(orderId) {
  const order = orders.find((o) => o.id === orderId);
  if (!order) return;
  activeCancelWholeOrderId = orderId;
  cancelOrderModalDesc.textContent = `Masa ${order.table} siparişi tamamen iptal edilecek ve adisyondan kaldırılacaktır. Onaylıyor musunuz?`;
  cancelOrderModal.hidden = false;
}

function closeCancelOrderModal() {
  cancelOrderModal.hidden = true;
  activeCancelWholeOrderId = null;
}

cancelOrderModalConfirm.addEventListener("click", async () => {
  if (!activeCancelWholeOrderId) return;

  cancelOrderModalConfirm.disabled = true;
  cancelOrderModalConfirm.textContent = "İptal Ediliyor...";

  try {
    const res = await fetch(`/api/orders/${activeCancelWholeOrderId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "cancel-order" }),
    });
    if (!res.ok) throw new Error("Sipariş iptal edilemedi.");
    closeCancelOrderModal();
    await fetchOrders();
  } catch (err) {
    alert(err.message || "Hata oluştu.");
  } finally {
    cancelOrderModalConfirm.disabled = false;
    cancelOrderModalConfirm.textContent = "✓ Siparişi İptal Et";
  }
});

cancelOrderModalCancel.addEventListener("click", closeCancelOrderModal);
cancelOrderModalBackdrop.addEventListener("click", closeCancelOrderModal);

/* --------------------------------------------------------------------------
   Ödeme Onayı Modalı
   -------------------------------------------------------------------------- */
function closePaymentModal() {
  paymentModal.hidden = true;
  pendingCloseOrderId = null;
}

if (paymentModalCancel) paymentModalCancel.addEventListener("click", closePaymentModal);
if (paymentModalBackdrop) paymentModalBackdrop.addEventListener("click", closePaymentModal);

if (paymentModalConfirm) {
  paymentModalConfirm.addEventListener("click", async () => {
    if (!pendingCloseOrderId) return;

    const id = pendingCloseOrderId;
    paymentModalConfirm.disabled = true;
    paymentModalConfirm.textContent = "Kapatılıyor...";

    try {
      const res = await fetch(`/api/orders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "done" }),
      });
      if (!res.ok) throw new Error("güncellenemedi");
      closePaymentModal();
      await fetchOrders();
    } catch {
      paymentModalConfirm.textContent = "Hata! Tekrar Dene";
    } finally {
      paymentModalConfirm.disabled = false;
      paymentModalConfirm.textContent = "✓ Ödeme Alındı, Kapat";
    }
  });
}

/* --------------------------------------------------------------------------
   Yardımcı fonksiyonlar
   -------------------------------------------------------------------------- */
function formatTime(iso) {
  try {
    return new Date(iso).toLocaleTimeString("tr-TR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* --------------------------------------------------------------------------
   Başlat
   -------------------------------------------------------------------------- */
fetchMenu();
fetchOrders();
setInterval(fetchOrders, 2000);

