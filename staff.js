const board = document.getElementById("board");
const emptyState = document.getElementById("emptyState");
const orderCount = document.getElementById("orderCount");
const filters = document.querySelectorAll(".filter");

let currentFilter = "all";
let orders = [];

const STATUS_LABEL = {
  new: "Yeni",
  preparing: "Hazırlanıyor",
  ready: "Hazır",
};

const NEXT_ACTION = {
  new: { status: "preparing", label: "Hazırla" },
  preparing: { status: "ready", label: "Hazır" },
  ready: { status: "done", label: "Teslim" },
};

filters.forEach((btn) => {
  btn.addEventListener("click", () => {
    currentFilter = btn.dataset.filter;
    filters.forEach((f) => f.classList.remove("is-active"));
    btn.classList.add("is-active");
    render();
  });
});

async function fetchOrders() {
  try {
    const res = await fetch("/api/orders");
    if (!res.ok) throw new Error("okunamadı");
    orders = await res.json();
    render();
  } catch {
    emptyState.textContent = "Sunucuya bağlanılamadı.";
    emptyState.hidden = false;
  }
}

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

    const itemsHtml = order.items
      .map(
        (item) => `
        <li>
          <span>${escapeHtml(item.name)}</span>
          <span class="order__qty">×${item.qty}</span>
        </li>`
      )
      .join("");

    const next = NEXT_ACTION[order.status];
    const time = formatTime(order.createdAt);

    card.innerHTML = `
      <div class="order__top">
        <h2 class="order__table">Masa ${escapeHtml(order.table)}</h2>
        <span class="order__time">${time}</span>
      </div>
      <span class="order__status">${STATUS_LABEL[order.status] || order.status}</span>
      <ul class="order__items">${itemsHtml}</ul>
      ${
        order.note
          ? `<p class="order__note">${escapeHtml(order.note)}</p>`
          : ""
      }
      <div class="order__actions">
        ${
          next
            ? `<button type="button" class="is-primary" data-status="${next.status}">${next.label}</button>`
            : ""
        }
        ${
          order.status !== "done"
            ? `<button type="button" data-status="done">Kapat</button>`
            : ""
        }
      </div>
    `;

    board.appendChild(card);
  });
}

board.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-status]");
  if (!btn) return;

  const card = btn.closest(".order");
  const id = card?.dataset.id;
  const status = btn.dataset.status;
  if (!id) return;

  btn.disabled = true;

  try {
    const res = await fetch(`/api/orders/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) throw new Error("güncellenemedi");
    await fetchOrders();
  } catch {
    btn.disabled = false;
  }
});

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

fetchOrders();
setInterval(fetchOrders, 2000);
